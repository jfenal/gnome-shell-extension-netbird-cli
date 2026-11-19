// Run with: gjs -m tests/test-netbird.js
import GLib from 'gi://GLib';
import System from 'system';
import {parseProfileList, parsePeers, secondsUntil, formatLocal, errorText, hostAddress, parseNetworks, STATUS_LABELS, statusLabel} from '../netbird/parse.js';

let failures = 0;
function check(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) {
        print(`ok   ${name}`);
    } else {
        failures++;
        print(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`);
    }
}

check('profile list, check-mark marker',
    parseProfileList('ID       NAME     ACTIVE\ndefault  default  ✓\n'),
    [{id: 'default', name: 'default', active: true}]);

check('profile list, star marker, name with spaces, inactive row',
    parseProfileList(
        'ID        NAME          ACTIVE\n' +
        'default   default       \n' +
        'a1b2c3d4  work account  *\n'),
    [{id: 'default', name: 'default', active: false},
        {id: 'a1b2c3d4', name: 'work account', active: true}]);

check('profile list with OWNER column',
    parseProfileList('ID       NAME     ACTIVE  OWNER\ndefault  default  *       alice\n'),
    [{id: 'default', name: 'default', active: true}]);

check('profile list, empty / garbage', [parseProfileList(''), parseProfileList('oops')], [[], []]);

const inOneHour = GLib.DateTime.new_now_utc().add_hours(1).format_iso8601();
const s = secondsUntil(inOneHour);
check('secondsUntil ~3600', s > 3590 && s <= 3600, true);
check('secondsUntil invalid', [secondsUntil(''), secondsUntil('nope')], [null, null]);
check('formatLocal shape', /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(formatLocal(inOneHour)), true);

check('errorText prefers stderr', errorText({stdout: 'out', stderr: ' err\n'}, 'fb'), 'err');
check('errorText fallback', errorText({stdout: '', stderr: ''}, 'fb'), 'fb');

check('host of cidr', hostAddress('100.92.14.7/16'), '100.92.14.7');
check('empty', hostAddress(''), '');

// parsePeers tests
check('parsePeers empty', parsePeers({}), []);
check('parsePeers no details', parsePeers({peers: {}}), []);

const peerFixture = {
    peers: {
        details: [
            {
                fqdn: 'server.netbird.cloud',
                netbirdIp: '100.92.1.1/16',
                netbirdIpv6: 'fd00:4e42::1/64',
                status: 'Connected',
                connectionType: 'P2P',
                latency: 12500000,
                transferReceived: 1024000,
                transferSent: 2048000,
                lastWireguardHandshake: '2026-11-19T10:00:00Z',
            },
            {
                fqdn: 'idle-peer.netbird.cloud',
                netbirdIp: '100.92.2.2/16',
                netbirdIpv6: '',
                status: 'Idle',
                connectionType: '',
                latency: 0,
                transferReceived: 0,
                transferSent: 0,
                lastWireguardHandshake: '0001-01-01T00:00:00Z',
            },
        ],
    },
};

const peers = parsePeers(peerFixture);
check('parsePeers count', peers.length, 2);
check('parsePeers connected first', peers[0].state, 'Connected');
check('parsePeers latencyMs', peers[0].latencyMs, 13);
check('parsePeers zero handshake', peers[1].lastHandshake, 0);
check('parsePeers nonzero handshake', typeof peers[0].lastHandshake === 'number' && peers[0].lastHandshake > 0, true);

check('parsePeers unicode FQDN name',
    parsePeers({peers: {details: [{fqdn: 'büro-pc.netbird.cloud', netbirdIp: '100.92.3.3/16', status: 'Connected'}]}})[0].name,
    'büro-pc');

check('parsePeers fallback to IP when no FQDN',
    parsePeers({peers: {details: [{fqdn: '', netbirdIp: '100.92.4.4/16', status: 'Idle'}]}})[0].name,
    '100.92.4.4');

// parseNetworks tests
const networksFixture = `Available Networks:

  - ID: office lan
    Network: 192.168.1.0/24
    Status: Selected

  - ID: intranet
    Domains: git.example.com, wiki.example.com
    Status: Not Selected
    Resolved IPs:
      [git.example.com]: 192.0.2.10, 192.0.2.11
      [wiki.example.com]: 192.0.2.20

  - ID: exit-fr
    Network: 0.0.0.0/0
    Status: Not Selected
`;

const networks = parseNetworks(networksFixture);
check('parseNetworks count', networks.length, 3);
check('parseNetworks CIDR selected', {
    id: networks[0].id,
    range: networks[0].range,
    selected: networks[0].selected,
    isExitNode: networks[0].isExitNode,
}, {id: 'office lan', range: '192.168.1.0/24', selected: true, isExitNode: false});

check('parseNetworks domain route', {
    id: networks[1].id,
    domains: networks[1].domains,
    resolvedIps: networks[1].resolvedIps,
    selected: networks[1].selected,
    isExitNode: networks[1].isExitNode,
}, {
    id: 'intranet',
    domains: ['git.example.com', 'wiki.example.com'],
    resolvedIps: ['192.0.2.10', '192.0.2.11', '192.0.2.20'],
    selected: false,
    isExitNode: false,
});

check('parseNetworks exit node', {
    id: networks[2].id,
    range: networks[2].range,
    selected: networks[2].selected,
    isExitNode: networks[2].isExitNode,
}, {id: 'exit-fr', range: '0.0.0.0/0', selected: false, isExitNode: true});

check('parseNetworks empty', parseNetworks('No networks available.\n'), []);
check('parseNetworks id with spaces preserved', parseNetworks(networksFixture)[0].id, 'office lan');

// Edge cases from real CLI output
const domainNoIPs = `Available Networks:

  - ID: internal
    Domains: app.example.com
    Status: Selected
    Resolved IPs: -
`;
const withNoIPs = parseNetworks(domainNoIPs);
check('parseNetworks domain with Resolved IPs: -', {
    id: withNoIPs[0].id,
    domains: withNoIPs[0].domains,
    resolvedIps: withNoIPs[0].resolvedIps,
    selected: withNoIPs[0].selected,
}, {id: 'internal', domains: ['app.example.com'], resolvedIps: [], selected: true});

const headerAndBlanks = `Available Networks:

  - ID: net1
    Network: 10.0.0.0/8
    Status: Selected

  - ID: net2
    Network: 172.16.0.0/12
    Status: Not Selected
`;
const multiNet = parseNetworks(headerAndBlanks);
check('parseNetworks with header and blank lines', multiNet.length, 2);
check('parseNetworks blank lines do not create bogus entries', multiNet[0].id, 'net1');
check('parseNetworks second network parsed', multiNet[1].id, 'net2');

// STATUS_LABELS and statusLabel tests
check('statusLabel Connected', statusLabel('Connected'), 'Connected');
check('statusLabel Idle', statusLabel('Idle'), 'Disconnected');
check('statusLabel NeedsLogin', statusLabel('NeedsLogin'), 'Login required');
check('statusLabel unknown', statusLabel('UnknownState'), 'UnknownState');
check('STATUS_LABELS.Connected', STATUS_LABELS.Connected, 'Connected');
check('STATUS_LABELS.Idle', STATUS_LABELS.Idle, 'Disconnected');

if (failures)
    System.exit(1);
