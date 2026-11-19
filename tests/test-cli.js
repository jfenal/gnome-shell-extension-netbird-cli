// SPDX-License-Identifier: GPL-3.0-or-later
// Run with: gjs -m tests/test-cli.js
//
// Test that NetbirdCli methods construct the correct argv arrays.

import System from 'system';
import {NetbirdCli} from '../netbird/cli.js';

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

// Stub settings object
const stubSettings = {
    get_string: () => '/mock/netbird',
};

// Mock cancellable
const stubCancellable = {};

// Create CLI instance with mocked run() that records argv
function createRecordingCli() {
    const cli = new NetbirdCli(stubSettings);
    const calls = [];
    cli.run = async (args, _c) => {
        calls.push(args);
        return {ok: true, stdout: '', stderr: ''};
    };
    cli._calls = calls;
    return cli;
}

// Test addProfile
{
    const cli = createRecordingCli();
    await cli.addProfile('test 1', stubCancellable);
    check('addProfile argv', cli._calls[0], ['profile', 'add', 'test 1']);
}

// Test renameProfile
{
    const cli = createRecordingCli();
    await cli.renameProfile('profile-id', 'new name', stubCancellable);
    check('renameProfile argv', cli._calls[0], ['profile', 'rename', 'profile-id', 'new name']);
}

// Test removeProfile
{
    const cli = createRecordingCli();
    await cli.removeProfile('profile-id', stubCancellable);
    check('removeProfile argv', cli._calls[0], ['profile', 'remove', 'profile-id']);
}

// Test logout
{
    const cli = createRecordingCli();
    await cli.logout('profile-id', stubCancellable);
    check('logout argv', cli._calls[0], ['logout', '--profile', 'profile-id']);
}

if (failures)
    System.exit(1);
