// SPDX-License-Identifier: GPL-3.0-or-later
//
// Peers page: search, filter, and view connected peers.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {Status, parsePeers, hostAddress} from '../netbird/parse.js';

const FILTER_ALL = 0;
const FILTER_CONNECTED = 1;
const FILTER_DISCONNECTED = 2;

/**
 * Create the Peers page.
 *
 * @param {object} model - WindowModel
 * @param {Adw.PreferencesWindow} _window - parent window (unused)
 * @returns {Adw.PreferencesPage}
 */
export function createPeersPage(model, _window) {
    const page = new Adw.PreferencesPage({
        title: 'Peers',
        iconName: 'network-workgroup-symbolic',
    });

    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
    });

    const controls = new Gtk.Box({
        margin_end: 18,
        margin_start: 18,
        margin_top: 18,
        spacing: 12,
    });
    const search = new Gtk.SearchEntry({
        hexpand: true,
        placeholder_text: 'Search by name or IP address',
    });
    const filter = new Gtk.DropDown({
        model: Gtk.StringList.new(['All', 'Connected', 'Disconnected']),
        selected: FILTER_ALL,
        tooltip_text: 'Filter peers by connection state',
    });
    filter.update_property(
        [Gtk.AccessibleProperty.LABEL],
        ['Peer connection filter']);
    controls.append(search);
    controls.append(filter);
    content.append(controls);

    const overlay = new Gtk.Overlay({
        hexpand: true,
        vexpand: true,
    });
    const scrolled = new Gtk.ScrolledWindow({
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        margin_bottom: 18,
        margin_end: 18,
        margin_start: 18,
        margin_top: 12,
        vexpand: true,
    });
    const peerGroup = new Adw.PreferencesGroup({
        valign: Gtk.Align.START,
    });
    scrolled.set_child(peerGroup);
    overlay.set_child(scrolled);

    const empty = new Adw.StatusPage({
        description: 'Connected peers will appear here',
        icon_name: 'network-offline-symbolic',
        title: 'No Peers',
    });
    overlay.add_overlay(empty);
    content.append(overlay);

    // PreferencesPage only accepts PreferencesGroup
    const group = new Adw.PreferencesGroup();
    group.add(content);
    page.add(group);

    const entries = new Map();
    let connected = false;
    let currentPeers = [];

    function matches(peer) {
        const selected = filter.selected;
        if (selected === FILTER_CONNECTED && peer.state !== 'Connected')
            return false;
        if (selected === FILTER_DISCONNECTED && peer.state === 'Connected')
            return false;

        const query = search.text.trim().toLocaleLowerCase();
        if (!query)
            return true;
        return [peer.name, peer.fqdn, peer.ip, peer.ipv6]
            .some(value => String(value ?? '').toLocaleLowerCase().includes(query));
    }

    function updateFilter() {
        let visible = 0;
        for (const entry of entries.values()) {
            entry.row.visible = matches(entry.peer);
            if (entry.row.visible)
                visible++;
        }
        scrolled.visible = visible > 0;
        empty.visible = visible === 0;
        if (!connected) {
            empty.title = 'Not Connected';
            empty.description = 'Connect to NetBird to see your peers';
        } else if (currentPeers.length === 0) {
            empty.title = 'No Peers';
            empty.description = 'Connected peers will appear here';
        } else {
            empty.title = 'No Matching Peers';
            empty.description = 'Try changing the search or connection filter';
        }
    }

    search.connect('search-changed', updateFilter);
    filter.connect('notify::selected', updateFilter);

    const signalId = model.connect('changed', (state) => {
        connected = state.status === Status.CONNECTED;
        currentPeers = parsePeers(state.data || {});

        const currentKeys = new Set();
        for (const peer of currentPeers) {
            const key = peerKey(peer);
            currentKeys.add(key);
            let entry = entries.get(key);
            if (!entry) {
                entry = createPeerRow();
                entries.set(key, entry);
                peerGroup.add(entry.row);
            }
            entry.peer = peer;
            updatePeerRow(entry, peer);
        }

        for (const [key, entry] of entries) {
            if (!currentKeys.has(key)) {
                peerGroup.remove(entry.row);
                entries.delete(key);
            }
        }

        updateFilter();
    });

    page.connect('destroy', () => {
        model.disconnect(signalId);
    });

    return page;
}

