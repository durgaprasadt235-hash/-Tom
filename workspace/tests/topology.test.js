const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildTopologySnapshot, normalizeStatus } = require('../plugins/runtime/topology-model');
function sources(connected = false) {
  return { projectRegistry: { getProject: id => id === 'drop' ? { id, name: 'Drop', root: '/private' } : null },
    pluginRegistry: { getCatalog: () => [{ id: 'vscode', name: 'VS Code' }, { id: 'github', name: 'GitHub' }, { id: 'other' }] },
    pluginManager: { getInstalledPlugins: () => ['vscode', 'github'], getPluginStatus: () => ({ installed: true, enabled: true, status: 'installed' }) },
    vscodeBridge: { getConnection: () => ({ connected, sessionId: 'SECRET', vscodeVersion: '1.0' }) },
    activityTracker: { isWorking: () => false, getRecentActivity: () => [] },
    actionGateway: { getRegisteredTools: () => [] } };
}
test('installed applications do not manufacture relationships or connection health', () => {
  const result = buildTopologySnapshot('drop', sources());
  assert.equal(result.nodes.length, 3); assert.equal(result.edges.length, 0);
  assert.deepEqual(result.nodes.slice(1).map(n => n.operationalStatus), ['not_connected', 'not_connected']);
  assert.equal(result.project.name, 'Drop'); assert.equal(result.activity.length, 0);
  assert.deepEqual(result.authorization.allowedActions, []);
});
test('bridge evidence creates one relationship without exposing session secrets', () => {
  const result = buildTopologySnapshot('drop', sources(true));
  assert.equal(result.edges.length, 1); assert.equal(result.edges[0].activityState, 'idle');
  assert.equal(result.nodes[1].operationalStatus, 'connected');
  assert.ok(!JSON.stringify(result).includes('SECRET')); assert.ok(!JSON.stringify(result).includes('/private'));
});
test('invalid projects and conservative status normalization', () => {
  assert.equal(buildTopologySnapshot('missing', sources()), null);
  assert.equal(normalizeStatus('installed'), 'not_connected');
  assert.equal(normalizeStatus('configuration_required'), 'warning');
  assert.equal(normalizeStatus('working'), 'unknown');
  assert.equal(normalizeStatus('future'), 'unknown');
  assert.equal(normalizeStatus('disabled'), 'disabled');
});

test('connected VS Code reports working while an operation is active', () => {
  const input = sources(true);
  input.activityTracker = {
    isWorking: () => true,
    getRecentActivity: () => [{ operationId: 'op-1', projectId: 'drop', pluginId: 'vscode', capability: 'vscode.file.active', state: 'operation_started', startedAt: '2026-01-01T00:00:00.000Z', completedAt: null }]
  };
  const result = buildTopologySnapshot('drop', input);
  assert.equal(result.nodes[1].operationalStatus, 'connected');
  assert.equal(result.edges[0].activityState, 'working');
  assert.equal(result.edges[0].activeDestination, 'plugin:vscode');
  assert.equal(result.activity.length, 1);
});

test('failed operations clear working state without making the integration error', () => {
  const input = sources(true);
  input.activityTracker = {
    isWorking: () => false,
    getRecentActivity: () => [{ operationId: 'op-2', projectId: 'drop', pluginId: 'vscode', capability: 'vscode.diagnostics', state: 'operation_failed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z' }]
  };
  const result = buildTopologySnapshot('drop', input);
  assert.equal(result.nodes[1].operationalStatus, 'connected');
  assert.equal(result.edges[0].activityState, 'idle');
  assert.equal(result.edges[0].activeDestination, null);
  assert.equal(result.activity[0].state, 'operation_failed');
});

test('disconnected VS Code cannot expose a working edge', () => {
  const input = sources(false);
  input.activityTracker = { isWorking: () => true, getRecentActivity: () => [] };
  const result = buildTopologySnapshot('drop', input);
  assert.equal(result.nodes[1].operationalStatus, 'not_connected');
  assert.equal(result.edges.length, 0);
});
