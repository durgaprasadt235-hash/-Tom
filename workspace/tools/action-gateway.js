// Tom Action Gateway - central registry for controlled read-only execution.
const gitTool = require("./git-tool");
const pluginManager = require("../plugins/runtime/plugin-manager");
const vscodeBridge = require("../plugins/vscode/vscode-bridge");
const activityTracker = require("../plugins/runtime/activity-tracker");
const { createRuntimeGateway, TOOLS: RUNTIME_TOOLS } = require("./runtime-controller");
const runtimeGateway = createRuntimeGateway({ root: require("../agent").DROP_ROOT });

const VSCODE_PROJECT_ID = "drop";

const STATIC_TOOLS = {
  "git.status": { name: "git.status", description: "Get the status of the authorized Drop repository", capability: "repository.status", riskLevel: "read", handler: gitTool.status },
  "git.branch": { name: "git.branch", description: "List branches in the authorized Drop repository", capability: "repository.branch", riskLevel: "read", handler: gitTool.branch },
  "git.log": { name: "git.log", description: "Get commit history of the authorized Drop repository", capability: "repository.log", riskLevel: "read", handler: gitTool.log },
  "git.diff": { name: "git.diff", description: "Show file differences in the authorized Drop repository", capability: "repository.diff", riskLevel: "read", handler: gitTool.diff },

};

const VSCODE_TOOLS = {
  "vscode.workspace.info": { name: "vscode.workspace.info", description: "Describe the authorized VS Code workspace", capability: "vscode.workspace.info", riskLevel: "read", handler: () => vscodeBridge.workspaceInfo(VSCODE_PROJECT_ID) },
  "vscode.workspace.tree": { name: "vscode.workspace.tree", description: "List the safe authorized project tree", capability: "vscode.workspace.tree", riskLevel: "read", handler: () => vscodeBridge.workspaceTree(VSCODE_PROJECT_ID) },
  "vscode.workspace.search": { name: "vscode.workspace.search", description: "Search authorized project files for implementation terms", capability: "vscode.workspace.search", riskLevel: "read", requiresArgs: true, handler: (args) => vscodeBridge.searchWorkspace(VSCODE_PROJECT_ID, args && args.query) },
  "vscode.file.active": { name: "vscode.file.active", description: "Get the active authorized VS Code file if available", capability: "vscode.file.active", riskLevel: "read", handler: () => vscodeBridge.activeFile(VSCODE_PROJECT_ID) },
  "vscode.diagnostics": { name: "vscode.diagnostics", description: "Get diagnostics reported by the local VS Code bridge", capability: "vscode.diagnostics", riskLevel: "read", handler: () => vscodeBridge.diagnostics(VSCODE_PROJECT_ID) },
  "vscode.file.changes": { name: "vscode.file.changes", description: "Get recent authorized file-save events reported by the local VS Code bridge", capability: "vscode.file.changes", riskLevel: "read", handler: () => vscodeBridge.fileChanges(VSCODE_PROJECT_ID) },
  "vscode.file.read": {
    name: "vscode.file.read",
    description: "Read an authorized project source file (read-only, 1 MB limit)",
    capability: "vscode.file.read",
    riskLevel: "read",
    requiresArgs: true,
    handler: (args) => {
      if (!args || typeof args.path !== "string") {
        throw new Error("A 'path' argument (string) is required");
      }
      return vscodeBridge.readFile(VSCODE_PROJECT_ID, args.path);
    }
  },
  "vscode.file.propose_edit": {
    name: "vscode.file.propose_edit",
    description: "Propose a minimal, validated patch to an authorized project file for human approval (does not write)",
    capability: "vscode.file.propose_edit",
    riskLevel: "read",
    requiresArgs: true,
    handler: (args) => {
      if (!args || typeof args.path !== "string") {
        throw new Error("A 'path' argument (string) is required");
      }
      if (!Array.isArray(args.edits)) {
        throw new Error("An 'edits' argument (array) is required");
      }
      return vscodeBridge.proposeEdit(VSCODE_PROJECT_ID, args.path, args.edits, args.verification || null);
    }
  },
  "vscode.file.apply_edit": {
    name: "vscode.file.apply_edit",
    description: "Apply a previously approved, single-use edit to an authorized project file",
    capability: "vscode.file.apply_edit",
    // Narrow, explicit exception to the read-only gate below: this is the
    // only tool with this risk level, and its handler refuses to write
    // anything without a valid, unused, unexpired, path-matching approval.
    riskLevel: "approved_write",
    requiresArgs: true,
    handler: (args) => {
      if (!args || typeof args.approvalId !== "string") {
        throw new Error("An 'approvalId' argument (string) is required");
      }
      if (typeof args.path !== "string") {
        throw new Error("A 'path' argument (string) is required");
      }
      return vscodeBridge.applyEdit(VSCODE_PROJECT_ID, args.approvalId, args.path);
    }
  }
};

function vscodeExecutable() {
  const state = pluginManager.getPluginStatus(VSCODE_PROJECT_ID, "vscode");
  return state.installed && state.enabled && vscodeBridge.getConnection(VSCODE_PROJECT_ID).connected;
}

function currentRegistry() {
  return vscodeExecutable() ? { ...STATIC_TOOLS, ...VSCODE_TOOLS } : STATIC_TOOLS;
}

function getRegisteredTools(capabilityFilter = null) {
  return [...Object.values(currentRegistry()), ...runtimeGateway.getRegisteredTools()]
    .filter((tool) => !capabilityFilter || tool.capability === capabilityFilter)
    .map(({ name, description, capability, riskLevel }) => ({ name, description, capability, riskLevel }));
}

async function executeTool(toolName, args) {
  if (RUNTIME_TOOLS.includes(toolName)) return runtimeGateway.executeTool(toolName, args);
  if (typeof toolName !== "string" || !Object.hasOwn(currentRegistry(), toolName)) {
    return { success: false, tool: toolName, error: "Tool not found or unavailable" };
  }
  const tool = currentRegistry()[toolName];
  if (!tool) return { success: false, tool: toolName, error: `Tool not found or unavailable: ${toolName}` };
  // Read-only by default. "approved_write" is a narrow, explicit exception
  // used only by vscode.file.apply_edit, which itself refuses to write
  // without a valid single-use approval. No other risk level is permitted.
  if (tool.riskLevel !== "read" && tool.riskLevel !== "approved_write") {
    return { success: false, tool: toolName, error: `Tool not allowed: ${toolName}` };
  }
  // Only pass validated, plain-object args through; tool handlers that don't
  // declare requiresArgs ignore whatever is passed and remain zero-argument.
  const safeArgs = tool.requiresArgs && args && typeof args === "object" ? args : undefined;
  const isVSCodeTool = toolName.startsWith("vscode.");
  const operationId = isVSCodeTool
    ? activityTracker.start({ projectId: VSCODE_PROJECT_ID, pluginId: "vscode", capability: tool.capability })
    : null;
  try {
    const result = { success: true, tool: toolName, data: await tool.handler(safeArgs) };
    if (operationId) activityTracker.complete(operationId);
    return result;
  } catch (error) {
    if (operationId) activityTracker.fail(operationId);
    return { success: false, tool: toolName, error: error.message || "Unknown error occurred" };
  }
}

module.exports = { getRegisteredTools, executeTool, activityTracker, shutdown: runtimeGateway.shutdown };

