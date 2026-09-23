const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const agent = require('../agent');
const actionGateway = require('../tools/action-gateway');
const terminalRunner = require('../tools/terminal-runner');

function fakeExec(result, capture = {}) {
  return (executable, args, options, callback) => {
    Object.assign(capture, { executable, args, options });
    callback(result.error || null, result.stdout || '', result.stderr || '');
  };
}

for (const [command, args] of [
  ['npm run build', ['run', 'build']],
  ['npm test', ['test']],
  ['npm run lint', ['run', 'lint']]
]) {
  test(`${command} is allowlisted and uses execFile arguments without a shell`, async () => {
    const capture = {};
    const result = await terminalRunner.run(command, 'web', {
      execFileImpl: fakeExec({ stdout: 'ok\n' }, capture)
    });
    assert.equal(capture.executable, 'npm');
    assert.deepEqual(capture.args, args);
    assert.equal(capture.options.shell, false);
    assert.equal(capture.options.cwd, path.join(agent.DROP_ROOT, 'web'));
    assert.equal(result.exitCode, 0);
  });
}

test('arbitrary commands and dangerous programs/operators are rejected', async () => {
  for (const command of [
    'node script.js',
    'rm -rf .',
    'curl https://example.com',
    'git status',
    'sudo npm test',
    'npm test | cat',
    'npm test > output.txt',
    'npm test && rm -rf .',
    'npm test; rm -rf .',
    'npm test $(whoami)'
  ]) {
    assert.throws(() => terminalRunner.run(command, 'web', { execFileImpl: fakeExec({}) }), /not allowlisted/i);
  }
});

test('cwd escape and absolute cwd are rejected', () => {
  assert.throws(() => terminalRunner.run('npm test', '../', { execFileImpl: fakeExec({}) }), /outside/i);
  assert.throws(() => terminalRunner.run('npm test', '/tmp', { execFileImpl: fakeExec({}) }), /project-relative/i);
});

test('timeout is reported as structured evidence', async () => {
  const error = Object.assign(new Error('timed out'), { killed: true, code: 'ETIMEDOUT' });
  const result = await terminalRunner.run('npm test', 'web', {
    timeoutMs: 5,
    execFileImpl: fakeExec({ error, stderr: 'timeout' })
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
});

test('stdout and stderr are truncated to configured limits', async () => {
  const result = await terminalRunner.run('npm test', 'web', {
    maxOutputBytes: 5,
    execFileImpl: fakeExec({ stdout: '123456789', stderr: 'abcdefghi' })
  });
  assert.match(result.stdout, /^12345\n\.\.\. \(truncated\)$/);
  assert.match(result.stderr, /^abcde\n\.\.\. \(truncated\)$/);
});

test('zero exit is pass evidence and nonzero exit is failure evidence', async () => {
  const passed = await terminalRunner.run('npm run build', 'web', {
    execFileImpl: fakeExec({ stdout: 'built' })
  });
  const failed = await terminalRunner.run('npm run build', 'web', {
    execFileImpl: fakeExec({ error: Object.assign(new Error('failed'), { code: 2 }), stderr: 'build failed' })
  });
  assert.equal(passed.exitCode, 0);
  assert.equal(failed.exitCode, 2);
  assert.equal(failed.stderr, 'build failed');
});

test('terminal.run is registered as a read-only verification tool', () => {
  const tool = actionGateway.getRegisteredTools().find((item) => item.name === 'terminal.run');
  assert.deepEqual(tool, {
    name: 'terminal.run',
    description: 'Run one allowlisted verification command inside the authorized Drop project',
    capability: 'terminal.run',
    riskLevel: 'read'
  });
});