require("dotenv").config();

const express = require("express");
const path = require("path");

const { askNvidia } = require("./nvidia-router");

const actionGateway = require("./tools/action-gateway");
const activityTracker = require("./plugins/runtime/activity-tracker");
const { createExecutionPlan, planCodeInspection, planVerification, planPostEditVerification, planExplicitReplacement, planEditProposal, planEditApproval } = require("./tools/chat-tool-planner");
const { sanitizeAndBoundHistory, findPendingApprovalId, executePlan } = require("./tools/agent-runtime");
const { numberSourceLines, buildInspectionEvidence, parseInspectionAnalysis, renderInspectionResponse } = require("./tools/code-inspection-runtime");
const { createUnusedImportEdits } = require("./tools/unused-code-cleanup");
const taskEvidenceStore = require("./tools/task-evidence-store");
const { createTaskStore, TERMINAL: TERMINAL_TASK_STATES } = require("./tools/task-session");
const attachmentStore = require("./tools/attachment-store");
const { filterDiagnostics, renderPostEditVerification } = require("./tools/post-edit-verification");
const { stripChainOfThought } = require("./tools/response-sanitizer");
const editApprovalStore = require("./tools/edit-approval-store");
const patchValidator = require("./tools/patch-validator");
const { buildProjectContext } = require("./tools/context-builder");

const {
  DROP_ROOT,
  listProjectFiles,
  readProjectFile,
  getProjectFileInfo
} = require("./agent");

const runtimeIntent = require("./tools/runtime-intent");

const app = express();

app.use(express.json({ limit: "4mb" }));

// Minimal CORS so the TOM workspace UI (hosted page) can call this API
// from the user's browser. These endpoints use no cookies or credentials.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});


// ---------------------------------------
// TOM CONFIGURATION
// ---------------------------------------

// PORT is environment-configurable so black-box acceptance runs can start a
// clean server on an isolated port. Default remains 3001.
const PORT = Number.isInteger(Number(process.env.PORT)) && Number(process.env.PORT) > 0 && Number(process.env.PORT) <= 65535
  ? Number(process.env.PORT)
  : 3001;

// Server-authoritative task lifecycle (Chat Control Panel). The UI renders
// only what task.controls says after each response — never local booleans.
const taskStore = createTaskStore();
// In-flight model call per task, so Pause/Stop can abort it at the boundary.
const modelAbortByTask = new Map();
// Approval-continuation messages are control traffic, not instruction edits:
// they must never bump the authority revision they are approving.
const TASK_CONTINUATION = /^\s*(?:approve|reject)\s+(?:execution|edit)\b/i;
/*
  APPROVAL CONTINUATION — kind-aware, fail-closed (defect: approval wording
  escaping to the model).

  While a task waits on a RUNTIME approval, any realistic approval wording
  must resolve to that pending approval deterministically — never to the
  model. "approve execution <id>" is exact-match classified, but "I approve
  execution <id>", "Approved. Execute it.", "go ahead", and bare "approve"
  previously fell through: the model fabricated a bare
  {"approvalId","decision":"approve"} reply and NOTHING was ever dispatched
  (the word "decision" exists nowhere in TOM's own payloads — it is always
  model fabrication). Bare "approve" additionally landed in the EDIT handler
  ("Edit not applied…") because approval kind was never recorded.
*/
const APPROVAL_UUID_PATTERN = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i;
// Negation first: "Do not approve anything until I review it." is NOT an approval.
const APPROVAL_NEGATION = /\b(?:do not|don't|dont|never|not|cannot|can't)\b[^.!?]*\b(?:approve|reject|apply)\b/i;
// approve/approved/(re)ject forms only — deliberately NOT the noun "approval",
// so "what is the approval status?" can never dispatch anything.
const APPROVAL_VERB = /\b(approve|approved|approves|approving|reject|rejected|rejects)\b/i;
const APPROVAL_AFFIRMATIVE = /^(?:i\s+)?(?:sure(?:,\s*yes)?|yes(?:\s+please)?|yep|ok(?:ay)?|go\s+ahead|proceed|confirm(?:ed)?|do\s+it|looks\s+good|ship\s+it)\b[.!,\s]*$/i;
const APPROVAL_NEGATIVE = /^(?:i\s+)?(?:no(?:\s+thanks)?|stop(?:\s+it)?)\b[.!,\s]*$/i;

function resolveExecutionApproval(message, session) {
  const text = String(message || "").trim();
  if (!text || APPROVAL_NEGATION.test(text)) return null;
  const pending = session && session.pendingApproval;
  const pendingRuntime = Boolean(session && session.state === "WAITING_FOR_APPROVAL" &&
    pending && pending.kind === "runtime");
  const uuid = (text.match(APPROVAL_UUID_PATTERN) || [])[1];
  const mentionsEdit = /\bedits?\b/i.test(text);
  const mentionsExecution = /\bexecut/i.test(text);
  const verbMatch = mentionsEdit ? null : text.match(APPROVAL_VERB);
  const verb = verbMatch
    ? (verbMatch[1].toLowerCase().startsWith("rej") ? "reject" : "approve")
    : null;

  // "approve execution <id>" / "Approved. Execute it." — explicit execution
  // approval. The id comes from the message, else from the pending runtime
  // approval; with NEITHER, the gateway fails closed ("Unknown or consumed
  // approval") instead of the model narrating an approval that never ran.
  if (verb && mentionsExecution) {
    const approvalId = uuid || (pendingRuntime ? pending.approvalId : undefined);
    return { tool: "execution." + verb, args: approvalId ? { approvalId } : {} };
  }
  // "<verb> <uuid>" without context words: an id the EDIT store owns stays
  // on the edit path; any other uuid routes to the runtime store, which
  // fails closed if it is not one of its own approvals.
  if (verb && uuid) {
    if (editApprovalStore.getApproval(uuid)) return null;
    return { tool: "execution." + verb, args: { approvalId: uuid } };
  }
  // Bare "approve"/"reject": the PENDING APPROVAL'S KIND picks the store —
  // runtime approvals dispatch here, edit approvals fall to the edit path.
  if (verb && pendingRuntime) {
    return { tool: "execution." + verb, args: { approvalId: pending.approvalId } };
  }
  // Verb-less yes/no control traffic while a runtime approval is pending.
  if (!verb && pendingRuntime) {
    if (APPROVAL_AFFIRMATIVE.test(text)) return { tool: "execution.approve", args: { approvalId: pending.approvalId } };
    if (APPROVAL_NEGATIVE.test(text)) return { tool: "execution.reject", args: { approvalId: pending.approvalId } };
  }
  return null;
}

const TOM_SYSTEM_PROMPT = `
You are Tom, the AI intelligence layer for this project workspace.

Be concise, accurate, evidence-driven, and project-focused.

Rules:
1. Maintain context from the conversation history provided to you.
2. Treat previous user and assistant messages as part of the same conversation.
3. Do not claim that you executed an action unless the system actually performed it.
4. Do not claim that you modified files unless the system actually modified them.
5. Clearly separate facts from assumptions or inference.
6. When project evidence is provided, ground your answer in that evidence.
  Current-turn Action Gateway evidence is authoritative for mutable project,
  VS Code, diagnostics, and Git state. Previous assistant claims about that
  state are historical context only and must not be presented as current facts.
7. Never reveal your internal reasoning, thinking process, or analysis steps.
   Provide only your final answer.
8. Do not begin your reply with a reasoning/planning section or heading such as
   "Analyze User Input", "Analysis", "Thinking", "Reasoning", or numbered
   planning steps ("1. Identify...", "2. Examine..."). Do not start a reply
   with phrases like "We need to...", "The user wants...", or "Let's think...".
   Respond with only the final answer, with no scratchpad or preamble.
`.trim();


// ---------------------------------------
// TOM DASHBOARD
// ---------------------------------------

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


// ---------------------------------------
// GIT TOOL SELECTION (deterministic, Phase 2)
// ---------------------------------------
// Small, deterministic matcher: maps a user question to at
// most a few registered Action Gateway tools. Normal questions
// that do not need Git produce an empty plan and go straight
// to the existing chat flow untouched.

const MAX_TOOL_OUTPUT_CHARS = 4000;

const TOOL_ACTIVITY_LABELS = {
  "git.status": "Checking Git status...",
  "git.branch": "Checking Git branches...",
  "git.log": "Reading Git log...",
  "git.diff": "Reading Git diff...",
  "vscode.workspace.info": "Reading VS Code workspace...",
  "vscode.workspace.tree": "Reading VS Code workspace tree...",
  "vscode.file.active": "Reading active VS Code file...",
  "vscode.diagnostics": "Reading VS Code diagnostics...",
  "vscode.file.read": "Reading authorized project file..."
};

function truncateToolOutput(text, max) {
  if (typeof text !== "string") return "";
  return text.length > max
    ? text.slice(0, max) + "\n... (truncated)"
    : text;
}

