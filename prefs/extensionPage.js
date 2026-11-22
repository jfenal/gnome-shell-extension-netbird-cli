// SPDX-License-Identifier: GPL-3.0-or-later
//
// Extension settings page (poll interval, panel icon, expiry warning, CLI
// path) and an About group (version, source code link).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

/**
 * Create the Extension settings page.
 *
 * @param {object} _model - WindowModel (unused in this page)
 * @param {Adw.PreferencesWindow} window - parent window (window._settings is Gio.Settings)
 * @param {object} extension - ExtensionPreferences instance (metadata, dir)
 * @returns {Adw.PreferencesPage}
 */
export function createExtensionPage(_model, window, extension) {
    const settings = window._settings;

    const page = new Adw.PreferencesPage({
        title: 'Extension',
        iconName: 'preferences-system-symbolic',
    });

    const statusGroup = new Adw.PreferencesGroup({title: 'Status'});
    page.add(statusGroup);

    statusGroup.add(createPollRow(settings));

    const iconRow = new Adw.SwitchRow({
        title: 'Panel icon',
        subtitle: 'Show an icon in the top bar while connected',
    });
    settings.bind('show-panel-icon', iconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    statusGroup.add(iconRow);

    const vpnRow = new Adw.SwitchRow({
        title: 'Manage GNOME VPN',
        subtitle: 'Disable GNOME\'s VPN button while NetBird is connected',
    });
    settings.bind('guard-gnome-vpn', vpnRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    statusGroup.add(vpnRow);

    const sessionGroup = new Adw.PreferencesGroup({title: 'Session'});
    page.add(sessionGroup);

    const expiryRow = new Adw.SpinRow({
        title: 'Expiry warning',
        subtitle: 'Minutes before SSO session expiry to notify (0 disables)',
        adjustment: new Gtk.Adjustment({
            lower: 0, upper: 1440, stepIncrement: 5, pageIncrement: 30,
        }),
    });
    settings.bind('expiry-warning-minutes', expiryRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    sessionGroup.add(expiryRow);

    const autoExtendRow = new Adw.SwitchRow({
        title: 'Auto-extend session',
        subtitle: 'Renew the SSO session before it expires. Opens your browser; usually no input is needed if you are still signed in to your identity provider.',
    });
    settings.bind('auto-extend', autoExtendRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    sessionGroup.add(autoExtendRow);

    const cliGroup = new Adw.PreferencesGroup({title: 'CLI'});
    page.add(cliGroup);

    const pathRow = new Adw.EntryRow({
        title: 'netbird binary (empty = search PATH)',
        showApplyButton: true,
    });
    pathRow.text = settings.get_string('netbird-path');
    pathRow.connect('apply', () => settings.set_string('netbird-path', pathRow.text.trim()));
    cliGroup.add(pathRow);

    page.add(createAboutGroup(window, extension));

    return page;
}

// The poll interval slider is logarithmic so that 1-10 s gets as much room
// as 1.5-15 min. Positions map to seconds, rounded to tidy values.
const POLL_MIN = 1;
const POLL_MAX = 900;
const POLL_MARKS = [1, 5, 15, 60, 300, 900];

function secondsToPosition(secs) {
    return Math.log(Math.min(Math.max(secs, POLL_MIN), POLL_MAX));
}

function positionToSeconds(pos) {
    const raw = Math.exp(pos);
    const unit = raw < 20 ? 1 : raw < 60 ? 5 : raw < 300 ? 30 : 60;
    return Math.min(POLL_MAX, Math.max(POLL_MIN, Math.round(raw / unit) * unit));
}

function formatSeconds(secs) {
    if (secs < 60)
        return `${secs} s`;
    const min = Math.floor(secs / 60);
    const rest = secs % 60;
    return rest ? `${min} min ${rest} s` : `${min} min`;
}

function createPollRow(settings) {
    const row = new Adw.ActionRow({title: 'Poll interval'});
    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: new Gtk.Adjustment({
            lower: secondsToPosition(POLL_MIN),
            upper: secondsToPosition(POLL_MAX),
            stepIncrement: 0.05,
            pageIncrement: 0.5,
        }),
        drawValue: false,
        widthRequest: 320,
        valign: Gtk.Align.CENTER,
    });
    for (const secs of POLL_MARKS)
        scale.add_mark(secondsToPosition(secs), Gtk.PositionType.BOTTOM, formatSeconds(secs).replace(' ', ''));
    row.add_suffix(scale);

    const updateSubtitle = secs => {
        row.subtitle = `Status check every ${formatSeconds(secs)} while the menu is closed`;
    };

    // Moving the slider writes the rounded value; setting it from the
    // stored value must not write back (a gsettings-set 7 stays 7).
    let syncing = false;
    const syncFromSettings = () => {
        const secs = settings.get_uint('poll-interval');
        syncing = true;
        scale.set_value(secondsToPosition(secs));
        syncing = false;
        updateSubtitle(secs);
    };
    scale.connect('value-changed', () => {
        if (syncing)
            return;
        const secs = positionToSeconds(scale.get_value());
        if (secs !== settings.get_uint('poll-interval'))
            settings.set_uint('poll-interval', secs);
    });
    const changedId = settings.connect('changed::poll-interval', syncFromSettings);
    scale.connect('destroy', () => settings.disconnect(changedId));
    syncFromSettings();

    return row;
}

function createAboutGroup(window, extension) {
    const {metadata} = extension;
    const group = new Adw.PreferencesGroup({title: 'About'});

    let version = metadata['version-name'] ?? String(metadata.version ?? 'unknown');
    const revision = readGitRevision(extension.dir);
    if (revision)
        version = `${version} (${revision})`;
    group.add(new Adw.ActionRow({
        title: 'Version',
        subtitle: version,
        subtitleSelectable: true,
    }));

    if (metadata.url) {
        const sourceRow = new Adw.ActionRow({
            title: 'Source code',
            subtitle: metadata.url,
            activatable: true,
        });
        sourceRow.add_suffix(new Gtk.Image({iconName: 'adw-external-link-symbolic'}));
        sourceRow.connect('activated', () => {
            new Gtk.UriLauncher({uri: metadata.url}).launch(window, null, null);
        });
        group.add(sourceRow);
    }

    return group;
}

/**
 * Describe the git revision when the extension runs from a git checkout
 * (`make install` symlinks the working tree). Returns null for packaged
 * installs (zip, RPM), which have no `.git`.
 *
 * @param {Gio.File} dir - extension directory
 * @returns {string|null}
 */
function readGitRevision(dir) {
    if (!dir.get_child('.git').query_exists(null))
        return null;
    try {
        const [ok, stdout, , status] = GLib.spawn_sync(
            dir.get_path(),
            ['git', 'describe', '--tags', '--always', '--dirty'],
            null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.STDERR_TO_DEV_NULL,
            null);
        if (!ok || status !== 0)
            return null;
        return new TextDecoder().decode(stdout).trim() || null;
    } catch {
        return null;
    }
}
