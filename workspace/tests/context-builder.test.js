const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const agent = require('../agent');
const vscodeBridge = require('../plugins/vscode/vscode-bridge');
const { buildProjectContext } = require('../tools/context-builder');

const PROJECT_ID = 'drop';
const CLIENT_INSTANCE_ID = 'tom-test-client-context-builder';

function connectBridge() {
  const challenge = vscodeBridge.beginHandshake(PROJECT_ID);
  return vscodeBridge.acceptHandshake(PROJECT_ID, {
    nonce: challenge.nonce,
    clientInstanceId: CLIENT_INSTANCE_ID,
    vscodeVersion: '1.0.0-test',
    workspaceFolders: [agent.DROP_ROOT],
    activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
    diagnostics: []
  });
}

let connection;

before(() => {
  connection = connectBridge();
});

after(() => {
  try {
    vscodeBridge.disconnect(PROJECT_ID, connection.sessionId, CLIENT_INSTANCE_ID);
  } catch {
    // best-effort cleanup
  }
});

test('requested file is included with content', async () => {
  const context = await buildProjectContext(['web/app/page.tsx']);
  assert.equal(context.version, 'tom-context-v1');
  assert.equal(context.files.length, 1);
  assert.equal(context.files[0].path, 'web/app/page.tsx');
  assert.equal(context.files[0].available, true);
  assert.match(context.files[0].content, /use client/);
});

test('a blocked file cannot be included in the context', async () => {
  const context = await buildProjectContext(['.env.local', 'web-git-backup/HEAD', '../../../etc/passwd']);
  assert.equal(context.files.length, 3);
  for (const file of context.files) {
    assert.equal(file.available, false);
    assert.match(file.error, /blocked/i);
    assert.equal(file.content, undefined);
  }
});

test('a failed tool section does not crash the whole context build', async () => {
  // Disconnect the bridge so vscode.* tools become unavailable, while
  // git.* tools (which do not require a bridge session) still work.
  vscodeBridge.disconnect(PROJECT_ID, connection.sessionId, CLIENT_INSTANCE_ID);
  try {
    const context = await buildProjectContext(['web/app/page.tsx']);
    assert.equal(context.version, 'tom-context-v1');
    assert.equal(context.tree.available, false);
    assert.ok(context.tree.error);
    assert.equal(context.diagnostics.available, false);
    assert.equal(context.files[0].available, false);
    assert.equal(context.gitStatus.available, true);
  } finally {
    connection = connectBridge();
  }
});

test('output stays bounded for large trees, diagnostics, and file/diff content', async () => {
  const bigFileList = Array.from({ length: 50 }, (_, i) => `web/does-not-exist-${i}.tsx`);
  const context = await buildProjectContext(bigFileList);
  assert.ok(context.files.length <= 10, 'file list must be capped');
  assert.ok(context.tree.entries.length <= 500, 'tree entries must be capped');
  assert.ok(context.diagnostics.entries.length <= 200, 'diagnostics must be capped');
  if (context.gitDiff.available) {
    assert.ok(context.gitDiff.content.length <= 4000 + '\n... (truncated)'.length);
  }
});
