const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const agent = require('../agent');
const vscodeBridge = require('../plugins/vscode/vscode-bridge');
const actionGateway = require('../tools/action-gateway');
const {
  planGitTools,
  planVscodeTools,
  planFileAnalysis,
  planProjectDiscovery,
  createExecutionPlan,
  extractExplicitFilePath
} = require('../tools/chat-tool-planner');
const { executePlan } = require('../tools/agent-runtime');

const PROJECT_ID = 'drop';
const CLIENT_INSTANCE_ID = 'tom-test-client-file-analysis';

function connectBridge() {
  const challenge = vscodeBridge.beginHandshake(PROJECT_ID);
  return vscodeBridge.acceptHandshake(PROJECT_ID, {
    nonce: challenge.nonce,
    clientInstanceId: CLIENT_INSTANCE_ID,
    vscodeVersion: '1.0.0-test',
    workspaceFolders: [agent.DROP_ROOT],
    activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
    diagnostics: []
  });
}

let connection;

before(() => {
  connection = connectBridge();
});

after(() => {
  try {
    vscodeBridge.disconnect(PROJECT_ID, connection.sessionId, CLIENT_INSTANCE_ID);
  } catch {
    // best-effort cleanup
  }
});

// Simulates the same sequence server.js runs for a /chat message:
// plan tools, execute through the real Action Gateway, and resolve
// an "active file" mode into an explicit path via vscode.file.read.
async function runFileAnalysisPlan(message) {
  const filePlan = planFileAnalysis(message);
  const toolResults = {};

  async function runTool(toolName, args) {
    const result = await actionGateway.executeTool(toolName, args);
    toolResults[toolName] = result;
    return result;
  }

  if (!filePlan) return { filePlan, toolResults };

  let targetPath = filePlan.mode === 'explicit' ? filePlan.path : null;

  if (filePlan.mode === 'active') {
    const activeResult = await runTool('vscode.file.active');
    targetPath = activeResult && activeResult.success && activeResult.data.available
      ? activeResult.data.path
      : null;
  }

  if (targetPath) {
    await runTool('vscode.file.read', { path: targetPath });
  }

  return { filePlan, toolResults, targetPath };
}

// --------------------------------------------------
// Deterministic planning (no LLM call for tool selection)
// --------------------------------------------------

test('extractExplicitFilePath finds an explicit relative path', () => {
  assert.equal(extractExplicitFilePath('Analyze web/app/page.tsx and explain it'), 'web/app/page.tsx');
  assert.equal(extractExplicitFilePath('explain web/components/drop-hub.tsx please'), 'web/components/drop-hub.tsx');
  assert.equal(extractExplicitFilePath('hello there'), null);
});

test('planFileAnalysis selects explicit mode for "analyze <path>"', () => {
  const plan = planFileAnalysis('Analyze web/app/page.tsx and explain the current DROP home page architecture.');
  assert.deepEqual(plan, { mode: 'explicit', path: 'web/app/page.tsx' });
});

test('planFileAnalysis selects explicit mode for "read <path>"', () => {
  const plan = planFileAnalysis('read web/app/page.tsx');
  assert.deepEqual(plan, { mode: 'explicit', path: 'web/app/page.tsx' });
});

test('planFileAnalysis selects active mode for "review the active file"', () => {
  const plan = planFileAnalysis('review the active file');
  assert.deepEqual(plan, { mode: 'active' });
});

test('planFileAnalysis returns null for normal chat that does not need a file', () => {
  assert.equal(planFileAnalysis('What is the weather like today?'), null);
  assert.equal(planFileAnalysis('Hi Tom, how are you?'), null);
});

