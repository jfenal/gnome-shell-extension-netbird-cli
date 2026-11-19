// Run with: gjs -m tests/test-config.js
import System from 'system';
import {SETTINGS, parseConfig, flagsFor, settingsWritable} from '../netbird/config.js';

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

// Shape of `netbird debug config` (protojson, EmitUnpopulated).
const CONFIG = JSON.stringify({
    managementUrl: 'https://api.netbird.io:443',
    preSharedKey: '**********',
    interfaceName: 'wt0',
    wireguardPort: '51820',
    mtu: '1280',
    disableAutoConnect: false,
    serverSSHAllowed: false,
    disableDns: true,
    sshJWTCacheTTL: 0,
    mDMManagedFields: ['managementURL'],
});

const parsed = parseConfig(CONFIG);
check('parseConfig bool', parsed.values.disableDns, true);
check('parseConfig managed', parsed.managed.has('managementUrl'), true);
check('parseConfig not managed', parsed.managed.has('disableDns'), false);
// protojson renders int64 as strings; uint settings come back as numbers.
check('parseConfig int64 string → number', [parsed.values.wireguardPort, parsed.values.mtu], [51820, 1280]);
check('parseConfig ignores unknown keys', 'preSharedKey' in parsed.values, false);
check('parseConfig no managed list', parseConfig('{"disableDns": false}').managed.size, 0);

let threw = false;
try {
    parseConfig('not json');
} catch {
    threw = true;
}
check('parseConfig invalid JSON throws', threw, true);

check('flagsFor bool/uint/string',
    flagsFor({disableDns: false, mtu: 1380, managementUrl: 'https://nb.example.com'}),
    ['--disable-dns=false', '--mtu=1380', '--management-url=https://nb.example.com']);
check('flagsFor explicit true', flagsFor({serverSSHAllowed: true}), ['--allow-server-ssh=true']);
check('flagsFor string with spaces stays one argv element',
    flagsFor({interfaceName: 'wt 1'}), ['--interface-name=wt 1']);

threw = false;
try {
    flagsFor({unknownKey: 1});
} catch {
    threw = true;
}
check('flagsFor unknown key throws', threw, true);

check('every setting has a flag, type and group',
    SETTINGS.every(s => s.key && s.flag.startsWith('--') && ['bool', 'string', 'uint'].includes(s.type) && s.group && s.title),
    true);
check('setting keys unique', new Set(SETTINGS.map(s => s.key)).size, SETTINGS.length);
check('21 settings', SETTINGS.length, 21);

// mDMManagedFields uses the MDM policy key names (client/mdm/policy.go),
// which differ from the protojson field names for some settings.
const mdm = parseConfig(JSON.stringify({
    serverSSHAllowed: false, managementUrl: 'x',
    mDMManagedFields: ['allowServerSSH', 'managementURL'],
}));
check('MDM names map to setting keys',
    [mdm.managed.has('serverSSHAllowed'), mdm.managed.has('managementUrl')], [true, true]);

// Writes go through `netbird up`: only safe from Idle or Connected (NeedsLogin
// would start an SSO login, Connecting would be aborted).
check('writable when Idle/Connected', [settingsWritable('Idle'), settingsWritable('Connected')], [true, true]);
check('not writable otherwise',
    ['NeedsLogin', 'SessionExpired', 'LoginFailed', 'Connecting', 'Unavailable', null].map(settingsWritable),
    [false, false, false, false, false, false]);

if (failures) {
    print(`\n${failures} failure(s)`);
    System.exit(1);
}
