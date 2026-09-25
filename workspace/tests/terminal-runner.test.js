const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../tools/command-policy');
const { fixture, approved } = require('./helpers/runtime-fixture');
const { classify } = require('../tools/runtime-intent');

async function using(t, options = {}) { const f = await fixture(options); t.after(() => f.cleanup()); return f; }
test('only exact discovered commands execute; stdout/stderr and exit evidence are separate', async t => {
  const f = await using(t);
  for (const command of ['npm test', 'npm run build', 'npm run lint']) {
    const result = await approved(f.gateway, 'terminal.run', { command, cwd: 'web' });
    assert.equal(result.success, true); assert.equal(result.data.reason, 'success'); assert.equal(result.data.exitCode, 0);
    assert.match(result.data.stdout, /stdout evidence/); assert.match(result.data.stderr, /stderr evidence/);
    assert.ok(result.data.pid); assert.ok(result.data.startedAt); assert.ok(result.data.completedAt);
  }
});
test('default deny rejects executable, operators, malformed args and legacy bypass', async t => {
  const f = await using(t);
  for (const command of ['node x.js', 'rm -rf .', 'npm test; echo x', 'npm test && echo x', 'npm test | cat', 'npm test > x', 'npm test $(id)', 'npm test `id`', 'npm test -- --flag', 'npm run dev', null, 1]) {
    const result = await f.gateway.executeTool('terminal.run', { command, cwd: 'web' }); assert.equal(result.success, false, String(command));
  }
  for (const args of [[], null, { command: 'npm test', shell: true }, { command: 'npm test', cwd: false }, { command: 'npm test', cwd: '' }]) {
    assert.equal((await f.gateway.executeTool('terminal.run', args)).success, false);
  }
  assert.throws(() => require('../agent').executeControlledCommand('node x.js'), /Direct execution disabled/);
  assert.throws(() => require('../tools/terminal-runner').run('npm test'), /Direct execution disabled/);
});
test('canonical cwd, traversal, absolute, symlink and nonexistent boundaries', async t => {
  const f = await using(t);
  assert.equal(policy.resolveCwd(f.root, 'web'), fs.realpathSync(path.join(f.root, 'web')));
  fs.symlinkSync(path.dirname(f.root), path.join(f.root, 'outside'));
  for (const cwd of ['../', '/tmp', 'outside', 'absent', 'web/../web', 'web/package.json']) {
    assert.equal((await f.gateway.executeTool('terminal.run', { command: 'npm test', cwd })).success, false, cwd);
  }
  fs.mkdirSync(path.join(f.root, 'nested')); fs.mkdirSync(path.join(f.root, 'nested/valid'));
  assert.ok(policy.resolveCwd(f.root, 'nested/valid').endsWith('nested/valid'));
});
test('missing package scripts fail before approval; package changes invalidate approval', async t => {
  const f = await using(t);
  const proposal = await f.gateway.executeTool('terminal.run', { command: 'npm test', cwd: 'web' });
  f.write('package.json', JSON.stringify({ scripts: { build: 'node task.cjs' } }));
  assert.equal((await f.gateway.executeTool('terminal.run', { command: 'npm test', cwd: 'web' })).success, false);
  assert.equal((await f.gateway.executeTool('execution.approve', { approvalId: proposal.data.approvalId })).success, false);
  const discovery = await f.gateway.executeTool('terminal.discover', { cwd: 'web' });
  assert.deepEqual(Object.keys(discovery.data.scripts), ['build']);
});
test('discovery and negated requests never select execution; positive requests do', () => {
  for (const message of ['what tests exist?', 'inspect package.json', 'find the test command', 'do not run tests', 'do not run npm test', 'inspect commands; do not run npm run build', 'show npm run lint']) {
    assert.equal(classify(message)?.tool, 'terminal.discover', message);
  }
  for (const message of ['run the tests', 'execute the test suite', 'run npm test', 'run npm run build', 'run lint']) assert.equal(classify(message)?.tool, 'terminal.run', message);
  assert.equal(classify('npm test'), null);
});
test('live regression: discovery/negation wording never executes or requests npm test approval', async t => {
  const { classify } = require('../tools/runtime-intent');
  const { planVerification } = require('../tools/chat-tool-planner');

  // Exact live acceptance wording: discovery request with an explicit
  // "do not guess npm test" guard.
  const discovery = 'First discover the existing test commands. Do not guess npm test.';
  assert.deepEqual(classify(discovery), { tool: 'terminal.discover', args: { cwd: 'web' } });
  assert.equal(planVerification(discovery), null);

  // Negation-only and inspection-only variants: discover, never execute.
  for (const message of ['Do not run npm test.', 'What tests exist?']) {
    assert.deepEqual(classify(message), { tool: 'terminal.discover', args: { cwd: 'web' } }, message);
    assert.equal(planVerification(message), null, message);
  }

  // "Run npm test." is a genuine execution request, but Drop's package.json
  // defines no test script, so verification planning must refuse it before
  // any approval is proposed.
  const { classify: liveClassify } = require('../tools/runtime-intent');
  assert.deepEqual(liveClassify('Run npm test.'), { tool: 'terminal.run', args: { command: 'npm test', cwd: 'web' } });
  assert.equal(planVerification('Run npm test.'), null);

  // End-to-end on the live request path: classify -> planVerification ->
  // gateway. Only terminal.discover may be invoked for the discovery and
  // negation messages; terminal.run must never be invoked for them.
  const calls = [];
  async function fakeExecute(tool, args) {
    calls.push({ tool, args });
    if (tool === 'terminal.discover') return { success: true, tool, data: { scripts: {} } };
    throw new Error('must not execute ' + tool);
  }
  for (const message of [discovery, 'Do not run npm test.', 'What tests exist?']) {
    calls.length = 0;
    const request = classify(message);
    assert.equal(request.tool, 'terminal.discover', message);
    const verification = planVerification(message);
    assert.equal(verification, null, message);
    await fakeExecute(request.tool, request.args);
    assert.deepEqual(calls.map((call) => call.tool), ['terminal.discover'], message);
  }
});
test('approval is required, reject/replay/changed action arguments fail closed', async t => {
  const f = await using(t);
  const request = { command: 'npm test', cwd: 'web' };
  const pending = await f.gateway.executeTool('terminal.run', request);
  assert.equal(pending.data.riskLevel, 'consequential'); assert.equal(pending.data.status, 'pending_approval');
  assert.deepEqual((await f.gateway.executeTool('terminal.status')).data, []);
  for (const extra of [{ command: 'npm run build' }, { cwd: '.' }, { projectId: 'other' }]) {
    assert.equal((await f.gateway.executeTool('execution.approve', { approvalId: pending.data.approvalId, ...extra })).success, false);
  }
  assert.equal((await f.gateway.executeTool('execution.reject', { approvalId: pending.data.approvalId })).data.status, 'rejected');
  assert.equal((await f.gateway.executeTool('execution.approve', { approvalId: pending.data.approvalId })).success, false);
  const next = await f.gateway.executeTool('terminal.run', request);
  assert.equal((await f.gateway.executeTool('execution.approve', { approvalId: next.data.approvalId })).data.exitCode, 0);
  assert.equal((await f.gateway.executeTool('execution.approve', { approvalId: next.data.approvalId })).success, false);
});
test('approval expires without executing', async t => {
  const f = await using(t, { approvalMs: 10 });
  const result = await f.gateway.executeTool('terminal.run', { command: 'npm test' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match((await f.gateway.executeTool('execution.approve', { approvalId: result.data.approvalId })).error, /expired/);
});
test('live routing: execution approve/reject wording reaches the execution path, never the edit path', async t => {
  const runtimeIntent = require('../tools/runtime-intent');
  const { planEditApproval } = require('../tools/chat-tool-planner');
  const editApprovalStore = require('../tools/edit-approval-store');

  // The exact live rejection must classify as execution.reject. The edit
  // parser (which predates execution approvals and only knows approve/apply
  // verbs) must not produce an edit approval for bare "reject execution".
  const liveReject = 'reject execution f72520c3-d178-4ff9-89f1-4e3082bb1006';
  assert.deepEqual(runtimeIntent.classify(liveReject),
    { tool: 'execution.reject', args: { approvalId: 'f72520c3-d178-4ff9-89f1-4e3082bb1006' } });
  assert.equal(planEditApproval(liveReject, 'f72520c3-d178-4ff9-89f1-4e3082bb1006'), null);

  // Mirror-image approve wording: the execution path owns it. (The legacy
  // edit parser can also match "approve <uuid>" text; the server guard
  // below guarantees the edit branch never runs for execution wording.)
  const liveApprove = 'approve execution f72520c3-d178-4ff9-89f1-4e3082bb1006';
  assert.deepEqual(runtimeIntent.classify(liveApprove),
    { tool: 'execution.approve', args: { approvalId: 'f72520c3-d178-4ff9-89f1-4e3082bb1006' } });

  // Server routing guard: execution wording must never enter the edit
  // approval branch, even though planEditApproval matches "approve <uuid>".
  const EXECUTION_WORDING = /\b(approve|reject)\s+execution\b/i;
  assert.equal(EXECUTION_WORDING.test(liveReject), true);
  assert.equal(EXECUTION_WORDING.test(liveApprove), true);
  assert.equal(EXECUTION_WORDING.test('approve edit f72520c3-d178-4ff9-89f1-4e3082bb1006'), false);

  // Full gateway round-trip through the same classify->executeTool path the
  // /chat handler uses (server.js lines 179-190). Runs against the fixture
  // Drop project, whose package.json defines test/build/lint/dev.
  const f = await using(t);
  async function routeChat(message) {
    const request = runtimeIntent.classify(message);
    assert.ok(request, 'expected a routed request for ' + message);
    const evidence = await f.gateway.executeTool(request.tool, request.args);
    return { request, evidence, reply: runtimeIntent.render(evidence) };
  }

  // 1. Reject a valid execution approval: rejected, never executed, and the
  // reply must not contain the edit-path marker "Edit not applied".
  const pendingReject = await f.gateway.executeTool('terminal.run', { command: 'npm test', cwd: 'web' });
  assert.equal(pendingReject.data.status, 'pending_approval');
  const rejected = await routeChat(`reject execution ${pendingReject.data.approvalId}`);
  assert.equal(rejected.evidence.success, true);
  assert.equal(rejected.evidence.data.status, 'rejected');
  assert.ok(!rejected.reply.includes('Edit not applied'), 'rejection must not enter the edit path');
  assert.match(rejected.reply, /rejected/i);
  assert.deepEqual((await f.gateway.executeTool('terminal.status')).data, []);

  // 2. Approve a valid execution approval: executes exactly once.
  const pendingApprove = await f.gateway.executeTool('terminal.run', { command: 'npm test', cwd: 'web' });
  const approvedOnce = await routeChat(`approve execution ${pendingApprove.data.approvalId}`);
  assert.equal(approvedOnce.evidence.success, true);
  assert.equal(approvedOnce.evidence.data.exitCode, 0);

  // 3. Replay the rejected approval: fail closed.
  const replayRejected = await f.gateway.executeTool('execution.approve', { approvalId: pendingReject.data.approvalId });
  assert.equal(replayRejected.success, false);

  // 4. Replay the approved approval: fail closed (single-use).
  const replayApproved = await f.gateway.executeTool('execution.approve', { approvalId: pendingApprove.data.approvalId });
  assert.equal(replayApproved.success, false);

  // 5. Edit approval/rejection behavior unchanged: unknown edit approval
  // still resolves through the edit store path, not the execution gateway.
  assert.equal(editApprovalStore.getApproval('f72520c3-d178-4ff9-89f1-4e3082bb1006'), null);
  assert.deepEqual(planEditApproval(
    'approve edit f72520c3-d178-4ff9-89f1-4e3082bb1006',
    'f72520c3-d178-4ff9-89f1-4e3082bb1006'),
    { approvalId: 'f72520c3-d178-4ff9-89f1-4e3082bb1006' });

  // 6. Invalid execution approval ID through the execution path: an
  // execution-specific failure, never the edit-path reply.
  const bogus = await routeChat('reject execution 00000000-0000-4000-8000-000000000000');
  assert.equal(bogus.evidence.success, false);
  assert.match(bogus.evidence.error, /Unknown or consumed approval/);
  assert.match(bogus.reply, /Execution request not performed/);
  assert.ok(!bogus.reply.includes('Edit not applied'), 'invalid execution ID must not enter the edit path');
});
test('real nonzero exit and spawn failure retain distinct evidence', async t => {
  const f = await using(t); f.write('task.cjs', 'process.exit(7)');
  const failed = await approved(f.gateway, 'terminal.run', { command: 'npm test' });
  assert.equal(failed.data.exitCode, 7); assert.equal(failed.data.reason, 'nonzero_exit');
  const broken = await using(t, { executable: '/nonexistent/tom-npm' });
  const missing = await approved(broken.gateway, 'terminal.run', { command: 'npm test' });
  assert.equal(missing.data.reason, 'spawn_failure'); assert.equal(missing.data.exitCode, -2);
});
test('real timeout kills a descendant and reports timeout', async t => {
  const f = await using(t, { timeoutMs: 500 });
  f.write('task.cjs', `const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log('DESC='+c.pid); setInterval(()=>{},1000);`);
  const result = await approved(f.gateway, 'terminal.run', { command: 'npm test' });
  assert.equal(result.data.reason, 'timeout'); assert.equal(result.data.timedOut, true);
  const pid = Number(result.data.stdout.match(/DESC=(\d+)/)?.[1]); assert.ok(pid);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
});
test('real cancellation targets an owned execution only', async t => {
  const f = await using(t); f.write('task.cjs', 'setInterval(()=>{},1000)');
  const pending = await f.gateway.executeTool('terminal.run', { command: 'npm test' });
  const running = f.gateway.executeTool('execution.approve', { approvalId: pending.data.approvalId });
  const records = (await f.gateway.executeTool('terminal.status')).data; assert.equal(records.length, 1);
  const cancelled = await approved(f.gateway, 'terminal.cancel', { executionId: records[0].executionId });
  assert.equal(cancelled.data.reason, 'cancelled'); assert.equal(cancelled.data.cancelled, true);
  assert.equal((await running).data.reason, 'cancelled');
  assert.equal((await f.gateway.executeTool('terminal.cancel', { executionId: String(process.pid) })).success, false);
});
test('real stdout overflow is bounded and distinct from timeout', async t => {
  const f = await using(t, { maxBytes: 1024 }); f.write('task.cjs', "setInterval(()=>process.stdout.write('x'.repeat(2000)),5)");
  const result = await approved(f.gateway, 'terminal.run', { command: 'npm test' });
  assert.equal(result.data.reason, 'output_limit'); assert.equal(result.data.stdoutTruncated, true);
  assert.ok(Buffer.byteLength(result.data.stdout) <= 1024); assert.equal(result.data.timedOut, false);
});
