const crypto = require("crypto");

const MAX_HISTORY = 50;
const activeOperations = new Map();
const recentActivity = new Map();

function requireSafeString(value, field) {
  if (typeof value !== "string" || !value || value.length > 160 || !/^[a-zA-Z0-9._:-]+$/.test(value)) {
    throw new Error(`invalid_activity_${field}`);
  }
  return value;
}

function projectOperations(projectId) {
  if (!activeOperations.has(projectId)) activeOperations.set(projectId, new Map());
  return activeOperations.get(projectId);
}

function projectHistory(projectId) {
  if (!recentActivity.has(projectId)) recentActivity.set(projectId, []);
  return recentActivity.get(projectId);
}

function publicEvent(operation, state, completedAt = null) {
  return {
    operationId: operation.operationId,
    projectId: operation.projectId,
    pluginId: operation.pluginId,
    capability: operation.capability,
    state,
    startedAt: operation.startedAt,
    completedAt
  };
}

function record(event) {
  const history = projectHistory(event.projectId);
  history.push(event);
  while (history.length > MAX_HISTORY) history.shift();
}

function start({ projectId, pluginId, capability }) {
  const operation = {
    operationId: crypto.randomUUID(),
    projectId: requireSafeString(projectId, "project"),
    pluginId: requireSafeString(pluginId, "plugin"),
    capability: requireSafeString(capability, "capability"),
    startedAt: new Date().toISOString()
  };
  projectOperations(operation.projectId).set(operation.operationId, operation);
  record(publicEvent(operation, "operation_started"));
  return operation.operationId;
}

function finish(operationId, state) {
  if (typeof operationId !== "string") return null;
  for (const [projectId, operations] of activeOperations) {
    const operation = operations.get(operationId);
    if (!operation) continue;
    operations.delete(operationId);
    if (operations.size === 0) activeOperations.delete(projectId);
    const completedAt = new Date().toISOString();
    const event = publicEvent(operation, state, completedAt);
    record(event);
    return event;
  }
  return null;
}

function complete(operationId) {
  return finish(operationId, "operation_completed");
}

function fail(operationId) {
  return finish(operationId, "operation_failed");
}

function getActiveOperations(projectId, pluginId = null) {
  const operations = activeOperations.get(projectId);
  if (!operations) return [];
  return [...operations.values()]
    .filter(operation => !pluginId || operation.pluginId === pluginId)
    .map(operation => publicEvent(operation, "operation_started"));
}

function isWorking(projectId, pluginId) {
  return getActiveOperations(projectId, pluginId).length > 0;
}

function getRecentActivity(projectId) {
  return [...(recentActivity.get(projectId) || [])].map(event => ({ ...event }));
}

function resetForTests() {
  activeOperations.clear();
  recentActivity.clear();
}

module.exports = {
  MAX_HISTORY,
  start,
  complete,
  fail,
  getActiveOperations,
  isWorking,
  getRecentActivity,
  resetForTests
};
