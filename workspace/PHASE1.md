# TOM Phase 1 — Local Execution & Runtime Control

Implementation reference for the controlled terminal/runtime layer (requirements 1.1–1.29).

## Architecture

One authoritative execution path, layered:

```
chat message
  → runtime-intent.classify()        (deterministic grammar; inspection/negation first)
  → Action Gateway (action-gateway.js)
      ├─ runtime tools → runtime-controller (createRuntimeGateway)
      │     ├─ command-policy   (allowlist, cwd jail, package.json script check)
      │     ├─ process-supervisor (spawn, owned process group, bounded capture)
      │     └─ runtime-probes   (port state, HTTP health, lsof ownership)
      └─ read tools (git.*, vscode.*) — unchanged
```

- `tools/runtime-controller.js` — the runtime gateway: tool registry, approval store, process registry, lifecycle operations, health, shutdown.
- `tools/process-supervisor.js` — `launch()`: spawns with `shell:false, detached:true`, kills the owned process group (`-pid`), never accepts caller-supplied PIDs.
- `tools/command-policy.js` — command allowlist, cwd resolution (traversal/absolute/symlink/nonexistent guards), `inspect()` reads `package.json` scripts, `plainArgs()` strict argument validation.
- `tools/runtime-probes.js` — `portState`, `httpHealth`, `ownsPort` (lsof-based PID↔port ownership proof).
- `tools/runtime-intent.js` — conservative intent grammar; negations ("do not run npm test") and discovery phrasing route to `terminal.discover`, never to execution.
- `tools/terminal-runner.js` — compatibility shell only; `run()` throws "Direct execution disabled".

## Command policy

Allowlist (`command-policy.js`): exactly `npm test`, `npm run build`, `npm run lint`, `npm run dev`. Exact string match, no shell, no argument appendage. Additionally the target package's `package.json` must actually define the script (checked at propose and again at approve). Nonexistent scripts fail closed before approval.

`terminal.discover` (read-only) returns the actual scripts found in `package.json` plus a sha256 of the file.

## Risk & approval model

- Reads (`terminal.discover`, `terminal.status`, `runtime.status/logs/health/port`) execute without approval.
- All mutations (`terminal.run`, `terminal.cancel`, `runtime.start/stop/restart`, plus `execution.approve/reject` bookkeeping) are `riskLevel: "consequential"` — builds/tests/lint mutate artifacts, so nothing mutating is labeled read-only.
- Mutations always enter `pending_approval`; execution happens only via `execution.approve`.
- Approval binds to the exact prepared action (tool + command + script + canonical cwd + projectId + port/healthPath). On approve, the action is re-prepared and byte-compared; any drift → "Approved action is stale".
- Approvals are single-use (consumed on approve *and* reject), expire after `approvalMs` (default 5 min), cap 100 pending.

## Project boundary

`resolveCwd(root, relative)`: relative-only, rejects `..` segments, absolute paths, NUL bytes; lexical containment inside root; `realpathSync` symlink containment; must be an existing directory. `package.json` reads are also realpath-contained.

## Process lifecycle

- `runtime.start` — port conflict check → owned spawn (`--strictPort`, 127.0.0.1) → readiness polling (health probe) within `startupMs` → RUNNING, or terminate + `readiness_timeout`/`startup_failure`/`port_conflict`.
- `runtime.stop` — only services in TOM's own registry; SIGTERM then SIGKILL after `graceMs`; unknown services rejected.
- `runtime.restart` — stop (old process group killed) then start; new PID recorded; per-service lock prevents concurrent lifecycle ops.
- Duplicate start of a live service is refused; stale (dead) records do not block restart.
- PIDs come only from live `ChildProcess` objects; never accepted from callers; descendants killed via process group.

## PID ownership

Only processes spawned by the supervisor (tracked in the in-memory registry) are controllable. `ownsPort` (lsof) proves the listener belongs to our PID before health can pass, so an unrelated squatter on the port can never fake readiness. `terminal.cancel` accepts only executionIds TOM itself issued.

## Port / readiness

`probes.portState` — TCP connect probe with timeout. Readiness requires: process alive + port owned by our PID (lsof group match) + HTTP status 2xx–3xx on the configured health path, within startup timeout. Early crash → `startup_failure`; alive-but-not-ready → `readiness_timeout`; both cleaned up (process group killed) and the service is restartable.

## Health

`runtime.health` = liveness + ownership + HTTP result: `{healthy, reason, statusCode, checkedAt, latencyMs}`. States: `STARTING → RUNNING → STOPPING → STOPPED` or `FAILED` (crash, readiness_timeout, port_conflict, spawn_failure).

