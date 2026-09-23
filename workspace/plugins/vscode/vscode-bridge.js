const crypto = require("crypto");
const { spawn } = require("child_process");

const path = require("path");
const fs = require("fs");
const { getProjectTree, readProjectFile, writeProjectFile } = require("../../agent");
const { getProject } = require("../runtime/project-registry");
const { detectVSCode } = require("./vscode-plugin");
const editApprovals = require("../../tools/edit-approval-store");
const patchValidator = require("../../tools/patch-validator");

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

const sessions = new Map();
const challenges = new Map();
const MAX_DIAGNOSTICS = 500;
const MAX_FILE_CHANGES = 50;
const CHALLENGE_TTL_MS = 30000;
const SESSION_TTL_MS = 30000;

function validClientInstanceId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
}

function safeRelative(project, candidate) {
  if (typeof candidate !== "string") return null;
  const absolute = path.resolve(candidate);
  const relative = path.relative(project.root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const parts = relative.split(path.sep);
  if (parts.some((part) => part === ".git" || part === ".env" || part.startsWith(".env.") || /\.(pem|key|p12|pfx)$/i.test(part))) return null;
  return relative;
}

function beginHandshake(projectId) {
  const project = getProject(projectId);
  if (!project) throw new Error("project_not_found");
  const nonce = crypto.randomBytes(24).toString("hex");
  challenges.set(projectId, { nonce, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  return { projectId, projectName: project.name, nonce, expiresInMs: CHALLENGE_TTL_MS };
}

function getChallenge(projectId) {
  const challenge = challenges.get(projectId);
  if (!challenge || challenge.expiresAt <= Date.now()) {
    challenges.delete(projectId);
    return null;
  }
  return { projectId, nonce: challenge.nonce };
}

function sanitizeDiagnostics(project, values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, MAX_DIAGNOSTICS).map((item) => {
    const file = safeRelative(project, item && item.file);
    if (!file) return null;
    return {
      file,
      severity: ["error", "warning", "information", "hint"].includes(item.severity) ? item.severity : "information",
      message: String(item.message || "").slice(0, 1000),
      line: Number.isInteger(item.line) && item.line > 0 ? item.line : null,
      source: typeof item.source === "string" ? item.source.slice(0, 100) : null
    };
  }).filter(Boolean);
}

// Validates a single file-change event: only a relative, in-project path
// (never the absolute fsPath), a known eventType, and a safe timestamp.
function sanitizeFileChangeEvent(project, event) {
  if (!event || typeof event !== "object") return null;
  const file = safeRelative(project, event.path);
  if (!file) return null;
  if (event.eventType !== "saved") return null;
  const timestamp = typeof event.timestamp === "string" && event.timestamp
    ? event.timestamp
    : new Date().toISOString();
  return { path: file, eventType: "saved", timestamp };
}

// Appends a sanitized file-change event to a session's bounded history.
// Invalid/out-of-project events are silently dropped, never thrown, so a
// bad event never fails the heartbeat/handshake call that carried it.
function recordFileChange(session, project, event) {
  const sanitized = sanitizeFileChangeEvent(project, event);
  if (!sanitized) return;
  session.fileChanges.push(sanitized);
  if (session.fileChanges.length > MAX_FILE_CHANGES) {
    session.fileChanges.splice(0, session.fileChanges.length - MAX_FILE_CHANGES);
  }
}

function acceptHandshake(projectId, payload) {
  const project = getProject(projectId);
  const challenge = getChallenge(projectId);
  if (!project) throw new Error("project_not_found");
  if (!challenge || !payload || payload.nonce !== challenge.nonce) throw new Error("invalid_bridge_challenge");
  if (!validClientInstanceId(payload.clientInstanceId)) throw new Error("invalid_bridge_client");
  const current = getSession(projectId);
  if (current && current.clientInstanceId !== payload.clientInstanceId) throw new Error("vscode_bridge_session_owned");
  const roots = Array.isArray(payload.workspaceFolders) ? payload.workspaceFolders.map((root) => path.resolve(String(root))) : [];
  if (!roots.includes(project.root)) throw new Error("authorized_workspace_not_open");
  const session = {
    sessionId: crypto.randomUUID(), connectedAt: new Date().toISOString(), lastSeen: Date.now(),
    clientInstanceId: payload.clientInstanceId,
    vscodeVersion: typeof payload.vscodeVersion === "string" ? payload.vscodeVersion.slice(0, 40) : null,
    activeFile: safeRelative(project, payload.activeFile),
    diagnostics: sanitizeDiagnostics(project, payload.diagnostics),
    fileChanges: []
  };
  recordFileChange(session, project, payload.fileChangeEvent);
  sessions.set(projectId, session);
  challenges.delete(projectId);
  return getConnection(projectId);
}

function heartbeat(projectId, payload) {
  const project = getProject(projectId);
  const session = sessions.get(projectId);
  if (!project || !session || !payload || payload.sessionId !== session.sessionId || payload.clientInstanceId !== session.clientInstanceId) throw new Error("bridge_not_connected");
  session.lastSeen = Date.now();
  session.activeFile = safeRelative(project, payload.activeFile);
  session.diagnostics = sanitizeDiagnostics(project, payload.diagnostics);
  recordFileChange(session, project, payload.fileChangeEvent);
  return getConnection(projectId);
}

function getSession(projectId) {
  const session = sessions.get(projectId);
  if (!session || Date.now() - session.lastSeen > SESSION_TTL_MS) {
    sessions.delete(projectId);
    return null;
  }
  return session;
}

function getConnection(projectId) {
  const project = getProject(projectId);
  const session = getSession(projectId);
  return session ? {
    connected: true, status: "connected", sessionId: session.sessionId,
    connectedAt: session.connectedAt, vscodeVersion: session.vscodeVersion,
    project: project.name, source: "vscode_extension"
  } : { connected: false, status: "disconnected", project: project ? project.name : null };
}

function disconnect(projectId, sessionId, clientInstanceId) {
  const session = getSession(projectId);
  if (!session || typeof sessionId !== "string" || sessionId !== session.sessionId || clientInstanceId !== session.clientInstanceId) {
    throw new Error("invalid_bridge_session");
  }
  challenges.delete(projectId);
  const existed = sessions.delete(projectId);
  return { disconnected: true, hadActiveSession: existed };
}


function launchLocalBridge(projectId) {
  const project = getProject(projectId);
  if (!project) throw new Error("project_not_found");
  const cli = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
  if (!fs.existsSync(cli)) throw new Error("vscode_cli_unavailable");
  const extensionPath = path.join(__dirname, "extension");
  const child = spawn(cli, [
    "--new-window",
    `--extensionDevelopmentPath=${extensionPath}`,
    project.root
  ], { detached: true, stdio: "ignore" });
  child.unref();
  return { launched: true, project: project.name, mode: "extension_development_host" };
}

async function waitForConnection(projectId, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connection = getConnection(projectId);
    if (connection.connected) return connection;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return getConnection(projectId);
}

function requireSession(projectId) {
  const project = getProject(projectId);
  const session = getSession(projectId);
  if (!project) throw new Error("project_not_found");
  if (!session) throw new Error("vscode_bridge_disconnected");
  return { project, session };
}

function workspaceInfo(projectId) {
  const { project, session } = requireSession(projectId);
  return { projectId, project: project.name, workspaceRoot: project.root, source: "project_filesystem", bridge: "vscode_extension", vscodeVersion: session.vscodeVersion };
}

function workspaceTree(projectId) {
  const { project } = requireSession(projectId);
  if (!fs.existsSync(project.root)) throw new Error("authorized_workspace_unavailable");
  return { projectId, project: project.name, source: "project_filesystem", ...getProjectTree(project.root) };
}

function activeFile(projectId) {
  const { session } = requireSession(projectId);
  return session.activeFile
    ? { available: true, path: session.activeFile, source: "vscode_extension" }
    : { available: false, status: "unavailable", reason: "VS Code reported no active file in the authorized workspace", source: "vscode_extension" };
}

function diagnostics(projectId) {
  const { session } = requireSession(projectId);
  return { available: true, source: "vscode_extension", diagnostics: session.diagnostics };
}

function fileChanges(projectId) {
  const { session } = requireSession(projectId);
  // Most recent first; already bounded to MAX_FILE_CHANGES by recordFileChange.
  return { available: true, source: "vscode_extension", changes: session.fileChanges.slice().reverse() };
}

function readFile(projectId, relativePath) {
  requireSession(projectId);
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error("A valid project file path is required");
  }
  // Reuses agent.js readProjectFile: same DROP_ROOT containment,
  // BLOCKED_NAMES/BLOCKED_EXTENSIONS filters, and 1 MB read limit.
  const content = readProjectFile(relativePath);
  return { path: relativePath, content, source: "project_filesystem" };
}

// Records a pending, human-approved MINIMAL patch. Never writes to disk.
// Reuses readProjectFile so a proposal is only possible for a path that
// already passes the same read security boundary (blocked names/exts,
// traversal, size). Edits are validated in full before an approval exists.
function proposeEdit(projectId, relativePath, edits, verification = null) {
  requireSession(projectId);
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new Error("A valid project file path is required");
  }
  const currentContent = readProjectFile(relativePath);
  const { summary } = patchValidator.validateEdits(currentContent, edits);
  const sourceHash = sha256(currentContent);
  const approvalId = editApprovals.createApproval(relativePath, edits, sourceHash, verification);
  const approval = editApprovals.getApproval(approvalId);
  return {
    approvalId,
    path: relativePath,
    summary,
    expiresAt: new Date(approval.expiresAt).toISOString(),
    applied: false,
    source: "project_filesystem"
  };
}

