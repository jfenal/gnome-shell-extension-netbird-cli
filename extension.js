// SPDX-License-Identifier: GPL-3.0-or-later
//
// NetBird Quick Settings toggle. Drives the `netbird` CLI.

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {NetbirdCli, Status} from './netbird/cli.js';
import {errorText, formatLocal, secondsUntil} from './netbird/parse.js';

const ICON_CONNECTED = 'network-vpn-symbolic';
const ICON_CONNECTING = 'network-vpn-acquiring-symbolic';
const ICON_DISCONNECTED = 'network-vpn-disabled-symbolic';
const ICON_ERROR = 'network-vpn-no-route-symbolic';

const STATUS_LABELS = {
    [Status.CONNECTED]: 'Connected',
    [Status.CONNECTING]: 'Connecting…',
    [Status.IDLE]: 'Disconnected',
    [Status.NEEDS_LOGIN]: 'Login required',
    [Status.LOGIN_FAILED]: 'Login failed',
    [Status.SESSION_EXPIRED]: 'Session expired',
    [Status.UNAVAILABLE]: 'Daemon unavailable',
};

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
class NetbirdToggle extends QuickSettings.QuickMenuToggle {
    _init(settings, cli) {
        super._init({
            title: 'NetBird',
            iconName: ICON_DISCONNECTED,
            toggleMode: false,
        });

        this._settings = settings;
        this._cli = cli;
        this._status = Status.UNAVAILABLE;
        this._data = null;
        this._lastError = null;
        this._pendingAction = null;
        this._actionCancellable = null;
        this._lifeCancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._warnedExpiry = null;
        this._notificationSource = null;

        this._buildMenu();
        this.connect('clicked', () => this._onClicked());
        this.refresh();
    }

