// Run with: gjs -m tests/test-vpn.js
import Gio from 'gi://Gio';
import System from 'system';
import {disconnectOtherVpns, isNetBirdConnection} from '../shell/vpnConnections.js';

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

const DEACTIVATED = 4;

function connection(type, iface) {
    return {get_connection_type: () => type, get_interface_name: () => iface};
}

check('wt0 wireguard is NetBird', isNetBirdConnection(connection('wireguard', 'wt0')), true);
check('other wireguard is not NetBird', isNetBirdConnection(connection('wireguard', 'wg0')), false);
check('openvpn is not NetBird', isNetBirdConnection(connection('vpn', 'tun0')), false);

// Fake NM client: deactivation flips the active connection to DEACTIVATED.
function active(id, type, iface, state = 2) {
    return {
        id, state, connection: connection(type, iface),
        get_state() {
            return this.state;
        },
        connect: () => 1,
        disconnect: () => {},
    };
}
const actives = [
    active('office', 'vpn', 'tun0'),
    active('home-wg', 'wireguard', 'wg0'),
    active('netbird', 'wireguard', 'wt0'),
    active('ethernet', '802-3-ethernet', 'eth0'),
    active('old', 'vpn', 'tun1', DEACTIVATED),
];
const deactivated = [];
const client = {
    get_active_connections: () => actives,
    deactivate_connection_async(a, _cancellable, callback) {
        deactivated.push(a.id);
        a.state = DEACTIVATED;
        callback(this, null);
    },
    deactivate_connection_finish: () => true,
};

await disconnectOtherVpns(client, new Gio.Cancellable());
check('disconnects other active VPNs only', deactivated, ['office', 'home-wg']);

let threw = false;
const cancelled = new Gio.Cancellable();
cancelled.cancel();
try {
    await disconnectOtherVpns(client, cancelled);
} catch {
    threw = true;
}
check('cancelled call rejects', threw, true);

await disconnectOtherVpns(null, new Gio.Cancellable());
check('no NM client is a no-op', true, true);

if (failures) {
    print(`\n${failures} failure(s)`);
    System.exit(1);
}
