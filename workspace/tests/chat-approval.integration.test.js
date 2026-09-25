const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const agent = require('../agent');
const vscodeBridge = require('../plugins/vscode/vscode-bridge');
const actionGateway = require('../tools/action-gateway');
const editApprovalStore = require('../tools/edit-approval-store');
const taskEvidenceStore = require('../tools/task-evidence-store');
const nvidiaRouter = require('../nvidia-router');

const PROJECT_ID = 'drop';
const CLIENT_INSTANCE_ID = 'tom-test-client-chat-approval';
const FIXTURE_RELATIVE_PATH = '__tom_chat_approval_fixture.txt';
const FIXTURE_ABSOLUTE_PATH = path.join(agent.DROP_ROOT, FIXTURE_RELATIVE_PATH);
const REQUESTED_PATH = 'web/app/page.tsx';
const ORIGINAL_CONTENT = 'Drops worth opening\n';
const UPDATED_CONTENT = 'Drops worth discovering\n';

let connection;
let server;
let baseUrl;
let modelCalls = 0;
let toolCalls;
let successfulApplyCalls;
let terminalExitCode;
let originalAskNvidia;
let originalExecuteTool;
let detectUnauthorizedExecution;

before(async () => {
  originalAskNvidia = nvidiaRouter.askNvidia;
  nvidiaRouter.askNvidia = async () => {
    modelCalls += 1;
    throw new Error('NVIDIA must not run during approval continuation');
  };

  const serverModule = require('../server');
  const { app } = serverModule;
  detectUnauthorizedExecution = serverModule.findUnauthorizedExecutionAttempt;
  assert.equal(typeof detectUnauthorizedExecution, 'function');
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
    activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
    diagnostics: []
  });

  originalExecuteTool = actionGateway.executeTool;
  actionGateway.executeTool = async (tool, args) => {
    toolCalls[tool] = (toolCalls[tool] || 0) + 1;
    if (tool === 'terminal.run') {
      // Mirror production policy: only the exact allowlisted commands the
      // Drop package.json actually defines may proceed. Everything else is
      // denied BEFORE approval/process — same as command-policy.command().
      // Drop's web/package.json defines build+lint, never test.
      const allowed = args && (args.command === 'npm run build' || args.command === 'npm run lint');
      if (!allowed) {
        return { success: false, tool, error: 'Command is not allowlisted' };
      }
      return {
        success: true,
        tool,
        data: {
          command: args.command,
          cwd: path.join(agent.DROP_ROOT, args.cwd),
          exitCode: terminalExitCode,
          stdout: terminalExitCode === 0 ? 'build passed\n' : '',
          stderr: terminalExitCode === 0 ? '' : 'build failed\n',
          timedOut: false,
          durationMs: 25
        }
      };
    }
    const isolatedArgs = args && args.path === REQUESTED_PATH
      ? { ...args, path: FIXTURE_RELATIVE_PATH }
      : args;
    const result = await originalExecuteTool(tool, isolatedArgs);
    if (tool === 'vscode.file.apply_edit' && result.success) successfulApplyCalls += 1;
    return result;
  };
});

beforeEach(() => {
  editApprovalStore.resetForTests();
  taskEvidenceStore.resetForTests();
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, ORIGINAL_CONTENT, 'utf8');
  modelCalls = 0;
  toolCalls = {};
  successfulApplyCalls = 0;
  terminalExitCode = 0;
});

after(async () => {
  actionGateway.executeTool = originalExecuteTool;
  nvidiaRouter.askNvidia = originalAskNvidia;
  try {
    vscodeBridge.disconnect(PROJECT_ID, connection.sessionId, CLIENT_INSTANCE_ID);
  } catch {
    // best-effort cleanup
  }
  try { fs.unlinkSync(FIXTURE_ABSOLUTE_PATH); } catch { /* already removed */ }
  await new Promise((resolve) => server.close(resolve));
});

