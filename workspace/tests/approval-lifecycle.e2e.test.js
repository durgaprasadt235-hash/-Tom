// ======================================================================
// TOM APPROVAL LIFECYCLE — TRUE BLACK-BOX E2E (start→status→logs→
// restart→status→stop, plus the approval-wording variants that used to
// escape to the model)
//
// Real server.js child process, real HTTP /chat, real approval IDs, a
// counting model stub, and a REAL DROP dev-server spawn on a free fixture
// port (TOM_RUNTIME_WEB_PORT) — no mocks of gateway/controller/supervisor.
//
// Proves, from clean processes:
//   1. The exact sequence start→approve→status→logs→restart→status→stop
//      reaches RUNNING with dispatched evidence (tool/PID/port), never a
//      bare {"decision":"approve"} fabrication (that key appears nowhere
//      in TOM and is asserted absent on EVERY response).
//   2. Realistic approval wordings ("I approve execution <id>", "Approved.
//      Execute it.", "go ahead", bare "approve") dispatch the real action
//      with ZERO model calls instead of falling through to the model.
//   3. Nothing listens on the managed port before the approval is
//      dispatched (the live defect's no-dispatch proof).
// Acceptance per mandate: the full `node --test workspace/tests/` suite
// green TWICE consecutively from clean processes.
// ======================================================================
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const WORKSPACE = path.join(__dirname, '..');
const DROP_ROOT = '/Users/tdurg/Projects/Drop';
const WEB_ROOT = path.join(DROP_ROOT, 'web');
const LSOF = ['/usr/sbin/lsof', '/usr/bin/lsof'].find((file) => fs.existsSync(file)) || '/usr/sbin/lsof';
const attachmentDir = path.join(os.tmpdir(), 'tom-lifecycle-attachments-' + process.pid);

