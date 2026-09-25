// Task lifecycle state machine — full model coverage for the Chat Control
// Panel's server-authoritative store (tools/task-session.js).
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTaskStore, STATES, TRANSITIONS, ACTIONABLE, TERMINAL } = require('../tools/task-session');

let tasks;
beforeEach(() => { tasks = createTaskStore(); });

function startPlanningTask() {
  const session = tasks.create({ label: 'demo' });
  tasks.setInstruction(session.taskId, 'do the thing');
  tasks.beginPlanning(session.taskId);
  return session.taskId;
}

test('valid lifecycle: IDLE -> PLANNING -> WAITING -> PLANNING -> PAUSED -> PLANNING -> CANCELLED -> PLANNING -> COMPLETED', () => {
  const taskId = startPlanningTask();
  assert.equal(tasks.view(taskId).state, 'PLANNING');

  tasks.waitForApproval(taskId, '11111111-1111-1111-1111-111111111111');
  assert.equal(tasks.view(taskId).state, 'WAITING_FOR_APPROVAL');

  tasks.beginPlanning(taskId); // new instruction cycle invalidates waiting
  assert.equal(tasks.view(taskId).state, 'PLANNING');

  tasks.pause(taskId, 'user');
  assert.equal(tasks.view(taskId).state, 'PAUSED');

  tasks.resume(taskId);
  assert.equal(tasks.view(taskId).state, 'PLANNING');

  tasks.stop(taskId, 'user');
  assert.equal(tasks.view(taskId).state, 'CANCELLED');

  tasks.beginPlanning(taskId); // stopped task stays visible and retryable
  assert.equal(tasks.view(taskId).state, 'PLANNING');

  tasks.complete(taskId, 'done');
  assert.equal(tasks.view(taskId).state, 'COMPLETED');
});

test('every state named in the model is real and classified', () => {
  assert.equal(STATES.length, 10);
  for (const state of STATES) {
    assert.ok(ACTIONABLE.has(state) !== TERMINAL.has(state) ||
      ['PAUSING', 'PAUSED', 'CANCELLING'].includes(state), state);
  }
  // The transition table never references an unknown state.
  for (const [from, targets] of Object.entries(TRANSITIONS)) {
    assert.ok(STATES.includes(from), from);
    for (const to of targets) assert.ok(STATES.includes(to), to);
  }
});

test('invalid transitions throw (fail closed)', () => {
  const fresh = tasks.create({});
  assert.throws(() => tasks.pause(fresh.taskId), /Cannot pause a IDLE task/);
  assert.throws(() => tasks.resume(fresh.taskId), /Cannot resume a IDLE task/);
  assert.throws(() => tasks.complete(fresh.taskId), /Invalid task transition IDLE -> COMPLETED/);
  assert.throws(() => tasks.stop(fresh.taskId + 'x'), /Unknown task session/);

  const taskId = startPlanningTask();
  // PAUSED cannot jump straight back to WAITING_FOR_APPROVAL: the call
  // fails closed (no transition) instead of corrupting the state machine.
  tasks.pause(taskId);
  tasks.waitForApproval(taskId, 'id');
  assert.equal(tasks.view(taskId).state, 'PAUSED');
  assert.throws(() => tasks.resume(taskId + 'missing'), /Unknown task session/);
});

test('pause and stop are idempotent; terminal states are stable', () => {
  const taskId = startPlanningTask();
  tasks.pause(taskId);
  tasks.pause(taskId);
  tasks.pause(taskId);
  assert.equal(tasks.view(taskId).state, 'PAUSED');

  tasks.stop(taskId);
  tasks.stop(taskId);
  assert.equal(tasks.view(taskId).state, 'CANCELLED');

  const done = startPlanningTask();
  tasks.complete(done, 'ok');
  const before = tasks.view(done).updatedAt;
  tasks.stop(done); // terminal: nothing left to cancel, never corrupts
  assert.equal(tasks.view(done).state, 'COMPLETED');
  assert.equal(tasks.fail(done, 'late'), tasks.get(done)); // stays terminal
  assert.equal(tasks.view(done).state, 'COMPLETED');
  assert.ok(before);
});

