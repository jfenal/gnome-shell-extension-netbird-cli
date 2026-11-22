// SPDX-License-Identifier: GPL-3.0-or-later
//
// NetBird Quick Settings toggle. Drives the `netbird` CLI.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {NetbirdCli, Status} from './netbird/cli.js';
import {errorText, formatLocal, hostAddress, isProfilesDisabled, secondsUntil, STATUS_LABELS} from './netbird/parse.js';
import {StatusIcons} from './shell/icons.js';
import {pollIntervalSeconds} from './shell/polling.js';
import {VpnButtonGuard} from './shell/vpnButtonGuard.js';
import {autoExtendDue, autoExtendLeadSeconds} from './shell/autoExtend.js';

// Desktop entry shipped by NetBird's GUI package (netbird-ui).
const NETBIRD_DESKTOP_ID = 'netbird.desktop';

// Give up on an automatic renewal the user did not complete in the browser.
const AUTO_EXTEND_TIMEOUT_SECONDS = 5 * 60;

// Labels for the long-running actions while they are in flight.
const ACTION_LABELS = {
    up: 'Connecting…',
    down: 'Disconnecting…',
    extend: 'Extending session…',
    profile: 'Switching profile…',
};

function isCancelled(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

const NetbirdToggle = GObject.registerClass(
class NetbirdToggleImpl extends QuickSettings.QuickMenuToggle {
    _init(settings, cli, statusIcons, extension, indicator) {
        super._init({
            title: 'NetBird CLI',
            gicon: statusIcons.forState('Idle'),
            toggleMode: false,
        });

        this._settings = settings;
        this._cli = cli;
        this._statusIcons = statusIcons;
        this._extension = extension;
        this._indicator = indicator;
        this._status = Status.UNAVAILABLE;
        this._data = null;
        this._lastError = null;
        this._pendingAction = null;
        this._actionCancellable = null;
        this._lifeCancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._warnedExpiry = null;
        this._autoExtendDeadline = null;
        this._profilesDisabled = false;
        this._guardSawConnected = false;
        this._autoExtendTimeoutId = 0;
        this._lastConnected = false;
        this._notificationSource = null;
        this._vpnGuard = null;

        this._buildMenu();
        this.connect('clicked', () => this._onClicked());
        this._settings.connectObject(
            'changed::guard-gnome-vpn', () => this._syncVpnGuard(),
            'changed::auto-extend', () => this._syncAutoExtendItem(),
            this);
        this._syncVpnGuard();
        this.refresh();
    }

    _buildMenu() {
        this.menu.setHeader(this._statusIcons.forState('Idle'), 'NetBird CLI', '');

        this._infoSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._infoSection);
        this._infoItems = {};
        // Clicking an address or name row copies its value.
        this._copyValues = {};
        const copyable = ['ip', 'ipv6', 'fqdn'];
        for (const key of ['ip', 'ipv6', 'fqdn', 'peers', 'expiry', 'error']) {
            const reactive = copyable.includes(key);
            const item = new PopupMenu.PopupMenuItem('', {reactive});
            item.visible = false;
            if (reactive) {
                item.label.x_expand = true;
                item.add_child(new St.Icon({
                    icon_name: 'edit-copy-symbolic',
                    style_class: 'popup-menu-icon',
                }));
                item.connect('activate', () => {
                    St.Clipboard.get_default().set_text(
                        St.ClipboardType.CLIPBOARD, this._copyValues[key] ?? '');
                });
            }
            this._infoItems[key] = item;
            this._infoSection.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._profileMenu = new PopupMenu.PopupSubMenuMenuItem('Profile', false);
        this.menu.addMenuItem(this._profileMenu);
        // Load profiles lazily, each time the submenu opens.
        this._profileMenu.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._loadProfiles();
        });

        // Session row: extend now on the left, auto-extend checkbox on the right.
        this._extendItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        // Non-reactive items are drawn greyed out; this one holds live buttons.
        this._extendItem.remove_style_pseudo_class('insensitive');
        this.menu.addMenuItem(this._extendItem);
        const extendBox = new St.BoxLayout({x_expand: true});
        this._extendItem.add_child(extendBox);
        this._extendNowButton = new St.Button({
            style_class: 'button',
            style: 'padding: 6px 12px;',
            label: 'Extend now',
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        this._extendNowButton.connect('clicked', () => this._runAction('extend'));
        extendBox.add_child(this._extendNowButton);
        this._autoExtendIcon = new St.Icon({style_class: 'popup-menu-icon'});
        const autoBox = new St.BoxLayout({style: 'spacing: 6px;'});
        autoBox.add_child(this._autoExtendIcon);
        autoBox.add_child(new St.Label({text: 'Auto', y_align: Clutter.ActorAlign.CENTER}));
        this._autoExtendButton = new St.Button({
            style_class: 'button',
            style: 'padding: 6px 12px;',
            child: autoBox,
            can_focus: true,
            accessible_name: 'Auto-extend session',
            x_align: Clutter.ActorAlign.END,
        });
        this._autoExtendButton.connect('clicked', () => {
            this._settings.set_boolean('auto-extend', !this._settings.get_boolean('auto-extend'));
        });
        extendBox.add_child(this._autoExtendButton);
        this._syncAutoExtendItem();

        // Window shortcuts share one row.
        const linksItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const linksBox = new St.BoxLayout({x_expand: true});
        for (const [label, onClicked, align] of [
            ['Open NetBird', () => this._openNetbird(), Clutter.ActorAlign.START],
            ['Extension Settings', () => this._openPrefs('extension'), Clutter.ActorAlign.END],
        ]) {
            const button = new St.Button({
                style_class: 'button',
                style: 'padding: 6px 12px;',
                label,
                can_focus: true,
                x_expand: true,
                x_align: align,
            });
            button.connect('clicked', onClicked);
            linksBox.add_child(button);
        }
        linksItem.add_child(linksBox);
        linksItem.visible = Main.sessionMode.allowSettings;
        this.menu.addMenuItem(linksItem);
    }

    _syncAutoExtendItem() {
        this._autoExtendIcon.icon_name = this._settings.get_boolean('auto-extend')
            ? 'checkbox-checked-symbolic' : 'checkbox-symbolic';
    }

    // Launch NetBird's desktop UI when installed; otherwise fall back to the
    // extension's own NetBird window.
    _openNetbird() {
        const app = Shell.AppSystem.get_default().lookup_app(NETBIRD_DESKTOP_ID);
        if (!app) {
            this._openPrefs('home');
            return;
        }
        Main.panel.closeQuickSettings();
        app.activate();
    }

    _openPrefs(page) {
        Main.panel.closeQuickSettings();
        // prefs.js watches this key and switches to the requested page.
        this._settings.set_string('prefs-page', page);
        this._extension.openPreferences();
    }

    get isConnected() {
        return this._status === Status.CONNECTED;
    }

    async refresh() {
        if (this._refreshing)
            return;
        this._refreshing = true;
        try {
            const {status, data, error} = await this._cli.status(this._lifeCancellable);
            if (this._lifeCancellable.is_cancelled())
                return;
            this._status = status;
            this._data = data;
            this._lastError = error;
            this._sync();
            this._checkExpiry();
            this._checkSessionExpiry();
        } catch (e) {
            if (!isCancelled(e))
                console.error('NetBird: status refresh failed:', e);
        } finally {
            this._refreshing = false;
        }
    }

    // Upstream behaviour (netbirdio/gnome-extension): while NetBird is
    // connected, GNOME's VPN toggle is insensitive and wt0 is hidden from it.
    _syncVpnGuard() {
        const wanted = this._settings.get_boolean('guard-gnome-vpn');
        if (wanted && !this._vpnGuard) {
            this._vpnGuard = new VpnButtonGuard(
                Main.panel.statusArea.quickSettings, new InjectionManager(),
                error => this._notify('GNOME VPN could not be disconnected', error.message ?? String(error)));
            this._vpnGuard.setBlocked(this.isConnected);
            this._updateVpnInterface();
        } else if (!wanted && this._vpnGuard) {
            this._vpnGuard.destroy();
            this._vpnGuard = null;
        }
    }

    // The guard must recognise NetBird's own WireGuard connection, whose
    // interface name is configurable (`netbird up --interface-name`).
    async _updateVpnInterface() {
        const config = await this._cli.config(this._lifeCancellable).catch(() => null);
        if (this._lifeCancellable.is_cancelled())
            return;
        const name = config?.values?.interfaceName;
        if (name)
            this._vpnGuard?.setInterfaceName(name);
    }

    _sync() {
        if (this._vpnGuard && this.isConnected && !this._guardSawConnected)
            this._updateVpnInterface();
        this._guardSawConnected = this.isConnected;
        this._vpnGuard?.setBlocked(this.isConnected);
        const data = this._data;
        const statusLabel = STATUS_LABELS[this._status] ?? this._status;
        let state;
        let subtitle;

        if (this._pendingAction) {
            state = 'Connecting';
            subtitle = ACTION_LABELS[this._pendingAction];
        } else {
            state = this._status;
            subtitle = statusLabel;
            if (this.isConnected && data?.peers)
                subtitle = `${data.peers.connected}/${data.peers.total} peers`;
        }

        const gicon = this._statusIcons.forState(state);
        this.set({
            checked: this.isConnected || this._pendingAction === 'up',
            gicon,
            subtitle,
        });

        const connected = this.isConnected;
        this._ipAddress = connected && data?.netbirdIp ? hostAddress(data.netbirdIp) : '';
        this._copyValues = {
            ip: this._ipAddress,
            ipv6: connected && data?.netbirdIpv6 ? hostAddress(data.netbirdIpv6) : '',
            fqdn: connected ? data?.fqdn ?? '' : '',
        };
        const headerSubtitle = this._ipAddress || statusLabel;
        this.menu.setHeader(gicon, 'NetBird CLI', headerSubtitle);

        const expiry = connected ? formatLocal(data?.sessionExpiresAt) : null;
        this._setInfo('ip', 'IP', connected ? data?.netbirdIp : null);
        this._setInfo('ipv6', 'IPv6', connected ? data?.netbirdIpv6 : null);
        this._setInfo('fqdn', 'Name', connected ? data?.fqdn : null);
        this._setInfo('peers', 'Peers',
            connected && data?.peers ? `${data.peers.connected} of ${data.peers.total} connected` : null);
        this._setInfo('expiry', 'Session expires', expiry);
        this._setInfo('error', 'Error', this._status === Status.UNAVAILABLE ? this._lastError : null);

        const profile = data?.profileName;
        this._profileMenu.label.text = profile ? `Profile: ${profile}` : 'Profile';
        // Profiles disabled by the daemon stay hidden until it restarts.
        if (this._status === Status.UNAVAILABLE)
            this._profilesDisabled = false;
        this._profileMenu.visible = this._status !== Status.UNAVAILABLE && !this._profilesDisabled;
        this._extendItem.visible = Boolean(expiry);
        this._extendNowButton.reactive = !this._pendingAction;
    }

    _setInfo(key, label, value) {
        const item = this._infoItems[key];
        item.visible = Boolean(value);
        item.label.text = value ? `${label}: ${value}` : '';
    }

    async _loadProfiles() {
        const section = this._profileMenu.menu;
        section.removeAll();
        const loading = new PopupMenu.PopupMenuItem('Loading…', {reactive: false});
        section.addMenuItem(loading);

        let profiles = null;
        let result = null;
        try {
            result = await this._cli.run(['profile', 'list', '--show-id'], this._lifeCancellable);
            if (result.ok)
                profiles = await this._cli.profiles(this._lifeCancellable);
        } catch (e) {
            if (isCancelled(e))
                return;
            console.error('NetBird: listing profiles failed:', e);
        }
        if (this._lifeCancellable.is_cancelled())
            return;

        if (result && isProfilesDisabled(result)) {
            this._profilesDisabled = true;
            this._profileMenu.visible = false;
            return;
        }

        this._profileMenu.visible = true;
        section.removeAll();
        if (!profiles?.length) {
            section.addMenuItem(new PopupMenu.PopupMenuItem(
                profiles ? 'No profiles' : 'Could not list profiles', {reactive: false}));
            return;
        }
        for (const p of profiles) {
            const item = new PopupMenu.PopupMenuItem(p.name);
            item.setOrnament(p.active ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            if (p.active || this._pendingAction)
                item.reactive = false;
            else
                item.connect('activate', () => this._switchProfile(p));
            section.addMenuItem(item);
        }
    }

    async _switchProfile(profile) {
        // `netbird profile select` brings the tunnel down if it is up;
        // reconnect afterwards so switching feels like a single step.
        const wasConnected = this.isConnected;
        const ok = await this._runAction('profile', ['profile', 'select', profile.id]);
        if (ok && wasConnected && !this._lifeCancellable.is_cancelled())
            await this._runAction('up');
    }

    _checkExpiry() {
        const expiresAt = this._data?.sessionExpiresAt;
        if (!this.isConnected || !expiresAt)
            return;
        const warnMinutes = this._settings.get_uint('expiry-warning-minutes');
        const remaining = secondsUntil(expiresAt);
        const autoExtend = this._settings.get_boolean('auto-extend');
        // Act at the last poll before a window opens: the next poll (up to
        // poll-interval away) may already be past it, or past the deadline.
        const pollSeconds = this._settings.get_uint('poll-interval');

        if (autoExtendDue({
            enabled: autoExtend,
            connected: this.isConnected,
            secondsLeft: remaining,
            leadSeconds: autoExtendLeadSeconds(warnMinutes, pollSeconds),
            deadline: expiresAt,
            lastAttemptDeadline: this._autoExtendDeadline,
        })) {
            this._autoExtendDeadline = expiresAt;
            this._autoExtend(expiresAt);
            return;
        }
        // An attempt for this deadline is running or failed (and warned).
        if (autoExtend && this._autoExtendDeadline === expiresAt)
            return;

        // Warn once per session (a new expiry means the session was renewed).
        if (!warnMinutes || this._warnedExpiry === expiresAt)
            return;
        if (remaining === null || remaining <= 0 || remaining > warnMinutes * 60 + pollSeconds)
            return;
        this._warnExpiry(expiresAt, remaining);
    }

    _checkSessionExpiry() {
        // Track session expiry: notify when the session expires after we saw Connected.
        if (this._status === Status.CONNECTED) {
            this._lastConnected = true;
        } else if ((this._status === Status.SESSION_EXPIRED ||
                    this._status === Status.NEEDS_LOGIN) &&
                   this._lastConnected) {
            this._lastConnected = false;
            this._notify(
                'NetBird Session Expired',
                'Sign in again to reconnect to your NetBird network.',
                [['Sign In', () => this._runAction('up')]]);
        } else if (this._status === Status.UNAVAILABLE) {
            this._lastConnected = false;
        }
    }

    _warnExpiry(expiresAt, remaining) {
        this._warnedExpiry = expiresAt;
        const minutes = Math.max(1, Math.round(remaining / 60));
        this._notify(
            'NetBird session expiring',
            `Your session expires in ${minutes} min (${formatLocal(expiresAt)}).`,
            [['Extend session', () => this._runAction('extend')]]);
    }

    // `netbird login --extend` opens the browser; it completes on its own
    // when the user is still signed in at the identity provider.
    async _autoExtend(expiresAt) {
        this._autoExtendTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, AUTO_EXTEND_TIMEOUT_SECONDS, () => {
                this._autoExtendTimeoutId = 0;
                if (this._pendingAction === 'extend')
                    this._actionCancellable?.cancel();
                return GLib.SOURCE_REMOVE;
            });
        const ok = await this._runAction('extend');
        if (this._autoExtendTimeoutId) {
            GLib.Source.remove(this._autoExtendTimeoutId);
            this._autoExtendTimeoutId = 0;
        }
        if (this._lifeCancellable.is_cancelled())
            return;

        if (ok) {
            await this.refresh();
            const renewed = this._data?.sessionExpiresAt;
            this._notify('NetBird session extended', renewed && renewed !== expiresAt
                ? `New expiry: ${formatLocal(renewed)}.`
                : 'Your session has been renewed.');
            return;
        }
        const remaining = secondsUntil(expiresAt);
        if (remaining !== null && remaining > 0)
            this._warnExpiry(expiresAt, remaining);
    }

    _notify(title, body, actions = []) {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({
                title: 'NetBird CLI',
                icon: this._statusIcons.appIcon,
            });
            this._notificationSource.connectObject('destroy', () => {
                this._notificationSource = null;
            }, this);
            Main.messageTray.add(this._notificationSource);
        }
        const notification = new MessageTray.Notification({
            source: this._notificationSource,
            title,
            body,
        });
        for (const [label, callback] of actions)
            notification.addAction(label, callback);
        this._notificationSource.addNotification(notification);
    }

    _onClicked() {
        if (this._pendingAction === 'up') {
            // Abort a pending connect (e.g. an SSO login the user abandoned).
            this._actionCancellable?.cancel();
            this._runAction('down');
            return;
        }
        if (this._pendingAction)
            return;

        const wantUp = !(this.isConnected || this._status === Status.CONNECTING);
        this._runAction(wantUp ? 'up' : 'down');
    }

    /**
     * Run a long-running CLI action, reflecting progress in the toggle.
     *
     * `up` and `login --extend` open the browser themselves when SSO is
     * needed and block until the login completes.
     *
     * @param {string} action - key into ACTION_LABELS
     * @param {string[]} [args] - CLI args; derived from action when omitted
     * @returns {Promise<boolean>} true on success
     */
    async _runAction(action, args) {
        args ??= action === 'extend' ? ['login', '--extend'] : [action];

        const cancellable = new Gio.Cancellable();
        const lifeId = this._lifeCancellable.connect(() => cancellable.cancel());
        this._actionCancellable = cancellable;
        this._pendingAction = action;
        this._sync();

        let ok = false;
        try {
            if (args[0] === 'up' && this._vpnGuard) {
                try {
                    await this._vpnGuard.disconnectActiveVpns();
                } catch (e) {
                    if (!cancellable.is_cancelled())
                        this._notify('GNOME VPN could not be disconnected', e.message ?? String(e));
                    return false;
                }
            }
            const result = await this._cli.run(args, cancellable);
            ok = result.ok;
            if (!ok && !cancellable.is_cancelled()) {
                Main.notifyError(`NetBird: ${ACTION_LABELS[action].replace('…', '')} failed`,
                    errorText(result, `netbird ${args.join(' ')} failed`));
            }
        } catch (e) {
            if (!isCancelled(e))
                console.error(`NetBird: netbird ${args.join(' ')} failed:`, e);
        } finally {
            this._lifeCancellable.disconnect(lifeId);
            if (this._actionCancellable === cancellable) {
                this._actionCancellable = null;
                this._pendingAction = null;
                if (!this._lifeCancellable.is_cancelled()) {
                    this._sync();
                    this.refresh();
                    this._indicator?._onActionCompleted();
                }
            }
        }
        return ok;
    }

    destroy() {
        this._lifeCancellable.cancel();
        this._settings.disconnectObject(this);
        if (this._autoExtendTimeoutId)
            GLib.Source.remove(this._autoExtendTimeoutId);
        this._autoExtendTimeoutId = 0;
        this._vpnGuard?.destroy();
        this._vpnGuard = null;
        this._notificationSource?.disconnectObject(this);
        this._notificationSource?.destroy();
        this._notificationSource = null;
        super.destroy();
    }
});

