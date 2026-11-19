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

// Human-readable labels for daemon states.
export const STATUS_LABELS = {
    [Status.CONNECTED]: 'Connected',
    [Status.CONNECTING]: 'Connecting…',
    [Status.IDLE]: 'Disconnected',
    [Status.NEEDS_LOGIN]: 'Login required',
    [Status.LOGIN_FAILED]: 'Login failed',
    [Status.SESSION_EXPIRED]: 'Session expired',
    [Status.UNAVAILABLE]: 'Daemon unavailable',
};

/**
 * Human-readable label for a daemon status.
 *
 * @param {string} state - daemon status (from Status)
 * @returns {string} label (falls back to the raw state)
 */
export function statusLabel(state) {
    return STATUS_LABELS[state] ?? state;
}

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
        const stateOrder = state => {
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

/**
 * Check if a CLI result indicates profiles are disabled.
 *
 * @param {{ok: boolean, stdout: string, stderr: string}} result - CLI result
 * @returns {boolean} true if profiles are disabled
 */
export function isProfilesDisabled(result) {
    return result.stderr.includes('profiles are disabled') ||
           result.stdout.includes('profiles are disabled');
}

/**
 * Parse `netbird networks list` output.
 *
 * Format: blocks starting with `  - ID: <id>`, then either:
 *   - `    Network: <cidr>` for CIDR routes
 *   - `    Domains: <comma, separated>` for domain routes
 * Followed by `    Status: Selected|Not Selected`.
 * Optional `    Resolved IPs:` section with `      [domain]: ip, ip` lines.
 *
 * Exit node ⇔ range is `0.0.0.0/0` or `::/0`.
 *
 * @param {string} text - CLI stdout
 * @returns {{id: string, range: string, domains: string[], resolvedIps: string[], selected: boolean, isExitNode: boolean}[]}
 */
export function parseNetworks(text) {
    if (text.includes('No networks available.'))
        return [];

    const networks = [];
    const lines = text.split('\n');
    let current = null;

    for (const line of lines) {
        // Start of a network block
        const idMatch = line.match(/^ {2}- ID: (.+)$/);
        if (idMatch) {
            if (current)
                networks.push(current);
            current = {
                id: idMatch[1],
                range: '',
                domains: [],
                resolvedIps: [],
                selected: false,
                isExitNode: false,
            };
            continue;
        }

        if (!current)
            continue;

        // Network field (CIDR)
        const networkMatch = line.match(/^ {4}Network: (.+)$/);
        if (networkMatch) {
            current.range = networkMatch[1];
            current.isExitNode = networkMatch[1] === '0.0.0.0/0' || networkMatch[1] === '::/0';
            continue;
        }

        // Domains field
        const domainsMatch = line.match(/^ {4}Domains: (.+)$/);
        if (domainsMatch) {
            current.domains = domainsMatch[1].split(',').map(d => d.trim());
            continue;
        }

        // Status field
        const statusMatch = line.match(/^ {4}Status: (.+)$/);
        if (statusMatch) {
            current.selected = statusMatch[1] === 'Selected';
            continue;
        }

        // Resolved IPs (individual lines)
        const resolvedMatch = line.match(/^ {6}\[.+?\]: (.+)$/);
        if (resolvedMatch) {
            const ips = resolvedMatch[1].split(',').map(ip => ip.trim());
            current.resolvedIps.push(...ips);
            continue;
        }
    }

    if (current)
        networks.push(current);

    return networks;
}

/**
 * Parse `netbird debug bundle` output (client/cmd/debug.go): the local
 * path follows "Local file:", the upload key follows "Upload file key:",
 * and a failed upload prints "upload failed: <reason>" on stderr.
 *
 * @param {string} stdout - CLI stdout
 * @param {string} stderr - CLI stderr
 * @returns {{path: string, uploadedKey: string, uploadError: string}}
 */
export function parseDebugBundle(stdout, stderr) {
    const after = label => {
        const lines = stdout.split('\n');
        const index = lines.findIndex(line => line.trim() === label);
        return index >= 0 ? (lines[index + 1] ?? '').trim() : '';
    };
    const failed = /upload failed:\s*(.*)/.exec(stderr);
    return {
        path: after('Local file:'),
        uploadedKey: after('Upload file key:'),
        uploadError: failed ? failed[1].trim() : '',
    };
}
