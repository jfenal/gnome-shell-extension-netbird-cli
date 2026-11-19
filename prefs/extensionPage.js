// SPDX-License-Identifier: GPL-3.0-or-later
//
// Extension settings page (poll interval, panel icon, expiry warning, CLI path).

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

/**
 * Create the Extension settings page.
 *
 * @param {object} _model - WindowModel (unused in this page)
 * @param {Adw.PreferencesWindow} window - parent window (window._settings is Gio.Settings)
 * @returns {Adw.PreferencesPage}
 */
export function createExtensionPage(_model, window) {
    const settings = window._settings;

    const page = new Adw.PreferencesPage({
        title: 'Extension',
        iconName: 'preferences-system-symbolic',
    });

    const statusGroup = new Adw.PreferencesGroup({title: 'Status'});
    page.add(statusGroup);

    const pollRow = new Adw.SpinRow({
        title: 'Poll interval',
        subtitle: 'Seconds between status checks',
        adjustment: new Gtk.Adjustment({lower: 1, upper: 300, stepIncrement: 1, pageIncrement: 10}),
    });
    settings.bind('poll-interval', pollRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    statusGroup.add(pollRow);

    const iconRow = new Adw.SwitchRow({
        title: 'Panel icon',
        subtitle: 'Show an icon in the top bar while connected',
    });
    settings.bind('show-panel-icon', iconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    statusGroup.add(iconRow);

    const sessionGroup = new Adw.PreferencesGroup({title: 'Session'});
    page.add(sessionGroup);

    const expiryRow = new Adw.SpinRow({
        title: 'Expiry warning',
        subtitle: 'Minutes before SSO session expiry to notify (0 disables)',
        adjustment: new Gtk.Adjustment({lower: 0, upper: 1440, stepIncrement: 5, pageIncrement: 30}),
    });
    settings.bind('expiry-warning-minutes', expiryRow, 'value', Gio.SettingsBindFlags.DEFAULT);
    sessionGroup.add(expiryRow);

    const cliGroup = new Adw.PreferencesGroup({title: 'CLI'});
    page.add(cliGroup);

    const pathRow = new Adw.EntryRow({
        title: 'netbird binary (empty = search PATH)',
        showApplyButton: true,
    });
    pathRow.text = settings.get_string('netbird-path');
    pathRow.connect('apply', () => settings.set_string('netbird-path', pathRow.text.trim()));
    cliGroup.add(pathRow);

    return page;
}