test('canInitiateAction: actionable states allow, everything else fails closed', () => {
  const fresh = tasks.create({});
  assert.deepEqual(tasks.canInitiateAction(fresh.taskId), { allowed: true, state: 'IDLE', reason: 'active' });

  const planning = startPlanningTask();
  assert.equal(tasks.canInitiateAction(planning).allowed, true);

  tasks.waitForApproval(planning, 'approval');
  assert.equal(tasks.canInitiateAction(planning).allowed, true);

  tasks.pause(planning);
  const paused = tasks.canInitiateAction(planning);
  assert.equal(paused.allowed, false);
  assert.equal(paused.reason, 'Task is paused');

  tasks.stop(planning);
  const stopped = tasks.canInitiateAction(planning);
  assert.equal(stopped.allowed, false);
  assert.equal(stopped.reason, 'Task was stopped');

  const completed = startPlanningTask();
  tasks.complete(completed);
  assert.equal(tasks.canInitiateAction(completed).allowed, false);

  const failed = startPlanningTask();
  tasks.fail(failed, 'boom');
  assert.equal(tasks.canInitiateAction(failed).allowed, false);
  assert.match(tasks.canInitiateAction(failed).reason, /failed/);

  // Unknown session: fail closed, never "actionable by default".
  const unknown = tasks.canInitiateAction('does-not-exist');
  assert.deepEqual(unknown, { allowed: false, state: 'UNKNOWN', reason: 'Unknown task session' });
  assert.equal(tasks.canInitiateAction(undefined).allowed, false);
  assert.equal(tasks.canInitiateAction(null).allowed, false);
});

test('controls(state) derives every button the panel renders', () => {
  const session = tasks.create({});
  const idleControls = tasks.view(session.taskId).controls;
  assert.equal(idleControls.canStop, false);
  assert.equal(idleControls.canPause, false);
  assert.equal(idleControls.canResume, false);

  const taskId = startPlanningTask();
  const planningControls = tasks.view(taskId).controls;
  assert.equal(planningControls.canPause, true);
  assert.equal(planningControls.busy, true);
  assert.equal(planningControls.canStop, true);
  assert.equal(planningControls.canEdit, false);

  tasks.pause(taskId);
  const pausedControls = tasks.view(taskId).controls;
  assert.equal(pausedControls.canResume, true);
  assert.equal(pausedControls.canPause, false);
  assert.equal(pausedControls.canStop, true);
  assert.equal(pausedControls.canEdit, true);
  assert.equal(pausedControls.busy, false);

  tasks.stop(taskId);
  const stoppedControls = tasks.view(taskId).controls;
  assert.equal(stoppedControls.canResume, false);
  assert.equal(stoppedControls.canStop, false);
  assert.equal(stoppedControls.canEdit, true);

  tasks.beginPlanning(taskId);
  assert.equal(tasks.view(taskId).state, 'PLANNING');
  tasks.waitForApproval(taskId, 'bbbbbbbb-2222-2222-2222-222222222222');
  const waitingControls = tasks.view(taskId).controls;
  // Approval is not execution: it must not be represented as a running task.
  assert.equal(waitingControls.canPause, false);
  assert.equal(waitingControls.canStop, true);
  assert.equal(waitingControls.busy, false);

  // Composer actions stay available only where editing is safe; active work
  // and approval wait are represented by their dedicated controls.
  for (const controls of [idleControls, pausedControls, stoppedControls]) {
    assert.equal(controls.canSend, true);
    assert.equal(controls.canAttach, true);
    assert.equal(controls.canVoice, true);
    assert.equal(controls.canCopy, true);
    assert.equal(controls.canShare, true);
  }
  assert.equal(planningControls.canSend, false);
  assert.equal(planningControls.canAttach, false);
  assert.equal(planningControls.canVoice, false);
  assert.equal(waitingControls.canSend, false);
  assert.equal(waitingControls.canAttach, false);
  assert.equal(waitingControls.canVoice, false);
});

