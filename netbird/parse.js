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

/**
 * Extract host address from a CIDR string (100.92.0.1/16 → 100.92.0.1).
 *
 * @param {string} cidr - CIDR notation or plain address
 * @returns {string} host address without prefix
 */
export function hostAddress(cidr) {
    return cidr.split('/')[0];
}

/**
 * Parse peers from `netbird status --json` output.
 *
 * @param {object} statusJson - parsed `netbird status --json`
 * @returns {{name: string, fqdn: string, ip: string, ipv6: string, state: string, connType: string, latencyMs: number, bytesRx: number, bytesTx: number, lastHandshake: number}[]}
 */
export function parsePeers(statusJson) {
    const details = statusJson?.peers?.details;
    if (!Array.isArray(details))
        return [];

    const peers = details.map(peer => {
        const fqdn = peer.fqdn || '';
        const ip = hostAddress(peer.netbirdIp || '');
        const ipv6 = hostAddress(peer.netbirdIpv6 || '');
        const name = fqdn.split('.')[0] || ip || ipv6 || 'Unknown Peer';

        // Parse lastWireguardHandshake: zero time → 0, else unix timestamp
        let lastHandshake = 0;
        const handshakeStr = peer.lastWireguardHandshake || '';
        if (handshakeStr && handshakeStr !== '0001-01-01T00:00:00Z') {
            const when = GLib.DateTime.new_from_iso8601(handshakeStr, null);
            if (when)
                lastHandshake = when.to_unix();
        }

        return {
            name,
            fqdn,
            ip,
            ipv6,
            state: peer.status || '',
            connType: peer.connectionType || '',
            latencyMs: Math.round((peer.latency || 0) / 1e6),
            bytesRx: peer.transferReceived || 0,
            bytesTx: peer.transferSent || 0,
            lastHandshake,
        };
    });

    // Sort: Connected, Connecting, then others; then by name
    peers.sort((a, b) => {
        const stateOrder = (state) => {
            if (state === 'Connected')
                return 0;
            if (state === 'Connecting')
                return 1;
            return 2;
        };
        const stateDiff = stateOrder(a.state) - stateOrder(b.state);
        if (stateDiff !== 0)
            return stateDiff;
        return a.name.localeCompare(b.name);
    });

    return peers;
}
