// SPDX-License-Identifier: GPL-3.0-or-later
//
// Home page: connection state and local peer details.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {Status, hostAddress, errorText} from '../netbird/parse.js';
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

    const root = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
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

    scrolled.set_child(clamp);
    root.append(scrolled);

    // Add root to a child to get it into the page
    const pageContent = new Gtk.Box();
    pageContent.append(root);
    page.add(pageContent);

    let suppressConnection = false;

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
    });

    page.connect('destroy', () => {
        model.disconnect(signalId);
    });

    return page;
}

function statusLabel(status) {
    switch (status) {
    case Status.CONNECTED:
        return 'Connected';
    case Status.CONNECTING:
        return 'Connecting…';
    case Status.IDLE:
        return 'Idle';
    case Status.NEEDS_LOGIN:
        return 'Login Required';
    case Status.LOGIN_FAILED:
        return 'Login Failed';
    case Status.SESSION_EXPIRED:
        return 'Session Expired';
    case Status.UNAVAILABLE:
        return 'Daemon Unavailable';
    default:
        return 'Unknown';
    }
}
