// Explicit TOM task lifecycle.
//
// The chat control panel (Pause / Resume / Stop / Edit-after-pause) is NOT a
// set of unrelated booleans: every request belongs to a task session whose
// state transitions are validated here. Invalid or unknown transitions throw,
// so a caller can never move a task into an impossible state, and the control
// surface only ever reflects a state the model actually allows.
//
// Fail-closed rules:
//   * an unknown session or unknown state is treated as "not actionable";
//   * a PAUSED / PAUSING / CANCELLING / CANCELLED / COMPLETED / FAILED session
//     may NOT initiate a new tool or action;
//   * STOP is idempotent (a cancelled task stays cancelled, never corrupt);
//   * editing an instruction while paused/stopped creates a NEW authority
//     revision, which invalidates approvals bound to the previous revision.
const crypto = require('node:crypto');

const STATES = Object.freeze(['IDLE', 'PLANNING', 'WAITING_FOR_APPROVAL', 'RUNNING', 'PAUSING',
  'PAUSED', 'CANCELLING', 'CANCELLED', 'COMPLETED', 'FAILED']);

// Allowed transitions. Anything absent is invalid and fails closed.
const TRANSITIONS = Object.freeze({
  IDLE: ['PLANNING', 'RUNNING', 'CANCELLING'],
  PLANNING: ['RUNNING', 'WAITING_FOR_APPROVAL', 'PAUSING', 'CANCELLING', 'COMPLETED', 'FAILED'],
  WAITING_FOR_APPROVAL: ['PLANNING', 'RUNNING', 'PAUSING', 'CANCELLING', 'COMPLETED', 'FAILED'],
  RUNNING: ['PLANNING', 'WAITING_FOR_APPROVAL', 'PAUSING', 'CANCELLING', 'COMPLETED', 'FAILED'],
  PAUSING: ['PAUSED', 'CANCELLING', 'FAILED'],
  PAUSED: ['RUNNING', 'PLANNING', 'CANCELLING', 'COMPLETED', 'FAILED'],
  CANCELLING: ['CANCELLED', 'FAILED'],
  // A stopped/finished task stays visible and retryable, but only as NEW work
  // (a fresh PLANNING/RUNNING cycle with recalculated authority).
  CANCELLED: ['PLANNING', 'RUNNING'],
  COMPLETED: ['PLANNING', 'RUNNING'],
  FAILED: ['PLANNING', 'RUNNING']
});

const ACTIONABLE = new Set(['IDLE', 'PLANNING', 'RUNNING', 'WAITING_FOR_APPROVAL']);
const ACTIVE = new Set(['PLANNING', 'RUNNING', 'WAITING_FOR_APPROVAL']);
const TERMINAL = new Set(['CANCELLED', 'COMPLETED', 'FAILED']);

const MAX_SESSIONS = 200;
const MAX_INSTRUCTIONS = 50;
const MAX_EVENTS = 200;


