// Read-only projection of the existing catalog, project and runtime authorities.
function normalizeStatus(raw) {
  return ({ connected: 'connected', degraded: 'warning', configuration_required: 'warning',
    error: 'error', disconnected: 'not_connected', installed: 'not_connected', disabled: 'disabled' })[raw] || 'unknown';
}
function buildTopologySnapshot(projectId, { projectRegistry, pluginRegistry, pluginManager, vscodeBridge, actionGateway, activityTracker }) {
  const project = projectRegistry.getProject(projectId);
  if (!project || project.id !== projectId) return null;
  const observedAt = new Date().toISOString();
  const installed = new Set(pluginManager.getInstalledPlugins(projectId));
  const nodes = [{ id: `project:${projectId}`, type: 'project', projectId, label: project.name }];
  const edges = [];
  const tools = actionGateway.getRegisteredTools();
  for (const plugin of pluginRegistry.getCatalog().filter(p => installed.has(p.id))) {
    const state = pluginManager.getPluginStatus(projectId, plugin.id);
    let connection = null;
    let rawStatus = state.status;
    let activityState = 'idle';
    let activeDestination = null;
    if (plugin.id === 'vscode') {
      const bridge = vscodeBridge.getConnection(projectId);
      rawStatus = !state.enabled ? 'disabled' : (bridge.connected ? 'connected' : 'disconnected');
      connection = { connected: state.enabled && bridge.connected, source: 'vscode_extension', connectedAt: bridge.connectedAt || null, version: bridge.vscodeVersion || null };
      const working = state.enabled && bridge.connected && Boolean(activityTracker?.isWorking(projectId, 'vscode'));
      activityState = working ? 'working' : 'idle';
      activeDestination = working ? 'plugin:vscode' : null;
      if (state.enabled && bridge.connected) edges.push({ id: `vscode:${projectId}`, projectId, source: 'plugin:vscode', target: `project:${projectId}`,
        relationship: 'Development workspace', directed: false, status: 'connected', activityState, activeDestination,
        provenance: { source: 'vscode_extension' }, observedAt });
    }
    nodes.push({ id: `plugin:${plugin.id}`, type: 'plugin', projectId, pluginId: plugin.id, label: plugin.name,
      vendor: plugin.vendor, category: plugin.category, description: plugin.description, billingMode: plugin.billingMode,
      connectionType: plugin.connectionType, capabilities: plugin.capabilities || [], supportedAuth: plugin.supportedAuth || [],
      riskLevels: plugin.riskLevels || [], runtimeCapabilities: tools.filter(t => (plugin.capabilities || []).some(c => c.name === t.capability)),
      installed: state.installed, enabled: state.enabled, rawStatus, operationalStatus: normalizeStatus(rawStatus),
      activityState, statusSource: plugin.id === 'vscode' ? 'runtime' : 'installation_state', connection,
      observedAt, allowedActions: [] });
  }
  const activity = activityTracker?.getRecentActivity(projectId) || [];
  return { schemaVersion: 1, project: { id: project.id, name: project.name }, nodes, edges, activity, observedAt,
    authorization: { source: null, role: null, allowedActions: [] } };
}
module.exports = { buildTopologySnapshot, normalizeStatus };
