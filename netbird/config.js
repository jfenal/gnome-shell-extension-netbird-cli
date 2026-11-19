// SPDX-License-Identifier: GPL-3.0-or-later
//
// Daemon settings: read from `netbird debug config` (protojson), written
// with `netbird up --<flag>=<value>`. Pure, no I/O.

/**
 * @typedef {object} Setting
 * @property {string} key - field name in `netbird debug config`
 * @property {'bool'|'string'|'uint'} type
 * @property {string} flag - `netbird up` flag
 * @property {string} group - preferences group title
 * @property {string} title
 * @property {string} [subtitle]
 * @property {number} [max] - upper bound for uint settings
 * @property {string} [mdm] - name in mDMManagedFields when it differs from key
 *   (MDM policy keys, client/mdm/policy.go)
 */

/** @type {Setting[]} */
export const SETTINGS = [
    {key: 'serverSSHAllowed', mdm: 'allowServerSSH', type: 'bool', flag: '--allow-server-ssh', group: 'General',
        title: 'Allow SSH', subtitle: 'Allow NetBird SSH access to this peer'},
    {key: 'disableAutoConnect', type: 'bool', flag: '--disable-auto-connect', group: 'General',
        title: 'Disable Auto-Connect', subtitle: 'Do not connect when the NetBird service starts'},
    {key: 'rosenpassEnabled', type: 'bool', flag: '--enable-rosenpass', group: 'General',
        title: 'Enable Quantum Resistance', subtitle: 'Secure connections with Rosenpass (experimental)'},
    {key: 'rosenpassPermissive', type: 'bool', flag: '--rosenpass-permissive', group: 'General',
        title: 'Enable Permissive Mode', subtitle: 'Allow connections to peers without quantum resistance support'},
    {key: 'blockInbound', type: 'bool', flag: '--block-inbound', group: 'General',
        title: 'Block Inbound Connections', subtitle: 'Block inbound peer connections'},

    {key: 'managementUrl', mdm: 'managementURL', type: 'string', flag: '--management-url', group: 'Connection',
        title: 'Management URL'},
    {key: 'interfaceName', type: 'string', flag: '--interface-name', group: 'Connection',
        title: 'Interface Name'},
    {key: 'wireguardPort', type: 'uint', flag: '--wireguard-port', group: 'Connection',
        title: 'Listen Port', max: 65535},
    {key: 'mtu', type: 'uint', flag: '--mtu', group: 'Connection',
        title: 'MTU', max: 65535},

    {key: 'networkMonitor', type: 'bool', flag: '--network-monitor', group: 'Network',
        title: 'Network Monitor', subtitle: 'React to system network changes'},
    {key: 'disableDns', type: 'bool', flag: '--disable-dns', group: 'Network',
        title: 'Disable NetBird DNS', subtitle: 'Do not configure DNS from NetBird'},
    {key: 'disableClientRoutes', type: 'bool', flag: '--disable-client-routes', group: 'Network',
        title: 'Disable Client Routes', subtitle: 'Do not install routes received from the network'},
    {key: 'disableServerRoutes', type: 'bool', flag: '--disable-server-routes', group: 'Network',
        title: 'Disable Server Routes', subtitle: 'Do not publish configured routes from this peer'},
    {key: 'blockLanAccess', type: 'bool', flag: '--block-lan-access', group: 'Network',
        title: 'Block LAN Access', subtitle: 'Block local networks when this peer routes traffic'},
    {key: 'disableIpv6', type: 'bool', flag: '--disable-ipv6', group: 'Network',
        title: 'Disable IPv6', subtitle: 'Do not use an IPv6 overlay address'},

    {key: 'disableSSHAuth', type: 'bool', flag: '--disable-ssh-auth', group: 'SSH',
        title: 'Disable Authentication', subtitle: 'Permit SSH without NetBird identity authentication'},
    {key: 'enableSSHRoot', type: 'bool', flag: '--enable-ssh-root', group: 'SSH',
        title: 'Allow Root Login', subtitle: 'Permit direct root SSH sessions'},
    {key: 'enableSSHSFTP', type: 'bool', flag: '--enable-ssh-sftp', group: 'SSH',
        title: 'Enable SFTP', subtitle: 'Allow secure file transfer over SSH'},
    {key: 'enableSSHLocalPortForwarding', type: 'bool', flag: '--enable-ssh-local-port-forwarding', group: 'SSH',
        title: 'Local Port Forwarding', subtitle: 'Allow local SSH port forwarding'},
    {key: 'enableSSHRemotePortForwarding', type: 'bool', flag: '--enable-ssh-remote-port-forwarding', group: 'SSH',
        title: 'Remote Port Forwarding', subtitle: 'Allow remote SSH port forwarding'},
    {key: 'sshJWTCacheTTL', type: 'uint', flag: '--ssh-jwt-cache-ttl', group: 'SSH',
        title: 'Identity Cache Lifetime', subtitle: 'Seconds to cache SSH identity tokens', max: 86400},
];

const BY_KEY = new Map(SETTINGS.map(s => [s.key, s]));

/**
 * Parse `netbird debug config` output.
 *
 * protojson renders int64 fields as strings; they are converted back to
 * numbers. Keys not in SETTINGS are dropped.
 *
 * @param {string} json - CLI stdout
 * @returns {{values: Record<string, boolean|string|number>, managed: Set<string>}}
 * @throws {SyntaxError} when the output is not JSON
 */
export function parseConfig(json) {
    const raw = JSON.parse(json);
    const values = {};
    for (const setting of SETTINGS) {
        if (!(setting.key in raw))
            continue;
        const value = raw[setting.key];
        if (setting.type === 'bool')
            values[setting.key] = Boolean(value);
        else if (setting.type === 'uint')
            values[setting.key] = Number(value) || 0;
        else
            values[setting.key] = String(value ?? '');
    }
    const policyNames = new Set(raw.mDMManagedFields ?? []);
    const managed = new Set(SETTINGS
        .filter(setting => policyNames.has(setting.mdm ?? setting.key))
        .map(setting => setting.key));
    return {values, managed};
}

/**
 * `netbird up` arguments for a set of changes, in insertion order.
 * Booleans are always explicit (`--flag=false`).
 *
 * @param {Record<string, boolean|string|number>} changes - key → new value
 * @returns {string[]}
 * @throws {Error} on a key that is not a known setting
 */
export function flagsFor(changes) {
    return Object.entries(changes).map(([key, value]) => {
        const setting = BY_KEY.get(key);
        if (!setting)
            throw new Error(`unknown setting: ${key}`);
        return `${setting.flag}=${value}`;
    });
}

/**
 * Settings are written with `netbird up`: from NeedsLogin/SessionExpired that
 * would start an SSO login, and a connection attempt would be aborted.
 *
 * @param {string|null} status - daemon status
 * @returns {boolean}
 */
export function settingsWritable(status) {
    return status === 'Idle' || status === 'Connected';
}