function createPeerRow() {
    const row = new Adw.ActionRow({
        subtitle_lines: 1,
        title_lines: 1,
        use_markup: false,
    });
    const icon = new Gtk.Image();
    const latency = new Gtk.Label({
        css_classes: ['dim-label'],
        valign: Gtk.Align.CENTER,
    });
    const entry = {icon, latency, ipToCopy: '', peer: {}, row};
    const copy = createCopyButton(entry);
    entry.copy = copy;
    row.add_prefix(icon);
    row.add_suffix(latency);
    row.add_suffix(copy);
    return entry;
}

function createCopyButton(entry) {
    const button = new Gtk.Button({
        css_classes: ['flat'],
        icon_name: 'edit-copy-symbolic',
        tooltip_text: 'Copy peer IP address',
        valign: Gtk.Align.CENTER,
    });
    button.update_property([Gtk.AccessibleProperty.LABEL], ['Copy peer IP address']);

    let resetId = 0;
    button.connect('clicked', () => {
        button.get_clipboard().set(entry.ipToCopy);
        if (resetId)
            GLib.Source.remove(resetId);
        resetId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            resetId = 0;
            button.icon_name = 'edit-copy-symbolic';
            button.tooltip_text = 'Copy peer IP address';
            return GLib.SOURCE_REMOVE;
        });
        button.icon_name = 'object-select-symbolic';
        button.tooltip_text = 'Copied';
    });
    button.connect('destroy', () => {
        if (resetId)
            GLib.Source.remove(resetId);
    });

    return button;
}

function updatePeerRow(entry, peer) {
    const isConnected = peer.state === 'Connected';
    entry.row.title = peer.name;

    const subtitleParts = [peer.ip, peer.ipv6];
    if (peer.connType === 'P2P')
        subtitleParts.push('Direct');
    else if (peer.connType === 'Relayed')
        subtitleParts.push('Relayed');
    entry.row.subtitle = subtitleParts.filter(Boolean).join('  •  ');

    entry.icon.icon_name = isConnected
        ? 'network-transmit-receive-symbolic'
        : 'network-offline-symbolic';
    entry.icon.css_classes = [isConnected ? 'success' : 'warning'];
    entry.icon.tooltip_text = peer.state;
    entry.icon.update_property([Gtk.AccessibleProperty.LABEL], [peer.state]);

    entry.latency.label = isConnected && peer.latencyMs > 0
        ? `${peer.latencyMs} ms`
        : '';
    entry.latency.visible = Boolean(entry.latency.label);

    entry.ipToCopy = hostAddress(peer.ip || peer.ipv6 || '');
    entry.copy.visible = Boolean(entry.ipToCopy);

    entry.row.tooltip_text = peerDetails(peer);
}

function peerDetails(peer) {
    const lines = [peer.fqdn, `Status: ${peer.state}`];
    if (peer.bytesRx || peer.bytesTx) {
        lines.push(`Received: ${GLib.format_size(peer.bytesRx)}`);
        lines.push(`Sent: ${GLib.format_size(peer.bytesTx)}`);
    }
    if (peer.lastHandshake)
        lines.push(`Last handshake: ${timeAgo(peer.lastHandshake)}`);
    return lines.filter(Boolean).join('\n');
}

function timeAgo(timestampSeconds) {
    const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestampSeconds);
    if (seconds < 60)
        return 'just now';
    const units = [[86400, 'day'], [3600, 'hour'], [60, 'minute']];
    const [size, unit] = units.find(([unitSeconds]) => seconds >= unitSeconds) || [1, 'second'];
    const count = Math.floor(seconds / size);
    return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

function peerKey(peer) {
    return peer.fqdn || peer.ip || peer.ipv6 || 'unknown';
}
