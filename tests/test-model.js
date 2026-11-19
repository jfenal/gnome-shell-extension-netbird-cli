// Run with: gjs -m tests/test-model.js
import System from 'system';
import {WindowModel} from '../prefs/model.js';

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

// Fake CLI implementing NetbirdCli interface
class FakeCli {
    constructor(statusData, profilesData, shouldReject = false) {
        this._statusData = statusData;
        this._profilesData = profilesData;
        this._shouldReject = shouldReject;
    }

    async status(_cancellable) {
        if (this._shouldReject)
            throw new Error('status rejected');
        return this._statusData;
    }

    async profiles(_cancellable) {
        if (this._shouldReject)
            return null;
        return this._profilesData;
    }

    async run(args, _cancellable) {
        return {ok: true, stdout: '', stderr: ''};
    }
}

// Test: basic refresh with Connected status and 2 profiles
const cli1 = new FakeCli(
    {status: 'Connected', data: {daemonStatus: 'Connected', foo: 'bar'}, error: null},
    [{id: 'default', name: 'default', active: true}, {id: 'work', name: 'work', active: false}]
);

const model1 = new WindowModel(cli1, 999);
let callbackFired = false;
let receivedState = null;
model1.connect('changed', state => {
    callbackFired = true;
    receivedState = state;
});

await model1.refresh();
check('callback fired after refresh', callbackFired, true);
check('state.status is Connected', receivedState?.status, 'Connected');
check('state.profiles.length is 2', receivedState?.profiles.length, 2);
check('state.data passed through', receivedState?.data?.foo, 'bar');

// Test: profiles() returns null → state.profiles is []
const cli2 = new FakeCli(
    {status: 'Idle', data: {daemonStatus: 'Idle'}, error: null},
    null
);

const model2 = new WindowModel(cli2, 999);
let state2 = null;
model2.connect('changed', state => { state2 = state; });
await model2.refresh();
check('profiles null yields empty array', state2?.profiles, []);

// Test: profiles() rejects → state.profiles is []
const cli3 = new FakeCli(
    {status: 'Connected', data: {daemonStatus: 'Connected'}, error: null},
    null,
    true
);

const model3 = new WindowModel(cli3, 999);
let state3 = null;
model3.connect('changed', state => { state3 = state; });
await model3.refresh();
check('profiles reject yields empty array', state3?.profiles, []);

if (failures)
    System.exit(1);
