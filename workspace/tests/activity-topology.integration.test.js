const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const tracker = require('../plugins/runtime/activity-tracker');
const { buildTopologySnapshot } = require('../plugins/runtime/topology-model');

function sources() {
  return {
    projectRegistry: { getProject: id => id === 'drop' ? { id, name: 'Drop', root: '/private' } : null },
    pluginRegistry: { getCatalog: () => [{ id: 'vscode', name: 'VS Code' }] },
    pluginManager: { getInstalledPlugins: () => ['vscode'], getPluginStatus: () => ({ installed: true, enabled: true, status: 'installed' }) },
    vscodeBridge: { getConnection: () => ({ connected: true, status: 'connected', vscodeVersion: 'test' }) },
    actionGateway: { getRegisteredTools: () => [] },
    activityTracker: tracker
  };
}

beforeEach(() => tracker.resetForTests());

test('pending activity projects a working edge and resolution returns idle', () => {
  const operationId = tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'vscode.file.active' });
  let result = buildTopologySnapshot('drop', sources());
  assert.equal(result.nodes[1].operationalStatus, 'connected');
  assert.equal(result.nodes[1].activityState, 'working');
  assert.equal(result.edges[0].activityState, 'working');
  assert.equal(result.edges[0].activeDestination, 'plugin:vscode');

  tracker.complete(operationId);
  result = buildTopologySnapshot('drop', sources());
  assert.equal(result.nodes[1].activityState, 'idle');
  assert.equal(result.edges[0].activityState, 'idle');
  assert.equal(result.edges[0].activeDestination, null);
});

test('two pending operations keep the edge working until both resolve', () => {
  const first = tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'vscode.file.active' });
  const second = tracker.start({ projectId: 'drop', pluginId: 'vscode', capability: 'vscode.diagnostics' });
  tracker.complete(first);
  assert.equal(buildTopologySnapshot('drop', sources()).edges[0].activityState, 'working');
  tracker.complete(second);
  assert.equal(buildTopologySnapshot('drop', sources()).edges[0].activityState, 'idle');
});
