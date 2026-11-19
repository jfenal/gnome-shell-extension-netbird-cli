// SPDX-License-Identifier: GPL-3.0-or-later
//
// Thin async wrapper around the `netbird` CLI.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Status, errorText, parseProfileList, parseNetworks} from './parse.js';
import {parseConfig, flagsFor} from './config.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

export {Status};

export class NetbirdCli {
    /**
     * @param {Gio.Settings} settings - extension settings (reads `netbird-path`)
     */
    constructor(settings) {
        this._settings = settings;
    }

    _binary() {
        const configured = this._settings.get_string('netbird-path').trim();
        if (configured)
            return configured;
        return GLib.find_program_in_path('netbird');
    }

    /**
     * Run the netbird CLI.
     *
     * @param {string[]} args - arguments after the binary name
     * @param {Gio.Cancellable} cancellable - kills the process when cancelled
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async run(args, cancellable) {
        const binary = this._binary();
        if (!binary)
            return {ok: false, stdout: '', stderr: 'netbird CLI not found in PATH'};

        let proc;
        try {
            proc = Gio.Subprocess.new(
                [binary, ...args],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            return {ok: false, stdout: '', stderr: e.message};
        }

        const cancelId = cancellable.connect(() => proc.force_exit());
        try {
            const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
            return {ok: proc.get_successful(), stdout: stdout ?? '', stderr: stderr ?? ''};
        } finally {
            cancellable.disconnect(cancelId);
        }
    }

    /**
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{status: string, data: object|null, error: string|null}>}
     */
    async status(cancellable) {
        const result = await this.run(['status', '--json'], cancellable);
        let data;
        try {
            data = result.stdout ? JSON.parse(result.stdout) : null;
        } catch {
            data = null;
        }
        return {
            status: data?.daemonStatus ?? Status.UNAVAILABLE,
            data,
            error: data ? null : errorText(result, 'netbird daemon not reachable'),
        };
    }

    /**
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{id: string, name: string, active: boolean}[]|null>} null on failure
     */
    async profiles(cancellable) {
        const result = await this.run(['profile', 'list', '--show-id'], cancellable);
        if (!result.ok)
            return null;
        return parseProfileList(result.stdout);
    }

    /**
     * List networks. Non-zero exit or "No networks available." → empty array.
     * "network selection is disabled" → empty array (caller should detect via text).
     *
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{networks: Network[], disabled: boolean}>}
     */
    async networks(cancellable) {
        const result = await this.run(['networks', 'list'], cancellable);
        const disabled = result.stderr.includes('network selection is disabled') ||
                         result.stdout.includes('network selection is disabled');
        if (!result.ok || disabled)
            return {networks: [], disabled};
        return {networks: parseNetworks(result.stdout), disabled: false};
    }

    /**
     * Select networks.
     *
     * @param {string[]} ids - network IDs to select
     * @param {{append: boolean}} options - append to current selection
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async selectNetworks(ids, options, cancellable) {
        const args = ['networks', 'select'];
        if (options?.append)
            args.push('--append');
        args.push(...ids);
        return this.run(args, cancellable);
    }

    /**
     * Deselect networks.
     *
     * @param {string[]} ids - network IDs to deselect
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async deselectNetworks(ids, cancellable) {
        return this.run(['networks', 'deselect', ...ids], cancellable);
    }

    /**
     * Add a new profile.
     *
     * @param {string} name - profile name
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async addProfile(name, cancellable) {
        return this.run(['profile', 'add', name], cancellable);
    }

    /**
     * Rename a profile.
     *
     * @param {string} id - profile ID
     * @param {string} newName - new name
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async renameProfile(id, newName, cancellable) {
        return this.run(['profile', 'rename', id, newName], cancellable);
    }

    /**
     * Remove a profile.
     *
     * @param {string} id - profile ID
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async removeProfile(id, cancellable) {
        return this.run(['profile', 'remove', id], cancellable);
    }

    /**
     * Logout from a profile.
     *
     * @param {string} id - profile ID
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async logout(id, cancellable) {
        return this.run(['logout', '--profile', id], cancellable);
    }

    /**
     * Daemon settings from `netbird debug config`.
     *
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{values: object|null, managed: Set<string>, error: string|null}>}
     */
    async config(cancellable) {
        const result = await this.run(['debug', 'config'], cancellable);
        if (result.ok) {
            try {
                return {...parseConfig(result.stdout), error: null};
            } catch {
                // fall through: unparsable output is reported like a failure
            }
        }
        return {values: null, managed: new Set(), error: errorText(result, 'could not read NetBird settings')};
    }

    /**
     * Write daemon settings. The CLI only writes settings through `up`,
     * which also connects, and which exits with "Already connected" before
     * applying anything when connected (client/cmd/up.go). So: when
     * connected, disconnect first and reconnect with the new flags (plain
     * `up` if those are refused); when disconnected, disconnect again after.
     *
     * @param {Record<string, boolean|string|number>} changes - key → value
     * @param {boolean} wasConnected - NetBird state before the write
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>} the `up` result
     */
    async applySettings(changes, wasConnected, cancellable) {
        const flags = flagsFor(changes);
        if (wasConnected)
            await this.run(['down'], cancellable);
        const result = await this.run(['up', ...flags], cancellable);
        if (wasConnected && !result.ok)
            await this.run(['up'], cancellable);
        else if (result.ok && !wasConnected)
            await this.run(['down'], cancellable);
        return result;
    }

    /**
     * Create a debug bundle.
     *
     * @param {{upload: boolean, anonymize: boolean, systemInfo: boolean}} options - bundle options
     * @param {Gio.Cancellable} cancellable - cancels the call
     * @returns {Promise<{ok: boolean, stdout: string, stderr: string}>}
     */
    async debugBundle({upload, anonymize, systemInfo}, cancellable) {
        return this.run([
            'debug', 'bundle',
            ...upload ? ['-U'] : [],
            ...anonymize ? ['-A'] : [],
            `--system-info=${systemInfo}`,
        ], cancellable);
    }
}
