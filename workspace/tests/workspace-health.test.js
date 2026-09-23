const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildWorkspaceHealth } = require('../plugins/runtime/workspace-health');

test('workspace health reports NVIDIA Direct configuration and VS Code connectivity', () => {
  const result = buildWorkspaceHealth('drop', {
    projectRegistry: {
      getProject: () => ({ id: 'drop', name: 'Drop', root: '/tmp/drop' })
    },
    pluginManager: {
      getPluginStatus: (projectId, pluginId) => {
        if (pluginId === 'vscode') {
          return { installed: true, enabled: true, status: 'connected' };
        }
        return { installed: false, enabled: false, status: 'available' };
      }
    },
    vscodeBridge: {
      getConnection: () => ({ connected: true, status: 'connected', project: 'Drop', source: 'vscode_extension' })
    },
    env: {
      NVIDIA_API_KEY: 'configured-key'
    }
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.project.connected, true);
  assert.equal(result.providers.vscode.connected, true);
  assert.equal(result.providers.nvidiaDirect.configured, true);
  assert.equal(result.providers.nvidiaDirect.status, 'configured');
  assert.equal(result.providers.nvidiaDirect.reachability, 'not_checked');
  assert.equal(Object.hasOwn(result.providers, 'omniroute'), false);
});

test('missing NVIDIA configuration degrades health without OmniRoute checks', () => {
  const result = buildWorkspaceHealth('drop', {
    projectRegistry: {
      getProject: () => ({ id: 'drop', name: 'Drop', root: '/tmp/drop' })
    },
    pluginManager: {
      getPluginStatus: () => ({ installed: true, enabled: true, status: 'connected' })
    },
    vscodeBridge: {
      getConnection: () => ({ connected: true, status: 'connected' })
    },
    env: {}
  });

  assert.equal(result.status, 'degraded');
  assert.equal(result.providers.nvidiaDirect.configured, false);
  assert.equal(result.providers.nvidiaDirect.status, 'missing_configuration');
  assert.equal(Object.hasOwn(result.providers, 'omniroute'), false);
});
