const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { fixture, approved } = require('./helpers/runtime-fixture');
const { classify } = require('../tools/runtime-intent');
const { delay } = require('../tools/process-supervisor');

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
test('live DROP service phrasing resolves to the configured managed service only', async () => {
  const expected = {
    'Start the DROP development server.': 'runtime.start',
    'Stop the DROP development server.': 'runtime.stop',
    'Restart the DROP development server.': 'runtime.restart',
    'Check the DROP development server status.': 'runtime.status',
    'Show DROP development server logs.': 'runtime.logs'
  };
  for (const [phrase, tool] of Object.entries(expected)) {
    const request = classify(phrase);
    assert.ok(request, phrase);
    assert.equal(request.tool, tool, phrase);
    // Service identity is trusted configuration only, never parsed from text.
    assert.deepEqual(request.args, { serviceId: 'web' }, phrase);
  }
  // Equivalent wordings keep working, and near misses stay unresolved so the
  // server can refuse them deterministically instead of calling the model.
  for (const phrase of ['start the drop dev server', 'Show me the DROP development server logs.',
    'status of the drop development server']) {
    assert.ok(classify(phrase), phrase);
  }
  for (const phrase of ['Start the ACME development server.', 'Start the DROP development server on port 9999.',
    'Restart the dev server with pid 99999', 'Stop process 4212', 'Start the DROP development server twice.']) {
    assert.equal(classify(phrase), null, phrase);
  }
});

test('DROP service phrasing drives the whole managed lifecycle, but only after approval', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const start = classify('Start the DROP development server.');
  const proposal = await f.gateway.executeTool(start.tool, start.args);
  assert.equal(proposal.data.status, 'pending_approval');
  assert.equal(proposal.data.riskLevel, 'consequential');
  // Nothing is spawned or registered before approval.
  assert.equal((await f.gateway.executeTool('runtime.port', { serviceId: 'web' })).data.occupied, false);
  assert.equal((await f.gateway.executeTool(classify('Check the DROP development server status.').tool, { serviceId: 'web' })).success, false);
  const started = await f.gateway.executeTool('execution.approve', { approvalId: proposal.data.approvalId });
  assert.equal(started.data.state, 'RUNNING');
  assert.ok(Number.isInteger(started.data.pid));
  assert.equal(started.data.port, f.port);
  assert.equal(started.data.health.healthy, true);
  // Read-only phrases observe the owned PID, port and logs without approval.
  const status = classify('Check the DROP development server status.');
  assert.equal(status.tool, 'runtime.status');
  assert.equal((await f.gateway.executeTool(status.tool, status.args)).data.pid, started.data.pid);
  const logs = classify('Show DROP development server logs.');
  assert.equal(logs.tool, 'runtime.logs');
  assert.match((await f.gateway.executeTool(logs.tool, logs.args)).data.stdout, /ready runtime/);
  // Restart replaces the old owned PID with a new one.
  const restartRequest = classify('Restart the DROP development server.');
  const restartProposal = await f.gateway.executeTool(restartRequest.tool, restartRequest.args);
  const restarted = await f.gateway.executeTool('execution.approve', { approvalId: restartProposal.data.approvalId });
  assert.equal(restarted.data.state, 'RUNNING');
  assert.notEqual(restarted.data.pid, started.data.pid);
  // Stop only ever affects the service TOM owns.
  const stopRequest = classify('Stop the DROP development server.');
  const stopProposal = await f.gateway.executeTool(stopRequest.tool, stopRequest.args);
  const stopped = await f.gateway.executeTool('execution.approve', { approvalId: stopProposal.data.approvalId });
  assert.equal(stopped.data.state, 'STOPPED');
  assert.equal((await f.gateway.executeTool('runtime.port', { serviceId: 'web' })).data.occupied, false);
});

test('service, port and PID input cannot bypass runtime ownership controls', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  for (const tool of ['runtime.start', 'runtime.stop', 'runtime.restart', 'runtime.status',
    'runtime.logs', 'runtime.health', 'runtime.port']) {
    const result = await f.gateway.executeTool(tool, { serviceId: 'other' });
    assert.equal(result.success, false, tool);
    assert.match(result.error, /Unknown configured service/, tool);
  }
  // A missing service id is never defaulted to a running process.
  assert.equal((await f.gateway.executeTool('runtime.start', {})).success, false);
  assert.equal((await f.gateway.executeTool('runtime.stop', {})).success, false);
  // Ports, PIDs and commands are configuration, never request arguments.
  for (const args of [{ serviceId: 'web', port: 9999 }, { serviceId: 'web', pid: 1 },
    { serviceId: 'web', cwd: '../../etc' }, { serviceId: 'web', command: 'npm run dev' }]) {
    const result = await f.gateway.executeTool('runtime.start', args);
    assert.equal(result.success, false, JSON.stringify(args));
    assert.match(result.error, /Invalid or unexpected tool arguments/, JSON.stringify(args));
  }
  // No owned process exists, so stop cannot signal anything.
  assert.equal((await f.gateway.executeTool('runtime.stop', { serviceId: 'web' })).success, false);
  assert.equal((await f.gateway.executeTool('runtime.status', { serviceId: 'web', pid: 1 })).success, false);
});

