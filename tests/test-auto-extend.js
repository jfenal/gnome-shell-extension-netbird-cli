// Run with: gjs -m tests/test-auto-extend.js
import System from 'system';
import {autoExtendDue, autoExtendLeadSeconds} from '../shell/autoExtend.js';

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

const due = {enabled: true, connected: true, secondsLeft: 600, leadSeconds: 1800,
    deadline: 'D1', lastAttemptDeadline: null};

check('due within lead time', autoExtendDue(due), true);
check('not when disabled', autoExtendDue({...due, enabled: false}), false);
check('not when disconnected', autoExtendDue({...due, connected: false}), false);
check('not before lead time', autoExtendDue({...due, secondsLeft: 3600}), false);
check('not once expired', autoExtendDue({...due, secondsLeft: 0}), false);
check('not without a deadline', autoExtendDue({...due, secondsLeft: null}), false);
check('one attempt per deadline', autoExtendDue({...due, lastAttemptDeadline: 'D1'}), false);
check('a renewed deadline is due again', autoExtendDue({...due, deadline: 'D2', lastAttemptDeadline: 'D1'}), true);

check('lead time follows the warning setting', autoExtendLeadSeconds(30), 1800);
check('lead time when the warning is disabled', autoExtendLeadSeconds(0), 600);

if (failures) {
    print(`\n${failures} failure(s)`);
    System.exit(1);
}
