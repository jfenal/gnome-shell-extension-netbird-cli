// SPDX-License-Identifier: GPL-3.0-or-later
//
// Pure parsers for `netbird` CLI output.

import GLib from 'gi://GLib';

// Daemon status values, from netbird client/status/status.go.
export const Status = {
    CONNECTED: 'Connected',
    CONNECTING: 'Connecting',
    IDLE: 'Idle',
    NEEDS_LOGIN: 'NeedsLogin',
    LOGIN_FAILED: 'LoginFailed',
    SESSION_EXPIRED: 'SessionExpired',
    // Not a daemon value: the CLI failed or could not reach the daemon.
    UNAVAILABLE: 'Unavailable',
};

/**
 * Best-effort error text from a CLI result.
 *
 * @param {{stdout: string, stderr: string}} result - CLI result
 * @param {string} fallback - used when the CLI printed nothing
 * @returns {string}
 */
export function errorText(result, fallback) {
    return (result.stderr || result.stdout).trim() || fallback;
}

/**
 * Parse `netbird profile list --show-id` (tabwriter-aligned columns).
 *
 * Columns are located from the header so that names containing spaces
 * survive. The active marker differs across versions ("*" or "✓"), so any
 * non-empty ACTIVE cell counts.
 *
 * @param {string} text - CLI stdout
 * @returns {{id: string, name: string, active: boolean}[]}
 */
export function parseProfileList(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0)
        return [];

    const header = lines[0];
    const idCol = header.indexOf('ID');
    const nameCol = header.indexOf('NAME');
    const activeCol = header.indexOf('ACTIVE');
    if (idCol < 0 || nameCol < 0 || activeCol < 0)
        return [];
    const ownerCol = header.indexOf('OWNER');
    const activeEnd = ownerCol > activeCol ? ownerCol : undefined;

    return lines.slice(1).map(line => ({
        id: line.slice(idCol, nameCol).trim(),
        name: line.slice(nameCol, activeCol).trim(),
        active: line.slice(activeCol, activeEnd).trim() !== '',
    })).filter(p => p.id);
}

/**
 * Seconds until an ISO-8601 timestamp, or null if unparsable.
 *
 * @param {string} isoString - timestamp
 * @returns {number|null}
 */
export function secondsUntil(isoString) {
    if (!isoString)
        return null;
    const when = GLib.DateTime.new_from_iso8601(isoString, null);
    if (!when)
        return null;
    return when.to_unix() - GLib.DateTime.new_now_utc().to_unix();
}

/**
 * Local "YYYY-MM-DD HH:MM" for an ISO-8601 timestamp, or null.
 *
 * @param {string} isoString - timestamp
 * @returns {string|null}
 */
export function formatLocal(isoString) {
    if (!isoString)
        return null;
    const when = GLib.DateTime.new_from_iso8601(isoString, null);
    return when ? when.to_local().format('%Y-%m-%d %H:%M') : null;
}