## Logs

Per-execution bounded stdout/stderr capture (`maxBytes`, default 256KB); persistent runtimes keep the *tail* (ring behavior), one-shot commands terminate on overflow. Retrieved via `runtime.logs`, tagged per service.

## Errors / recovery

Structured evidence on every exit path: `reason` ∈ success | nonzero_exit | signal | timeout | cancelled | output_limit | spawn_failure | port_conflict | readiness_timeout | startup_failure. Crash → state `FAILED`; restart after any failure is supported; port conflicts leave the foreign listener untouched.

## Security controls

- Default deny; exact-string allowlist; no shell; fixed argv.
- Malformed/extra/prototype-polluting args rejected (`plainArgs`).
- cwd jail incl. symlink + realpath containment; absolute paths and `..` rejected.
- package.json inspected **before** selection; approvals invalidated if package.json changes.
- Approvals: single-use, expiring, bound to exact tool/command/cwd; reject/expiry consume the id.
- `npm run dev` is never executable via `terminal.run` (runtime lifecycle only).
- Negations ("do not run npm test") and inspection phrasing never select execution.
- Bounded output (non-persistent overflow terminates the run), bounded timeouts, bounded pending-approval and active-command counts.
- Termination: SIGTERM → SIGKILL escalation on the owned process group only.

## Tests

```
node --test workspace/tests/         # 161 tests (local runtime)
cd cloud && node --test tests/       # 11 tests (cloud boundary)
cd cloud && npm run build            # boundary verifier (fails closed)
```
Key files: `tests/terminal-runner.test.js` (security/policy/approval/evidence, isolated fixtures), `tests/runtime-e2e.test.js` (full lifecycle + failure paths), `tests/agent-runtime.test.js`, `tests/chat-approval.integration.test.js` (HTTP + approval regression), `tests/chat-code-inspection.integration.test.js` (inspection phrasing is not mistaken for an execution probe), `cloud/tests/cloud-boundary.test.js` (deployable bundle contains no privileged capability).

## Limitations

- POSIX-only (macOS/Linux): owned process groups require it; other platforms fail closed.
- Command set is a fixed allowlist; no arbitrary command execution by design.
- One managed runtime per configured service; service set is factory configuration (trusted app config), not request-supplied.
- Readiness and health require `lsof` ownership evidence. If `lsof` is unavailable, ownership cannot be proven and the runtime fails closed as `listener_not_owned`; there is no HTTP-only fallback.
- Logs are in-memory and bounded; they are not persisted across server restarts.

## Post-Phase-1 security hardening

A post-deployment audit found two live failures. Both were traced to a **stale
running TOM process that predated Phase 1** (the deployed `/chat` handler had no
deterministic runtime/execution branch), plus a genuine gap in the intent
grammar. The hardening below closes the grammar gap and makes the deterministic
termination a written, tested invariant.

### 1. Deterministic results terminate the request (no model fallthrough)

`/chat` now returns immediately from every deterministic branch — a routed
runtime tool (`runtime-intent.classify`), a default-denied command probe, or an
edit/execution approval — and those branches are marked in source as FINAL.
A denied, rejected, or pending request therefore never builds a model request:

- the model can never narrate, invent, or paraphrase an execution result;
- the model can never receive an approval id and echo it as if it were valid.

**Root cause of the corrupted model reply (verified):** in the stale process, a
rejected execution request fell through to the NVIDIA fallback with the raw,
unsanitized browser history (which contained the pending-approval text). The
model then re-emitted that approval text instead of a deterministic rejection.
Current source returns before the fallback, so this is unreachable; the
regression tests assert `modelCalls === 0` for denied, rejected, and pending
paths, and a live (unmocked) probe of `reject execution <id>` returns
`Execution request not performed: Unknown or consumed approval` with
`provider: tom-action-gateway`.

### 2. Approval can never legitimize an unauthorized command

`tools/runtime-intent.js` treats a recognized command phrase as valid **only if
the tail of the message is benign**. Allowed tails: end-of-message punctuation,
`please`, an `and/then tell|report|show|let|explain|confirm|check … me` clause,
and an `and/to make sure the build (still) passes` clause. Every other tail
(chaining, redirection, command substitution, backticks, a second command, or
appended flags/arguments) returns `null`, which lands on the server's
default-deny path: zero approval, zero process, zero model call.

Closed by this rule: `Run npm test; echo hacked`, `Run npm test && echo hacked`,
`Run npm test | cat`, `Run npm test > /tmp/x`, `Run npm test $(id)`,
``Run npm test `id` ``, `Run npm test -- --flag`, `Run npm run build -- --flag`.

