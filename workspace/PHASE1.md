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
node --test workspace/tests/
```
Key files: `tests/terminal-runner.test.js` (security/policy/approval/evidence, isolated fixtures), `tests/runtime-e2e.test.js` (full lifecycle + failure paths), `tests/agent-runtime.test.js`, `tests/chat-approval.integration.test.js` (HTTP + approval regression).

## Limitations

- POSIX-only (macOS/Linux): owned process groups require it; other platforms fail closed.
- Command set is a fixed allowlist; no arbitrary command execution by design.
- One managed runtime per configured service; service set is factory configuration (trusted app config), not request-supplied.
- Readiness and health require `lsof` ownership evidence. If `lsof` is unavailable, ownership cannot be proven and the runtime fails closed as `listener_not_owned`; there is no HTTP-only fallback.
- Logs are in-memory and bounded; they are not persisted across server restarts.

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
| 1.29 Phase completion | Requirements 1.1-1.28 complete and verified | 154/154 regression, 37/37 focused, release verification | PASS |