function boundEvidenceData(data) {
  if (typeof data === "string") return truncateToolOutput(data, MAX_TOOL_OUTPUT_CHARS);
  const serialized = JSON.stringify(data);
  return serialized.length <= MAX_TOOL_OUTPUT_CHARS
    ? data
    : { truncated: true, preview: truncateToolOutput(serialized, MAX_TOOL_OUTPUT_CHARS) };
}

function verificationReply(result) {
  if (!result.success) return "Verification could not run: " + result.error;
  const data = result.data;
  if (data.status === "pending_approval") return runtimeIntent.render(result);
  const status = data.exitCode === 0 && !data.timedOut ? "passed" : "failed";
  return [
    `Verification ${status}: ${data.command}`,
    `Exit code: ${data.exitCode === null ? "none" : data.exitCode}`,
    `Timed out: ${data.timedOut ? "yes" : "no"}`,
    data.stdout ? "stdout:\n" + data.stdout : "",
    data.stderr ? "stderr:\n" + data.stderr : ""
  ].filter(Boolean).join("\n");
}

/*
  CHAIN-OF-THOUGHT GUARD (deterministic, defensive second layer)

  Reasoning suppression is primarily handled at the provider layer
  (TOM_SYSTEM_PROMPT + the NVIDIA request's chat_template_kwargs).
  This is the defensive fallback: it strips any internal-reasoning
  content models leak anyway. See tools/response-sanitizer.js.
*/

// ---------------------------------------
// GENERAL TOM CHAT
// ---------------------------------------

/*
  SECURITY: recognizes execution wording that did NOT classify to a validated
  runtime tool. Each "run/execute/rerun ..." clause is inspected on its own, so
  a message cannot hide one authorized-looking phrase behind another.
  Clauses targeting a read-only TOM surface ("VS Code diagnostics",
  "diagnostics", "checks") are ordinary inspection phrasing and are left to the
  deterministic inspection path; every other target is an unauthorized probe.
  Returns the offending target string, or null when the message is not an
  execution attempt at all.
*/
const RECOGNIZED_RUN_TARGET =
  /^(?:(?:vs\s*code|vscode)\s+)?(?:diagnostics|checks)(?:\s+(?:for|on|of)\s+[\w./-]+)?[,]?$/i;

function findUnauthorizedExecutionAttempt(message) {
  const text = String(message || "");
  // Approval/rejection wording for an already-created execution approval is
  // routed by runtimeIntent.classify and must not be swallowed here.
  if (/^\s*(?:approve|reject)\s+execution\b/i.test(text)) return null;
  const clause =
    /(?:^|[.!?]\s*|\b(?:and|then|also)\s+)(?:(?:please|also)\s+)*(?:run|execute|rerun|re-run)\s+([^.;!?]*)/gi;
  let match;
  while ((match = clause.exec(text)) !== null) {
    const target = match[1].trim().replace(/^the\s+/i, "");
    if (!RECOGNIZED_RUN_TARGET.test(target)) return target || "(unspecified target)";
  }
  return null;
}

/*
  SECURITY: unresolved managed-service wording.

  A service lifecycle request ("start the DROP development server", "stop the
  ACME server", "check service foo") that did NOT resolve to the single
  configured managed service is refused deterministically here — zero
  approval, zero process, zero model call. Service identity can ONLY come from
  trusted configuration (projectId + serviceId); project names, ports, PIDs
  and paths in message text can never address or own a process.

  The clause must be imperative (message start, or after "and/then/also"), so
  ordinary questions ("how do I start a server?") stay conversational. Every
  clause is inspected independently, so an authorized-looking clause cannot
  mask a service clause.
*/
const SERVICE_LIFECYCLE_VERB =
  /^(?:start|stop|restart|kill|check|show|get|display|view|report|status|logs|health)$/i;
