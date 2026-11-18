// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class NetbirdPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'General',
            iconName: 'preferences-system-symbolic',
        });
        window.add(page);

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
    }
}
