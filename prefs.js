// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {NetbirdCli} from './netbird/cli.js';
import {WindowModel} from './prefs/model.js';
import {createHomePage} from './prefs/homePage.js';
import {createPeersPage} from './prefs/peersPage.js';
import {createNetworksPage} from './prefs/networksPage.js';
import {createProfilesPage} from './prefs/profilesPage.js';
import {createExtensionPage} from './prefs/extensionPage.js';

export default class NetbirdPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const cli = new NetbirdCli(settings);
        const model = new WindowModel(cli, 2);

        // Store settings on window so pages can access it
        window._settings = settings;

        // Add pages (order: Home, Peers, Networks, Profiles, Extension)
        const homePage = createHomePage(model, window);
        const peersPage = createPeersPage(model, window);
        const networksPage = createNetworksPage(model, window);
        const profilesPage = createProfilesPage(model, window);
        const extensionPage = createExtensionPage(model, window);

        window.add(homePage);
        window.add(peersPage);
        window.add(networksPage);
        window.add(profilesPage);
        window.add(extensionPage);

        // Wire model lifecycle to window
        window.connect('close-request', () => {
            model.stop();
        });

        model.start();

        // Smoke test only (tools/smoke): the prefs process is D-Bus activated
        // and inherits the bus environment, so the page name is read from a
        // file whose path was exported before the bus started.
        const targetPage = readSmokePage();
        if (targetPage) {
            const pageMap = {
                'Home': homePage,
                'Peers': peersPage,
                'Networks': networksPage,
                'Profiles': profilesPage,
            };
            const page = pageMap[targetPage];
            if (page) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    window.set_visible_page(page);
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }
}

function readSmokePage() {
    const path = GLib.getenv('NETBIRD_PREFS_PAGE_FILE');
    if (!path)
        return null;
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return new TextDecoder().decode(bytes).trim() || null;
    } catch {
        return null;
    }
}
