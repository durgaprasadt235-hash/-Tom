const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createExecutionPlan, planGitTools, planVerification, planPostEditVerification, planExplicitReplacement, planEditApproval } = require('../tools/chat-tool-planner');
const { MAX_HISTORY_MESSAGES, sanitizeAndBoundHistory, findPendingApprovalId, executePlan } = require('../tools/agent-runtime');

test('active VS Code file error check plans active file and diagnostics only', () => {
  const plan = createExecutionPlan('In the DROP project, tell me which file is currently open in VS Code and check whether it has any errors. Do not modify anything.');
  assert.equal(plan.intent, 'inspect_vscode_diagnostics');
  assert.deepEqual(plan.steps, [
    { tool: 'vscode.file.active', args: {}, riskLevel: 'read' },
    { tool: 'vscode.diagnostics', args: {}, riskLevel: 'read' }
  ]);
  assert.equal(plan.steps.some((step) => step.tool.startsWith('git.')), false);
  assert.equal(plan.steps.some((step) => step.tool === 'vscode.file.read'), false);
});

test('ordinary non-Git changes, status, and history wording invokes no Git tools', () => {
  assert.deepEqual(planGitTools('What changes would improve this explanation?'), []);
  assert.deepEqual(planGitTools('What is the current service status?'), []);
  assert.deepEqual(planGitTools('Tell me the history of this design idea'), []);
});

test('explicit Git requests still select their corresponding tools', () => {
  assert.deepEqual(planGitTools('Show the Git status'), ['git.status', 'git.diff']);
  assert.deepEqual(planGitTools('Which repository branch is active?'), ['git.branch']);
  assert.deepEqual(planGitTools('Show recent commits'), ['git.log']);
  assert.deepEqual(planGitTools('Show the git diff'), ['git.diff']);
});

test('old Git conversation history cannot cause Git execution on an unrelated request', async () => {
  const history = sanitizeAndBoundHistory([
    { role: 'user', content: 'Show the Git status' },
    { role: 'assistant', content: 'The repository has modified files.' }
  ]);
  const plan = createExecutionPlan('check the active VS Code file for errors');
  const calls = [];
  const evidence = await executePlan(plan, async (tool, args) => {
    calls.push({ tool, args });
    return { success: true, data: tool === 'vscode.file.active' ? { available: true, path: 'web/app/page.tsx' } : { diagnostics: [] } };
  });

  assert.equal(history.length, 2);
  assert.deepEqual(calls.map((call) => call.tool), ['vscode.file.active', 'vscode.diagnostics']);
  assert.equal(evidence.some((item) => item.tool.startsWith('git.')), false);
});

test('chat history is sanitized and bounded to recent turns', () => {
  const history = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message ${index}`
  }));
  history.unshift({ role: 'tool', content: 'untrusted tool output' });
  const bounded = sanitizeAndBoundHistory(history);
  assert.equal(bounded.length, MAX_HISTORY_MESSAGES);
  assert.equal(bounded[0].content, 'message 5');
  assert.equal(bounded.some((item) => item.role === 'tool'), false);
});

test('normal chat and unapproved write wording never produce a write step', () => {
  assert.deepEqual(createExecutionPlan('hello').steps, []);
  assert.equal(createExecutionPlan('modify the active file now').steps.some((step) => step.riskLevel !== 'read'), false);
  assert.equal(createExecutionPlan('apply this edit').steps.some((step) => step.tool === 'vscode.file.apply_edit'), false);
});

test('contextual approval phrases resolve only a persisted pending approval ID', () => {
  const approvalId = '12345678-1234-4234-8234-123456789abc';
  const history = sanitizeAndBoundHistory([
    { role: 'assistant', content: 'Proposed edit awaiting approval.', approvalId }
  ]);
  const pendingApprovalId = findPendingApprovalId(history);

  for (const message of ['approved', 'Approved. Apply the proposed change.', 'apply it', 'yes apply']) {
    assert.deepEqual(planEditApproval(message, pendingApprovalId), { approvalId });
  }
  assert.equal(planEditApproval('do not apply it', pendingApprovalId), null);
  assert.equal(planEditApproval('apply it', null), null);
});

test('exact live replacement sentence parses into path, oldText, and newText', () => {
  const message =
    'In the DROP project, open web/app/page.tsx and propose changing ' +
    '`Drops worth opening` to `Drops worth discovering`. ' +
    'Do not modify anything until I approve it.';

  assert.deepEqual(planExplicitReplacement(message), {
    path: 'web/app/page.tsx',
    oldText: 'Drops worth opening',
    newText: 'Drops worth discovering'
  });
});

test('exact plain-text live replacement sentence parses conservatively', () => {
  const message =
    'In the DROP project, open web/app/page.tsx and propose changing ' +
    'Drops worth opening to Drops worth discovering. ' +
    'Do not modify anything until I approve it.';

  assert.deepEqual(planExplicitReplacement(message), {
    path: 'web/app/page.tsx',
    oldText: 'Drops worth opening',
    newText: 'Drops worth discovering'
  });
});

test('ambiguous plain-text replacement is not guessed', () => {
  assert.equal(
    planExplicitReplacement(
      'Open web/app/page.tsx and propose changing one to two to three. Do not modify anything.'
    ),
    null
  );
});

test('verification intent maps only to approved command definitions', () => {
  assert.deepEqual(planVerification('Run the DROP build and tell me whether it passes.'), {
    command: 'npm run build',
    cwd: 'web'
  });
  assert.deepEqual(planVerification('Please run npm test'), { command: 'npm test', cwd: 'web' });
  assert.deepEqual(planVerification('Run npm run lint'), { command: 'npm run lint', cwd: 'web' });
  assert.equal(planVerification('Run curl and tell me the result'), null);
});

test('combined edit and build request includes read-only terminal verification', () => {
  const plan = createExecutionPlan('Clean up unused code in web/app/page.tsx and make sure the build still passes.');
  assert.equal(plan.steps.some((step) => step.tool === 'terminal.run' && step.args.command === 'npm run build'), true);
  assert.equal(plan.steps.some((step) => step.riskLevel !== 'read'), false);
});

test('post-edit verification distinguishes stored and fresh build evidence', () => {
  assert.deepEqual(
    planPostEditVerification(
      'Verify the cleanup you just applied to web/app/page.tsx. Tell me exactly what changed, run VS Code diagnostics for that file, and report the build result from the completed verification. Do not make any additional changes.'
    ),
    { path: 'web/app/page.tsx', buildMode: 'stored' }
  );
  assert.deepEqual(
    planPostEditVerification('Verify the edit to web/app/page.tsx and rerun the build.'),
    { path: 'web/app/page.tsx', buildMode: 'fresh' }
  );
});