// Chat Control Panel — task lifecycle over the REAL /chat pipeline:
// J (pause between steps, edit-after-pause invalidating approvals) and
// K (stop cancels approvals, process cleanup evidence, retry) — real Action
// Gateway proposals, deterministic branches, zero model calls, zero spawns.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const nvidiaRouter = require('../nvidia-router');
const actionGateway = require('../tools/action-gateway');

let server;
let baseUrl;
let originalAskNvidia;
let originalExecuteTool;
let modelCalls;
let toolCallCounts;

before(async () => {
  originalAskNvidia = nvidiaRouter.askNvidia;
  nvidiaRouter.askNvidia = async (messages) => {
    modelCalls += 1;
    return { content: 'stub model reply ' + modelCalls, model: 'stub-model' };
  };

  originalExecuteTool = actionGateway.executeTool;
  toolCallCounts = {};
  actionGateway.executeTool = async (tool, args, context) => {
    toolCallCounts[tool] = (toolCallCounts[tool] || 0) + 1;
    return originalExecuteTool(tool, args, context);
  };

  const { app } = require('../server');
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  nvidiaRouter.askNvidia = originalAskNvidia;
  actionGateway.executeTool = originalExecuteTool;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  modelCalls = 0;
  toolCallCounts = {};
});

async function post(pathname, body) {
  const response = await fetch(baseUrl + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  return { status: response.status, body: await response.json() };
}

async function get(pathname) {
  const response = await fetch(baseUrl + pathname);
  return { status: response.status, body: await response.json() };
}

function postChat(body) {
  return post('/chat', body);
}

test('every /chat response carries the authoritative task view and controls', async () => {
  const created = await post('/task', { label: 'panel task' });
  assert.equal(created.status, 200);
  assert.equal(created.body.task.state, 'IDLE');
  assert.equal(created.body.task.controls.canPause, false);

  const chat = await postChat({ taskId: created.body.task.taskId, message: 'Hello Tom, are you there?' });
  assert.equal(chat.status, 200);
  assert.ok(chat.body.task, 'task view present');
  assert.equal(chat.body.task.taskId, created.body.task.taskId);
  assert.equal(chat.body.task.state, 'COMPLETED');
  assert.equal(typeof chat.body.task.controls, 'object');
  assert.equal(chat.body.task.controls.canSend, true);
  assert.equal(chat.body.task.controls.canPause, false, 'completed task offers no pause');
  assert.equal(chat.body.task.controls.canEdit, true, 'terminal task offers edit/retry');
  assert.match(chat.body.reply, /stub model reply/);
  assert.equal(modelCalls, 1);

  // No taskId supplied: server creates one and still returns it.
  const auto = await postChat({ message: 'Second conversation turn.' });
  assert.ok(auto.body.task && auto.body.task.taskId);
  assert.notEqual(auto.body.task.taskId, created.body.task.taskId);
  assert.equal(auto.body.task.state, 'COMPLETED');
});

test('J: pause between steps, edit-after-pause invalidates the old approval', async () => {
  const created = await post('/task', { label: 'J lifecycle' });
  const initial = created.body.task;
  const taskId = initial.taskId;
  assert.equal(initial.state, 'IDLE');

  // Step 1: real deterministic proposal -> WAITING_FOR_APPROVAL, no model.
  const proposed = await postChat({ taskId, message: 'Run npm run build' });
  assert.equal(proposed.status, 200);
  const firstApproval = proposed.body.approvalId;
  assert.ok(firstApproval, 'approval id returned');
  assert.match(proposed.body.reply, /Approval required for consequential execution/);
  assert.equal(proposed.body.task.state, 'WAITING_FOR_APPROVAL');
  assert.equal(proposed.body.task.controls.canPause, false, 'approval wait is not execution');
  assert.equal(modelCalls, 0, 'deterministic branch never reaches the model');

  // Step 2: PAUSE between steps.
  const paused = await post(`/task/${taskId}/pause`);
  assert.equal(paused.status, 200);
  assert.equal(paused.body.task.state, 'PAUSED');
  assert.equal(paused.body.task.controls.canResume, true);
  assert.equal(paused.body.task.controls.canPause, false);

  // Step 3: while paused, NOTHING is initiated — zero gateway, zero model.
  const approveCallsBefore = toolCallCounts['execution.approve'] || 0;
  const denied = await postChat({ taskId, message: `approve execution ${firstApproval}` });
  assert.equal(denied.status, 200);
  assert.match(denied.body.reply, /Task is paused/);
  assert.match(denied.body.reply, /No action was started/);
  assert.equal(denied.body.provider, 'tom-task-control');
  assert.equal(toolCallCounts['execution.approve'] || 0, approveCallsBefore, 'gateway never called');
  assert.equal(modelCalls, 0);

  // Also: plain messages on a paused task are refused the same way.
  const plain = await postChat({ taskId, message: 'Do something else entirely' });
  assert.equal(plain.body.provider, 'tom-task-control');
  assert.equal(modelCalls, 0);

  // Step 4: RESUME with an EDITED instruction = new authority revision.
  const resumed = await post(`/task/${taskId}/resume`, {
    instruction: 'Run npm run build and summarize the output'
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.task.state, 'PLANNING');
  assert.equal(resumed.body.task.revision, initial.revision + 1, 'revision bumped by edit');

  // Step 5: the OLD approval can never execute under the new revision.
  // (terminal.run proposals above are gateway calls, NOT spawns — what
  // matters is the count never GROWS on approve attempts.)
  const runCallsBeforeApprove = toolCallCounts['terminal.run'] || 0;
  const invalidated = await postChat({ taskId, message: `approve execution ${firstApproval}` });
  assert.equal(invalidated.status, 200);
  assert.match(invalidated.body.reply, /Approval invalidated by task edit/);
  assert.equal(modelCalls, 0, 'invalidation is deterministic, no model');
  assert.equal(toolCallCounts['terminal.run'] || 0, runCallsBeforeApprove, 'no execution initiated');

  // Step 6: a fresh proposal under the NEW revision is a different approval.
  const revisionBeforeRepropose = invalidated.body.task.revision;
  const reproposed = await postChat({ taskId, message: 'Run npm run build' });
  const secondApproval = reproposed.body.approvalId;
  assert.ok(secondApproval);
  assert.notEqual(secondApproval, firstApproval);
  assert.equal(reproposed.body.task.state, 'WAITING_FOR_APPROVAL');
  // Instruction text differs from the edited one -> one more authority bump.
  assert.equal(reproposed.body.task.revision, revisionBeforeRepropose + 1);

  const revisionBeforeReject = reproposed.body.task.revision;

  // Approval-continuation traffic must NOT bump the revision it approves.
  const rejected = await postChat({ taskId, message: `reject execution ${secondApproval}` });
  assert.equal(rejected.status, 200);
  assert.match(rejected.body.reply, /rejected/);
  assert.equal(rejected.body.task.state, 'COMPLETED');
  assert.equal(rejected.body.task.revision, revisionBeforeReject, 'continuation never bumps revision');
  assert.equal(modelCalls, 0);
});

test('K: stop cancels approvals with evidence, stopped task stays visible and retryable', async () => {
  const created = await post('/task', { label: 'K lifecycle' });
  const taskId = created.body.task.taskId;

  const proposed = await postChat({ taskId, message: 'Run npm run build' });
  const cancelledApproval = proposed.body.approvalId;
  assert.ok(cancelledApproval);
  assert.equal(proposed.body.task.state, 'WAITING_FOR_APPROVAL');

  // STOP: cancels the pending approval and records the evidence.
  const stopped = await post(`/task/${taskId}/stop`);
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.task.state, 'CANCELLED');
  assert.deepEqual(stopped.body.evidence.cancelledApprovals, [cancelledApproval]);
  assert.deepEqual(stopped.body.evidence.executionCleanup, [], 'nothing owned yet — honest empty cleanup');
  assert.deepEqual(stopped.body.task.cancelledApprovals, [cancelledApproval]);

  // Stopped task remains VISIBLE with its state and edit/retry controls.
  const visible = await get(`/task/${taskId}`);
  assert.equal(visible.status, 200);
  assert.equal(visible.body.task.state, 'CANCELLED');
  assert.equal(visible.body.task.controls.canEdit, true);
  assert.equal(visible.body.task.controls.canStop, false);
  assert.equal(visible.body.task.controls.canResume, false);

  // Approving on a stopped task: fail closed before ANY gateway call.
  const approveBefore = toolCallCounts['execution.approve'] || 0;
  const denied = await postChat({ taskId, message: `approve execution ${cancelledApproval}` });
  assert.match(denied.body.reply, /Task was stopped/);
  assert.equal(denied.body.provider, 'tom-task-control');
  assert.equal(toolCallCounts['execution.approve'] || 0, approveBefore, 'gateway untouched');
  assert.equal(modelCalls, 0);

  // RETRY: a new message on the stopped task starts a fresh cycle.
  const retried = await postChat({ taskId, message: 'Run npm run build' });
  const newApproval = retried.body.approvalId;
  assert.ok(newApproval, 'retry produced a fresh approval');
  assert.notEqual(newApproval, cancelledApproval);
  assert.equal(retried.body.task.state, 'WAITING_FOR_APPROVAL');

  // The CANCELLED approval can never be revived — consumed at cancel time.
  const runCallsBefore = toolCallCounts['terminal.run'] || 0;
  const revived = await postChat({ taskId, message: `approve execution ${cancelledApproval}` });
  assert.match(revived.body.reply, /Unknown or consumed approval/);
  assert.equal(toolCallCounts['terminal.run'] || 0, runCallsBefore, 'no execution initiated');
  assert.equal(modelCalls, 0);

  // Clean up the fresh approval without executing anything.
  const rejected = await postChat({ taskId, message: `reject execution ${newApproval}` });
  assert.match(rejected.body.reply, /rejected/);
  assert.equal(rejected.body.task.state, 'COMPLETED');
});

test('unknown sessions and invalid transitions fail closed', async () => {
  // Unknown task id on /chat -> 400 before anything happens.
  const unknown = await postChat({ taskId: 'no-such-task', message: 'hello' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /Unknown task session/);
  assert.equal(modelCalls, 0);

  // Unknown task id on the control endpoints -> 404.
  assert.equal((await get('/task/no-such-task')).status, 404);
  assert.equal((await post('/task/no-such-task/pause')).status, 404);
  assert.equal((await post('/task/no-such-task/resume')).status, 404);
  assert.equal((await post('/task/no-such-task/stop')).status, 404);
  assert.equal((await post('/task/no-such-task/edit', { instruction: 'x' })).status, 404);

  const created = await post('/task', {});
  const taskId = created.body.task.taskId;
  await postChat({ taskId, message: 'A plain completed turn.' });
  assert.equal((await post(`/task/${taskId}/resume`)).status, 409, 'cannot resume a completed task');
  assert.equal((await post(`/task/${taskId}/pause`)).status, 409, 'cannot pause a completed task');
  await postChat({ taskId, message: 'Run npm run build' });
  const firstPause = await post(`/task/${taskId}/pause`);
  assert.equal(firstPause.status, 200);
  const secondPause = await post(`/task/${taskId}/pause`);
  assert.equal(secondPause.status, 200, 'pause is idempotent');
  assert.equal(secondPause.body.task.state, 'PAUSED');
  await post(`/task/${taskId}/stop`);

  // Edit requires real text.
  const emptyEdit = await post(`/task/${taskId}/edit`, { instruction: '   ' });
  assert.equal(emptyEdit.status, 409);
  assert.match(emptyEdit.body.error, /requires text/);
});

test('instruction revisions: new text bumps, identical text does not', async () => {
  const created = await post('/task', {});
  const taskId = created.body.task.taskId;

  const first = await postChat({ taskId, message: 'First instruction text' });
  assert.equal(first.body.task.revision, 1, 'first instruction records without bump');

  const second = await postChat({ taskId, message: 'Completely different second text' });
  assert.equal(second.body.task.revision, 2, 'different text = new authority');

  const repeat = await postChat({ taskId, message: 'Completely different second text' });
  assert.equal(repeat.body.task.revision, 2, 'identical text never bumps');

  await post(`/task/${taskId}/stop`);
  const retryDifferent = await postChat({ taskId, message: 'Third instruction after stop' });
  assert.equal(retryDifferent.body.task.revision, 3, 'retry with new text bumps');
  assert.equal(retryDifferent.body.task.state, 'COMPLETED');
});