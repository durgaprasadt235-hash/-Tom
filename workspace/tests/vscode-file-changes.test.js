const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const agent = require('../agent');
const vscodeBridge = require('../plugins/vscode/vscode-bridge');
const actionGateway = require('../tools/action-gateway');

const PROJECT_ID = 'drop';
const CLIENT_INSTANCE_ID = 'tom-test-client-file-changes';

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

test('a valid saved file event is recorded and exposed via vscode.file.changes', async () => {
  vscodeBridge.heartbeat(PROJECT_ID, {
    sessionId: connection.sessionId,
    clientInstanceId: CLIENT_INSTANCE_ID,
    activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
    diagnostics: [],
    fileChangeEvent: {
      path: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
      eventType: 'saved',
      timestamp: '2026-09-18T00:00:00.000Z'
    }
  });

  const result = await actionGateway.executeTool('vscode.file.changes');
  assert.equal(result.success, true);
  assert.equal(result.data.available, true);
  assert.equal(result.data.changes[0].path, 'web/app/page.tsx');
  assert.equal(result.data.changes[0].eventType, 'saved');
  assert.equal(result.data.changes[0].timestamp, '2026-09-18T00:00:00.000Z');
});

test('a file-change event outside the authorized workspace is rejected (dropped)', async () => {
  vscodeBridge.heartbeat(PROJECT_ID, {
    sessionId: connection.sessionId,
    clientInstanceId: CLIENT_INSTANCE_ID,
    activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
    diagnostics: [],
    fileChangeEvent: {
      path: '/Users/tdurg/somewhere/else/secret.txt',
      eventType: 'saved',
      timestamp: new Date().toISOString()
    }
  });

  const result = await actionGateway.executeTool('vscode.file.changes');
  assert.equal(result.success, true);
  assert.ok(!result.data.changes.some((c) => c.path.includes('somewhere/else')));
});

test('recorded events never expose an absolute filesystem path', async () => {
  vscodeBridge.heartbeat(PROJECT_ID, {
    sessionId: connection.sessionId,
    clientInstanceId: CLIENT_INSTANCE_ID,
    activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
    diagnostics: [],
    fileChangeEvent: {
      path: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
      eventType: 'saved',
      timestamp: new Date().toISOString()
    }
  });

  const result = await actionGateway.executeTool('vscode.file.changes');
  const serialized = JSON.stringify(result.data.changes);
  assert.equal(serialized.includes(agent.DROP_ROOT), false);
  assert.equal(serialized.includes('/Users/'), false);
});

test('file-change history is bounded to the most recent entries', async () => {
  for (let i = 0; i < 60; i += 1) {
    vscodeBridge.heartbeat(PROJECT_ID, {
      sessionId: connection.sessionId,
      clientInstanceId: CLIENT_INSTANCE_ID,
      activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
      diagnostics: [],
      fileChangeEvent: {
        path: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
        eventType: 'saved',
        timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString()
      }
    });
  }

  const result = await actionGateway.executeTool('vscode.file.changes');
  assert.equal(result.success, true);
  assert.ok(result.data.changes.length <= 50, 'history must be bounded to 50 entries');
});

test('existing heartbeat/reconnect still works after adding file-change tracking', async () => {
  const heartbeatResult = vscodeBridge.heartbeat(PROJECT_ID, {
    sessionId: connection.sessionId,
    clientInstanceId: CLIENT_INSTANCE_ID,
    activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
    diagnostics: []
  });
  assert.equal(heartbeatResult.connected, true);

  // Simulate a reconnect: disconnect, then a fresh handshake succeeds.
  vscodeBridge.disconnect(PROJECT_ID, connection.sessionId, CLIENT_INSTANCE_ID);
  assert.equal(vscodeBridge.getConnection(PROJECT_ID).connected, false);
  connection = connectBridge();
  assert.equal(vscodeBridge.getConnection(PROJECT_ID).connected, true);

  const activeFileResult = await actionGateway.executeTool('vscode.file.active');
  assert.equal(activeFileResult.success, true);
  assert.equal(activeFileResult.data.available, true);
});
