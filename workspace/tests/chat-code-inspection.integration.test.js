const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const agent = require('../agent');
const vscodeBridge = require('../plugins/vscode/vscode-bridge');
const actionGateway = require('../tools/action-gateway');
const nvidiaRouter = require('../nvidia-router');

const PROJECT_ID = 'drop';
const CLIENT_INSTANCE_ID = 'tom-test-client-code-inspection';
const TARGET_PATH = 'web/app/page.tsx';
const REQUEST =
  'Inspect web/app/page.tsx completely and run VS Code diagnostics for it. ' +
  'Separate findings into confirmed compiler/diagnostic issues, confirmed code facts, ' +
  'and architectural suggestions. Cite line numbers. Do not modify anything.';

let connection;
let server;
let baseUrl;
let originalAskNvidia;
let originalExecuteTool;
let toolCalls;
let modelMessages;
let modelOptions;

before(async () => {
  const content = agent.readProjectFile(TARGET_PATH);
  originalAskNvidia = nvidiaRouter.askNvidia;
  nvidiaRouter.askNvidia = async (messages, options) => {
    modelMessages = messages;
    modelOptions = options;
    return {
      model: 'test-model',
      content: JSON.stringify({
        diagnostics: [{ severity: 'error', message: 'Invented diagnostic', line: 999 }],
        codeFacts: [
          { lineStart: 1, lineEnd: 1, fact: 'The file declares a client component.' },
          { lineStart: 999, lineEnd: 999, fact: 'Invented fact.' }
        ],
        suggestions: [
          {
            lineStart: 1,
            lineEnd: 3,
            suggestion: 'Consider isolating the top-level responsibility.',
            reason: 'The file begins with client-side component imports.'
          }
        ]
      })
    };
  };

  const { app } = require('../server');
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const challenge = vscodeBridge.beginHandshake(PROJECT_ID);
  connection = vscodeBridge.acceptHandshake(PROJECT_ID, {
    nonce: challenge.nonce,
    clientInstanceId: CLIENT_INSTANCE_ID,
    vscodeVersion: '1.0.0-test',
    workspaceFolders: [agent.DROP_ROOT],
    activeFile: path.join(agent.DROP_ROOT, TARGET_PATH),
    diagnostics: [
      { file: path.join(agent.DROP_ROOT, TARGET_PATH), severity: 'error', message: 'Actual compiler issue', line: 7, source: 'typescript' },
      { file: path.join(agent.DROP_ROOT, 'web/other.tsx'), severity: 'warning', message: 'Unrelated warning', line: 3, source: 'eslint' }
    ]
  });

  originalExecuteTool = actionGateway.executeTool;
  toolCalls = {};
  actionGateway.executeTool = async (tool, args) => {
    toolCalls[tool] = (toolCalls[tool] || 0) + 1;
    return originalExecuteTool(tool, args);
  };
});

after(async () => {
  actionGateway.executeTool = originalExecuteTool;
  nvidiaRouter.askNvidia = originalAskNvidia;
  try {
    vscodeBridge.disconnect(PROJECT_ID, connection.sessionId, CLIENT_INSTANCE_ID);
  } catch {
    // best-effort cleanup
  }
  await new Promise((resolve) => server.close(resolve));
});

test('exact inspection request keeps diagnostics and code evidence authoritative', async () => {
  const response = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: REQUEST, history: [] })
  });
  const body = await response.json();
  const sourceContent = agent.readProjectFile(TARGET_PATH);
  const modelInput = JSON.parse(modelMessages[1].content);

  assert.equal(response.status, 200);
  assert.deepEqual(body.toolsUsed, ['vscode.file.read', 'vscode.diagnostics']);
  assert.equal(toolCalls['vscode.file.read'], 1);
  assert.equal(toolCalls['vscode.diagnostics'], 1);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(toolCalls['vscode.file.apply_edit'] || 0, 0);
  assert.equal(toolCalls['vscode.file.propose_edit'] || 0, 0);
  assert.equal(modelInput.file.lineCount, sourceContent.split(/\r?\n/).length);
  // Pause/Stop abort support: the router also receives a task abort signal.
  assert.equal(modelOptions.temperature, 0);
  assert.equal(modelOptions.maxTokens, 2000);
  assert.ok(modelOptions.signal instanceof AbortSignal);
  assert.equal(
    modelInput.file.numberedSource,
    sourceContent.split(/\r?\n/).map((line, index) => `${index + 1} | ${line}`).join('\n')
  );

  assert.deepEqual(body.inspectionEvidence.diagnostics, [
    { file: TARGET_PATH, severity: 'error', message: 'Actual compiler issue', line: 7, source: 'typescript' }
  ]);
  assert.deepEqual(body.inspectionEvidence.codeFacts, [
    {
      lineStart: 1,
      lineEnd: 1,
      fact: 'The file declares a client component.',
      source: sourceContent.split(/\r?\n/)[0]
    }
  ]);
  const diagnosticSection = body.reply.split('## Confirmed code facts')[0];
  assert.match(diagnosticSection, /Actual compiler issue/);
  assert.match(diagnosticSection, /web\/app\/page\.tsx:7/);
  assert.doesNotMatch(diagnosticSection, /Invented diagnostic|Invented fact|Architectural/);
  assert.doesNotMatch(body.reply, /visible excerpt/i);
  assert.match(body.reply, /## Architectural suggestions/);
  assert.match(body.reply, /Lines 1-3: Consider isolating the top-level responsibility/);
});