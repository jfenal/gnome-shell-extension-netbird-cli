// Run with: gjs -m tests/test-polling.js
import System from 'system';
import {pollIntervalSeconds} from '../shell/polling.js';

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

// Base case: menu closed, no recent action
check('idle, configured=5', pollIntervalSeconds({configured: 5, menuOpen: false, secondsSinceAction: 60}), 5);
check('idle, configured=10', pollIntervalSeconds({configured: 10, menuOpen: false, secondsSinceAction: 100}), 10);

// Menu open: use fast polling
check('menu open, configured=5', pollIntervalSeconds({configured: 5, menuOpen: true, secondsSinceAction: 60}), 2);
check('menu open, configured=10', pollIntervalSeconds({configured: 10, menuOpen: true, secondsSinceAction: 60}), 2);
check('menu open, configured=1', pollIntervalSeconds({configured: 1, menuOpen: true, secondsSinceAction: 60}), 1);

// Recent action (< 30s): use fast polling
check('recent action (10s), configured=5', pollIntervalSeconds({configured: 5, menuOpen: false, secondsSinceAction: 10}), 2);
check('recent action (29s), configured=10', pollIntervalSeconds({configured: 10, menuOpen: false, secondsSinceAction: 29}), 2);
check('recent action (5s), configured=1', pollIntervalSeconds({configured: 1, menuOpen: false, secondsSinceAction: 5}), 1);

// Boundary case: exactly 30s
check('action at 30s boundary, configured=5', pollIntervalSeconds({configured: 5, menuOpen: false, secondsSinceAction: 30}), 5);

// Both conditions true: still fast polling
check('menu open + recent action', pollIntervalSeconds({configured: 5, menuOpen: true, secondsSinceAction: 10}), 2);

if (failures)
    System.exit(1);
