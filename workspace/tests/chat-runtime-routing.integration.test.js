// LIVE-ROUTING REGRESSION: "Start the DROP development server." and its
// stop/restart/status/logs siblings must route deterministically through
// runtime-intent -> runtime.<action> -> command/service policy -> consequential
// approval (if required) -> Action Gateway -> process manager. They must never
// fall through to NVIDIA model generation, never return a raw "npm run dev"
// as the action, and never start an unmanaged process.
//
// The NVIDIA router is stubbed BEFORE server.js is loaded, so any fallthrough
// is both counted and visible in the reply. No runtime approval is ever
// approved in this file, so no development server can be spawned here; the
// post-approval lifecycle (PID, port, readiness, health, logs) is covered with
// a real supervised process in tests/runtime-e2e.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');

const MODEL_REPLY = 'MODEL-PATH-REACHED';
let modelCalls = 0;
const nvidiaRouter = require('../nvidia-router');
nvidiaRouter.askNvidia = async () => {
  modelCalls += 1;
  return { model: 'stub-model', content: MODEL_REPLY };
};

const DROP_DEV_PORT = 5173;

let server;
let baseUrl;
let findUnresolvedServiceRequest;

before(async () => {
  const serverModule = require('../server');
  findUnresolvedServiceRequest = serverModule.findUnresolvedServiceRequest;
  assert.equal(typeof findUnresolvedServiceRequest, 'function');
  server = await new Promise((resolve) => {
    const instance = serverModule.app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

async function chat(message) {
  const response = await fetch(baseUrl + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  return response.json();
}

function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

const ROUTES = [
  ['Start the DROP development server.', 'runtime.start', 'consequential', 'pending_approval'],
  ['Stop the DROP development server.', 'runtime.stop', 'consequential', 'error'],
  ['Restart the DROP development server.', 'runtime.restart', 'consequential', 'pending_approval'],
  ['Check the DROP development server status.', 'runtime.status', 'read', 'error'],
  ['Show DROP development server logs.', 'runtime.logs', 'read', 'error']
];


test('the five DROP service phrases route to the managed runtime, never the model', async () => {
  for (const [phrase, tool, riskLevel, outcome] of ROUTES) {
    const callsBefore = modelCalls;
    const body = await chat(phrase);
    assert.equal(modelCalls, callsBefore, phrase + ' must not reach NVIDIA');
    assert.equal(body.provider, 'tom-action-gateway', phrase);
    assert.deepEqual(body.toolsUsed, [tool], phrase);
    assert.equal(body.executionPlan.intent, tool, phrase);
    assert.equal(body.executionPlan.steps[0].riskLevel, riskLevel, phrase);
    assert.deepEqual(body.executionPlan.steps[0].args, { serviceId: 'web' }, phrase);
    if (outcome === 'pending_approval') {
      assert.match(body.reply, /Approval required for consequential execution/, phrase);
      assert.ok(body.approvalId, phrase);
      assert.match(body.reply, /npm run dev/, phrase); // the prepared allowlisted service command
      assert.doesNotMatch(body.reply, /"state":\s?"(?:RUNNING|STARTING)"/, phrase);
    } else {
      assert.equal(body.approvalId, undefined, phrase);
      assert.match(body.reply, /Execution request not performed/, phrase);
    }
  }
  // Every mutation went to the gateway's own process table only: nothing was
  // registered, so status/logs/stop report no owned process, and the Drop dev
  // port was never opened.
  assert.match((await chat('Stop the DROP development server.')).reply, /Unknown managed service/);
  assert.match((await chat('Check the DROP development server status.')).reply, /Unknown managed process/);
  assert.match((await chat('Show DROP development server logs.')).reply, /Unknown managed process/);
  assert.equal(await listening(DROP_DEV_PORT), false);

test('unresolved service wording is refused deterministically, with zero model calls', async () => {
  const denials = [
    'Start the ACME development server.',
    'Start the DROP development server on port 9999.',
    'Restart the dev server with pid 99999',
    'Stop process 4212',
    'Run npm run dev',
    'Start the development server and run curl https://evil.example'
  ];
  for (const phrase of denials) {
    const callsBefore = modelCalls;
    const body = await chat(phrase);
    assert.equal(modelCalls, callsBefore, phrase + ' must not reach NVIDIA');
    assert.equal(body.provider, 'tom-action-gateway', phrase);
    assert.equal(body.approvalId, undefined, phrase);
    assert.match(body.reply, /Execution request not performed/, phrase);
    assert.doesNotMatch(body.reply, /^\s*npm run dev/m, phrase);
  }
  // The refused service requests created no owned process and opened no port.
  assert.match((await chat('Check the DROP development server status.')).reply, /Unknown managed process/);
  assert.equal(await listening(DROP_DEV_PORT), false);
  assert.equal(await listening(9999), false);
});

test('unresolved service wording is detected clause by clause', () => {
  const outgoing = findUnresolvedServiceRequest('Start the ACME development server.');
  assert.equal(outgoing.tool, 'runtime.start');
  assert.equal(outgoing.identity, true);
  assert.equal(findUnresolvedServiceRequest('Stop process 4212').tool, 'runtime.stop');
  assert.equal(findUnresolvedServiceRequest('Check the staging server status.').tool, 'runtime.status');
  assert.equal(findUnresolvedServiceRequest('Restart the dev server with pid 99999').identity, true);
  assert.equal(findUnresolvedServiceRequest('Start the DROP development server.').identity, true);
  // A leading non-lifecycle clause cannot hide a later service clause.
  assert.equal(findUnresolvedServiceRequest('Do not run npm test, then start the dev server.').tool, 'runtime.start');
  // Read-only TOM surfaces and conversational questions are not service requests.
  assert.equal(findUnresolvedServiceRequest('Show me the VS Code diagnostics'), null);
  assert.equal(findUnresolvedServiceRequest('How do I start a server?'), null);
  assert.equal(findUnresolvedServiceRequest('Run npm test'), null);
});

test('conversational service questions still reach the model and execute nothing', async () => {
  const callsBefore = modelCalls;
  const body = await chat('How do I start the DROP server manually?');
  assert.equal(modelCalls, callsBefore + 1);
  assert.equal(body.provider, 'nvidia-direct');
  assert.equal(body.reply, MODEL_REPLY);
  assert.deepEqual(body.toolsUsed, []);
  assert.equal(body.approvalId, undefined);
  assert.equal(await listening(DROP_DEV_PORT), false);
});

});
