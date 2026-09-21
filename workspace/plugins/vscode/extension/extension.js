const vscode = require("vscode");
const http = require("http");
const crypto = require("crypto");

const HOST = "127.0.0.1";
const PORT = 3001;
const PROJECT_ID = "drop";
let sessionId = null;
let timer = null;
let syncPromise = null;
const pendingFileChangeEvents = [];
const clientInstanceId = crypto.randomUUID();

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ hostname: HOST, port: PORT, path: route, method, headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {} }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(2000, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function snapshot() {
  const folders = (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
  const editor = vscode.window.activeTextEditor;
  const activeFile = editor && editor.document.uri.scheme === "file" ? editor.document.uri.fsPath : null;
  const severity = ["error", "warning", "information", "hint"];
  const diagnostics = [];
  for (const [uri, items] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== "file") continue;
    for (const item of items) {
      diagnostics.push({ file: uri.fsPath, severity: severity[item.severity] || "information", message: item.message, line: item.range.start.line + 1, source: item.source || null });
      if (diagnostics.length >= 500) break;
    }
    if (diagnostics.length >= 500) break;
  }
  return { workspaceFolders: folders, activeFile, diagnostics, vscodeVersion: vscode.version };
}

async function synchronizeOnce(fileChangeEvent) {
  try {
    if (sessionId) {
      const response = await request("POST", `/projects/${PROJECT_ID}/plugins/vscode/bridge/heartbeat`, { sessionId, clientInstanceId, ...snapshot(), fileChangeEvent });
      if (response.status === 200) return;
      sessionId = null;
    }
    const challenge = await request("GET", `/projects/${PROJECT_ID}/plugins/vscode/bridge/challenge`);
    if (challenge.status !== 200 || !challenge.body.nonce) return;
    const response = await request("POST", `/projects/${PROJECT_ID}/plugins/vscode/bridge/handshake`, { nonce: challenge.body.nonce, clientInstanceId, ...snapshot(), fileChangeEvent });
    if (response.status === 200) sessionId = response.body.connection.sessionId;
  } catch (_) {
    sessionId = null;
  }
}

function synchronize(fileChangeEvent) {
  if (fileChangeEvent) pendingFileChangeEvents.push(fileChangeEvent);
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    do {
      const nextFileChangeEvent = pendingFileChangeEvents.shift();
      await synchronizeOnce(nextFileChangeEvent);
    } while (pendingFileChangeEvents.length > 0);
  })().finally(() => {
    syncPromise = null;
    if (pendingFileChangeEvents.length > 0) synchronize();
  });

  return syncPromise;
}

function activate(context) {
  timer = setInterval(() => synchronize(), 3000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => synchronize()));
  context.subscriptions.push(vscode.languages.onDidChangeDiagnostics(() => synchronize()));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.uri.scheme !== "file") return;
    // No file contents are sent - only the path, event type, and timestamp.
    synchronize({ path: document.uri.fsPath, eventType: "saved", timestamp: new Date().toISOString() });
  }));
  synchronize();
}

async function deactivate() {
  if (timer) clearInterval(timer);
  if (sessionId) {
    try {
      await request("POST", `/projects/${PROJECT_ID}/plugins/vscode/bridge/disconnect`, { sessionId, clientInstanceId });
    } catch (_) {
      // The server may already be unavailable during shutdown; TTL remains authoritative.
    }
    sessionId = null;
  }
}

module.exports = { activate, deactivate };
