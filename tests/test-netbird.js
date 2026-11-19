// Run with: gjs -m tests/test-netbird.js
import GLib from 'gi://GLib';
import System from 'system';
import {parseProfileList, parsePeers, secondsUntil, formatLocal, errorText, hostAddress} from '../netbird/parse.js';

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

if (failures)
    System.exit(1);
