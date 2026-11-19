// SPDX-License-Identifier: GPL-3.0-or-later
//
// Home page: connection state and local peer details.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {Status, hostAddress, errorText, statusLabel} from '../netbird/parse.js';
import {createCopyLabel} from './copyLabel.js';

/**
 * Create the Home page.
 *
 * @param {object} model - WindowModel
 * @param {Adw.PreferencesWindow} window - parent window
 * @returns {Adw.PreferencesPage}
 */
export function createHomePage(model, window) {
    const page = new Adw.PreferencesPage({
        title: 'Home',
        iconName: 'user-home-symbolic',
    });

    const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vexpand: true,
    });
    const clamp = new Adw.Clamp({
        margin_bottom: 24,
        margin_end: 24,
        margin_start: 24,
        margin_top: 24,
        maximum_size: 480,
        valign: Gtk.Align.CENTER,
    });
    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 14,
    });
    clamp.set_child(content);

    const brand = new Gtk.Box({
        halign: Gtk.Align.CENTER,
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
    });
    brand.append(new Gtk.Image({
        halign: Gtk.Align.CENTER,
        icon_name: 'netbird',
        pixel_size: 56,
        valign: Gtk.Align.CENTER,
    }));
    brand.append(new Gtk.Label({
        css_classes: ['title-1'],
        halign: Gtk.Align.CENTER,
        label: 'NetBird',
        valign: Gtk.Align.CENTER,
    }));
    content.append(brand);

    const connectionSwitch = new Gtk.Switch({
        halign: Gtk.Align.CENTER,
        tooltip_text: 'Connect or disconnect NetBird',
        valign: Gtk.Align.CENTER,
    });
    connectionSwitch.update_property(
        [Gtk.AccessibleProperty.LABEL],
        ['NetBird connection']);
    content.append(connectionSwitch);

    const stateLabel = new Gtk.Label({
        css_classes: ['title-2'],
        halign: Gtk.Align.CENTER,
        label: 'Loading…',
    });
    content.append(stateLabel);

    const fqdnLabel = createCopyLabel(window);
    const ipv4Label = createCopyLabel(window);
    const ipv6Label = createCopyLabel(window);
    content.append(fqdnLabel.widget);
    content.append(ipv4Label.widget);
    content.append(ipv6Label.widget);

    const exitGroup = new Adw.PreferencesGroup({
        margin_top: 28,
    });
    const exitNode = new Adw.ComboRow({
        subtitle: 'Route traffic through another NetBird peer',
        title: 'Exit Node',
    });
    exitGroup.add(exitNode);
    content.append(exitGroup);

    scrolled.set_child(clamp);

    // PreferencesPage only accepts PreferencesGroup
    const group = new Adw.PreferencesGroup();
    group.add(scrolled);
    page.add(group);

    let suppressConnection = false;
    let suppressExitNode = false;
    let exitNodeIds = [];
    let selectedExitNodeId = '';
    let selectionSourceId = 0;

    connectionSwitch.connect('notify::active', async () => {
        if (suppressConnection)
            return;

        const args = connectionSwitch.active ? ['up'] : ['down'];
        const result = await model.run(args);
        if (!result.ok) {
            window.add_toast(new Adw.Toast({
                title: errorText(result, 'Connection toggle failed'),
            }));
        }
    });

    exitNode.connect('notify::selected', () => {
        if (suppressExitNode)
            return;

        const id = exitNodeIds[exitNode.selected] ?? '';
        if (id === selectedExitNodeId)
            return;

        if (selectionSourceId)
            GLib.Source.remove(selectionSourceId);
        selectionSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            selectionSourceId = 0;
            selectExitNode(id, model, window);
            return GLib.SOURCE_REMOVE;
        });
    });

    const signalId = model.connect('changed', (state) => {
        suppressConnection = true;
        connectionSwitch.active = state.status === Status.CONNECTED ||
                                   state.status === Status.CONNECTING;
        suppressConnection = false;
        connectionSwitch.sensitive = state.status !== Status.UNAVAILABLE;

        stateLabel.label = statusLabel(state.status);

        const data = state.data || {};
        const connected = state.status === Status.CONNECTED;
        fqdnLabel.setText(connected ? (data.fqdn || '') : '');
        ipv4Label.setText(connected ? hostAddress(data.netbirdIp || '') : '');
        ipv6Label.setText(connected ? hostAddress(data.netbirdIpv6 || '') : '');

        // Exit node ComboRow
        const exits = state.networks.filter(network => network.isExitNode);
        exitGroup.visible = !state.features.networksDisabled;
        const names = ['No exit node', ...exits.map(network => network.id)];
        const nextExitNodeIds = ['', ...exits.map(network => network.id)];
        selectedExitNodeId = exits.find(network => network.selected)?.id ?? '';

        suppressExitNode = true;
        if (!arraysEqual(exitNodeIds, nextExitNodeIds)) {
            exitNodeIds = nextExitNodeIds;
            exitNode.model = Gtk.StringList.new(names);
        }
        const selected = exits.findIndex(network => network.selected);
        exitNode.selected = selected === -1 ? 0 : selected + 1;
        suppressExitNode = false;
        exitNode.sensitive = connected && exits.length > 0;
    });

    page.connect('destroy', () => {
        if (selectionSourceId) {
            GLib.Source.remove(selectionSourceId);
            selectionSourceId = 0;
        }
        model.disconnect(signalId);
    });

    return page;
}

async function selectExitNode(id, model, window) {
    // Collect all exit node IDs from current state
    const allExitIds = [];
    for (const signalValue of model._signals.values()) {
        // We can't easily get the last state; instead run networks deselect for all
        // current exit nodes, then select the new one
        break;
    }

    // Simpler approach: if id is empty, deselect all exit nodes
    // Otherwise, deselect all exit nodes then select the new one with --append
    const state = model._state;
    const exits = state.networks.filter(network => network.isExitNode);

    if (id === '') {
        // Deselect all exit nodes
        const selectedExits = exits.filter(network => network.selected);
        if (selectedExits.length > 0) {
            const result = await model.run(['networks', 'deselect', ...selectedExits.map(n => n.id)]);
            if (!result.ok) {
                window.add_toast(new Adw.Toast({
                    title: errorText(result, 'Exit node deselection failed'),
                }));
            }
        }
    } else {
        // Deselect all exit nodes first, then select the new one
        const otherExits = exits.filter(network => network.id !== id && network.selected);
        if (otherExits.length > 0) {
            const result = await model.run(['networks', 'deselect', ...otherExits.map(n => n.id)]);
            if (!result.ok) {
                window.add_toast(new Adw.Toast({
                    title: errorText(result, 'Exit node deselection failed'),
                }));
                return;
            }
        }
        // Select the new exit node
        const result = await model.run(['networks', 'select', '--append', id]);
        if (!result.ok) {
            window.add_toast(new Adw.Toast({
                title: errorText(result, 'Exit node selection failed'),
            }));
        }
    }
}

function arraysEqual(a, b) {
    return a.length === b.length && a.every((val, i) => val === b[i]);
}
