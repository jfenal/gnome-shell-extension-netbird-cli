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

// applySettings: `up` with flags; `down` afterwards only if it was not connected
{
    const cli = createRecordingCli();
    await cli.applySettings({disableDns: true}, false, stubCancellable);
    check('applySettings while disconnected argv',
        cli._calls, [['up', '--disable-dns=true'], ['down']]);
}
{
    const cli = createRecordingCli();
    await cli.applySettings({mtu: 1380}, true, stubCancellable);
    check('applySettings while connected argv', cli._calls, [['up', '--mtu=1380']]);
}
{
    const cli = createRecordingCli();
    cli.run = async args => {
        cli._calls.push(args);
        return {ok: false, stdout: '', stderr: 'the daemon refused the settings update: privileged'};
    };
    const result = await cli.applySettings({enableSSHRoot: true}, false, stubCancellable);
    check('applySettings failure skips down and returns the up result',
        [cli._calls, result.ok], [[['up', '--enable-ssh-root=true']], false]);
}

// config: `debug config` parsed; failure → null values with error text
{
    const cli = createRecordingCli();
    cli.run = async args => {
        cli._calls.push(args);
        return {ok: true, stdout: '{"disableDns": true, "mDMManagedFields": ["mtu"]}', stderr: ''};
    };
    const config = await cli.config(stubCancellable);
    check('config argv', cli._calls[0], ['debug', 'config']);
    check('config parsed', [config.values.disableDns, config.managed.has('mtu'), config.error], [true, true, null]);
}
{
    const cli = createRecordingCli();
    cli.run = async () => ({ok: false, stdout: '', stderr: 'failed to connect to daemon'});
    const config = await cli.config(stubCancellable);
    check('config failure', [config.values, config.error], [null, 'failed to connect to daemon']);
}

if (failures)
    System.exit(1);
