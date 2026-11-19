// SPDX-License-Identifier: GPL-3.0-or-later
//
// Daemon settings page. Values come from `netbird debug config`; writes go
// through `netbird up --<flag>=<value>` (the CLI's only settings path), then
// the value is read back to confirm the daemon applied it.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';

import {SETTINGS} from '../netbird/config.js';
import {Status, errorText} from '../netbird/parse.js';

const GROUPS = ['General', 'Connection', 'Network', 'SSH'];
const SETTINGS_DISABLED = 'update settings are disabled';

/**
 * Create the Settings page.
 *
 * @param {object} model - WindowModel
 * @param {Adw.PreferencesWindow} window - parent window
 * @returns {Adw.PreferencesPage}
 */
export function createDaemonSettingsPage(model, window) {
    const page = new Adw.PreferencesPage({
        title: 'Settings',
        iconName: 'emblem-system-symbolic',
        description: 'Saving a setting reconnects NetBird.',
    });

    const rows = new Map(); // key → {setting, row, get(), set(value)}
    let suppress = false;
    let busy = false;
    let readOnlyReason = null;
    let managed = new Set();

    const groups = new Map(GROUPS.map(title => {
        const group = new Adw.PreferencesGroup({title});
        page.add(group);
        return [title, group];
    }));

    for (const setting of SETTINGS) {
        const entry = createRow(setting, value => void save(setting, value), () => suppress);
        rows.set(setting.key, entry);
        groups.get(setting.group).add(entry.row);
    }

    function setSensitivity() {
        for (const {setting, row} of rows.values()) {
            const isManaged = managed.has(setting.key);
            row.sensitive = !busy && !readOnlyReason && !isManaged;
            row.tooltip_text = isManaged ? 'Managed by your organization' : readOnlyReason;
        }
    }

    function toast(title) {
        window.add_toast(new Adw.Toast({title, timeout: 5}));
    }

    async function load() {
        const config = await model.cli.config(model.cancellable);
        if (model.cancellable.is_cancelled())
            return null;
        if (!config.values) {
            readOnlyReason = config.error;
            page.description = `Settings unavailable: ${config.error}`;
            setSensitivity();
            return null;
        }
        if (!readOnlyReason?.includes(SETTINGS_DISABLED)) {
            readOnlyReason = null;
            page.description = 'Saving a setting reconnects NetBird.';
        }
        managed = config.managed;
        suppress = true;
        for (const [key, value] of Object.entries(config.values))
            rows.get(key)?.set(value);
        suppress = false;
        setSensitivity();
        return config.values;
    }

    async function save(setting, value) {
        if (busy)
            return;
        busy = true;
        setSensitivity();
        try {
            const wasConnected = model.state.status === Status.CONNECTED;
            const result = await model.cli.applySettings(
                {[setting.key]: value}, wasConnected, model.cancellable);
            if (model.cancellable.is_cancelled())
                return;
            const message = errorText(result, '');
            if (!result.ok && message.includes(SETTINGS_DISABLED)) {
                readOnlyReason = message;
                page.description = message;
            }
            const values = await load();
            if (values && values[setting.key] !== value)
                toast(`Setting Could Not Be Saved${message ? `: ${message}` : ''}`);
            else if (!result.ok)
                toast(message || 'Setting Could Not Be Saved');
            await model.refresh();
        } finally {
            busy = false;
            if (!model.cancellable.is_cancelled())
                setSensitivity();
        }
    }

    // Reload whenever the page is shown: settings may change from the CLI.
    page.connect('map', () => void load());
    void load();

    return page;
}

/**
 * One row for a setting.
 *
 * @param {object} setting - entry from SETTINGS
 * @param {function(boolean|string|number): void} onChange - user edited the row
 * @param {function(): boolean} suppressed - true while values are set programmatically
 * @returns {{setting: object, row: Gtk.Widget, set: function(*): void}}
 */
function createRow(setting, onChange, suppressed) {
    if (setting.type === 'bool') {
        const row = new Adw.SwitchRow({title: setting.title, subtitle: setting.subtitle ?? ''});
        row.connect('notify::active', () => {
            if (!suppressed())
                onChange(row.active);
        });
        return {setting, row, set: value => {
            row.active = value;
        }};
    }

    if (setting.type === 'uint') {
        const row = Adw.SpinRow.new_with_range(0, setting.max, 1);
        row.title = setting.title;
        row.subtitle = setting.subtitle ?? '';
        // Every write reconnects NetBird: wait until the value settles.
        let sourceId = 0;
        row.connect('notify::value', () => {
            if (suppressed())
                return;
            if (sourceId)
                GLib.Source.remove(sourceId);
            sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                sourceId = 0;
                onChange(Math.round(row.value));
                return GLib.SOURCE_REMOVE;
            });
        });
        row.connect('destroy', () => {
            if (sourceId)
                GLib.Source.remove(sourceId);
            sourceId = 0;
        });
        return {setting, row, set: value => {
            row.value = value;
        }};
    }

    const row = new Adw.EntryRow({title: setting.title, show_apply_button: true});
    row.connect('apply', () => {
        if (!suppressed())
            onChange(row.text.trim());
    });
    return {setting, row, set: value => {
        row.text = value;
    }};
}