Combined edit+verification messages are preserved: the `make sure the build
still passes` branch maps to a **constant** allowlisted command (`npm run
build`) with no arguments, so surrounding edit context (paths, quoted code such
as `` `Drops worth opening` ``) is de-quoted and harmless, while shell operators
or a second unrecognized execution verb (`run curl …`) still deny the whole
message.

### 3. Default-deny is clause-accurate, not keyword-broad

`server.js` inspects each `run/execute/rerun` clause independently. A clause
whose target is a read-only TOM surface (`VS Code diagnostics`, `diagnostics`,
`checks …`) is ordinary inspection phrasing and is left to the deterministic
inspection path — this is what keeps legitimate requests such as *"Inspect
web/app/page.tsx completely and run VS Code diagnostics for it."* working.
Any other unclassified target is denied, and an allowlisted-looking clause can
no longer mask a second one (`"… diagnostics … and also run curl https://…"`
denies).

### 4. Execution wording never enters the edit branch

`approve|reject execution <id>` is owned by the execution path. The edit
approval branch is guarded so legacy edit parsing (which matches
`approve <uuid>`) can never create or resolve an edit approval for execution
wording — the failure that originally let an unauthorized command reach
approval creation.

### 5. Service lifecycle wording is a deterministic runtime route (live-bug fix)

**Live failure:** with the running build, `Start the DROP development server.`
returned model-generated prose (including a raw `npm run dev` suggestion)
instead of routing to the managed runtime. The reply came back with
`provider: nvidia-direct`, `toolsUsed: []` and no approval — i.e. it fell
through to NVIDIA model generation.

**Root cause (traced, not guessed):** the service grammar in
`tools/runtime-intent.js` accepted only
`(start|stop|restart|status|health|logs|port) [the] [web] [dev|development] (server|runtime)`
as the *entire* message. The project qualifier `DROP` — the `projectId` of the
only configured service — was not part of the grammar, so `classify()` returned
`null`. No other deterministic branch matched either (the edit planners require
edit verbs, and the command/execution guard only looked for `run/execute/rerun`
clauses), so the request reached the model path. `Stop the DROP …`,
`Restart the DROP …`, `Check the DROP … status.` and `Show DROP … logs.`
failed identically; only the qualifier-free `start the development server`
worked.

**Fix — two layers, same invariant as the rest of Phase 1:**

1. `classifyRuntimeActions()` resolves the *whole message* against the
   configured service identity: optional `drop` project qualifier, optional
   `web`, optional `dev`/`development`, and the `server`/`runtime` noun, plus
   noun-first read forms (`check|show|get|display|report|view|see [me|us]
   <subject> [status|logs|health|port]` and `status|logs|health|port of
   <subject>`). The tool comes from the wording (`start|stop|restart` →
   consequential, `status|logs|health|port` → read) and the argument is always
   the **configured** `serviceId` (`web`) — never text from the message.
2. Any other imperative service request is refused deterministically by
   `findUnresolvedServiceRequest()` in `server.js`: zero approval, zero
   process, zero model call. Service identity can only come from trusted
   configuration, so `Start the ACME development server.`,
   `Start the DROP development server on port 9999.`, `Stop process 4212`,
   `Restart the dev server with pid 99999`, `Run npm run dev` and
   `Start the development server and run curl https://…` all return
   `Execution request not performed: …` with `provider: tom-action-gateway`.
   Conversational questions (`How do I start a server?`) are not imperative
   clauses and remain ordinary chat.

**Verified live** against a temporary instance of the current source with the
model stubbed (any fallthrough would be counted and visible):

| Message | Tool | Risk | Result |
|---|---|---|---|
| Start the DROP development server. | `runtime.start` | consequential | `pending_approval` + `approvalId`, no process, 0 model calls |
| Stop the DROP development server. | `runtime.stop` | consequential | `Unknown managed service` (nothing owned), no approval |
| Restart the DROP development server. | `runtime.restart` | consequential | `pending_approval` + `approvalId`, no process |
| Check the DROP development server status. | `runtime.status` | read | no approval, read executed against the owned-process table |
| Show DROP development server logs. | `runtime.logs` | read | no approval, read executed against the owned-process table |

