// SPDX-License-Identifier: GPL-3.0-or-later

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {NetbirdCli} from './netbird/cli.js';
import {WindowModel} from './prefs/model.js';
import {createExtensionPage} from './prefs/extensionPage.js';

export default class NetbirdPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const cli = new NetbirdCli(settings);
        const model = new WindowModel(cli, 2);

        // Store settings on window so pages can access it
        window._settings = settings;

        // Add pages
        window.add(createExtensionPage(model, window));

        // Wire model lifecycle to window
        window.connect('close-request', () => {
            model.stop();
        });

        model.start();
    }
}
