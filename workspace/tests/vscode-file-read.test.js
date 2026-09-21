const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const agent = require('../agent');
const vscodeBridge = require('../plugins/vscode/vscode-bridge');
const actionGateway = require('../tools/action-gateway');

const PROJECT_ID = 'drop';
const CLIENT_INSTANCE_ID = 'tom-test-client-0001';

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

// --------------------------------------------------
// agent.js: shared filesystem security (reused by vscode.file.read)
// --------------------------------------------------

test('readProjectFile succeeds for an authorized source file', () => {
  const content = agent.readProjectFile('web/app/page.tsx');
  assert.equal(typeof content, 'string');
  assert.ok(content.length > 0);
});

test('readProjectFile blocks .env.local', () => {
  assert.throws(() => agent.readProjectFile('.env.local'), /blocked/i);
});

test('readProjectFile blocks web-git-backup/HEAD', () => {
  assert.throws(() => agent.readProjectFile('web-git-backup/HEAD'), /blocked/i);
});

test('readProjectFile blocks ../ path traversal', () => {
  assert.throws(() => agent.readProjectFile('../../../etc/passwd'), /blocked/i);
});

test('readProjectFile enforces the 1 MB size limit', () => {
  const tmpFile = path.join(agent.DROP_ROOT, '__tom_oversized_test.txt');
  fs.writeFileSync(tmpFile, Buffer.alloc(1024 * 1024 + 10, 'a'));
  try {
    assert.throws(() => agent.readProjectFile('__tom_oversized_test.txt'), /1 MB read limit/);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

// --------------------------------------------------
// vscode-bridge.readFile: reuses agent.js security, no duplicate logic
// --------------------------------------------------

test('vscodeBridge.readFile returns file content for an authorized path', () => {
  const result = vscodeBridge.readFile(PROJECT_ID, 'web/app/page.tsx');
  assert.equal(result.path, 'web/app/page.tsx');
  assert.equal(typeof result.content, 'string');
  assert.equal(result.source, 'project_filesystem');
});

test('vscodeBridge.readFile rejects a missing/invalid path argument', () => {
  assert.throws(() => vscodeBridge.readFile(PROJECT_ID, ''), /valid project file path/i);
  assert.throws(() => vscodeBridge.readFile(PROJECT_ID, undefined), /valid project file path/i);
});

// --------------------------------------------------
// Action Gateway: vscode.file.read tool registration and arg plumbing
// --------------------------------------------------

test('vscode.file.read is registered when the bridge is connected', () => {
  const tools = actionGateway.getRegisteredTools().map((t) => t.name);
  assert.ok(tools.includes('vscode.file.read'));
});

test('executeTool("vscode.file.read", { path }) succeeds end-to-end', async () => {
  const result = await actionGateway.executeTool('vscode.file.read', { path: 'web/app/page.tsx' });
  assert.equal(result.success, true);
  assert.equal(result.data.path, 'web/app/page.tsx');
  assert.ok(result.data.content.length > 0);
});

test('executeTool("vscode.file.read") rejects reading .env.local', async () => {
  const result = await actionGateway.executeTool('vscode.file.read', { path: '.env.local' });
  assert.equal(result.success, false);
  assert.match(result.error, /blocked/i);
});

test('executeTool("vscode.file.read") rejects reading web-git-backup/HEAD', async () => {
  const result = await actionGateway.executeTool('vscode.file.read', { path: 'web-git-backup/HEAD' });
  assert.equal(result.success, false);
  assert.match(result.error, /blocked/i);
});

test('executeTool("vscode.file.read") rejects ../ traversal', async () => {
  const result = await actionGateway.executeTool('vscode.file.read', { path: '../../../etc/passwd' });
  assert.equal(result.success, false);
  assert.match(result.error, /blocked/i);
});

test('executeTool("vscode.file.read") requires a path argument', async () => {
  const result = await actionGateway.executeTool('vscode.file.read', {});
  assert.equal(result.success, false);
  assert.match(result.error, /path.*required/i);
});

// --------------------------------------------------
// Regression: existing zero-argument tools still work unchanged
// --------------------------------------------------

test('executeTool("vscode.file.active") still works with the new signature', async () => {
  const result = await actionGateway.executeTool('vscode.file.active');
  assert.equal(result.success, true);
  assert.equal(result.data.available, true);
  assert.equal(result.data.path, 'web/app/page.tsx');
});

test('executeTool("vscode.diagnostics") still works with the new signature', async () => {
  const result = await actionGateway.executeTool('vscode.diagnostics');
  assert.equal(result.success, true);
  assert.equal(result.data.available, true);
});

test('vscode.workspace.tree still excludes web-git-backup', async () => {
  const result = await actionGateway.executeTool('vscode.workspace.tree');
  assert.equal(result.success, true);
  const paths = result.data.tree.map((entry) => entry.path);
  assert.ok(!paths.some((p) => p === 'web-git-backup' || p.startsWith('web-git-backup' + path.sep)));
});

test('existing Git tools remain unaffected by the args change', async () => {
  const result = await actionGateway.executeTool('git.status');
  assert.equal(result.success, true);
});

test('unknown tool still returns a not-found error', async () => {
  const result = await actionGateway.executeTool('vscode.does.not.exist', { path: 'x' });
  assert.equal(result.success, false);
  assert.match(result.error, /not found/i);
});
