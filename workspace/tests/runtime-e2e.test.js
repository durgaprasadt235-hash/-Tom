const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { fixture, approved } = require('./helpers/runtime-fixture');
const { classify } = require('../tools/runtime-intent');

test('Phase 1 acceptance: request, policy, approval, PID, readiness, health, logs, restart, stop', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const request = classify('start the development server'); assert.equal(request.tool, 'runtime.start');
  const proposal = await f.gateway.executeTool(request.tool, request.args);
  assert.equal(proposal.data.riskLevel, 'consequential'); assert.equal(proposal.data.status, 'pending_approval');
  assert.equal((await f.gateway.executeTool('runtime.status', { serviceId: 'web' })).success, false);
  const started = await f.gateway.executeTool('execution.approve', { approvalId: proposal.data.approvalId });
  assert.equal(started.success, true); assert.equal(started.data.state, 'RUNNING', JSON.stringify(started));
  assert.ok(started.data.pid); assert.equal(started.data.port, f.port); assert.equal(started.data.health.healthy, true);
  const logs = await f.gateway.executeTool('runtime.logs', { serviceId: 'web' });
  assert.match(logs.data.stdout, /ready runtime/); assert.match(logs.data.stderr, /runtime diagnostic/);
  assert.equal((await f.gateway.executeTool('runtime.port', { serviceId: 'web' })).data.occupied, true);
  assert.equal((await f.gateway.executeTool('runtime.health', { serviceId: 'web' })).data.health.healthy, true);
  assert.equal((await approved(f.gateway, 'runtime.start', { serviceId: 'web' })).success, false);
  const replacement = await approved(f.gateway, 'runtime.restart', { serviceId: 'web' });
  assert.equal(replacement.data.state, 'RUNNING'); assert.notEqual(replacement.data.pid, started.data.pid);
  const stopped = await approved(f.gateway, 'runtime.stop', { serviceId: 'web' });
  assert.equal(stopped.data.state, 'STOPPED'); assert.equal(stopped.data.health.healthy, false);
  assert.equal((await approved(f.gateway, 'runtime.stop', { serviceId: 'web' })).data.state, 'STOPPED');
  assert.equal((await f.gateway.executeTool('runtime.port', { serviceId: 'web' })).data.occupied, false);
});
test('occupied unrelated port is not ready, remains untouched, then recovery succeeds', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const other = net.createServer(); t.after(() => new Promise(resolve => other.close(resolve)));
  await new Promise(resolve => other.listen(f.port, '127.0.0.1', resolve));
  const conflict = await approved(f.gateway, 'runtime.start', { serviceId: 'web' });
  assert.equal(conflict.data.state, 'FAILED'); assert.equal(conflict.data.error, 'port_conflict'); assert.equal(other.listening, true);
  await new Promise(resolve => other.close(resolve));
  assert.equal((await approved(f.gateway, 'runtime.restart', { serviceId: 'web' })).data.state, 'RUNNING');
});
test('early crash and readiness timeout clean up and allow restart', async t => {
  const f = await fixture({ startupMs: 400 }); t.after(() => f.cleanup());
  f.write('crash', '1');
  const crashed = await approved(f.gateway, 'runtime.start', { serviceId: 'web' });
  assert.equal(crashed.data.state, 'FAILED'); assert.equal(crashed.data.error, 'startup_failure');
  fs.unlinkSync(path.join(f.root, 'web/crash')); f.write('slow', '1');
  const slow = await approved(f.gateway, 'runtime.restart', { serviceId: 'web' });
  assert.equal(slow.data.state, 'FAILED'); assert.equal(slow.data.error, 'readiness_timeout');
  fs.unlinkSync(path.join(f.root, 'web/slow'));
  assert.equal((await approved(f.gateway, 'runtime.restart', { serviceId: 'web' })).data.state, 'RUNNING');
});
test('health failure and runtime crash are observed without stale ownership', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const started = await approved(f.gateway, 'runtime.start', { serviceId: 'web' });
  assert.equal(started.data.state, 'RUNNING'); f.write('unhealthy', '1');
  const unhealthy = await f.gateway.executeTool('runtime.health', { serviceId: 'web' });
  assert.equal(unhealthy.data.health.healthy, false); assert.equal(unhealthy.data.health.statusCode, 503);
  // This PID came from our fixture's own supervisor, never from the user's environment.
  process.kill(started.data.pid, 'SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await f.gateway.executeTool('runtime.status', { serviceId: 'web' })).data.state, 'FAILED');
  assert.equal((await f.gateway.executeTool('runtime.stop', { serviceId: 'unknown' })).success, false);
});
