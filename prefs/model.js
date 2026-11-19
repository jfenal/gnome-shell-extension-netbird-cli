// SPDX-License-Identifier: GPL-3.0-or-later
//
// Shared polling model for all prefs pages.
// No Gtk/Adw imports — must run under plain `gjs -m` for tests.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/**
 * WindowModel: shared state for all prefs pages.
 *
 * State: {status, data, profiles}.
 * Polling via `start()` / `stop()`.
 * Signal: 'changed' fires after each refresh.
 */
export class WindowModel {
    /**
     * @param {object} cli - NetbirdCli instance
     * @param {number} intervalSeconds - poll interval (default 2)
     */
    constructor(cli, intervalSeconds = 2) {
        this._cli = cli;
        this._intervalSeconds = intervalSeconds;
        this._state = {status: null, data: null, profiles: [], networks: [], features: {}};
        this._cancellable = new Gio.Cancellable();
        this._timeoutId = null;
        this._refreshing = false;
        this._signals = new Map();
        this._nextSignalId = 1;
    }

    /** @returns {object} the NetbirdCli the model polls with */
    get cli() {
        return this._cli;
    }

    /** @returns {object} last emitted state */
    get state() {
        return this._state;
    }

    /** @returns {Gio.Cancellable} cancelled when the window closes */
    get cancellable() {
        return this._cancellable;
    }

    /**
     * Connect to a signal.
     *
     * @param {string} signal - signal name ('changed')
     * @param {function} callback - called with (state)
     * @returns {number} connection ID for disconnect()
     */
    connect(signal, callback) {
        if (signal !== 'changed')
            throw new Error(`Unknown signal: ${signal}`);
        const id = this._nextSignalId++;
        this._signals.set(id, callback);
        return id;
    }

    /**
     * Disconnect a signal.
     *
     * @param {number} id - connection ID from connect()
     */
    disconnect(id) {
        this._signals.delete(id);
    }

    _emit(signal, ...args) {
        if (signal === 'changed') {
            for (const cb of this._signals.values())
                cb(...args);
        }
    }

    /**
     * Start polling. Call after connecting to 'changed'.
     */
    start() {
        if (this._timeoutId)
            return;
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, this._intervalSeconds, () => {
                this.refresh();
                return GLib.SOURCE_CONTINUE;
            });
        this.refresh();
    }

    /**
     * Stop polling and cancel in-flight requests.
     */
    stop() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        this._cancellable.cancel();
    }

    /**
     * Refresh state from the CLI. Guards against overlapping calls.
     *
     * @returns {Promise<void>}
     */
    async refresh() {
        if (this._refreshing)
            return;
        this._refreshing = true;

        try {
            // Capture raw profile list result to detect disabled state
            const profileListResult = await this._cli.run(['profile', 'list', '--show-id'], this._cancellable)
                .catch(() => ({ok: false, stdout: '', stderr: ''}));
            const profilesDisabled = !profileListResult.ok &&
                (profileListResult.stderr.includes('profiles are disabled') ||
                 profileListResult.stdout.includes('profiles are disabled'));

            const [statusResult, networksResult] = await Promise.all([
                this._cli.status(this._cancellable).catch(() => ({
                    status: 'Unavailable',
                    data: null,
                    error: 'status call failed',
                })),
                this._cli.networks(this._cancellable)
                    .catch(() => ({networks: [], disabled: false})),
            ]);

            this._state = {
                status: statusResult.status,
                data: statusResult.data,
                profiles: await this._cli.profiles(this._cancellable).catch(() => []) ?? [],
                networks: networksResult.networks,
                features: {
                    networksDisabled: networksResult.disabled,
                    profilesDisabled,
                },
            };

            this._emit('changed', this._state);
        } finally {
            this._refreshing = false;
        }
    }

    /**
     * Run a CLI command, then refresh.
     *
     * @param {string[]} args - CLI arguments
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async run(args) {
        const result = await this._cli.run(args, this._cancellable);
        await this.refresh();
        return result;
    }
}