// Applies a previously proposed patch. Only ever reachable through the
// narrowly-gated vscode.file.apply_edit tool; never callable without a
// valid, unused, unexpired approval matching the exact requested path, and
// only if the source file's content hash still matches the proposal time.
function applyEdit(projectId, approvalId, relativePath) {
  requireSession(projectId);
  const approval = editApprovals.consumeApproval(approvalId, relativePath);
  const currentContent = readProjectFile(approval.path);
  if (sha256(currentContent) !== approval.sourceHash) {
    throw new Error("Source file changed since this edit was proposed; approval is stale");
  }
  const { content: newContent } = patchValidator.validateEdits(currentContent, approval.edits);
  // writeProjectFile re-validates the path through validateProjectPath
  // (defense in depth) and enforces the same write-size/symlink checks.
  const writeResult = writeProjectFile(approval.path, newContent);
  const content = readProjectFile(approval.path);
  if (content !== newContent) {
    throw new Error("Post-write verification failed");
  }
  return {
    path: approval.path,
    applied: true,
    bytesWritten: writeResult.bytesWritten,
    content,
    source: "project_filesystem"
  };
}

module.exports = {
  detectVSCode, beginHandshake, getChallenge, acceptHandshake, heartbeat,
  getConnection, disconnect, launchLocalBridge, waitForConnection, workspaceInfo, workspaceTree,
  activeFile, diagnostics, fileChanges, readFile, proposeEdit, applyEdit
};