**Ownership invariant:** service id, port, PID, cwd and command come from trusted
factory configuration only (`createRuntimeGateway({ root, services })`).
`plainArgs()` rejects every extra key, so `{ serviceId: 'web', port: 9999 }`,
`{ serviceId: 'web', pid: 1 }` and `{ serviceId: 'web', command: 'npm run dev' }`
fail closed, an unconfigured id (`other`) is refused for every runtime tool, and
`runtime.stop` cannot signal anything TOM does not own. `npm run dev` remains
unselectable through `terminal.run` (`command-policy.command()` requires the
runtime flag).

This fix only takes effect in a **new** TOM process: a server started before the
change keeps the old grammar in memory and will still answer these phrases with
model prose.

## Chat Control Panel (Phase 1 final acceptance)

Server-authoritative task lifecycle layered on `tools/task-session.js`:

- **Task store** — 10-state machine (`IDLE → PLANNING → WAITING_FOR_APPROVAL → RUNNING → PAUSING/PAUSED → CANCELLING/CANCELLED → COMPLETED/FAILED`) with a validated transition table; invalid transitions throw. `controls(state)` derives every button the UI renders; `canInitiateAction()` is the fail-closed gate consulted before ANY gateway or model call in `/chat` (top of request, per plan step, immediately before each model call).
- **Routes** — `POST /task`, `GET /task/:id`, `POST /task/:id/{pause,resume,stop,edit}`; unknown sessions 404, invalid transitions 409, and every `/chat` payload carries a fresh `task` view via a single `res.json` exit wrapper (approval-bearing responses wait, everything else completes; failed evidence on a waiting task keeps the live approval alive).
- **Authority revisions** — a changed instruction bumps `revision`; consequential approvals are bound to `{taskId, revision}` at propose time inside the runtime gateway and re-checked at approve time (`Approval invalidated by task edit`). Approval-continuation messages (`approve/reject …`) never bump the revision they approve.
- **Pause** — `PAUSING → PAUSED` at the safe boundary, aborts the in-flight model call (`AbortSignal` through `nvidia-router.js`); the next action is never initiated (zero gateway, zero model, zero approvals) while paused.
- **Stop** — idempotent `CANCELLED`; cancels every task-bound approval (`cancelTaskApprovals`, evidenced in the response), cancels the pending edit approval, and terminates TOM-owned commands via `cancelOwnedExecution` (owned PID only, never a proposal — the operator's explicit Stop is the authorization). The stopped task stays visible and retryable; the cancelled approval can never be revived.
- **Attachments** (`tools/attachment-store.js`) — DATA-only boundary: extension allowlist + explicit executable blocklist, 1 MB / 5-file caps, base64 transport, traversal-proof names, per-task ownership checks. Stored under `.tom-attachments/<taskId>` (mode 0600, `TOM_ATTACHMENT_DIR` overridable for isolation), embedded ONLY into model messages as framed reference data. The module contains no spawn/exec/eval of any kind.
- **Voice** — Web Speech API in `public/tom-controls.js` with graceful degradation (`supported:false` + visible notice), permission-denied notice, editable transcript appended to the composer; sending is always a manual action. The shared module performs no network I/O.
- **Copy/Share** — per-message buttons; share payloads pass `buildShareText()` redaction (API keys, bearer/password/token patterns, AWS keys) before `navigator.share`/clipboard fallback.
- **UI** — buttons derive exclusively from `task.controls` via `TomControls.deriveButtons`; no local busy/pause booleans exist anywhere in `public/app.js`.

Acceptance evidence: `tests/phase1-acceptance.e2e.test.js` boots the REAL server as a clean child process against a local model stub (`TOM_MODEL_BASE_URL`) and drives the S-UI / A-B / Q / R / S scenarios over HTTP only. Two consecutive `node --test tests/` clean-start runs: **218/218 PASS** each.

## Requirement Traceability

| Requirement | Implementation | Test/Evidence | Status |
|---|---|---|---|
| 1.1 Default-deny execution | `command-policy.js` exact allowlist | `terminal-runner.test.js` | PASS |
| 1.2 Exact command matching | Fixed npm commands and argv | `terminal-runner.test.js` | PASS |
| 1.3 Shell/command injection defense | `shell: false`; no user command shell | Operator and chaining tests | PASS |
| 1.4 Argument validation | `plainArgs()` rejects extra and malformed keys | Malformed-argument tests | PASS |
| 1.5 cwd containment | Relative cwd, lexical and realpath jail | Traversal/absolute cwd tests | PASS |
| 1.6 Symlink escape defense | Realpath containment checks | Symlink boundary test | PASS |
| 1.7 Package script validation | `package.json` checked before proposal and approval | Missing-script/hash-change test | PASS |
| 1.8 Approval gate | Mutations become pending approvals | Approval tests | PASS |
| 1.9 Approval expiry | Expiring, bounded approval map | Expiry test | PASS |
| 1.10 Exact approval binding | Re-prepared action compared at approval | Changed-action tests | PASS |
| 1.11 Single-use approval | Approval consumed before execution/rejection | Replay/reject tests | PASS |
| 1.12 Project/service binding | Prepared action includes project and service identity | Runtime controller review | PASS |
| 1.13 PID ownership | PIDs come only from managed `ChildProcess` objects | Owned-cancellation test | PASS |
| 1.14 Process-group cleanup | Owned detached group, SIGTERM then SIGKILL | Descendant cleanup test | PASS |
| 1.15 Lifecycle states | Start, stop, restart, failure transitions | Runtime E2E lifecycle test | PASS |
| 1.16 Duplicate process detection | Canonical `serviceId`, per-service lock, stale-record recovery | Sequential and concurrent duplicate-start probes | PASS |
| 1.17 Port conflict isolation | Conflict detected before launch; foreign listener untouched | Port-conflict E2E test | PASS |
| 1.18 Readiness verification | Liveness, owned listener, and HTTP health required | Readiness E2E tests | PASS |
| 1.19 Health evidence | Structured health reason/status/timing | Health failure E2E test | PASS |
| 1.20 Bounded logs | Bounded capture and persistent tail | Output-limit test | PASS |
| 1.21 Timeout/cancellation | Bounded timeout and owned cancellation | Timeout/cancellation tests | PASS |
| 1.22 Crash/restart recovery | Dead handles become failed and restartable | Crash/restart E2E test | PASS |
| 1.23 Structured failure evidence | Distinct exit, signal, timeout, and startup reasons | Failure evidence tests | PASS |
| 1.24 Discovery without execution | `terminal.discover` reads scripts only | Discovery tests | PASS |
| 1.25 Negation/inspection routing | Conservative intent grammar routes discovery phrases safely | Intent classification tests | PASS |
| 1.26 Resource bounds | Limits for approvals, commands, output, and time | Full runtime test suite | PASS |
| 1.27 Gateway/legacy integration | Action Gateway is authoritative; legacy runner fails closed | Regression and integration tests | PASS |
| 1.28 Documentation and Git release | This traceability document plus reviewed release commit | `PHASE1.md`, Git status/diff, release commit | PASS |
| 1.29 Phase completion | Requirements 1.1-1.28 complete and verified | Phase 1 completion snapshot: 154/154 regression, 37/37 focused, release verification (current suite: 218/218 across two consecutive clean-start runs — was 168/168 pre-Control-Panel, see Post-Phase-1 security hardening) | PASS |
| 1.30 Live service-phrasing routing | Whole-message service grammar (`classifyRuntimeActions`) routes the five DROP phrases to `runtime.*` with the configured `serviceId` | `chat-runtime-routing.integration.test.js`, `runtime-e2e.test.js` | PASS |
| 1.31 Unresolved service default-deny | `findUnresolvedServiceRequest()` refuses unknown project/service/port/PID wording with zero approval, process and model calls | `chat-runtime-routing.integration.test.js` | PASS |
| 1.32 Runtime ownership arguments | Port/PID/cwd/command are configuration only; `plainArgs()` and the service allowlist fail closed | `runtime-e2e.test.js` ownership test | PASS |
| 1.33 Task lifecycle & control panel | `task-session.js` state machine, `/task` routes, `/chat` fail-closed gate, server-derived `controls` | `task-session.test.js`, `chat-task-control.integration.test.js`, `ui-control-panel.test.js` | PASS |
| 1.34 Approval↔task authority binding | Approvals bound to `{taskId, revision}` at propose, re-checked at approve; Stop cancels task-bound approvals | `runtime-e2e.test.js` binding test, `chat-task-control.integration.test.js` (J/K) | PASS |
| 1.35 Attachment data boundary | `attachment-store.js`: allowlist/blocklist, 1 MB/5-file caps, traversal-proof names, per-task ownership; no execution primitives | `attachment-store.test.js`, `chat-attachments.integration.test.js` | PASS |
| 1.36 Voice, copy/share controls | Web Speech wrapper with graceful degradation + manual send; redacted share payloads | `tom-controls.test.js`, `ui-control-panel.test.js` | PASS |
| 1.37 Black-box acceptance | Clean child server + model stub over real HTTP: S-UI, A/B stale-status, Q lifecycle, R attachments, S controls | `phase1-acceptance.e2e.test.js` — two consecutive clean-start runs, 218/218 each | PASS |
