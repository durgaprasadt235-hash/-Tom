// Plugin Manager Runtime - Part 1
// Manages project-scoped plugin installation state
// Local persistence only - no secrets, tokens, or credentials

const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', '..', '.plugin-state');
const STATE_FILE = path.join(STATE_DIR, 'plugins.json');

// Ensure state directory exists
if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

const DEFAULT_STATE = {
  version: 1,
  projects: {}
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading plugin state:', error.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving plugin state:', error.message);
    throw error;
  }
}

function getCurrentProjectId() {
  return process.env.PROJECT_ID || 'default-project';
}

function getInstalledPlugins(projectId) {
  const state = loadState();
  const project = state.projects[projectId];
  if (!project) return [];
  return project.installed || [];
}

function getEnabledPlugins(projectId) {
  const state = loadState();
  const project = state.projects[projectId];
  if (!project) return [];
  return project.enabled || [];
}

function installPlugin(projectId, pluginId) {
  if (!projectId || typeof projectId !== 'string') {
    return { success: false, message: 'Invalid project ID' };
  }
  if (!pluginId || typeof pluginId !== 'string') {
    return { success: false, message: 'Invalid plugin ID' };
  }
  
  const state = loadState();
  
  if (!state.projects[projectId]) {
    state.projects[projectId] = { installed: [], enabled: [] };
  }
  
  const project = state.projects[projectId];
  
  if (project.installed.includes(pluginId)) {
    return { 
      success: true, 
      message: 'Plugin already installed',
      installed: true,
      enabled: project.enabled.includes(pluginId)
    };
  }
  
  project.installed.push(pluginId);
  saveState(state);
  
  return { success: true, message: 'Plugin installed successfully', installed: true, enabled: false };
}

function uninstallPlugin(projectId, pluginId) {
  if (!projectId || typeof projectId !== 'string') {
    return { success: false, message: 'Invalid project ID' };
  }
  if (!pluginId || typeof pluginId !== 'string') {
    return { success: false, message: 'Invalid plugin ID' };
  }
  
  const state = loadState();
  
  if (!state.projects[projectId]) {
    return { success: false, message: 'Project not found' };
  }
  
  const project = state.projects[projectId];
  
  if (!project.installed.includes(pluginId)) {
    return { success: false, message: 'Plugin not installed' };
  }
  
  project.installed = project.installed.filter(id => id !== pluginId);
  project.enabled = project.enabled.filter(id => id !== pluginId);
  
  saveState(state);
  
  return { success: true, message: 'Plugin uninstalled successfully' };
}

function enablePlugin(projectId, pluginId) {
  if (!projectId || typeof projectId !== 'string') {
    return { success: false, message: 'Invalid project ID' };
  }
  if (!pluginId || typeof pluginId !== 'string') {
    return { success: false, message: 'Invalid plugin ID' };
  }
  
  const state = loadState();
  
  if (!state.projects[projectId]) {
    return { success: false, message: 'Project not found' };
  }
  
  const project = state.projects[projectId];
  
  if (!project.installed.includes(pluginId)) {
    return { success: false, message: 'Plugin not installed' };
  }
  
  if (!project.enabled.includes(pluginId)) {
    project.enabled.push(pluginId);
    saveState(state);
  }
  
  return { success: true, message: 'Plugin enabled successfully' };
}

function disablePlugin(projectId, pluginId) {
  if (!projectId || typeof projectId !== 'string') {
    return { success: false, message: 'Invalid project ID' };
  }
  if (!pluginId || typeof pluginId !== 'string') {
    return { success: false, message: 'Invalid plugin ID' };
  }
  
  const state = loadState();
  
  if (!state.projects[projectId]) {
    return { success: false, message: 'Project not found' };
  }
  
  const project = state.projects[projectId];
  project.enabled = project.enabled.filter(id => id !== pluginId);
  saveState(state);
  
  return { success: true, message: 'Plugin disabled successfully' };
}

function getPluginStatus(projectId, pluginId) {
  const state = loadState();
  const project = state.projects[projectId];
  
  const installed = project ? project.installed.includes(pluginId) : false;
  const enabled = project ? project.enabled.includes(pluginId) : false;
  
  let status = 'available';
  if (installed) {
    status = enabled ? 'installed' : 'configuration_required';
  }
  
  return { installed, enabled, status };
}

function setConnectionMetadata(projectId, pluginId, metadata) {
  const state = loadState();
  if (!state.projects[projectId]) {
    state.projects[projectId] = { installed: [], enabled: [], connectionMetadata: {} };
  }
  state.projects[projectId].connectionMetadata = state.projects[projectId].connectionMetadata || {};
  state.projects[projectId].connectionMetadata[pluginId] = metadata;
  saveState(state);
  return metadata;
}

function getConnectionMetadata(projectId, pluginId) {
  const state = loadState();
  return state.projects[projectId]?.connectionMetadata?.[pluginId] || null;
}

function clearConnectionMetadata(projectId, pluginId) {
  const state = loadState();
  if (state.projects[projectId]?.connectionMetadata) {
    delete state.projects[projectId].connectionMetadata[pluginId];
    saveState(state);
  }
}

module.exports = {
  loadState,
  saveState,
  getCurrentProjectId,
  getInstalledPlugins,
  getEnabledPlugins,
  installPlugin,
  uninstallPlugin,
  enablePlugin,
  disablePlugin,
  getPluginStatus,
  setConnectionMetadata,
  getConnectionMetadata,
  clearConnectionMetadata
};