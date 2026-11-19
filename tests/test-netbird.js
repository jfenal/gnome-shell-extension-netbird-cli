// Run with: gjs -m tests/test-netbird.js
import GLib from 'gi://GLib';
import System from 'system';
import {parseProfileList, secondsUntil, formatLocal, errorText, hostAddress} from '../netbird/parse.js';

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

if (failures)
    System.exit(1);