test('task authority binds approvals: revision edits and Stop cancel them; owned commands stop with evidence', async t => {
  const f = await fixture({ timeoutMs: 8000 }); t.after(() => f.cleanup());
  const taskId = 'task-binding-0001';

  // (1) Proposal bound to revision 1: approving under revision 2 (an
  // instruction edit happened since) is stale — nothing executes.
  const proposal = await f.gateway.executeTool('terminal.run',
    { command: 'npm run build', cwd: 'web' }, { taskId, revision: 1 });
  assert.equal(proposal.data.status, 'pending_approval');
  const stale = await f.gateway.executeTool('execution.approve',
    { approvalId: proposal.data.approvalId }, { taskId, revision: 2 });
  assert.equal(stale.success, false);
  assert.match(stale.error, /Approval invalidated by task edit/);

  // (2) An approval bound to ANOTHER task can never execute here.
  const foreign = await f.gateway.executeTool('terminal.run',
    { command: 'npm run build', cwd: 'web' }, { taskId: 'other-task-0009', revision: 1 });
  const wrongTask = await f.gateway.executeTool('execution.approve',
    { approvalId: foreign.data.approvalId }, { taskId, revision: 1 });
  assert.equal(wrongTask.success, false);
  assert.match(wrongTask.error, /Approval invalidated by task edit/);

  // (3) Stop cancels every pending approval bound to the task, idempotently,
  // and a cancelled approval can never be revived.
  const doomed = await f.gateway.executeTool('terminal.run',
    { command: 'npm run build', cwd: 'web' }, { taskId, revision: 1 });
  const cancelled = f.gateway.cancelTaskApprovals(taskId);
  assert.deepEqual(cancelled, [doomed.data.approvalId]);
  assert.deepEqual(f.gateway.cancelTaskApprovals(taskId), [], 'idempotent second cancel');
  assert.deepEqual(f.gateway.cancelTaskApprovals('unrelated-task'), [], 'never touches other tasks');
  assert.deepEqual(f.gateway.cancelTaskApprovals(null), [], 'invalid id fails closed');
  const revived = await f.gateway.executeTool('execution.approve',
    { approvalId: doomed.data.approvalId }, { taskId, revision: 1 });
  assert.equal(revived.success, false);
  assert.match(revived.error, /Unknown or consumed approval/);

  // (4) Matching task + revision still executes (fixture build, fast).
  const live = await f.gateway.executeTool('terminal.run',
    { command: 'npm run build', cwd: 'web' }, { taskId, revision: 3 });
  const executed = await f.gateway.executeTool('execution.approve',
    { approvalId: live.data.approvalId }, { taskId, revision: 3 });
  assert.equal(executed.success, true, JSON.stringify(executed));
  assert.equal(executed.data.exitCode, 0);
  assert.ok(executed.data.executionId);

  // (5) Process cleanup with evidence: a real spawned command is stopped
  // mid-flight through the task-control plane (no extra approval needed).
  fs.writeFileSync(f.packagePath, JSON.stringify({
    scripts: { test: 'node slow.cjs', build: 'node task.cjs', lint: 'node task.cjs', dev: 'node server.cjs' }
  }));
  f.write('slow.cjs', 'setInterval(function () {}, 1000);');
  const slowProposal = await f.gateway.executeTool('terminal.run',
    { command: 'npm test', cwd: 'web' }, { taskId, revision: 4 });
  assert.equal(slowProposal.data.status, 'pending_approval');
  const running = f.gateway.executeTool('execution.approve',
    { approvalId: slowProposal.data.approvalId }, { taskId, revision: 4 });

  let executionId = null;
  for (let attempt = 0; attempt < 60 && !executionId; attempt += 1) {
    await delay(50);
    const statuses = await f.gateway.executeTool('terminal.status', {});
    const active = (statuses.data || []).find((entry) => entry.state === 'STARTING' && entry.command === 'npm test');
    if (active) executionId = active.executionId;
  }
  assert.ok(executionId, 'owned command observed while running');

  const cleanup = await f.gateway.cancelOwnedExecution(executionId);
  assert.equal(cleanup.success, true, JSON.stringify(cleanup));
  assert.equal(cleanup.tool, 'terminal.cancel');
  assert.equal(cleanup.data.cancelled, true, 'evidence records cancellation');
  assert.equal(cleanup.data.state, 'STOPPED');

  const finished = await running;
  assert.equal(finished.success, true);
  assert.equal(finished.data.cancelled, true, 'the approval request resolves as cancelled');

  // Unknown ids fail closed; cancelling an already-finished command is a
  // harmless no-op (never signals a foreign or recycled PID).
  assert.equal((await f.gateway.cancelOwnedExecution('missing-id')).success, false);
  const again = await f.gateway.cancelOwnedExecution(executionId);
  assert.equal(again.success, true, 'idempotent: finished handle, no signal re-sent');
  assert.equal(again.data.state, 'STOPPED');
});
