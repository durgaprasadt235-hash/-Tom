function buildWorkspaceHealth(projectId, { projectRegistry, pluginManager, vscodeBridge, env = process.env } = {}) {
  const project = projectRegistry?.getProject?.(projectId) || null;
  const vscodeState = pluginManager?.getPluginStatus?.(projectId, 'vscode') || { installed: false, enabled: false, status: 'available' };
  const vscodeConnection = vscodeBridge?.getConnection?.(projectId) || { connected: false, status: 'disconnected' };

  const nvidiaConfigured = typeof env?.NVIDIA_API_KEY === 'string' && env.NVIDIA_API_KEY.trim().length > 0;

  const projectConnected = Boolean(project && project.id === projectId && (vscodeState.enabled || vscodeConnection.connected));
  const workspaceStatus = projectConnected && vscodeConnection.connected && nvidiaConfigured ? 'ok' : 'degraded';

  return {
    status: workspaceStatus,
    project: {
      id: project?.id || projectId,
      name: project?.name || 'Unknown project',
      connected: projectConnected,
      root: project?.root || null
    },
    providers: {
      nvidiaDirect: {
        configured: nvidiaConfigured,
        status: nvidiaConfigured ? 'configured' : 'missing_configuration',
        reachability: 'not_checked'
      },
      vscode: {
        connected: Boolean(vscodeConnection.connected),
        status: vscodeConnection.status || (vscodeState.enabled ? 'connected' : 'disabled'),
        source: vscodeConnection.source || 'vscode_extension'
      }
    }
  };
}

module.exports = { buildWorkspaceHealth };
