const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const tracker = require('../plugins/runtime/activity-tracker');

beforeEach(() => tracker.resetForTests());

test('records start and completion with safe metadata', () => {
  const operationId = tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'vscode.file.active' });
  assert.match(operationId, /^[0-9a-f-]{36}$/);
  assert.equal(tracker.getActiveOperations('drop', 'vscode').length, 1);

  const event = tracker.complete(operationId);
  assert.equal(event.state, 'operation_completed');
  assert.equal(event.projectId, 'drop');
  assert.equal(event.pluginId, 'vscode');
  assert.equal(event.capability, 'vscode.file.active');
  assert.equal(tracker.getActiveOperations('drop', 'vscode').length, 0);
});

test('records failures and clears active operations', () => {
  const operationId = tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'vscode.diagnostics' });
  const event = tracker.fail(operationId);
  assert.equal(event.state, 'operation_failed');
  assert.equal(tracker.getActiveOperations('drop', 'vscode').length, 0);
});

test('keeps concurrent operations working until the last one finishes', () => {
  const first = tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'vscode.file.active' });
  const second = tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'vscode.diagnostics' });
  assert.equal(tracker.isWorking('drop', 'vscode'), true);
  tracker.complete(first);
  assert.equal(tracker.isWorking('drop', 'vscode'), true);
  tracker.complete(second);
  assert.equal(tracker.isWorking('drop', 'vscode'), false);
});

test('bounds recent history and rejects unsafe metadata', () => {
  for (let index = 0; index < tracker.MAX_HISTORY + 10; index += 1) {
    const operationId = tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'vscode.file.active' });
    tracker.complete(operationId);
  }
  assert.equal(tracker.getRecentActivity('drop').length, tracker.MAX_HISTORY);
  assert.throws(() => tracker.start({ projectId: '/Users/secret', pluginId: 'vscode', capability: 'vscode.file.active' }), /invalid_activity_project/);
  assert.throws(() => tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'file contents' }), /invalid_activity_capability/);
  const serialized = JSON.stringify(tracker.getRecentActivity('drop'));
  assert.equal(serialized.includes('/Users/secret'), false);
  assert.equal(serialized.includes('sessionId'), false);
});
