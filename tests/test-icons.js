// Run with: gjs -m tests/test-icons.js
import System from 'system';
import {iconFileForState} from '../shell/icons.js';

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

// State-to-filename mapping tests
check('Connected', iconFileForState('Connected'), 'netbird-systemtray-connected-symbolic.svg');
check('Connecting', iconFileForState('Connecting'), 'netbird-systemtray-connecting-symbolic.svg');
check('Idle', iconFileForState('Idle'), 'netbird-systemtray-disconnected-symbolic.svg');
check('needs login', iconFileForState('SessionExpired'), 'netbird-systemtray-needs-login-symbolic.svg');
check('NeedsLogin', iconFileForState('NeedsLogin'), 'netbird-systemtray-needs-login-symbolic.svg');
check('LoginFailed', iconFileForState('LoginFailed'), 'netbird-systemtray-needs-login-symbolic.svg');
check('Unavailable', iconFileForState('Unavailable'), 'netbird-systemtray-error-symbolic.svg');
check('unknown', iconFileForState('Bogus'), 'netbird-systemtray-error-symbolic.svg');

if (failures)
    System.exit(1);