async function postChat(body) {
  const response = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('real browser approval payload applies once without Git or NVIDIA', async () => {
  const proposal = await originalExecuteTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'Drops worth opening', newText: 'Drops worth discovering' }]
  });
  assert.equal(proposal.success, true);

  const history = [
    {
      role: 'user',
      content: `Propose changing ${FIXTURE_RELATIVE_PATH}: "Drops worth opening" to "Drops worth discovering".`
    },
    {
      role: 'assistant',
      content:
        `Proposed edit for ${FIXTURE_RELATIVE_PATH} (not yet applied).\n` +
        `Approval ID: ${proposal.data.approvalId}\n\n` +
        `Reply with "approve edit ${proposal.data.approvalId}" to apply this exact change.`
    }
  ];

  const applied = await postChat({
    message: 'Approved. Apply the proposed change.',
    history
  });

  assert.equal(applied.status, 200);
  assert.equal(applied.body.provider, 'tom-action-gateway');
  assert.deepEqual(applied.body.toolsUsed, ['vscode.file.apply_edit', 'vscode.diagnostics']);
  assert.equal(toolCalls['vscode.file.apply_edit'], 1);
  assert.equal(successfulApplyCalls, 1);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), UPDATED_CONTENT);
  assert.match(applied.body.reply, /applied and verified/i);
  assert.match(applied.body.reply, /Drops worth discovering/);

  const replay = await postChat({
    message: 'Approved. Apply the proposed change.',
    history
  });

  assert.equal(replay.status, 200);
  assert.match(replay.body.reply, /already been used/i);
  assert.equal(successfulApplyCalls, 1);
  assert.equal(modelCalls, 0);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), UPDATED_CONTENT);
});

test('exact explicit replacement request proposes then applies without Git or NVIDIA', async () => {
  const request =
    'In the DROP project, open web/app/page.tsx and propose changing ' +
    '`Drops worth opening` to `Drops worth discovering`. ' +
    'Do not modify anything until I approve it.';

  const proposed = await postChat({ message: request, history: [] });

  assert.equal(proposed.status, 200);
  assert.equal(proposed.body.provider, 'tom-action-gateway');
  assert.match(proposed.body.approvalId, /^[0-9a-f-]{36}$/i);
  assert.match(proposed.body.reply, new RegExp(proposed.body.approvalId));
  assert.equal(toolCalls['vscode.file.read'], 1);
  assert.equal(toolCalls['vscode.file.propose_edit'], 1);
  assert.equal(toolCalls['vscode.file.apply_edit'] || 0, 0);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);

  const browserHistory = [
    { role: 'user', content: request },
    {
      role: 'assistant',
      content: proposed.body.reply,
      approvalId: proposed.body.approvalId
    }
  ];
  const applied = await postChat({ message: 'Approved', history: browserHistory });

  assert.equal(applied.status, 200);
  assert.equal(applied.body.provider, 'tom-action-gateway');
  assert.equal(toolCalls['vscode.file.apply_edit'], 1);
  assert.equal(successfulApplyCalls, 1);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
  const reread = fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8');
  assert.equal(reread.includes('Drops worth discovering'), true);
  assert.equal(reread.includes('Drops worth opening'), false);
  assert.match(applied.body.reply, /applied and verified/i);
});