function createTaskStore({ now = () => Date.now(), maxSessions = MAX_SESSIONS } = {}) {
  const sessions = new Map();
  const stamp = () => new Date(now()).toISOString();

  function prune() {
    if (sessions.size <= maxSessions) return;
    for (const [id, session] of sessions) {
      if (sessions.size <= maxSessions) break;
      if (TERMINAL.has(session.state)) sessions.delete(id);
    }
  }

  function record(session, type, detail) {
    session.events.push({ at: stamp(), type, state: session.state, ...(detail ? { detail } : {}) });
    if (session.events.length > MAX_EVENTS) session.events.splice(0, session.events.length - MAX_EVENTS);
  }

  // The UI derives button availability from THIS, never from local booleans.
  // Active work replaces the normal composer actions; PAUSED remains editable.
  function controls(state) {
    const composerReady = ['IDLE', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(state);
    const working = ['PLANNING', 'RUNNING', 'PAUSING', 'CANCELLING'].includes(state);
    return { canSend: composerReady, canAttach: composerReady, canVoice: composerReady,
      canPause: state === 'PLANNING' || state === 'RUNNING', canResume: state === 'PAUSED',
      canStop: working || state === 'PAUSED' || state === 'WAITING_FOR_APPROVAL',
      canEdit: state === 'PAUSED' || TERMINAL.has(state) || state === 'CANCELLING',
      canCopy: true, canShare: true, busy: working };
  }

  function view(session) {
    if (!session) return null;
    return { taskId: session.taskId, label: session.label, state: session.state,
      revision: session.revision, createdAt: session.createdAt, updatedAt: session.updatedAt,
      instruction: session.instruction, instructionHistory: session.instructions.length,
      cancelledApprovals: [...session.cancelledApprovals], ownedExecutions: [...session.ownedExecutions],
      pendingApproval: session.pendingApproval ? { approvalId: session.pendingApproval.approvalId, revision: session.pendingApproval.revision } : null,
      lastError: session.lastError, actionable: ACTIONABLE.has(session.state), openApp: null, controls: controls(session.state) };
  }

  function transition(session, next, detail) {
    if (!STATES.includes(next)) throw new Error('Unknown task state: ' + next);
    const allowed = TRANSITIONS[session.state] || [];
    if (!allowed.includes(next)) throw new Error(`Invalid task transition ${session.state} -> ${next}`);
    session.state = next;
    session.updatedAt = stamp();
    record(session, 'transition', detail);
    return session;
  }

  function create({ label = null, taskId = null } = {}) {
    prune();
    const id = taskId || crypto.randomUUID();
    if (sessions.has(id)) return sessions.get(id);
    const session = { taskId: id, label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : null,
      state: 'IDLE', revision: 1, instruction: null, instructions: [], cancelledApprovals: [],
      ownedExecutions: [], pendingApproval: null, lastError: null, createdAt: stamp(), updatedAt: stamp(), events: [] };
    record(session, 'created');
    sessions.set(id, session);
    return session;
  }

  function get(taskId) {
    return typeof taskId === 'string' ? sessions.get(taskId) || null : null;
  }
  function require_(taskId) {
    const session = get(taskId);
    if (!session) throw new Error('Unknown task session');
    return session;
  }


  // Records the instruction text for the active revision. Called for the
  // message being executed NOW, so approvals are always bound to the
  // instruction the user actually sent.
  function setInstruction(taskId, text) {
    const session = require_(taskId);
    const value = String(text || '').trim();
    session.instruction = value || session.instruction;
    const last = session.instructions[session.instructions.length - 1];
    if (value && (!last || last.text !== value)) {
      session.instructions.push({ revision: session.revision, text: value, at: stamp() });
      if (session.instructions.length > MAX_INSTRUCTIONS) session.instructions.splice(0, session.instructions.length - MAX_INSTRUCTIONS);
    }
    session.updatedAt = stamp();
    return session;
  }

  // EDIT AFTER PAUSE / STOP. The edited instruction is NEW USER AUTHORITY for
  // future actions; already-completed actions are not undone. The revision bump
  // makes every approval bound to the previous revision stale.
  function editInstruction(taskId, text) {
    const session = require_(taskId);
    const value = String(text || '').trim();
    if (!value) throw new Error('An edited instruction requires text');
    session.revision += 1;
    session.instruction = value;
    session.instructions.push({ revision: session.revision, text: value, at: stamp() });
    if (session.instructions.length > MAX_INSTRUCTIONS) session.instructions.splice(0, session.instructions.length - MAX_INSTRUCTIONS);
    session.updatedAt = stamp();
    record(session, 'instruction_edited', 'revision ' + session.revision);
    return session;
  }

  function beginPlanning(taskId) {
    const session = require_(taskId);
    if (session.state === 'PLANNING') return session;
    // IDLE, active work, AND a finished-but-visible task may (re)enter
    // PLANNING (terminal states are explicit retries — see TRANSITIONS).
    // PAUSED/PAUSING/CANCELLING fail closed: only their own exits apply.
    if (!ACTIONABLE.has(session.state) && !TERMINAL.has(session.state)) return session;
    return transition(session, 'PLANNING');
  }
  function waitForApproval(taskId, approvalId, kind = 'runtime') {
    const session = require_(taskId);
    // Remember WHICH approval this authority revision is waiting on, so a
    // later instruction edit or Stop can invalidate/cancel it precisely.
    if (typeof approvalId === 'string' && approvalId) {
      // `kind` records WHICH store owns this approval (runtime vs edit) so a
      // later bare "approve" can be routed deterministically — never guessed,
      // never narrated by the model.
      session.pendingApproval = { approvalId, revision: session.revision, at: stamp(),
        kind: kind === 'edit' ? 'edit' : 'runtime' };
      session.updatedAt = stamp();
    }
    if (session.state === 'WAITING_FOR_APPROVAL') return session;
    if (!ACTIONABLE.has(session.state)) return session;
    return transition(session, 'WAITING_FOR_APPROVAL', approvalId || null);
  }
  function complete(taskId, outcome) {
    const session = require_(taskId);
    if (TERMINAL.has(session.state)) return session;
    // A completed task has NOTHING pending: the approval was dispatched,
    // rejected, or never existed. Stale bookkeeping here used to leave
    // orphaned pendingApproval entries on completed tasks.
    session.pendingApproval = null;
    return transition(session, 'COMPLETED', outcome || null);
  }
  function fail(taskId, message) {
    const session = require_(taskId);
    session.lastError = typeof message === 'string' ? message.slice(0, 300) : 'task failed';
    if (TERMINAL.has(session.state)) return session;
    return transition(session, 'FAILED', session.lastError);
  }

  // PAUSE: stop initiating the NEXT action. RUNNING/WAITING_FOR_APPROVAL ->
  // PAUSING -> PAUSED. An atomic operation may reach its safe boundary first,
  // so PAUSING is recorded as a real transition before PAUSED.
  function pause(taskId, reason = 'user') {
    const session = require_(taskId);
    if (session.state === 'PAUSED') return session;                 // idempotent
    if (!ACTIVE.has(session.state)) throw new Error(`Cannot pause a ${session.state} task`);
    transition(session, 'PAUSING', reason);
    return transition(session, 'PAUSED', 'safe boundary');
  }
  function resume(taskId) {
    const session = require_(taskId);
    if (session.state === 'PAUSED') return transition(session, 'PLANNING', 'resume');
    if (session.state === 'PLANNING') return session;                // idempotent
    throw new Error(`Cannot resume a ${session.state} task`);
  }

  // STOP: cancel the current task safely and idempotently.
  function stop(taskId, reason = 'user') {
    const session = require_(taskId);
    if (session.state === 'CANCELLED') return session;               // idempotent
    if (TERMINAL.has(session.state)) return session;                 // nothing left to cancel
    if (session.state !== 'CANCELLING') transition(session, 'CANCELLING', reason);
    return transition(session, 'CANCELLED', 'cancelled');
  }

  function noteCancelledApproval(taskId, approvalId) {
    const session = get(taskId);
    if (!session || typeof approvalId !== 'string') return null;
    if (!session.cancelledApprovals.includes(approvalId)) session.cancelledApprovals.push(approvalId);
    return session;
  }
  function noteOwnedExecution(taskId, executionId) {
    const session = get(taskId);
    if (!session || typeof executionId !== 'string') return null;
    if (!session.ownedExecutions.includes(executionId)) session.ownedExecutions.push(executionId);
    return session;
  }

  // Gate consulted by the server immediately before initiating any tool/action.
  function canInitiateAction(taskId) {
    const session = get(taskId);
    if (!session) return { allowed: false, state: 'UNKNOWN', reason: 'Unknown task session' };
    if (ACTIONABLE.has(session.state)) return { allowed: true, state: session.state, reason: 'active' };
    const reason = session.state === 'PAUSED' ? 'Task is paused'
      : session.state === 'PAUSING' ? 'Task is pausing'
        : session.state === 'CANCELLING' ? 'Task is being cancelled'
          : session.state === 'CANCELLED' ? 'Task was stopped' : `Task is ${session.state.toLowerCase()}`;
    return { allowed: false, state: session.state, reason };
  }
  function authorityRevision(taskId) {
    const session = get(taskId);
    return session ? session.revision : null;
  }
  function resetForTests() { sessions.clear(); }

  return { STATES, TRANSITIONS, create, get, view: (id) => view(get(id)), setInstruction, editInstruction,
    beginPlanning, waitForApproval, complete, fail, pause, resume, stop, noteCancelledApproval,
    noteOwnedExecution, canInitiateAction, authorityRevision, resetForTests };
}

module.exports = { createTaskStore, STATES, TRANSITIONS, ACTIONABLE, TERMINAL };
