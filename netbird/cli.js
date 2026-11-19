// SPDX-License-Identifier: GPL-3.0-or-later
//
// Thin async wrapper around the `netbird` CLI.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {Status, errorText, parseProfileList, parseNetworks} from './parse.js';

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
        let data = null;
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
}
