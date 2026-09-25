// LIVE DEFECT REGRESSION: "Status of the DROP development server."
//
// The runtime read tools used to return the supervised process record verbatim
// (command / stdout / stderr / exitCode of the PREVIOUS execution), and the
// renderer keyed off `typeof data.exitCode !== "undefined"` — which matches a
// service snapshot too, including one whose exitCode is null. The result: a
// status request re-displayed stale `npm run dev` start evidence
// ("Verification ... npm run dev") instead of current runtime state.
//
// These tests pin the fixed behaviour: status/health/port/start/stop/restart
// return CURRENT state only, logs are the only tool that returns output, and
// every render is shape-keyed so stale execution evidence can never reappear.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, approved } = require('./helpers/runtime-fixture');
const { classify, render } = require('../tools/runtime-intent');

const STALE_MARKER = 'ready runtime';

async function status(gateway) {
  return gateway.executeTool('runtime.status', { serviceId: 'web' });
}

test('runtime.status returns current state, never the previous start execution output', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const started = await approved(f.gateway, 'runtime.start', { serviceId: 'web' });
  assert.equal(started.data.state, 'RUNNING');

  const first = await status(f.gateway);
  assert.equal(first.success, true);
  assert.equal(first.data.kind, 'service');
  assert.equal(first.data.state, 'RUNNING');
  assert.equal(first.data.pid, started.data.pid);
  assert.equal(first.data.port, f.port);
  assert.equal(first.data.serviceId, 'web');
  assert.equal(first.data.projectId, 'drop');
  assert.equal(first.data.liveness, 'alive');
  assert.equal(first.data.health.healthy, true);
  assert.ok(first.data.executionId);
  assert.ok(first.data.startedAt);
  assert.ok(first.data.uptimeMs >= 0);
  // A status payload carries no execution output at all.
  for (const leaked of ['command', 'stdout', 'stderr', 'args', 'cwd']) {
    assert.equal(Object.hasOwn(first.data, leaked), false, leaked);
  }
  assert.equal(first.data.exitCode, null);

  const rendered = render(first);
  assert.match(rendered, /^Runtime state: RUNNING/);
  assert.match(rendered, /PID: \d+/);
  assert.doesNotMatch(rendered, /Verification/);
  assert.doesNotMatch(rendered, /npm run dev/);
  assert.doesNotMatch(rendered, new RegExp(STALE_MARKER));

  // Repeated status calls stay current and identical in identity terms.
  const second = await status(f.gateway);
  assert.equal(second.data.pid, first.data.pid);
  assert.equal(second.data.executionId, first.data.executionId);
  assert.equal(render(second).includes('Verification'), false);

  // Only the logs tool returns output, and it labels it as logs.
  const logs = await f.gateway.executeTool('runtime.logs', { serviceId: 'web' });
  assert.equal(logs.data.kind, 'logs');
  assert.equal(logs.data.executionId, started.data.executionId);
  assert.match(logs.data.stdout, new RegExp(STALE_MARKER));
  assert.match(render(logs), /^Runtime logs: RUNNING/);
  assert.match(render(logs), new RegExp(STALE_MARKER));

  // Health is a live readiness probe of the current process.
  const health = await f.gateway.executeTool('runtime.health', { serviceId: 'web' });
  assert.equal(health.data.kind, 'service');
  assert.equal(health.data.health.healthy, true);
  assert.equal(health.data.health.reason, 'http_status');
  assert.match(render(health), /Health: ready/);

  // Port evidence names the owned listener, not a foreign one.
  const port = await f.gateway.executeTool('runtime.port', { serviceId: 'web' });
  assert.equal(port.data.kind, 'port');
  assert.equal(port.data.occupied, true);
  assert.equal(port.data.owned, true);
  assert.equal(port.data.ownerPid, started.data.pid);
  assert.match(render(port), new RegExp('Owned by TOM managed PID: ' + started.data.pid));
});

test('status shows the new PID after restart and STOPPED after stop, with no stale evidence', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const started = await approved(f.gateway, 'runtime.start', { serviceId: 'web' });
  const restarted = await approved(f.gateway, 'runtime.restart', { serviceId: 'web' });
  assert.equal(restarted.data.state, 'RUNNING');
  assert.notEqual(restarted.data.pid, started.data.pid);

  const afterRestart = await status(f.gateway);
  assert.equal(afterRestart.data.pid, restarted.data.pid);
  assert.equal(afterRestart.data.executionId, restarted.data.executionId);
  assert.notEqual(afterRestart.data.executionId, started.data.executionId);
  assert.match(render(afterRestart), new RegExp('PID: ' + restarted.data.pid));

  const stopped = await approved(f.gateway, 'runtime.stop', { serviceId: 'web' });
  assert.equal(stopped.data.state, 'STOPPED');
  assert.equal(stopped.data.health.healthy, false);
  assert.equal(stopped.data.health.reason, 'stopped');

  const afterStop = await status(f.gateway);
  assert.equal(afterStop.success, true);
  assert.equal(afterStop.data.state, 'STOPPED');
  assert.equal(afterStop.data.pid, null);
  assert.equal(afterStop.data.liveness, 'not_running');
  assert.equal(afterStop.data.health.healthy, false);
  const rendered = render(afterStop);
  assert.match(rendered, /^Runtime state: STOPPED/);
  assert.match(rendered, /PID: none/);
  assert.doesNotMatch(rendered, /Verification/);
  assert.doesNotMatch(rendered, new RegExp(STALE_MARKER));

  const port = await f.gateway.executeTool('runtime.port', { serviceId: 'web' });
  assert.equal(port.data.occupied, false);
  assert.equal(port.data.owned, false);
  assert.match(render(port), /Listening: no/);
});

test('a crashed service reports FAILED with the failure reason, not its captured output', async t => {
  const f = await fixture({ startupMs: 400 }); t.after(() => f.cleanup());
  f.write('crash', '1');
  const crashed = await approved(f.gateway, 'runtime.start', { serviceId: 'web' });
  assert.equal(crashed.data.state, 'FAILED');
  assert.equal(crashed.data.error, 'startup_failure');

  const after = await status(f.gateway);
  assert.equal(after.data.state, 'FAILED');
  assert.equal(after.data.error, 'startup_failure');
  const rendered = render(after);
  assert.match(rendered, /^Runtime state: FAILED/);
  assert.match(rendered, /Error: startup_failure/);
  assert.doesNotMatch(rendered, /^Verification/m);

  // The classified live phrasing renders the same current-state view.
  const request = classify('Status of the DROP development server.');
  assert.equal(request.tool, 'runtime.status');
  const live = await f.gateway.executeTool(request.tool, request.args);
  assert.equal(live.data.state, 'FAILED');
  assert.match(render(live), /^Runtime state: FAILED/);
});