test('explicit replacement does not propose when oldText is absent', async () => {
  const response = await postChat({
    message:
      'In the DROP project, open web/app/page.tsx and propose changing ' +
      '`Text that is not present` to `Replacement text`. Do not modify anything until I approve it.',
    history: []
  });

  assert.equal(response.status, 200);
  assert.match(response.body.reply, /was not found/i);
  assert.equal(toolCalls['vscode.file.read'], 1);
  assert.equal(toolCalls['vscode.file.propose_edit'] || 0, 0);
  assert.equal(toolCalls['vscode.file.apply_edit'] || 0, 0);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

test('exact plain-text replacement request proposes deterministically', async () => {
  const response = await postChat({
    message:
      'In the DROP project, open web/app/page.tsx and propose changing ' +
      'Drops worth opening to Drops worth discovering. ' +
      'Do not modify anything until I approve it.',
    history: []
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'tom-action-gateway');
  assert.match(response.body.approvalId, /^[0-9a-f-]{36}$/i);
  assert.match(response.body.reply, new RegExp(response.body.approvalId));
  assert.equal(toolCalls['vscode.file.read'], 1);
  assert.equal(toolCalls['vscode.file.propose_edit'], 1);
  assert.equal(toolCalls['vscode.file.apply_edit'] || 0, 0);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

test('verification after an approved edit uses terminal.run without Git or NVIDIA', async () => {
  const request =
    'In the DROP project, open web/app/page.tsx and propose changing ' +
    '`Drops worth opening` to `Drops worth discovering`, and make sure the build still passes. ' +
    'Do not modify anything until I approve it.';
  const proposed = await postChat({ message: request, history: [] });
  assert.equal(proposed.status, 200);
  assert.equal(toolCalls['terminal.run'] || 0, 0);

  const applied = await postChat({
    message: 'Approved',
    history: [
      { role: 'user', content: request },
      { role: 'assistant', content: proposed.body.reply, approvalId: proposed.body.approvalId }
    ]
  });

  assert.equal(applied.status, 200);
  assert.equal(toolCalls['vscode.file.apply_edit'], 1);
  assert.equal(toolCalls['terminal.run'], 1);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
  assert.equal(applied.body.verification.exitCode, 0);
  assert.match(applied.body.reply, /Verification passed: npm run build/);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), UPDATED_CONTENT);
});

test('unused-code cleanup uses exact diagnostic-backed imports then builds only after approval', async () => {
  const pageFixture = [
    "'use client';",
    'import {',
    '  Dialog,',
    '  DialogDescription,',
    '  DialogHeader,',
    "} from '@/components/ui/dialog';",
    "import ClubroomProfile from '@/components/clubrooms/clubroom-profile';",
    '',
    'export default function Page() {',
    '  return <Dialog />;',
    '}',
    ''
  ].join('\n');
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, pageFixture, 'utf8');
  vscodeBridge.heartbeat(PROJECT_ID, {
    sessionId: connection.sessionId,
    clientInstanceId: CLIENT_INSTANCE_ID,
    activeFile: path.join(agent.DROP_ROOT, REQUESTED_PATH),
    diagnostics: [
      { file: path.join(agent.DROP_ROOT, REQUESTED_PATH), severity: 'hint', message: "'DialogDescription' is declared but its value is never read.", line: 4, source: 'ts' },
      { file: path.join(agent.DROP_ROOT, REQUESTED_PATH), severity: 'hint', message: "'ClubroomProfile' is declared but its value is never read.", line: 7, source: 'ts' }
    ]
  });
  const request = 'Clean up the unused code in web/app/page.tsx, then verify diagnostics and make sure the build passes.';

  const proposed = await postChat({ message: request, history: [] });

  assert.equal(proposed.status, 200);
  assert.equal(proposed.body.provider, 'tom-action-gateway');
  assert.match(proposed.body.approvalId, /^[0-9a-f-]{36}$/i);
  assert.equal(toolCalls['vscode.file.read'], 1);
  assert.equal(toolCalls['vscode.diagnostics'], 1);
  assert.equal(toolCalls['vscode.file.propose_edit'], 1);
  assert.equal(toolCalls['vscode.file.apply_edit'] || 0, 0);
  assert.equal(toolCalls['terminal.run'] || 0, 0);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), pageFixture);

  const applied = await postChat({
    message: 'Approved',
    history: [
      { role: 'user', content: request },
      { role: 'assistant', content: proposed.body.reply, approvalId: proposed.body.approvalId }
    ]
  });

  assert.equal(applied.status, 200);
  assert.equal(toolCalls['vscode.file.apply_edit'], 1);
  assert.equal(toolCalls['terminal.run'], 1);
  assert.equal(modelCalls, 0);
  const updated = fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8');
  assert.equal(updated.includes('DialogDescription'), false);
  assert.equal(updated.includes('ClubroomProfile'), false);
  assert.equal(updated.includes('return <Dialog />;'), true);
  assert.match(applied.body.reply, /Verification passed: npm run build/);
});

