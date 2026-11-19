// SPDX-License-Identifier: GPL-3.0-or-later
//
// NetBird status icons (from upstream, BSD-3-Clause licensed).

import Gio from 'gi://Gio';

const STATE_ICON_FILES = {
    Connected: 'netbird-systemtray-connected-symbolic.svg',
    Connecting: 'netbird-systemtray-connecting-symbolic.svg',
    Idle: 'netbird-systemtray-disconnected-symbolic.svg',
    LoginFailed: 'netbird-systemtray-needs-login-symbolic.svg',
    NeedsLogin: 'netbird-systemtray-needs-login-symbolic.svg',
    SessionExpired: 'netbird-systemtray-needs-login-symbolic.svg',
    Unavailable: 'netbird-systemtray-error-symbolic.svg',
};

/**
 * Map a daemon state to its icon filename (pure, testable without Shell).
 *
 * @param {string} state - daemon state from Status constants
 * @returns {string} filename like 'netbird-systemtray-connected-symbolic.svg'
 */
export function iconFileForState(state) {
    return STATE_ICON_FILES[state] ?? 'netbird-systemtray-error-symbolic.svg';
}

/**
 * NetBird state icons, loaded from the extension's icon directory.
 */
export class StatusIcons {
    constructor(extensionDir) {
        const scalable = extensionDir.get_child('icons')
            .get_child('hicolor')
            .get_child('scalable');
        const directory = scalable.get_child('status');
        this.appIcon = new Gio.FileIcon({
            file: scalable.get_child('apps').get_child('netbird.svg'),
        });

        this._icons = new Map();
        for (const filename of new Set(Object.values(STATE_ICON_FILES))) {
            const file = directory.get_child(filename);
            this._icons.set(filename, new Gio.FileIcon({file}));
        }
        // Add the default error icon for unknown states.
        const errorFile = directory.get_child('netbird-systemtray-error-symbolic.svg');
        this._icons.set('netbird-systemtray-error-symbolic.svg',
            new Gio.FileIcon({file: errorFile}));
    }

    forState(state) {
        const filename = iconFileForState(state);
        return this._icons.get(filename);
    }
}