let child = null;
let childOutput = '';
let stub = null;
let stubCalls = [];
let baseUrl = '';
let devPort = null;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// NVIDIA-compatible chat completions stub: counts every request so the test
// can prove approval traffic NEVER reaches the model.
function startStub() {
  return new Promise((resolve) => {
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        stubCalls.push(raw);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'stub-' + stubCalls.length,
          choices: [{ message: { role: 'assistant', content: 'STUB-REPLY-' + stubCalls.length } }]
        }));
      });
    });
    stub.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${stub.address().port}/v1/chat/completions`));
  });
}
async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      // /health is optional-bridge-sensitive; the served page proves Express
      // itself is ready without requiring a VS Code connection.
      const response = await fetch(baseUrl + '/');
      if (response.ok) return;
      lastError = new Error('index HTTP ' + response.status);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server never became ready: ' + (lastError && lastError.message) + '\nchild output:\n' + childOutput);
}

async function post(pathname, body) {
  const response = await fetch(baseUrl + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return { status: response.status, body: await response.json() };
}

function chat(taskId, message) {
  return post('/chat', { taskId, message });
}

function assertNoFabricatedDecision(response) {
  assert.ok(!/"decision"\s*:\s*"(?:approve|reject)"/i.test(JSON.stringify(response.body)),
    'TOM response never contains a fabricated model decision');
}

function assertGatewaySuccess(response) {
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.provider, 'tom-action-gateway', JSON.stringify(response.body));
  assertNoFabricatedDecision(response);
  assert.equal(response.body.toolEvidence.length, 1, JSON.stringify(response.body));
  assert.equal(response.body.toolEvidence[0].success, true, JSON.stringify(response.body.toolEvidence[0]));
  return response.body.toolEvidence[0].data;
}

async function listenerCount(port) {
  return new Promise((resolve, reject) => {
    execFile(LSOF, ['-nP', '-iTCP:' + port, '-sTCP:LISTEN'], (error, stdout) => {
      if (error && error.code === 1) return resolve(0);
      if (error) return reject(error);
      resolve(stdout.split('\n').filter((line) => line.trim()).length);
    });
  });
}

before(async () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(WEB_ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts && packageJson.scripts.dev, 'vinext dev',
    'fixture must expose the expected real dev command');
  devPort = await freePort();
  assert.equal(await listenerCount(devPort), 0, 'managed fixture port starts free');

  const stubUrl = await startStub();
  const port = await freePort();
  child = spawn(process.execPath, ['server.js'], {
    cwd: WORKSPACE,
    env: { ...process.env, PORT: String(port), TOM_MODEL_BASE_URL: stubUrl,
      TOM_RUNTIME_WEB_PORT: String(devPort), NVIDIA_API_KEY: 'black-box-test-key',
      TOM_ATTACHMENT_DIR: attachmentDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => { childOutput += chunk; });
  child.stderr.on('data', (chunk) => { childOutput += chunk; });
  child.on('exit', (code, signal) => { childOutput += '\n[child exit code=' + code + ' signal=' + signal + ']'; });
  baseUrl = 'http://127.0.0.1:' + port;
  await waitForHealth();
});

after(async () => {
  if (child) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM'); // server.js terminates its supervised process groups
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8000))]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  if (stub) await new Promise((resolve) => stub.close(resolve));
  fs.rmSync(attachmentDir, { recursive: true, force: true });
  assert.equal(await listenerCount(devPort), 0, 'no managed listener survives TOM');
});

test('real managed service completes start, status, logs, restart, and stop lifecycle', async () => {
  const created = await post('/task', { label: 'black-box approval lifecycle' });
  assert.equal(created.status, 200);
  const taskId = created.body.task.taskId;
  const modelBaseline = stubCalls.length;

  const start = await chat(taskId, 'Start the DROP development server.');
  assertGatewaySuccess(start);
  assert.equal(start.body.toolsUsed[0], 'runtime.start');
  assert.equal(start.body.toolEvidence[0].data.status, 'pending_approval');
  assert.match(start.body.approvalId, /^[0-9a-f-]{36}$/);
  assert.equal(start.body.task.state, 'WAITING_FOR_APPROVAL');
  assert.equal(await listenerCount(devPort), 0, 'proposal must not dispatch or listen');

  const started = await chat(taskId, 'approve execution ' + start.body.approvalId);
  const startedData = assertGatewaySuccess(started);
  assert.equal(started.body.toolsUsed[0], 'execution.approve');
  assert.equal(startedData.state, 'RUNNING');
  assert.equal(startedData.port, devPort);
  assert.equal(startedData.liveness, 'alive');
  assert.equal(startedData.health.healthy, true);
  assert.ok(startedData.pid > 0);
  assert.ok((await listenerCount(devPort)) > 0, 'approved TOM process owns a listener');

  const status = assertGatewaySuccess(await chat(taskId, 'Status of the DROP development server.'));
  assert.equal(status.kind, 'service');
  assert.equal(status.state, 'RUNNING');
  assert.equal(status.pid, startedData.pid);
  assert.ok(!('command' in status) && !('stdout' in status) && !('stderr' in status),
    'status is current service state, not stale execution output');
  assert.match(status.url, new RegExp(':' + devPort + '$'));

  const logs = assertGatewaySuccess(await chat(taskId, 'Show the DROP development server logs.'));
  assert.equal(logs.kind, 'logs');
  assert.equal(logs.executionId, startedData.executionId);
  assert.ok(typeof logs.stdout === 'string' && typeof logs.stderr === 'string');

  const restart = await chat(taskId, 'Restart the DROP development server.');
  assertGatewaySuccess(restart);
  assert.equal(restart.body.toolsUsed[0], 'runtime.restart');
  assert.equal(restart.body.task.state, 'WAITING_FOR_APPROVAL');
  const restartedData = assertGatewaySuccess(await chat(taskId, 'approve execution ' + restart.body.approvalId));
  assert.equal(restartedData.state, 'RUNNING');
  assert.notEqual(restartedData.executionId, startedData.executionId);
  assert.equal(restartedData.action.previousExecutionId, startedData.executionId);
  assert.equal((await listenerCount(devPort)) > 0, true);

  const stop = await chat(taskId, 'Stop the DROP development server.');
  assertGatewaySuccess(stop);
  assert.equal(stop.body.toolsUsed[0], 'runtime.stop');
  const stoppedData = assertGatewaySuccess(await chat(taskId, 'approve execution ' + stop.body.approvalId));
  assert.equal(stoppedData.state, 'STOPPED');
  assert.equal(stoppedData.pid, null);
  assert.equal(stoppedData.exitCode, 0);
  assert.equal(stoppedData.reason, 'stopped');
  assert.equal(await listenerCount(devPort), 0);
  assert.equal(stubCalls.length, modelBaseline, 'entire lifecycle remains deterministic and never calls the model');
});

test('realistic runtime approval wording dispatches without the model', async () => {
  const variants = [
    (id) => 'I approve execution ' + id,
    () => 'Approved. Execute it.',
    () => 'go ahead',
    () => 'approve'
  ];

  for (const wording of variants) {
    const created = await post('/task', { label: 'approval wording: ' + wording('00000000-0000-0000-0000-000000000000') });
    const taskId = created.body.task.taskId;
    const modelBaseline = stubCalls.length;
    const proposed = await chat(taskId, 'Start the DROP development server.');
    assertGatewaySuccess(proposed);
    assert.equal(proposed.body.approvalId, proposed.body.toolEvidence[0].data.approvalId);
    assert.equal(await listenerCount(devPort), 0);

    const approved = await chat(taskId, wording(proposed.body.approvalId));
    const data = assertGatewaySuccess(approved);
    assert.equal(approved.body.toolsUsed[0], 'execution.approve', wording(proposed.body.approvalId));
    assert.equal(data.action.tool, 'runtime.start');
    assert.equal(data.state, 'RUNNING');
    assert.equal(stubCalls.length, modelBaseline, wording(proposed.body.approvalId) + ' must not reach model');

    const stop = await chat(taskId, 'Stop the DROP development server.');
    const stopped = assertGatewaySuccess(await chat(taskId, 'approve execution ' + stop.body.approvalId));
    assert.equal(stopped.state, 'STOPPED');
    assert.equal(await listenerCount(devPort), 0);
  }
});
