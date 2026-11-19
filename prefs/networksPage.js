// SPDX-License-Identifier: GPL-3.0-or-later
//
// Networks page: network resources (non-exit-node routes).

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {Status, errorText} from '../netbird/parse.js';

/**
 * Create the Networks page.
 *
 * @param {object} model - WindowModel
 * @param {Adw.PreferencesWindow} window - parent window
 * @returns {Adw.PreferencesPage}
 */
export function createNetworksPage(model, window) {
    const page = new Adw.PreferencesPage({
        title: 'Networks',
        iconName: 'network-workgroup-symbolic',
    });

    const overlay = new Gtk.Overlay({
        hexpand: true,
        vexpand: true,
    });
    const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        margin_bottom: 18,
        margin_end: 18,
        margin_start: 18,
        margin_top: 18,
        vexpand: true,
    });
    const resourceGroup = new Adw.PreferencesGroup({
        valign: Gtk.Align.START,
    });
    scrolled.set_child(resourceGroup);
    overlay.set_child(scrolled);

    const empty = new Adw.StatusPage({
        description: 'You don\'t have access to any network resources',
        icon_name: 'network-workgroup-symbolic',
        title: 'No Resources Available',
    });
    overlay.add_overlay(empty);

    // PreferencesPage only accepts PreferencesGroup
    const group = new Adw.PreferencesGroup();
    group.add(overlay);
    page.add(group);

    const entries = new Map();
    let connected = false;

    const signalId = model.connect('changed', (state) => {
        connected = state.status === Status.CONNECTED;
        const resources = state.networks.filter(network => !network.isExitNode);

        const currentKeys = new Set();
        for (const [index, network] of resources.entries()) {
            const key = resourceKey(network, index);
            currentKeys.add(key);
            let entry = entries.get(key);
            if (!entry) {
                entry = createResourceRow(model, window);
                entries.set(key, entry);
                resourceGroup.add(entry.row);
            }
            entry.network = network;
            updateResourceRow(entry, network, state);
        }

        for (const [key, entry] of entries) {
            if (!currentKeys.has(key)) {
                resourceGroup.remove(entry.row);
                entries.delete(key);
            }
        }

        scrolled.visible = resources.length > 0;
        empty.visible = resources.length === 0;
        if (!connected) {
            empty.title = 'Not Connected';
            empty.description = 'Connect to NetBird to see network resources';
        } else {
            empty.title = 'No Resources Available';
            empty.description = 'You don\'t have access to any network resources';
        }

        page.visible = !state.features.networksDisabled;
    });

    page.connect('destroy', () => {
        model.disconnect(signalId);
    });

    return page;
}

function createResourceRow(model, window) {
    const row = new Adw.SwitchRow({use_markup: false});
    row.add_prefix(new Gtk.Image({
        icon_name: 'network-workgroup-symbolic',
    }));

    const entry = {network: {}, row, suppress: false};

    row.connect('notify::active', async () => {
        if (entry.suppress || !row.sensitive)
            return;
        if (row.active === entry.network.selected)
            return;

        const args = row.active
            ? ['networks', 'select', '--append', entry.network.id]
            : ['networks', 'deselect', entry.network.id];

        const result = await model.run(args);
        if (!result.ok) {
            window.add_toast(new Adw.Toast({
                title: errorText(result, 'Network toggle failed'),
            }));
        }
    });

    return entry;
}

function updateResourceRow(entry, network, state) {
    entry.network = network;
    entry.row.title = resourceTitle(network);
    entry.row.subtitle = resourceDescription(network);
    entry.row.sensitive = state.status === Status.CONNECTED;
    entry.suppress = true;
    entry.row.active = network.selected;
    entry.suppress = false;
}

function resourceKey(network, index) {
    return network.id || network.range || (network.domains ?? []).join(',') ||
        `unnamed-${index}`;
}

function resourceTitle(network) {
    return network.id || network.domains?.[0] || network.range ||
        'Unnamed Resource';
}

function resourceDescription(network) {
    const parts = [];
    if (network.range)
        parts.push(network.range);
    if (network.domains && network.domains.length > 0)
        parts.push(...network.domains);
    return parts.join('  •  ') || 'Routed network resource';
}
