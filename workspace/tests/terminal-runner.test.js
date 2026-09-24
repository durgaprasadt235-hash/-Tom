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