test('project discovery starts with the tree and selects existing Home candidates', async () => {
  const message = 'Inspect the Drop project and tell me what component implements the main Home page. Do not modify anything.';
  const projectPlan = planProjectDiscovery(message);
  const executionPlan = createExecutionPlan(message);
  const calls = [];
  const evidence = await executePlan(executionPlan, async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'vscode.workspace.tree') {
      return { success: true, data: { tree: [{ path: 'web/app/page.tsx', type: 'file' }] } };
    }
    return { success: true, data: { path: args.path, content: 'export default function Home() {}' } };
  });

  assert.equal(projectPlan.intent, 'inspect_project');
  assert.deepEqual(calls, [
    { tool: 'vscode.workspace.tree', args: {} },
    { tool: 'vscode.file.read', args: { path: 'web/app/page.tsx' } }
  ]);
  assert.deepEqual(evidence.map((item) => item.tool), ['vscode.workspace.tree', 'vscode.file.read']);
  assert.equal(executionPlan.steps[0].tool, 'vscode.workspace.tree');
});

test('project discovery does not read guessed files absent from the tree', async () => {
  const executionPlan = createExecutionPlan(
    'Find the component that implements the main Home page in the repository.'
  );
  const calls = [];
  const evidence = await executePlan(executionPlan, async (tool, args) => {
    calls.push({ tool, args });
    return { success: true, data: { tree: [{ path: 'web/components/Other.tsx', type: 'file' }] } };
  });

  assert.deepEqual(calls, [{ tool: 'vscode.workspace.tree', args: {} }]);
  assert.deepEqual(evidence.map((item) => item.tool), ['vscode.workspace.tree']);
});

test('planGitTools and planVscodeTools are unaffected by file analysis wording', () => {
  assert.deepEqual(planGitTools('what changed recently?'), []);
  assert.deepEqual(planVscodeTools('what file am I working on?'), ['vscode.file.active']);
});

// --------------------------------------------------
// End-to-end plan execution through the real Action Gateway
// --------------------------------------------------

test('explicit file analysis executes vscode.file.read with the correct path', async () => {
  const { filePlan, toolResults, targetPath } = await runFileAnalysisPlan(
    'Analyze web/app/page.tsx and explain the current DROP home page architecture.'
  );
  assert.equal(filePlan.mode, 'explicit');
  assert.equal(targetPath, 'web/app/page.tsx');
  assert.equal(toolResults['vscode.file.read'].success, true);
  assert.match(toolResults['vscode.file.read'].data.content, /use client/);
});

test('active-file analysis resolves the active file then reads it', async () => {
  const { filePlan, toolResults, targetPath } = await runFileAnalysisPlan('Please review the active file');
  assert.equal(filePlan.mode, 'active');
  assert.equal(toolResults['vscode.file.active'].success, true);
  assert.equal(targetPath, 'web/app/page.tsx');
  assert.equal(toolResults['vscode.file.read'].success, true);
});

test('blocked file requests fail safely', async () => {
  const { toolResults } = await runFileAnalysisPlan('Analyze web/.env.local for me');
  assert.equal(toolResults['vscode.file.read'].success, false);
  assert.match(toolResults['vscode.file.read'].error, /blocked/i);
});

test('missing/nonexistent file requests fail safely', async () => {
  const { toolResults } = await runFileAnalysisPlan('Analyze web/does-not-exist.tsx please');
  assert.equal(toolResults['vscode.file.read'].success, false);
  assert.match(toolResults['vscode.file.read'].error, /does not exist/i);
});

test('normal chat that does not require a file triggers no file reads', async () => {
  const { filePlan, toolResults } = await runFileAnalysisPlan('What is the weather like today?');
  assert.equal(filePlan, null);
  assert.equal(Object.keys(toolResults).length, 0);
});

test('existing VS Code and Git tools still work unaffected', async () => {
  const diagnostics = await actionGateway.executeTool('vscode.diagnostics');
  assert.equal(diagnostics.success, true);

  const tree = await actionGateway.executeTool('vscode.workspace.tree');
  assert.equal(tree.success, true);
  assert.ok(!tree.data.tree.some((entry) => entry.path.startsWith('web-git-backup')));

  const gitStatus = await actionGateway.executeTool('git.status');
  assert.equal(gitStatus.success, true);
});