const NetbirdIndicator = GObject.registerClass(
class NetbirdIndicatorImpl extends QuickSettings.SystemIndicator {
    _init(settings, extensionDir, extension) {
        super._init();

        this._settings = settings;
        this._statusIcons = new StatusIcons(extensionDir);
        this._icon = this._addIndicator();
        this._icon.gicon = this._statusIcons.forState('Connected');
        this._icon.visible = false;
        this._menuOpen = false;
        this._lastActionTime = null;
        this._debugEnabled = GLib.getenv('NETBIRD_DEBUG') === '1';

        this._toggle = new NetbirdToggle(
            settings, new NetbirdCli(settings), this._statusIcons, extension, this);
        this._toggle.connectObject(
            'notify::checked', () => this._syncIcon(),
            'notify::gicon', () => this._syncIcon(),
            this);
        this._toggle.menu.connectObject(
            'open-state-changed', (_menu, open) => this._onMenuOpenStateChanged(open),
            this);
        this.quickSettingsItems.push(this._toggle);

        this._settingsIds = [
            settings.connect('changed::show-panel-icon', () => this._syncIcon()),
            settings.connect('changed::poll-interval', () => this._startPolling()),
            settings.connect('changed::netbird-path', () => this._toggle.refresh()),
        ];
        this._startPolling();
    }

    _onMenuOpenStateChanged(open) {
        this._menuOpen = open;
        if (open)
            this._toggle.refresh();
        this._startPolling();
    }

    _onActionCompleted() {
        this._lastActionTime = GLib.get_monotonic_time() / 1000000;
        this._startPolling();
    }

    _startPolling() {
        this._stopPolling();
        const configured = Math.max(1, this._settings.get_uint('poll-interval'));
        const secondsSinceAction = this._lastActionTime
            ? (GLib.get_monotonic_time() / 1000000) - this._lastActionTime
            : Number.MAX_SAFE_INTEGER;
        const interval = pollIntervalSeconds({
            configured,
            menuOpen: this._menuOpen,
            secondsSinceAction,
        });

        if (this._debugEnabled)
            console.debug(`NetBird: scheduling poll in ${interval}s (configured=${configured}, menuOpen=${this._menuOpen}, secondsSinceAction=${Math.round(secondsSinceAction)})`);

        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._toggle.refresh();
            this._startPolling();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopPolling() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    _syncIcon() {
        this._icon.gicon = this._toggle.gicon;
        this._icon.visible = this._toggle.checked && this._settings.get_boolean('show-panel-icon');
    }

    destroy() {
        this._stopPolling();
        this._toggle.disconnectObject(this);
        this._toggle.menu.disconnectObject(this);
        this._settingsIds.forEach(id => this._settings.disconnect(id));
        this._settingsIds = [];
        this.quickSettingsItems.forEach(item => item.destroy());
        this.quickSettingsItems = [];
        super.destroy();
    }
});

export default class NetbirdExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new NetbirdIndicator(this._settings, this.dir, this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