const SERVICE_NOUN = /\b(?:servers?|runtimes?|services?|daemons?|process(?:es)?|pids?)\b/i;
// A subject that is exactly a service identity (with an optional address
// suffix such as "on port 9999" / "pid 42") — i.e. what a user would type to
// name one managed service.
const SERVICE_IDENTITY_SUBJECT =
  /^(?:\w+\s+)*(?:servers?|runtimes?|services?|daemons?|process(?:es)?|pids?)(?:\s+(?:on|at|using)\s+(?:port\s+)?\d+|\s+with\s+(?:pid|process\s+id|id|port)\s+\d+|\s+(?:pid|id)\s+\d+|\s*#\s*\d+|\s+\d+)?$/i;
const SERVICE_VERB_TOOL = { start: "runtime.start", stop: "runtime.stop", restart: "runtime.restart",
  kill: "runtime.stop", status: "runtime.status", logs: "runtime.logs", health: "runtime.health",
  check: "runtime.status", show: "runtime.status", get: "runtime.status", display: "runtime.status",
  view: "runtime.status", report: "runtime.status" };

// Clause boundaries: sentence punctuation and the connectors TOM treats as
// clause starts ("and/then/also"), so a leading non-lifecycle clause
// ("Do not run npm test, then start the dev server.") cannot hide a later
// service clause.
const SERVICE_CLAUSE_SPLIT = /\s*[.;!?]+\s*|\s+(?:and|then|also)\s+/i;

function findUnresolvedServiceRequest(message) {
  const clauses = String(message || "").split(SERVICE_CLAUSE_SPLIT);
  for (const raw of clauses) {
    const clause = raw.trim().replace(/^(?:please|also)\s+/i, "");
    const words = clause.split(/\s+/).filter(Boolean);
    const verb = (words[0] || "").toLowerCase();
    if (!SERVICE_LIFECYCLE_VERB.test(verb)) continue;
    const subject = words.slice(1).join(" ").trim();
    if (!SERVICE_NOUN.test(subject)) continue;
    return { verb, subject, identity: SERVICE_IDENTITY_SUBJECT.test(subject),
      tool: SERVICE_VERB_TOOL[verb] || "runtime.status" };
  }
  return null;
}

// ---------------------------------------
// TASK CONTROL (server-authoritative lifecycle)
// ---------------------------------------
// Pause / Resume / Stop / Edit are gated by the task store, never by the
// client. Unknown sessions fail closed (404/409), and every response carries
// the authoritative `task` view (state + controls) the UI must render.

function unknownTask(res) {
  return res.status(404).json({ error: "Unknown task session" });
}

function taskTransitionError(res, error) {
  return res.status(409).json({ error: error.message || "Invalid task transition" });
}

app.post("/task", (req, res) => {
  const label = req.body && typeof req.body.label === "string" ? req.body.label : null;
  const session = taskStore.create({ label });
  return res.json({ task: taskStore.view(session.taskId) });
});

app.get("/task/:taskId", (req, res) => {
  const task = taskStore.view(req.params.taskId);
  return task ? res.json({ task }) : unknownTask(res);
});

app.get("/runtime/open-app", async (_req, res) => {
  try { return res.json(await actionGateway.getBrowserTarget()); }
  catch (error) { return res.json({ available: false, reason: error.message || "Unavailable" }); }
});

app.post("/task/:taskId/pause", (req, res) => {
  const { taskId } = req.params;
  if (!taskStore.get(taskId)) return unknownTask(res);
  try {
    taskStore.pause(taskId, "user");
    // Abort the in-flight model call at the safe boundary. No process is
    // ever killed by Pause: owned commands finish to their safe boundary.
    const inFlight = modelAbortByTask.get(taskId);
    if (inFlight) inFlight.abort();
    return res.json({ task: taskStore.view(taskId) });
  } catch (error) {
    return taskTransitionError(res, error);
  }
});

app.post("/task/:taskId/resume", (req, res) => {
  const { taskId } = req.params;
  if (!taskStore.get(taskId)) return unknownTask(res);
  try {
    const session = taskStore.get(taskId);
    const instruction = req.body && typeof req.body.instruction === "string" ? req.body.instruction.trim() : "";
    if (instruction && instruction !== session.instruction) {
      // Edit-after-pause: NEW user authority. The revision bump makes every
      // approval bound to the previous revision permanently stale.
      taskStore.editInstruction(taskId, instruction);
    }
    taskStore.resume(taskId);
    return res.json({ task: taskStore.view(taskId) });
  } catch (error) {
    return taskTransitionError(res, error);
  }
});

app.post("/task/:taskId/edit", (req, res) => {
  const { taskId } = req.params;
  if (!taskStore.get(taskId)) return unknownTask(res);
  try {
    const instruction = req.body && typeof req.body.instruction === "string" ? req.body.instruction.trim() : "";
    taskStore.editInstruction(taskId, instruction);
    return res.json({ task: taskStore.view(taskId) });
  } catch (error) {
    return taskTransitionError(res, error);
  }
});

app.post("/task/:taskId/stop", async (req, res) => {
  const { taskId } = req.params;
  const session = taskStore.get(taskId);
  if (!session) return unknownTask(res);
  try {
    taskStore.stop(taskId, "user");
    const inFlight = modelAbortByTask.get(taskId);
    if (inFlight) inFlight.abort();

    // Evidence-driven cleanup: cancel every pending approval bound to this
    // task (runtime + edit stores), then terminate any TOM-owned command.
    const cancelledRuntime = actionGateway.cancelTaskApprovals(taskId);
    const pendingEdit = session.pendingApproval
      ? editApprovalStore.cancelApproval(session.pendingApproval.approvalId)
      : null;
    const cancelledApprovals = [
      ...cancelledRuntime,
      ...(pendingEdit && !cancelledRuntime.includes(pendingEdit.approvalId) ? [pendingEdit.approvalId] : [])
    ];
    for (const approvalId of cancelledApprovals) taskStore.noteCancelledApproval(taskId, approvalId);
    // Stop CANCELS every pending approval — nothing stays pending on a
    // cancelled task (stale bookkeeping used to leave orphaned entries).
    session.pendingApproval = null;

    const executionCleanup = [];
    for (const executionId of [...session.ownedExecutions]) {
      const result = await actionGateway.cancelOwnedExecution(executionId);
      executionCleanup.push({
        tool: "terminal.cancel",
        executionId,
        success: Boolean(result && result.success),
        error: result && result.success ? null : ((result && result.error) || "cancel failed")
      });
      if (result && result.success) {
        const remaining = session.ownedExecutions.filter((id) => id !== executionId);
        session.ownedExecutions = remaining;
      }
    }

    return res.json({
      task: taskStore.view(taskId),
      evidence: { cancelledApprovals, executionCleanup }
    });
  } catch (error) {
    return taskTransitionError(res, error);
  }
});

// ---------------------------------------
// CHAT ATTACHMENTS (data-only boundary)
// ---------------------------------------
// Attachments are inert data: validated type/size, stored outside the
// project tree, and embedded ONLY into model messages — never into a
// command, path, or argument (see tools/attachment-store.js).

app.post("/attachment", (req, res) => {
  try {
    const body = req.body || {};
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    if (!taskId || !taskStore.get(taskId)) {
      return res.status(400).json({ error: "A valid taskId is required" });
    }
    const attachment = attachmentStore.create({
      taskId,
      name: body.name,
      type: body.type,
      data: body.data,
      encoding: body.encoding
    });
    return res.json({ attachment });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Attachment rejected" });
  }
});

app.get("/attachment/:taskId", (req, res) => {
  if (!taskStore.get(req.params.taskId)) return unknownTask(res);
  return res.json({ attachments: attachmentStore.list(req.params.taskId) });
});


app.post("/chat", async (req, res) => {
  let taskId = null;
  try {
    const message = req.body.message;

    const history = Array.isArray(req.body.history)
      ? req.body.history
      : [];

    if (
      typeof message !== "string" ||
      !message.trim()
    ) {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    /*
      public/app.js sends previous messages as:

      {
        role: "user" | "assistant",
        content: "..."
      }

      Validate them before sending them to the model.
    */

    /* ---------------------------------------------------------------
      TASK AUTHORITY (server-side, before ANY gateway or model call)
      --------------------------------------------------------------- */
    taskId = typeof req.body.taskId === "string" ? req.body.taskId.trim() : "";
    if (taskId && !taskStore.get(taskId)) {
      return res.status(400).json({ error: "Unknown task session" });
    }
    if (!taskId) {
      taskId = taskStore.create({ label: message.trim().slice(0, 120) }).taskId;
    }

    // ONE exit path: every payload (success, denial, approval, error) leaves
    // with a fresh authoritative task view, and the task state advances here:
    // an approval-bearing response waits for approval, anything else completes.
    const baseJson = res.json.bind(res);
    res.json = (payload) => {
      if (payload && typeof payload === "object") {
        try {
          let approvalId = null;
          if (typeof payload.approvalId === "string") {
            approvalId = payload.approvalId;
          } else if (typeof payload.reply === "string") {
            const match = payload.reply.match(/Approval ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
            if (match) approvalId = match[1];
          }
          const session = taskStore.get(taskId);
          const state = session ? session.state : null;
          const inFlightState = ["IDLE", "PLANNING", "RUNNING", "WAITING_FOR_APPROVAL"].includes(state);
          // Failed evidence (denied/invalidated attempt) must NOT complete a
          // task that is still waiting on a live approval — the pending
          // approval survives a bad approve attempt and stays actionable.
          const failedEvidence = Array.isArray(payload.toolEvidence) &&
            payload.toolEvidence.some((item) => item && item.success === false);
          const holdsApproval = state === "WAITING_FOR_APPROVAL" && failedEvidence &&
            Boolean(session && session.pendingApproval);
          if (approvalId && inFlightState) {
            // KIND decides which store later approval wording may talk to:
            // edit proposals carry vscode.file.propose_edit, everything else
            // (runtime.start/stop/restart, terminal.run) is a runtime approval.
            const isEditProposal = Array.isArray(payload.toolsUsed) &&
              payload.toolsUsed.includes("vscode.file.propose_edit");
            taskStore.waitForApproval(taskId, approvalId, isEditProposal ? "edit" : "runtime");
          } else if (!approvalId && !holdsApproval &&
            ["PLANNING", "RUNNING", "WAITING_FOR_APPROVAL"].includes(state)) {
            taskStore.complete(taskId, "response sent");
          }
          payload.task = taskStore.view(taskId);
        } catch (_) {
          payload.task = taskStore.view(taskId);
        }
      }
        // SECURITY: only TOM's deterministic stores decide approvals. TOM's
        // own payloads NEVER contain a "decision" key — a model reply that
        // carries one is fabricated approval theater and is refused here, at
        // the single exit path, instead of being rendered as a real decision.
        if (typeof payload.reply === "string" &&
            !String(payload.provider || "").startsWith("tom-") &&
            /["']?decision["']?\s*:\s*["']?(?:approve|reject)/i.test(payload.reply)) {
          payload.reply = "Approval decisions come only from TOM's action gateway, so that reply was not applied. No action was dispatched. Request the action again and answer its approval prompt.";
          payload.modelDecisionRefused = true;
        }
      return baseJson(payload);
    };

    // Approval-wording variants resolve BEFORE authority bookkeeping so they
    // behave exactly like the exact wording: control traffic that never edits
    // the instruction, never bumps the authority revision, and never the model.
    const approvalContinuation = resolveExecutionApproval(message, taskStore.get(taskId));
    const isContinuation = approvalContinuation !== null || TASK_CONTINUATION.test(message);
    let gate = taskStore.canInitiateAction(taskId);
    if (!gate.allowed && TERMINAL_TASK_STATES.has(gate.state) && !isContinuation) {
      // A stopped/finished task stays visible; a NEW message on it is an
      // explicit retry — a fresh PLANNING cycle with recalculated authority.
      const retryText = message.trim();
      const session = taskStore.get(taskId);
      if (session.instruction && session.instruction !== retryText) {
        taskStore.editInstruction(taskId, retryText);
      } else {
        taskStore.setInstruction(taskId, retryText);
      }
      taskStore.beginPlanning(taskId);
      gate = taskStore.canInitiateAction(taskId);
    }
    if (!gate.allowed) {
      // FAIL CLOSED: paused/stopped/transitional tasks initiate NOTHING —
      // zero gateway calls, zero model calls, zero approvals.
      return res.json({
        reply: gate.reason + ". No action was started. Use Resume to continue this task, or start a new task.",
        provider: "tom-task-control",
        taskControl: gate,
        toolEvidence: [],
        toolActivity: [],
        toolsUsed: []
      });
    }
    if (!isContinuation) {
      const session = taskStore.get(taskId);
      const instruction = message.trim();
      if (session.instruction && session.instruction !== instruction) {
        // New message text = NEW user authority: bump the revision so any
        // approval proposed under the previous instruction goes stale.
        taskStore.editInstruction(taskId, instruction);
      } else {
        taskStore.setInstruction(taskId, instruction);
      }
      taskStore.beginPlanning(taskId);
    } else if (taskStore.get(taskId).state === "IDLE") {
      taskStore.beginPlanning(taskId);
    }

    // Attachment context is DATA embedded into the model message only.
    // Invalid or cross-task attachment ids fail closed as a 400.
    let attachmentBlock = "";
    if (Array.isArray(req.body.attachmentIds) && req.body.attachmentIds.length) {
      try {
        attachmentBlock = attachmentStore.contextFor(taskId, req.body.attachmentIds);
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    }

    // Task-gated model caller: re-checked immediately before every model call
    // so a Pause that landed mid-request prevents the NEXT action, and the
    // in-flight call is abortable at the safe boundary.
    const callModel = async (modelMessages, options = {}) => {
      const modelGate = taskStore.canInitiateAction(taskId);
      if (!modelGate.allowed) {
        const failure = new Error("Task not actionable: " + modelGate.reason);
        failure.taskControl = modelGate;
        throw failure;
      }
      const controller = new AbortController();
      modelAbortByTask.set(taskId, controller);
      try {
        return await askNvidia(modelMessages, { ...options, signal: controller.signal });
      } finally {
        if (modelAbortByTask.get(taskId) === controller) modelAbortByTask.delete(taskId);
      }
    };

    const runtimeRequest = approvalContinuation || runtimeIntent.classify(message);
    // Preserve combined edit/proposal behavior; execution remains separately approved.
    const combinedEdit = planEditProposal(message) || planExplicitReplacement(message) || planPostEditVerification(message);
    if (runtimeRequest && !combinedEdit) {
      // Task context binds consequential approvals to THIS task and THIS
      // authority revision (enforced by the runtime gateway at approve time).
      const taskContext = { taskId, revision: taskStore.authorityRevision(taskId) };
      const evidence = await actionGateway.executeTool(runtimeRequest.tool, runtimeRequest.args, taskContext);
      // Track commands this task owns so Stop can terminate them with evidence.
      if (evidence && evidence.success && evidence.data && typeof evidence.data.executionId === "string") {
        taskStore.noteOwnedExecution(taskId, evidence.data.executionId);
      }
      // SECURITY: a deterministic runtime result — success, denial, or
      // pending approval — is FINAL. It must terminate the request here
      // so it can never fall through to the NVIDIA model fallback below
      // (which would let the model narrate, invent, or corrupt the result).
      return res.json({ reply: runtimeIntent.render(evidence), provider: "tom-action-gateway",
        // A consequential runtime action (runtime.start/stop/restart) only ever
        // returns pending here: the managed process is created later, by the
        // explicit "approve execution <id>" continuation.
        ...(evidence.data && evidence.data.status === "pending_approval" && evidence.data.approvalId
          ? { approvalId: evidence.data.approvalId, approvalExpiresAt: evidence.data.expiresAt } : {}),
        toolsUsed: [runtimeRequest.tool], toolActivity: ["Processing " + runtimeRequest.tool],
        toolEvidence: [{ tool: runtimeRequest.tool, args: runtimeRequest.args, ...evidence }],
        executionPlan: { intent: runtimeRequest.tool, steps: [{ ...runtimeRequest,
          riskLevel: runtimeRequest.tool === "terminal.discover" || /\.(status|logs|health|port)$/.test(runtimeRequest.tool) ? "read" : "consequential" }] }
      });
    }

    /*
      SECURITY: default-deny short-circuit for unauthorized command probes.

      A message that asks for execution ("run X", "execute X", ...) but did
      NOT classify to a validated runtime tool (the branch above) is an
      unauthorized command. It is rejected deterministically here — zero
      approval, zero process, zero model call — so no unrecognized command can
      ever fall through to the NVIDIA/model path and be narrated as if it ran.

      Read-only TOM surfaces are NOT command probes: "and run VS Code
      diagnostics for it" is inspection phrasing handled by the deterministic
      inspection path below. Every execution clause in the message is checked
      independently, so "run diagnostics and also run curl X" still denies.
    */
    const executionAttempt = findUnauthorizedExecutionAttempt(message);
    if (executionAttempt && !combinedEdit) {
      const denied = { success: false, tool: "terminal.run", error: "Command is not allowlisted" };
      return res.json({ reply: runtimeIntent.render(denied), provider: "tom-action-gateway",
        toolsUsed: ["terminal.run"], toolActivity: ["Processing terminal.run"],
        toolEvidence: [{ tool: "terminal.run", args: { requested: executionAttempt }, ...denied }],
        executionPlan: { intent: "terminal.run", steps: [{ tool: "terminal.run", args: { requested: executionAttempt }, riskLevel: "consequential" }] }
      });
    }

    /*
      SECURITY: default-deny for unresolved managed-service wording.

      "Start the DROP development server." and its stop/restart/status/logs
      siblings resolve to the configured managed service in the branch above.
      Anything else shaped like a service lifecycle request ("start the ACME
      server", "stop process 4212", "restart the dev server on port 9999") is
      refused here deterministically: no approval, no process, no model call.
    */
    const unresolvedService = findUnresolvedServiceRequest(message);
    if (unresolvedService && !combinedEdit) {
      const denied = { success: false, tool: unresolvedService.tool,
        error: unresolvedService.identity ? "Unknown configured service" : "Unrecognized service request" };
      return res.json({ reply: runtimeIntent.render(denied), provider: "tom-action-gateway",
        toolsUsed: [unresolvedService.tool], toolActivity: ["Processing " + unresolvedService.tool],
        toolEvidence: [{ tool: unresolvedService.tool, args: { requested: unresolvedService.subject }, ...denied }],
        executionPlan: { intent: unresolvedService.tool, steps: [{ tool: unresolvedService.tool,
          args: { requested: unresolvedService.subject },
          riskLevel: /\.(?:status|logs|health|port)$/.test(unresolvedService.tool) ? "read" : "consequential" }] }
      });
    }

    const safeHistory = sanitizeAndBoundHistory(history);
    const pendingApprovalId = findPendingApprovalId(safeHistory);
    const editApproval = planEditApproval(message, pendingApprovalId);
    const explicitReplacement = planExplicitReplacement(message);
    const verification = planVerification(message);
    const postEditVerification = planPostEditVerification(message);

    /*
      PHASE 1: CONTROLLED EDIT APPROVAL (deterministic, explicit human step)

      An explicit approval message ("approve edit <approvalId>") applies a
      previously proposed edit through vscode.file.apply_edit. This never
      writes without a valid, unused, unexpired, path-matching approval
      (enforced by tools/edit-approval-store.js + agent.js writeProjectFile).
      This short-circuits the normal chat/NVIDIA pipeline entirely.

      Execution approvals ("approve/reject execution <approvalId>") are
      handled by the runtimeRequest branch above (runtime-intent.classify)
      and must NEVER reach this edit path.
    */

    if (editApproval && !/\b(approve|reject)\s+execution\b/i.test(message)) {
      const pending = editApprovalStore.getApproval(editApproval.approvalId);
      const targetPath = pending ? pending.path : null;
      const applyResult = targetPath
        ? await actionGateway.executeTool("vscode.file.apply_edit", { approvalId: editApproval.approvalId, path: targetPath })
        : { success: false, error: "Unknown or invalid approval" };

      if (!applyResult.success) {
        return res.json({
          reply: "Edit not applied: " + applyResult.error,
          provider: "tom-action-gateway",
          toolActivity: ["Applying approved edit..."],
          toolsUsed: ["vscode.file.apply_edit"]
        });
      }

      const diagnosticsResult = await actionGateway.executeTool("vscode.diagnostics");
      const verificationResult = pending.verification
        ? await actionGateway.executeTool("terminal.run", pending.verification)
        : null;
      const diagnosticsForFile = filterDiagnostics(diagnosticsResult, applyResult.data.path);
      taskEvidenceStore.recordAppliedTask({
        approvalId: editApproval.approvalId,
        path: applyResult.data.path,
        edits: pending.edits,
        application: {
          verified: applyResult.data.applied === true,
          bytesWritten: applyResult.data.bytesWritten,
          appliedAt: new Date().toISOString()
        },
        diagnostics: {
          success: diagnosticsResult.success,
          entries: diagnosticsForFile,
          error: diagnosticsResult.success ? null : diagnosticsResult.error
        },
        terminal: verificationResult,
        appliedAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString()
      });
      const changeSummary = pending.edits
        .map((edit) =>
          "- Replaced \"" + truncateToolOutput(edit.oldText, 120) +
          "\" with \"" + truncateToolOutput(edit.newText, 120) + "\""
        )
        .join("\n");
      return res.json({
        reply:
          "Edit applied and verified in " + applyResult.data.path + ".\n\n" +
          changeSummary + "\n\n" +
          "The file was reread after writing (" + applyResult.data.bytesWritten + " bytes)." +
          (diagnosticsResult.success
            ? "\n\nCurrent diagnostics: " + diagnosticsResult.data.diagnostics.length + " reported."
            : "") +
          (verificationResult ? "\n\n" + verificationReply(verificationResult) : ""),
        provider: "tom-action-gateway",
        toolActivity: [
          "Applying approved edit...",
          "Reading VS Code diagnostics...",
          ...(verificationResult ? ["Running " + pending.verification.command + "..."] : [])
        ],
        toolsUsed: [
          "vscode.file.apply_edit",
          "vscode.diagnostics",
          ...(verificationResult ? ["terminal.run"] : [])
        ],
        ...(verificationResult ? { verification: verificationResult.data || { error: verificationResult.error } } : {})
      });
    }

    if (postEditVerification) {
      const appliedEvidence = taskEvidenceStore.getLatestByPath(postEditVerification.path);
      if (!appliedEvidence || !appliedEvidence.application || appliedEvidence.application.verified !== true) {
        return res.json({
          reply:
            "## Applied changes\nNo successfully applied edit evidence is stored for " + postEditVerification.path + ".\n\n" +
            "## Diagnostics\nNot run because no applied task evidence was found.\n\n" +
            "## Build\nNo trustworthy completed build evidence is stored.\n\n" +
            "## Verification\nNOT VERIFIED",
          provider: "tom-action-gateway",
          toolsUsed: [],
          toolActivity: []
        });
      }

      const diagnosticsResult = await actionGateway.executeTool("vscode.diagnostics");
      const diagnosticsForFile = filterDiagnostics(diagnosticsResult, postEditVerification.path);
      let terminalResult = appliedEvidence.terminal;
      if (postEditVerification.buildMode === "fresh") {
        const command = planVerification(message) ||
          (terminalResult && terminalResult.success && terminalResult.data
            ? { command: terminalResult.data.command, cwd: "web" }
            : null);
        terminalResult = command
          ? await actionGateway.executeTool("terminal.run", command)
          : null;
      }
      const updatedEvidence = taskEvidenceStore.updateVerification(
        postEditVerification.path,
        {
          success: diagnosticsResult.success,
          entries: diagnosticsForFile,
          error: diagnosticsResult.success ? null : diagnosticsResult.error
        },
        terminalResult
      );

      return res.json({
        reply: renderPostEditVerification(updatedEvidence, diagnosticsResult, diagnosticsForFile, terminalResult),
        provider: "tom-action-gateway",
        taskEvidence: updatedEvidence,
        toolEvidence: [
          {
            tool: "vscode.diagnostics",
            args: {},
            success: diagnosticsResult.success,
            data: diagnosticsResult.success ? { diagnostics: diagnosticsForFile } : { error: diagnosticsResult.error }
          },
          ...(postEditVerification.buildMode === "fresh" && terminalResult
            ? [{ tool: "terminal.run", args: planVerification(message) || {}, success: terminalResult.success, data: terminalResult.data || { error: terminalResult.error } }]
            : [])
        ],
        toolActivity: [
          "Reading VS Code diagnostics...",
          ...(postEditVerification.buildMode === "fresh" && terminalResult ? ["Running build verification..."] : [])
        ],
        toolsUsed: [
          "vscode.diagnostics",
          ...(postEditVerification.buildMode === "fresh" && terminalResult ? ["terminal.run"] : [])
        ]
      });
    }

    if (explicitReplacement) {
      const readResult = await actionGateway.executeTool("vscode.file.read", { path: explicitReplacement.path });
      if (!readResult.success) {
        return res.json({
          reply: "Could not propose an edit: " + readResult.error,
          provider: "tom-action-gateway",
          toolActivity: ["Reading authorized project file..."],
          toolsUsed: ["vscode.file.read"]
        });
      }

      if (!readResult.data.content.includes(explicitReplacement.oldText)) {
        return res.json({
          reply:
            "No edit proposed: the exact text \"" + explicitReplacement.oldText +
            "\" was not found in " + explicitReplacement.path + ".",
          provider: "tom-action-gateway",
          toolActivity: ["Reading authorized project file..."],
          toolsUsed: ["vscode.file.read"]
        });
      }

      const proposeResult = await actionGateway.executeTool("vscode.file.propose_edit", {
        path: explicitReplacement.path,
        edits: [{ oldText: explicitReplacement.oldText, newText: explicitReplacement.newText }],
        verification
      });
      if (!proposeResult.success) {
        return res.json({
          reply: "Proposed patch could not be safely validated: " + proposeResult.error,
          provider: "tom-action-gateway",
          toolActivity: ["Reading authorized project file...", "Validating proposed edit..."],
          toolsUsed: ["vscode.file.read", "vscode.file.propose_edit"]
        });
      }

      return res.json({
        reply:
          "Proposed edit for " + proposeResult.data.path + " (not yet applied).\n" +
          "Approval ID: " + proposeResult.data.approvalId + "\n" +
          "Expires: " + proposeResult.data.expiresAt + "\n\n" +
          "- Replace \"" + explicitReplacement.oldText + "\" with \"" + explicitReplacement.newText + "\"\n\n" +
          "Reply with \"Approved\" or \"Apply it\" to apply this exact change.",
        provider: "tom-action-gateway",
        approvalId: proposeResult.data.approvalId,
        toolActivity: ["Reading authorized project file...", "Validating proposed edit..."],
        toolsUsed: ["vscode.file.read", "vscode.file.propose_edit"]
      });
    }

    /*
      PHASE 1B: CONTROLLED EDIT PROPOSAL (deterministic trigger, one model call)

      "Fix ... in <path>" reads the file (+ diagnostics) and asks NVIDIA for
      a MINIMAL structured patch ({"edits":[{"oldText","newText"}]}) only -
      never a full-file rewrite. The patch is validated (tools/patch-validator.js)
      and recorded as a pending approval through vscode.file.propose_edit.
      Nothing is written to disk here. If the model output can't be parsed
      or validated as a safe patch, this fails closed with no fallback to
      full-file replacement.
    */

    const editProposal = planEditProposal(message);
    if (editProposal) {
      const readResult = await actionGateway.executeTool("vscode.file.read", { path: editProposal.path });
      if (!readResult.success) {
        return res.json({
          reply: "Could not propose an edit: " + readResult.error,
          provider: "tom-action-gateway",
          toolActivity: ["Reading authorized project file..."],
          toolsUsed: ["vscode.file.read"]
        });
      }

      const diagnosticsResult = await actionGateway.executeTool("vscode.diagnostics");
      const diagnosticsForFile = diagnosticsResult.success
        ? diagnosticsResult.data.diagnostics.filter((d) => d.file === editProposal.path)
        : [];

      if (editProposal.kind === "unused-code-cleanup") {
        const cleanup = createUnusedImportEdits(readResult.data.content, diagnosticsForFile);
        if (cleanup.edits.length === 0) {
          return res.json({
            reply:
              "No deterministic unused-import edit was proposed for " + editProposal.path +
              ". The current VS Code diagnostics did not identify a safely removable standalone import.",
            provider: "tom-action-gateway",
            toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
            toolsUsed: ["vscode.file.read", "vscode.diagnostics"]
          });
        }

        const cleanupProposal = await actionGateway.executeTool("vscode.file.propose_edit", {
          path: editProposal.path,
          edits: cleanup.edits,
          verification
        });
        if (!cleanupProposal.success) {
          console.error("[Tom Edit Proposal Rejected]", {
            stage: "deterministic-unused-cleanup-validation",
            path: editProposal.path,
            reason: cleanupProposal.error
          });
          return res.json({
            reply: "Unused-code proposal rejected: " + cleanupProposal.error,
            provider: "tom-action-gateway",
            toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
            toolsUsed: ["vscode.file.read", "vscode.diagnostics", "vscode.file.propose_edit"]
          });
        }

        const preview = cleanupProposal.data.summary
          .map((change) => "- remove: " + truncateToolOutput(change.removed, 200))
          .join("\n");
        return res.json({
          reply:
            "Proposed unused-code cleanup for " + cleanupProposal.data.path + " (not yet applied).\n" +
            "Approval ID: " + cleanupProposal.data.approvalId + "\n" +
            "Expires: " + cleanupProposal.data.expiresAt + "\n\n" +
            "Changes:\n" + preview + "\n\n" +
            "Reply with \"Approved\" to apply this exact change and run the requested verification.",
          provider: "tom-action-gateway",
          approvalId: cleanupProposal.data.approvalId,
          toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics...", "Validating proposed edit..."],
          toolsUsed: ["vscode.file.read", "vscode.diagnostics", "vscode.file.propose_edit"]
        });
      }

      const editMessages = [
        {
          role: "system",
          content:
            "You propose a MINIMAL edit to one authorized project file. " +
            "Reply with ONLY JSON of the exact form " +
            "{\"edits\":[{\"oldText\":\"...\",\"newText\":\"...\"}]} - no prose, no markdown fences, " +
            "no commentary, nothing before or after the JSON. " +
            "Each oldText must be copied EXACTLY (verbatim, including whitespace) from the current " +
            "content below and must occur exactly once. Never reproduce the whole file; only include " +
            "the smallest oldText/newText pairs needed for the requested change."
        },
        {
          role: "user",
          content:
            "Request: " + message.trim() + "\n\n" +
            "File: " + editProposal.path + "\n\n" +
            "Current content:\n" + readResult.data.content + "\n\n" +
            "Diagnostics for this file:\n" + JSON.stringify(diagnosticsForFile)
        }
      ];

      const editModelResult = await callModel(editMessages, { temperature: 0 });
      if (!editModelResult || !editModelResult.content) {
        throw new Error("NVIDIA returned an empty response");
      }

      let edits;
      try {
        edits = patchValidator.parseModelEdits(editModelResult.content);
      } catch (parseError) {
        console.error("[Tom Edit Proposal Rejected]", {
          stage: "model-output-parse",
          path: editProposal.path,
          reason: parseError.message
        });
        return res.json({
          reply: "Proposed patch could not be safely validated.",
          provider: "nvidia-direct",
          model: editModelResult.model,
          toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
          toolsUsed: ["vscode.file.read", "vscode.diagnostics"]
        });
      }

      const proposeResult = await actionGateway.executeTool("vscode.file.propose_edit", {
        path: editProposal.path,
        edits,
        verification
      });

      if (!proposeResult.success) {
        console.error("[Tom Edit Proposal Rejected]", {
          stage: "patch-validation",
          path: editProposal.path,
          reason: proposeResult.error
        });
        return res.json({
          reply: "Proposed patch could not be safely validated.",
          provider: "nvidia-direct",
          model: editModelResult.model,
          toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
          toolsUsed: ["vscode.file.read", "vscode.diagnostics"]
        });
      }

      const preview = proposeResult.data.summary
        .map((change) =>
          "- remove: " + truncateToolOutput(change.removed, 200) +
          "\n  add: " + truncateToolOutput(change.added, 200)
        )
        .join("\n");

      return res.json({
        reply:
          "Proposed edit for " + proposeResult.data.path + " (not yet applied).\n" +
          "Approval ID: " + proposeResult.data.approvalId + "\n" +
          "Expires: " + proposeResult.data.expiresAt + "\n\n" +
          "Changes:\n" + preview + "\n\n" +
          "Reply with \"approve edit " + proposeResult.data.approvalId + "\" to apply this exact change.",
        provider: "nvidia-direct",
        model: editModelResult.model,
        approvalId: proposeResult.data.approvalId,
        toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
        toolsUsed: ["vscode.file.read", "vscode.diagnostics", "vscode.file.propose_edit"]
      });
    }

    if (verification) {
      const verificationResult = await actionGateway.executeTool("terminal.run", verification);
      return res.json({
        reply: verificationReply(verificationResult),
        provider: "tom-action-gateway",
        executionPlan: {
          intent: "verify_project",
          steps: [{ tool: "terminal.run", args: verification, riskLevel: "consequential" }]
        },
        toolEvidence: [{
          tool: "terminal.run",
          args: verification,
          success: verificationResult.success,
          data: verificationResult.data || { error: verificationResult.error }
        }],
        toolActivity: ["Running " + verification.command + "..."],
        toolsUsed: ["terminal.run"]
      });
    }

    const inspectionPlan = planCodeInspection(message);
    if (inspectionPlan) {
      const readResult = await actionGateway.executeTool("vscode.file.read", { path: inspectionPlan.path });
      if (!readResult.success) {
        return res.json({
          reply: "Could not inspect file: " + readResult.error,
          provider: "tom-action-gateway",
          executionPlan: inspectionPlan,
          toolEvidence: [{ tool: "vscode.file.read", args: { path: inspectionPlan.path }, success: false, data: { error: readResult.error } }],
          toolActivity: ["Reading authorized project file..."],
          toolsUsed: ["vscode.file.read"]
        });
      }

      const diagnosticsResult = await actionGateway.executeTool("vscode.diagnostics");
      const allDiagnostics = diagnosticsResult.success ? diagnosticsResult.data.diagnostics : [];
      const inspectionEvidence = buildInspectionEvidence(
        inspectionPlan.path,
        readResult.data.content,
        allDiagnostics
      );
      const inspectionMessages = [
        {
          role: "system",
          content:
            "Analyze only the complete source evidence supplied by the user. Reply with ONLY JSON: " +
            "{\"codeFacts\":[{\"lineStart\":1,\"lineEnd\":5,\"fact\":\"fact text\"}]," +
            "\"suggestions\":[{\"lineStart\":100,\"lineEnd\":130," +
            "\"suggestion\":\"suggestion text\",\"reason\":\"reason text\"}]}. " +
            "Do not return diagnostics, errors, warnings, headings, markdown, or uncited observations. " +
            "Every line number is 1-based and must refer to the numbered source supplied. " +
            "Return at most 6 code facts and at most 6 suggestions. " +
            "Code facts must describe directly observable syntax or behavior and must not use speculative words such as may, might, could, should, or potential. " +
            "Suggestions are recommendations, never compiler or diagnostic issues."
        },
        {
          role: "user",
          content: JSON.stringify({
            request: message.trim(),
            file: {
              path: inspectionEvidence.file.path,
              lineCount: inspectionEvidence.file.lineCount,
              numberedSource: numberSourceLines(inspectionEvidence.file.content)
            }
          })
        }
      ];

      let analysis = { codeFacts: [], architecturalSuggestions: [] };
      let inspectionModel = null;
      try {
        const modelResult = await callModel(inspectionMessages, { temperature: 0, maxTokens: 2000 });
        inspectionModel = modelResult.model;
        analysis = parseInspectionAnalysis(modelResult.content, inspectionEvidence.file.content);
      } catch {
        // Tool evidence remains useful and authoritative when model suggestions are unavailable.
      }
      inspectionEvidence.codeFacts = analysis.codeFacts;

      return res.json({
        reply: renderInspectionResponse(inspectionEvidence, analysis),
        provider: inspectionModel ? "nvidia-direct" : "tom-action-gateway",
        ...(inspectionModel ? { model: inspectionModel } : {}),
        executionPlan: inspectionPlan,
        inspectionEvidence,
        toolEvidence: [
          { tool: "vscode.file.read", args: { path: inspectionPlan.path }, success: true, data: inspectionEvidence.file },
          { tool: "vscode.diagnostics", args: {}, success: diagnosticsResult.success, data: { diagnostics: inspectionEvidence.diagnostics } }
        ],
        toolActivity: ["Reading authorized project file...", "Reading VS Code diagnostics..."],
        toolsUsed: ["vscode.file.read", "vscode.diagnostics"]
      });
    }

    /*
      IMPORTANT:

      This creates ONE continuous model conversation:

      system
      previous user message
      previous Tom response
      previous user message
      previous Tom response
      ...
      current user message
    */

    /*
      PHASE 2: GIT TOOL SELECTION (deterministic)

      Only tools already registered in the Action Gateway can
      run, and only when the question clearly needs repository
      state. The client never supplies paths and handlers take
      no arguments, so no user text can reach git itself.
      Tool output is passed to Tom as trusted project context,
      never into the visible composer.
    */

    /*
      PHASE 3: FILE ANALYSIS TOOL SELECTION (deterministic)

      When the message names an explicit project-relative path
      (e.g. "analyze web/app/page.tsx"), that file is read through
      vscode.file.read and nothing else is bundled in, so unrelated
      project files are never sent to the model. When the message
      instead refers to the "active"/"current"/"open" file, the
      active path is resolved first via vscode.file.active and then
      read the same way. All path validation, blocked names/
      extensions, traversal, symlink, and size checks are enforced
      by the Action Gateway -> agent.js, never by this planner.
    */

    const executionPlan = createExecutionPlan(message);
    const toolActivity = [];
    const toolEvidence = await executePlan(executionPlan, async (tool, args) => {
      // Re-gate per step: a Pause/Stop that landed mid-request stops the
      // NEXT action instead of silently continuing the plan.
      const stepGate = taskStore.canInitiateAction(taskId);
      if (!stepGate.allowed) {
        return { success: false, tool, error: "Task not actionable: " + stepGate.reason };
      }
      toolActivity.push(TOOL_ACTIVITY_LABELS[tool] || "Running " + tool + "...");
      return actionGateway.executeTool(tool, args);
    });
    const toolsUsed = toolEvidence.map((item) => item.tool);
    const boundedEvidence = toolEvidence.map((item) => ({
      ...item,
      data: boundEvidenceData(item.data)
    }));
    const toolContext = boundedEvidence.length
      ? JSON.stringify({ executionPlan, evidence: boundedEvidence }, null, 2)
      : "";

    const attachmentIntro = attachmentBlock ? attachmentBlock + "\n\n" : "";
    const finalUserContent = attachmentIntro + (toolContext
      ? message.trim() +
        "\n\n" +
        "----- CURRENT-TURN ACTION GATEWAY EVIDENCE -----\n" +
        toolContext +
        "\n----- END CURRENT-TURN ACTION GATEWAY EVIDENCE -----\n" +
        "Rules for this answer:\n" +
        "1. Treat only the current-turn evidence above as authoritative for mutable project state.\n" +
        "2. Present repository facts as facts only when directly supported by current-turn evidence.\n" +
        "3. Previous assistant claims about Git, files, diagnostics, or repository state are not current facts.\n" +
        "4. Clearly separate current evidence from explanation or inference.\n" +
        "5. Do not claim you executed anything beyond these read-only checks.\n" +
        "6. Never describe a file's contents, purpose, behavior, exports, components, or implementation unless vscode.file.read successfully read that file in the current turn.\n" +
        "7. Files returned only by vscode.workspace.search are search matches, not inspected files. List unread matches separately as 'Additional search matches not inspected in this turn' and do not infer their role from filenames.\n" +
        "8. Never claim no other files were found unless the search evidence itself contains no additional matches.\n" +
        "9. If successful repository evidence does not verify the requested fact, say that you could not verify it; never invent a path, component, implementation, or relationship between files.\n" +
        "10. Answer the user's question directly. Do NOT narrate or analyze the " +
        "conversation, the instructions, or the tool results. Do NOT start with " +
        "sections like 'Analyze User Input' or any step-by-step reasoning. " +
        "Begin directly with the repository facts."
      : message.trim());

    const messages = [
      {
        role: "system",
        content: TOM_SYSTEM_PROMPT
      },

      ...safeHistory,

      {
        role: "user",
        content: finalUserContent
      }
    ];


    // NVIDIA router automatically tries its configured
    // models until one succeeds. Gated + abortable via callModel.
    const result = await callModel(messages);


    if (!result || !result.content) {
      throw new Error(
        "NVIDIA returned an empty response"
      );
    }


    return res.json({
      reply: stripChainOfThought(result.content),

      provider: "nvidia-direct",

      model: result.model,

      historyMessages:
        safeHistory.length + 1,

      executionPlan,

      toolEvidence: boundedEvidence,

      toolActivity,

      toolsUsed: toolsUsed
    });

  } catch (error) {
    const failureSession = taskId ? taskStore.get(taskId) : null;
    const failureState = failureSession ? failureSession.state : null;

    // Pause/Stop cancelled the in-flight model call at the safe boundary:
    // this is a successful control action, not a provider failure.
    if (["PAUSING", "PAUSED", "CANCELLING", "CANCELLED"].includes(failureState)) {
      return res.json({
        reply: "Task paused at a safe boundary; the in-flight model call was cancelled and no further action was started.",
        provider: "tom-task-control",
        toolEvidence: [],
        toolActivity: [],
        toolsUsed: []
      });
    }

    console.error(
      "[Tom Chat Error]",
      error
    );

    if (taskId && failureSession) {
      try { taskStore.fail(taskId, error.message || "provider unavailable"); }
      catch (_) { /* state already terminal — keep the original error */ }
    }

    return res.status(503).json({
      error:
        error.message ||
        "Tom intelligence provider unavailable"
    });
  }
});


// ---------------------------------------
// TOM CONTEXT BUILDER (read-only, reuses actionGateway)
// ---------------------------------------

app.post("/context", async (req, res) => {
  try {
    const paths = Array.isArray(req.body.paths) ? req.body.paths : [];
    const context = await buildProjectContext(paths);
    return res.json(context);
  } catch (error) {
    console.error("[Context Builder Error]", error);
    return res.status(500).json({
      error: error.message || "Context build failed"
    });
  }
});


// ---------------------------------------
// PROJECT INFORMATION
// ---------------------------------------

app.get("/project", (req, res) => {
  try {
    return res.json({
      project: "Project Workspace",

      root: DROP_ROOT,

      files: listProjectFiles()
    });

  } catch (error) {
    console.error(
      "[Project Error]",
      error
    );

    return res.status(500).json({
      error: error.message
    });
  }
});


// ---------------------------------------
// READ AUTHORIZED PROJECT FILE
// ---------------------------------------

app.get("/file", (req, res) => {
  try {
    const filePath = req.query.path;

    if (!filePath) {
      return res.status(400).json({
        error: "File path is required"
      });
    }


    const content =
      readProjectFile(filePath);


    return res.json({
      project: "Project Workspace",

      path: filePath,

      content
    });

  } catch (error) {
    console.error(
      "[File Read Error]",
      error
    );

    return res.status(400).json({
      error: error.message
    });
  }
});


// ---------------------------------------
// TOM FILE ANALYSIS
// ---------------------------------------

app.post(
  "/analyze-file",
  async (req, res) => {
    try {
      const filePath =
        req.body.path;

      const question =
        req.body.question;


      if (!filePath) {
        return res.status(400).json({
          error:
            "File path is required"
        });
      }


      if (
        typeof question !== "string" ||
        !question.trim()
      ) {
        return res.status(400).json({
          error:
            "Question is required"
        });
      }


      /*
        SAFE OVERSIZED-FILE DETECTION

        Never send an entire large file to the model.

        Instead, return a clear "large file" result so the
        client can show:
          "Large file — targeted analysis required"

        This keeps the architecture ready for later
        chunking / indexing / retrieval without changing
        the provider routing or reading the whole file.
      */
      const fileInfo =
        getProjectFileInfo(filePath);

      if (fileInfo.isLarge) {
        return res.status(200).json({
          project:
            "Project Workspace",

          file:
            filePath,

          largeFile:
            true,

          size:
            fileInfo.size,

          maxSize:
            fileInfo.maxSize,

          message:
            "Large file — targeted analysis required",

          reply:
            "Large file — targeted analysis required.\n\n" +
            "This file is " +
            Math.round(fileInfo.size / 1024) +
            " KB, which is above Tom's " +
            Math.round(fileInfo.maxSize / 1024) +
            " KB full-analysis limit. Tom will not send " +
            "the entire file to the model.\n\n" +
            "Targeted analysis (chunking / retrieval) is " +
            "required for this file.",

          provider:
            "nvidia-direct",

          model:
            null
        });
      }


      const content =
        readProjectFile(filePath);


      const analysisPrompt = `
Project root:
${DROP_ROOT}

File being inspected:
${filePath}

The following is the actual content of the authorized project file.

----- FILE START -----

${content}

----- FILE END -----

User request:

${question.trim()}

File analysis rules:

1. Analyze only what is supported by the provided source code.
2. Clearly separate facts from inference.
3. Do not claim that you modified files.
4. Do not claim that you executed commands.
5. Do not invent project architecture not supported by the source.
6. If additional files are required, identify the specific files Tom should inspect next.
7. Keep the response focused on the user's request.
`.trim();


      const messages = [
        {
          role: "system",
          content:
            TOM_SYSTEM_PROMPT
        },

        {
          role: "user",
          content:
            analysisPrompt
        }
      ];


      const result =
        await askNvidia(messages);


      if (
        !result ||
        !result.content
      ) {
        throw new Error(
          "NVIDIA returned an empty response"
        );
      }


      return res.json({
        project:
          "Project Workspace",

        file:
          filePath,

        reply:
          result.content,

        provider:
          "nvidia-direct",

        model:
          result.model
      });

    } catch (error) {
      console.error(
        "[Tom File Analysis Error]",
        error
      );

      return res.status(503).json({
        error:
          error.message ||
          "Tom file analysis unavailable"
      });
    }
  }
);


// ---------------------------------------
// TOM ACTION GATEWAY
// ---------------------------------------

// Get all registered tools and their metadata
app.get("/tools", (req, res) => {
  try {
    const capabilityFilter = req.query.capability || null;
    const tools = actionGateway.getRegisteredTools(capabilityFilter);
    return res.json({
      success: true,
      tools: tools,
      count: tools.length
    });
  } catch (error) {
    console.error("[Action Gateway Error]", error);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve registered tools"
    });
  }
});

// Execute a registered tool
app.post("/tools/execute", async (req, res) => {
  try {
    const { tool, args } = req.body;

    if (!tool || typeof tool !== "string") {
      return res.status(400).json({
        success: false,
        error: "Tool name is required"
      });
    }

    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) {
      return res.status(400).json({
        success: false,
        error: "Tool args must be a plain object"
      });
    }

    // Only tools that declare requiresArgs (e.g. vscode.file.read) use client-
    // supplied args, and those args still pass through the shared DROP project
    // path validation (validateProjectPath/readProjectFile) before any file is
    // touched. Zero-argument tools like git.* ignore anything supplied here.
    const result = await actionGateway.executeTool(tool, args);

    if (result.success) {
      return res.json(result);
    } else {
      // Tool not found or execution failed
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error("[Action Gateway Execute Error]", error);
    return res.status(500).json({
      success: false,
      tool: req.body.tool || "unknown",
      error: "Internal gateway error"
    });
  }
});


// ---------------------------------------
// TOM BACKEND HEALTH
// ---------------------------------------

app.get("/health", (req, res) => {
  const health = buildWorkspaceHealth('drop', {
    projectRegistry,
    pluginManager,
    vscodeBridge,
    env: process.env
  });

  const statusCode = health.status === 'ok' ? 200 : 503;
  return res.status(statusCode).json(formatWorkspaceHealthResponse(health));
});

app.get('/projects/:projectId/health', requireKnownProject, (req, res) => {
  const health = buildWorkspaceHealth(req.params.projectId, {
    projectRegistry,
    pluginManager,
    vscodeBridge,
    env: process.env
  });

  return res.status(health.status === 'ok' ? 200 : 503).json(formatWorkspaceHealthResponse(health));
});




// ---------------------------------------
// PLUGIN MARKETPLACE API - PART 1
// Catalog, categories, search
// ---------------------------------------
const pluginRegistry = require('./plugins/registry/plugin-registry');
const pluginManager = require('./plugins/runtime/plugin-manager');
const projectRegistry = require('./plugins/runtime/project-registry');
const vscodeBridge = require('./plugins/vscode/vscode-bridge');
const { buildWorkspaceHealth } = require('./plugins/runtime/workspace-health');

function formatWorkspaceHealthResponse(health) {
  return {
    ...health,
    tomServer: 'connected',
    provider: 'nvidia-direct',
    router: {
      enabled: true,
      configured: health.providers.nvidiaDirect.configured,
      status: health.providers.nvidiaDirect.status
    },
    currentProject: health.project
  };
}

function requireKnownProject(req, res, next) {
  if (!projectRegistry.validateProjectId(req.params.projectId)) {
    return res.status(404).json({ error: 'project_not_found' });
  }
  next();
}

function requireKnownPlugin(req, res, next) {
  if (!pluginRegistry.validatePluginId(req.params.pluginId)) {
    return res.status(404).json({ error: 'plugin_not_found' });
  }
  next();
}

function requireVSCodePlugin(req, res, next) {
  if (!pluginRegistry.validatePluginId('vscode')) {
    return res.status(404).json({ error: 'plugin_not_found' });
  }
  next();
}

app.use('/projects/:projectId/plugins', requireKnownProject);

function pluginStatus(projectId, pluginId) {
  const state = pluginManager.getPluginStatus(projectId, pluginId);
  if (pluginId !== 'vscode' || !state.installed) return state;
  const connection = vscodeBridge.getConnection(projectId);
  return {
    ...state,
    status: !state.enabled
      ? 'disabled'
      : connection.connected
      ? 'connected'
      : (state.enabled ? 'disconnected' : 'configuration_required'),
    connection: state.enabled
      ? connection
      : { ...connection, connected: false, status: 'disabled' }
  };
}

async function requireEnabledVSCodeBridge(req, res, next) {
  try {
    if (!pluginRegistry.validatePluginId('vscode')) {
      return res.status(404).json({ error: 'plugin_not_found' });
    }

    const state = pluginManager.getPluginStatus(req.params.projectId, 'vscode');
    if (!state.installed || !state.enabled) {
      return res.status(409).json({ error: 'vscode_plugin_not_enabled' });
    }

    const detection = await vscodeBridge.detectVSCode();
    if (!detection.installedLocally && !detection.cliAvailable && !detection.bundledCliAvailable) {
      return res.status(503).json({ error: 'vscode_not_installed' });
    }

    next();
  } catch (error) {
    res.status(503).json({ error: 'vscode_unavailable' });
  }
}

app.get('/projects/:projectId/plugins/vscode/bridge/challenge', requireKnownProject, requireEnabledVSCodeBridge, (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(vscodeBridge.beginHandshake(req.params.projectId));
  } catch (error) {
    res.status(error.message === 'project_not_found' ? 404 : 400).json({ error: error.message });
  }
});

app.post('/projects/:projectId/plugins/vscode/bridge/handshake', requireKnownProject, requireEnabledVSCodeBridge, (req, res) => {
  try {
    const connection = vscodeBridge.acceptHandshake(req.params.projectId, req.body);
    res.set('Cache-Control', 'no-store').json({ connection });
  } catch (error) {
    const status = error.message === 'project_not_found' ? 404 : 401;
    res.status(status).json({ error: error.message });
  }
});

app.post('/projects/:projectId/plugins/vscode/bridge/heartbeat', requireKnownProject, requireEnabledVSCodeBridge, (req, res) => {
  try {
    const connection = vscodeBridge.heartbeat(req.params.projectId, req.body);
    res.set('Cache-Control', 'no-store').json({ connection });
  } catch (error) {
    const status = error.message === 'project_not_found' ? 404 : 401;
    res.status(status).json({ error: error.message });
  }
});

app.post('/projects/:projectId/plugins/vscode/bridge/disconnect', requireKnownProject, requireVSCodePlugin, (req, res) => {
  try {
    const result = vscodeBridge.disconnect(req.params.projectId, req.body && req.body.sessionId, req.body && req.body.clientInstanceId);
    res.set('Cache-Control', 'no-store').json(result);
  } catch (error) {
    const status = error.message === 'project_not_found' ? 404 : 401;
    res.status(status).json({ error: error.message });
  }
});


// Topology is a read-only projection; it never writes plugin configuration.
app.get('/projects/:projectId/topology', requireKnownProject, (req, res) => {
  try {
    const { buildTopologySnapshot } = require('./plugins/runtime/topology-model');
    const snapshot = buildTopologySnapshot(req.params.projectId, {
      projectRegistry, pluginRegistry, pluginManager, vscodeBridge, actionGateway
      , activityTracker
    });
    if (!snapshot) return res.status(404).json({ error: 'project_not_found' });
    res.set('Cache-Control', 'no-store').json(snapshot);
  } catch (error) {
    res.status(500).json({ error: 'topology_unavailable' });
  }
});

// GET /plugins - Get full catalog
app.get('/plugins', (req, res) => {
  try {
    const catalog = pluginRegistry.getCatalog();
    res.json(catalog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /plugins/categories - Get available categories
app.get('/plugins/categories', (req, res) => {
  try {
    const categories = pluginRegistry.getCategories();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /plugins/search - Search plugins
app.get('/plugins/search', (req, res) => {
  try {
    const query = req.query.q || '';
    const results = pluginRegistry.searchPlugins(query);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /plugins/:id - Get single plugin by ID
app.get('/plugins/:id', (req, res) => {
  try {
    const plugin = pluginRegistry.getPluginById(req.params.id);
    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }
    res.json(plugin);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ---------------------------------------

// ---------------------------------------
// PLUGIN MARKETPLACE API - PART 2
// Project-scoped plugin management
// ---------------------------------------
// GET /projects/:projectId/plugins - Get installed plugins for a project
app.get('/projects/:projectId/plugins', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const installed = pluginManager.getInstalledPlugins(projectId);
    const enabled = pluginManager.getEnabledPlugins(projectId);

    const catalog = pluginRegistry.getCatalog();
    const projectPlugins = catalog.filter(p => installed.includes(p.id));

    const pluginsWithStatus = projectPlugins.map(plugin => {
      const statusInfo = pluginStatus(projectId, plugin.id);
      return {
        ...plugin,
        installed: statusInfo.installed,
        enabled: statusInfo.enabled,
        status: statusInfo.status
      };
    });

        res.json(pluginsWithStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /projects/:projectId/plugins/:pluginId/status - Get plugin status
app.get('/projects/:projectId/plugins/:pluginId/status', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    if (!pluginRegistry.validatePluginId(pluginId)) {
      return res.status(404).json({ error: 'Plugin not found in catalog' });
    }

    const statusInfo = pluginStatus(projectId, pluginId);
    const plugin = pluginRegistry.getPluginById(pluginId);

    res.json({
      ...plugin,
      installed: statusInfo.installed,
      enabled: statusInfo.enabled,
      status: statusInfo.status
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /projects/:projectId/plugins/:pluginId/install - Install a plugin
app.post('/projects/:projectId/plugins/:pluginId/install', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    if (!pluginRegistry.validatePluginId(pluginId)) {
      return res.status(404).json({ error: 'Plugin not found in catalog' });
    }

    const result = pluginManager.installPlugin(projectId, pluginId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const plugin = pluginRegistry.getPluginById(pluginId);
    const statusInfo = pluginStatus(projectId, pluginId);

    res.json({
      ...plugin,
      installed: statusInfo.installed,
      enabled: statusInfo.enabled,
      status: statusInfo.status,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /projects/:projectId/plugins/:pluginId/uninstall - Uninstall a plugin
app.post('/projects/:projectId/plugins/:pluginId/uninstall', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    const result = pluginManager.uninstallPlugin(projectId, pluginId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /projects/:projectId/plugins/:pluginId/enable - Enable a plugin
app.post('/projects/:projectId/plugins/:pluginId/enable', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    const result = pluginManager.enablePlugin(projectId, pluginId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const plugin = pluginRegistry.getPluginById(pluginId);
    const statusInfo = pluginStatus(projectId, pluginId);

    res.json({
      ...plugin,
      installed: statusInfo.installed,
      enabled: statusInfo.enabled,
      status: statusInfo.status,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /projects/:projectId/plugins/:pluginId/disable - Disable a plugin
app.post('/projects/:projectId/plugins/:pluginId/disable', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const pluginId = req.params.pluginId;

    const result = pluginManager.disablePlugin(projectId, pluginId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const plugin = pluginRegistry.getPluginById(pluginId);
    const statusInfo = pluginStatus(projectId, pluginId);

    res.json({
      ...plugin,
      installed: statusInfo.installed,
      enabled: statusInfo.enabled,
      status: statusInfo.status,
      message: result.message
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ---------------------------------------
// DASHBOARD FALLBACK
// ---------------------------------------

app.get(
  "/{*splat}",
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

// START TOM
// ---------------------------------------

function startServer(port = PORT, host = "0.0.0.0") {
  return app.listen(
    port,
    host,
    () => {
    console.log("");

    console.log(
      `Tom Project Workspace running on port ${port}`
    );

    console.log(
      `Authorized project: ${DROP_ROOT}`
    );

    console.log(
      "Intelligence gateway: NVIDIA Direct"
    );

    console.log(
      "NVIDIA model failover router: enabled"
    );

    console.log("");
    }
  );
}

if (require.main === module) {
  // Clean shutdown: SIGTERM/SIGINT terminate every TOM-supervised process
  // group (managed services + owned commands) BEFORE the server exits, so no
  // orphan dev server outlives TOM. In-process test hosts never run this path.
  let shuttingDown = false;
  const shutdownOnce = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const forced = setTimeout(() => process.exit(1), 5000);
    const done = () => { clearTimeout(forced); process.exit(0); };
    Promise.resolve()
      .then(() => actionGateway.shutdown())
      .catch(() => {})
      .then(done, done);
  };
  process.on("SIGTERM", shutdownOnce);
  process.on("SIGINT", shutdownOnce);
  startServer();
}

module.exports = { app, startServer, findUnauthorizedExecutionAttempt, findUnresolvedServiceRequest, taskStore };