    _buildMenu() {
        this.menu.setHeader(ICON_DISCONNECTED, 'NetBird', '');

        this._infoSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._infoSection);
        this._infoItems = {};
        for (const key of ['ip', 'fqdn', 'peers', 'expiry', 'error']) {
            const item = new PopupMenu.PopupMenuItem('', {reactive: false});
            item.visible = false;
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

        this._extendItem = this.menu.addAction('Extend session', () => this._runAction('extend'));
        this.menu.addAction('Refresh', () => this.refresh());
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
        } catch (e) {
            if (!isCancelled(e))
                logError(e, 'NetBird: status refresh failed');
        } finally {
            this._refreshing = false;
        }
    }

    _sync() {
        const data = this._data;
        const statusLabel = STATUS_LABELS[this._status] ?? this._status;
        let iconName;
        let subtitle;

        if (this._pendingAction) {
            iconName = ICON_CONNECTING;
            subtitle = ACTION_LABELS[this._pendingAction];
        } else {
            switch (this._status) {
            case Status.CONNECTED:
                iconName = ICON_CONNECTED;
                break;
            case Status.CONNECTING:
                iconName = ICON_CONNECTING;
                break;
            case Status.IDLE:
                iconName = ICON_DISCONNECTED;
                break;
            default:
                iconName = ICON_ERROR;
            }
            subtitle = statusLabel;
            if (this.isConnected && data?.peers)
                subtitle = `${data.peers.connected}/${data.peers.total} peers`;
        }

        this.set({
            checked: this.isConnected || this._pendingAction === 'up',
            iconName,
            subtitle,
        });

        const profile = data?.profileName;
        this.menu.setHeader(iconName, 'NetBird', profile ? `${statusLabel} · ${profile}` : statusLabel);

        const connected = this.isConnected;
        const expiry = connected ? formatLocal(data?.sessionExpiresAt) : null;
        this._setInfo('ip', 'IP', connected ? data?.netbirdIp : null);
        this._setInfo('fqdn', 'Name', connected ? data?.fqdn : null);
        this._setInfo('peers', 'Peers',
            connected && data?.peers ? `${data.peers.connected} of ${data.peers.total} connected` : null);
        this._setInfo('expiry', 'Session expires', expiry);
        this._setInfo('error', 'Error', this._status === Status.UNAVAILABLE ? this._lastError : null);

        this._profileMenu.label.text = profile ? `Profile: ${profile}` : 'Profile';
        this._profileMenu.visible = this._status !== Status.UNAVAILABLE;
        this._extendItem.visible = Boolean(expiry);
        this._extendItem.reactive = !this._pendingAction;
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
        try {
            profiles = await this._cli.profiles(this._lifeCancellable);
        } catch (e) {
            if (isCancelled(e))
                return;
            logError(e, 'NetBird: listing profiles failed');
        }
        if (this._lifeCancellable.is_cancelled())
            return;

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
        const warnMinutes = this._settings.get_uint('expiry-warning-minutes');
        const expiresAt = this._data?.sessionExpiresAt;
        if (!warnMinutes || !this.isConnected || !expiresAt)
            return;
        // Warn once per session (a new expiry means the session was renewed).
        if (this._warnedExpiry === expiresAt)
            return;

        const remaining = secondsUntil(expiresAt);
        if (remaining === null || remaining <= 0 || remaining > warnMinutes * 60)
            return;

        this._warnedExpiry = expiresAt;
        const minutes = Math.max(1, Math.round(remaining / 60));
        this._notify(
            'NetBird session expiring',
            `Your session expires in ${minutes} min (${formatLocal(expiresAt)}).`,
            [['Extend session', () => this._runAction('extend')]]);
    }

    _notify(title, body, actions = []) {
        if (!this._notificationSource) {
            this._notificationSource = new MessageTray.Source({
                title: 'NetBird',
                iconName: ICON_CONNECTED,
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
            const result = await this._cli.run(args, cancellable);
            ok = result.ok;
            if (!ok && !cancellable.is_cancelled())
                Main.notifyError(`NetBird: ${ACTION_LABELS[action].replace('…', '')} failed`,
                    errorText(result, `netbird ${args.join(' ')} failed`));
        } catch (e) {
            if (!isCancelled(e))
                logError(e, `NetBird: netbird ${args.join(' ')} failed`);
        } finally {
            this._lifeCancellable.disconnect(lifeId);
            if (this._actionCancellable === cancellable) {
                this._actionCancellable = null;
                this._pendingAction = null;
                if (!this._lifeCancellable.is_cancelled()) {
                    this._sync();
                    this.refresh();
                }
            }
        }
        return ok;
    }

    destroy() {
        this._lifeCancellable.cancel();
        this._notificationSource?.disconnectObject(this);
        this._notificationSource?.destroy();
        this._notificationSource = null;
        super.destroy();
    }
});

const NetbirdIndicator = GObject.registerClass(
class NetbirdIndicator extends QuickSettings.SystemIndicator {
    _init(settings) {
        super._init();

        this._settings = settings;
        this._icon = this._addIndicator();
        this._icon.iconName = ICON_CONNECTED;
        this._icon.visible = false;

        this._toggle = new NetbirdToggle(settings, new NetbirdCli(settings));
        this._toggle.connectObject(
            'notify::checked', () => this._syncIcon(),
            'notify::icon-name', () => this._syncIcon(),
            this);
        this.quickSettingsItems.push(this._toggle);

        this._settingsIds = [
            settings.connect('changed::show-panel-icon', () => this._syncIcon()),
            settings.connect('changed::poll-interval', () => this._startPolling()),
            settings.connect('changed::netbird-path', () => this._toggle.refresh()),
        ];
        this._startPolling();
    }

    _startPolling() {
        this._stopPolling();
        const interval = Math.max(1, this._settings.get_uint('poll-interval'));
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._toggle.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPolling() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
    }

    _syncIcon() {
        this._icon.iconName = this._toggle.iconName;
        this._icon.visible = this._toggle.checked && this._settings.get_boolean('show-panel-icon');
    }

    destroy() {
        this._stopPolling();
        this._toggle.disconnectObject(this);
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
        this._indicator = new NetbirdIndicator(this._settings);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