test('exact post-edit verification uses stored applied/build evidence without writing or rerunning build', async () => {
  const pageFixture = [
    "'use client';",
    'import {',
    '  Dialog,',
    '  DialogDescription,',
    "} from '@/components/ui/dialog';",
    '',
    'export default function Page() {',
    '  return <Dialog />;',
    '}',
    ''
  ].join('\n');
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, pageFixture, 'utf8');
  vscodeBridge.heartbeat(PROJECT_ID, {
    sessionId: connection.sessionId,
    clientInstanceId: CLIENT_INSTANCE_ID,
    activeFile: path.join(agent.DROP_ROOT, REQUESTED_PATH),
    diagnostics: [
      { file: path.join(agent.DROP_ROOT, REQUESTED_PATH), severity: 'hint', message: "'DialogDescription' is declared but its value is never read.", line: 4, source: 'ts' }
    ]
  });
  const cleanupRequest = 'Clean up the unused code in web/app/page.tsx, then verify diagnostics and make sure the build passes.';
  const proposed = await postChat({ message: cleanupRequest, history: [] });
  const applied = await postChat({
    message: 'Approved',
    history: [
      { role: 'user', content: cleanupRequest },
      { role: 'assistant', content: proposed.body.reply, approvalId: proposed.body.approvalId }
    ]
  });
  assert.equal(applied.body.verification.exitCode, 0);
  taskEvidenceStore.recordAppliedTask({
    ...taskEvidenceStore.getLatestByPath(FIXTURE_RELATIVE_PATH),
    path: REQUESTED_PATH
  });

  const beforeVerification = { ...toolCalls };
  const verifyResponse = await postChat({
    message:
      'Verify the cleanup you just applied to web/app/page.tsx. Tell me exactly what changed, ' +
      'run VS Code diagnostics for that file, and report the build result from the completed verification. ' +
      'Do not make any additional changes.',
    history: []
  });

  assert.equal(verifyResponse.status, 200);
  assert.equal(verifyResponse.body.provider, 'tom-action-gateway');
  assert.deepEqual(verifyResponse.body.toolsUsed, ['vscode.diagnostics']);
  assert.equal(toolCalls['vscode.diagnostics'], (beforeVerification['vscode.diagnostics'] || 0) + 1);
  assert.equal(toolCalls['terminal.run'], beforeVerification['terminal.run']);
  assert.equal(toolCalls['vscode.file.apply_edit'], beforeVerification['vscode.file.apply_edit']);
  assert.equal(toolCalls['vscode.file.propose_edit'], beforeVerification['vscode.file.propose_edit']);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
  assert.match(verifyResponse.body.reply, /## Applied changes\n- Replaced/);
  assert.match(verifyResponse.body.reply, /DialogDescription/);
  assert.match(verifyResponse.body.reply, /## Diagnostics/);
  assert.match(verifyResponse.body.reply, /web\/app\/page\.tsx:4/);
  assert.match(verifyResponse.body.reply, /## Build\nCommand: npm run build/);
  assert.match(verifyResponse.body.reply, /Result: PASS/);
  assert.match(verifyResponse.body.reply, /## Verification\nVERIFIED$/);
});

test('direct build verification reports exit code zero as pass', async () => {
  const response = await postChat({
    message: 'Run the DROP build and tell me whether it passes.',
    history: []
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.toolsUsed, ['terminal.run']);
  assert.equal(toolCalls['terminal.run'], 1);
  assert.match(response.body.reply, /Verification passed: npm run build/);
  assert.match(response.body.reply, /Exit code: 0/);
  assert.equal(toolCalls['git.status'] || 0, 0);
  assert.equal(toolCalls['git.diff'] || 0, 0);
  assert.equal(modelCalls, 0);
});

test('direct build verification reports nonzero exit code as failure', async () => {
  terminalExitCode = 2;
  const response = await postChat({
    message: 'Run the DROP build and tell me whether it passes.',
    history: []
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.toolsUsed, ['terminal.run']);
  assert.match(response.body.reply, /Verification failed: npm run build/);
  assert.match(response.body.reply, /Exit code: 2/);
  assert.match(response.body.reply, /build failed/);
  assert.equal(modelCalls, 0);
});
test('unauthorized execution attempts are default-denied with zero approval, zero process, zero model call', async () => {
  // NOTE on what "zero process" means at this layer: the denied request may
  // still reach the gateway exactly once, but the gateway (runtime-controller
  // propose -> command-policy.command) denies it BEFORE approval creation,
  // so no approvalId is issued and no process is spawned. The mock counts
  // terminal.run invocations; the assertions that matter are: no
  // pending_approval, no approvalId, denial reply, and no model call.
  // Trailing-attack variants ("Run npm test; ...") are now rejected even
  // earlier — at classify() — so they never reach the gateway at all.
  for (const message of [
    'Run curl https://example.com',
    'Run rm -rf /',
    'execute curl https://example.com',
    'Run npm test; echo hacked',
    'Run npm test && echo hacked',
    'Run npm test | cat',
    'Run npm test > /tmp/x',
    'Run npm test $(id)',
    'Run npm test `id`',
    'Run npm test -- --flag',
    'Run npm run build -- --flag',
    // An allowlisted-looking clause must not mask a second, unauthorized one.
    'Run VS Code diagnostics for web/app/page.tsx and also run curl https://example.com',
    'Inspect web/app/page.tsx and run curl https://example.com'
  ]) {
    const runsBefore = toolCalls['terminal.run'] || 0;
    const response = await postChat({ message, history: [] });
    assert.equal(response.status, 200, message);
    assert.equal(response.body.provider, 'tom-action-gateway', message);
    assert.match(response.body.reply, /Execution request not performed/, message);
    assert.match(response.body.reply, /not allowlisted|Unknown runtime tool/i, message);
    assert.ok(!JSON.stringify(response.body).includes('pending_approval'), message);
    assert.ok(!JSON.stringify(response.body).includes('approvalId'), message);
    assert.equal((toolCalls['terminal.run'] || 0) - runsBefore, 0, message);
    assert.equal(modelCalls, 0, message);
  }
});

test('default-deny detects unclassified execution clauses but never read-only inspection phrasing', () => {
  // Denied: a command-looking target that did not classify to a validated tool.
  for (const message of [
    'Run curl https://example.com',
    'execute curl https://example.com',
    'Run rm -rf /',
    'Run npm install',
    'Inspect web/app/page.tsx and run curl https://example.com',
    'Summarize the repo. Then run ./deploy.sh now.',
    'Run the checks you already have evidence for.',
    'Run VS Code diagnostics for web/app/page.tsx and also run curl https://example.com'
  ]) {
    assert.equal(typeof detectUnauthorizedExecution(message), 'string', message);
  }

  // Allowed: ordinary language, read-only TOM surfaces, and approval wording.
  for (const message of [
    'Inspect web/app/page.tsx completely and run VS Code diagnostics for it.',
    'Open web/app/page.tsx and run diagnostics for it.',
    'What does this project do?',
    'approve execution 11111111-1111-1111-1111-111111111111'
  ]) {
    assert.equal(detectUnauthorizedExecution(message), null, message);
  }
});


test('execution approval wording routes to the execution path, never the edit path or the model', async () => {
  // Phase 1 regression: the live rejection that originally reached approval
  // creation ("reject execution <approvalId>"). It must be owned by the
  // execution path — deterministic reply, no edit approval, no model call.
  for (const message of [
    'reject execution f72520c3-d178-4ff9-89f1-4e3082bb1006',
    'approve execution f72520c3-d178-4ff9-89f1-4e3082bb1006'
  ]) {
    const response = await postChat({ message, history: [] });
    assert.equal(response.status, 200, message);
    assert.equal(response.body.provider, 'tom-action-gateway', message);
    assert.match(response.body.reply, /Execution request not performed/, message);
    assert.match(response.body.reply, /Unknown or consumed approval/, message);
    assert.ok(!response.body.reply.includes('Edit not applied'), message);
    assert.ok(!JSON.stringify(response.body).includes('pending_approval'), message);
    assert.equal(toolCalls['vscode.file.apply_edit'] || 0, 0, message);
    assert.equal(modelCalls, 0, message);
  }
});

test('missing package script is rejected before approval with zero model call', async () => {
  const terminalRunsBefore = toolCalls['terminal.run'] || 0;
  const response = await postChat({ message: 'Run npm test', history: [] });
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'tom-action-gateway');
  assert.match(response.body.reply, /Execution request not performed/);
  assert.ok(!JSON.stringify(response.body).includes('pending_approval'));
  // The denied request still reaches the gateway exactly once (which denies
  // it), but creates zero approval and spawns zero process.
  assert.equal((toolCalls['terminal.run'] || 0) - terminalRunsBefore, 1);
  assert.ok(!JSON.stringify(response.body).includes('approvalId'));
  assert.equal(modelCalls, 0);
});

test('discovery wording performs terminal.discover only with zero model call', async () => {
  const response = await postChat({
    message: 'First discover the existing test commands. Do not guess npm test.',
    history: []
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.provider, 'tom-action-gateway');
  assert.deepEqual(response.body.toolsUsed, ['terminal.discover']);
  assert.equal(toolCalls['terminal.run'] || 0, 0);
  assert.equal(modelCalls, 0);
});