test('editInstruction: requires text, bumps authority revision, records history', () => {
  const taskId = startPlanningTask();
  const before = tasks.view(taskId);
  assert.equal(before.revision, 1);
  assert.equal(before.instructionHistory, 1);

  assert.throws(() => tasks.editInstruction(taskId, ''), /requires text/);
  assert.throws(() => tasks.editInstruction(taskId, '   '), /requires text/);

  tasks.editInstruction(taskId, 'do the other thing');
  const after = tasks.view(taskId);
  assert.equal(after.revision, 2);
  assert.equal(after.instruction, 'do the other thing');
  assert.equal(after.instructionHistory, 2);

  tasks.editInstruction(taskId, 'third instruction');
  assert.equal(tasks.view(taskId).revision, 3);
  assert.equal(tasks.authorityRevision(taskId), 3);
});

test('beginPlanning: terminal retry works, paused fails closed', () => {
  const taskId = startPlanningTask();
  tasks.stop(taskId);
  tasks.beginPlanning(taskId); // CANCELLED -> PLANNING (explicit retry)
  assert.equal(tasks.view(taskId).state, 'PLANNING');

  tasks.pause(taskId);
  tasks.beginPlanning(taskId); // PAUSED must NOT sneak into PLANNING
  assert.equal(tasks.view(taskId).state, 'PAUSED');
  assert.equal(tasks.canInitiateAction(taskId).allowed, false);
});

test('waitForApproval records the approval bound to the current revision', () => {
  const taskId = startPlanningTask();
  tasks.waitForApproval(taskId, 'aaaaaaaa-1111-1111-1111-111111111111');
  const view = tasks.view(taskId);
  assert.equal(view.state, 'WAITING_FOR_APPROVAL');
  assert.deepEqual(view.pendingApproval, {
    approvalId: 'aaaaaaaa-1111-1111-1111-111111111111',
    revision: 1
  });

  tasks.editInstruction(taskId, 'edited while waiting');
  // pendingApproval still references the OLD approval, now at revision 2 —
  // the mismatch is exactly what invalidates it at approve time.
  assert.equal(tasks.view(taskId).pendingApproval.revision, 1);
  assert.equal(tasks.view(taskId).revision, 2);
});

test('cancelled approvals and owned executions are recorded without duplicates', () => {
  const taskId = startPlanningTask();
  tasks.noteCancelledApproval(taskId, 'approval-1');
  tasks.noteCancelledApproval(taskId, 'approval-1');
  tasks.noteCancelledApproval(taskId, 'approval-2');
  tasks.noteOwnedExecution(taskId, 'exec-1');
  tasks.noteOwnedExecution(taskId, 'exec-1');
  const view = tasks.view(taskId);
  assert.deepEqual(view.cancelledApprovals, ['approval-1', 'approval-2']);
  assert.deepEqual(view.ownedExecutions, ['exec-1']);
  // Unknown session: notes are ignored, never throw.
  assert.equal(tasks.noteCancelledApproval('missing', 'x'), null);
  assert.equal(tasks.noteOwnedExecution('missing', 'x'), null);
});

test('bounded stores: sessions prune terminal first, events capped at 200', () => {
  const bounded = createTaskStore({ maxSessions: 5 });
  for (let i = 0; i < 12; i += 1) {
    const session = bounded.create({ label: 's' + i });
    bounded.setInstruction(session.taskId, 'work ' + i);
    bounded.beginPlanning(session.taskId);
    bounded.complete(session.taskId, 'done');
  }
  const keeper = bounded.create({ label: 'keeper' });
  assert.ok(bounded.get(keeper.taskId));
  assert.equal(bounded.view(keeper.taskId).state, 'IDLE');

  const taskId = startPlanningTask();
  for (let i = 0; i < 250; i += 1) tasks.editInstruction(taskId, 'instruction ' + i);
  assert.equal(tasks.get(taskId).events.length, 200);
  assert.equal(tasks.view(taskId).instructionHistory, 50);
  assert.equal(tasks.view(taskId).revision, 251);
});
