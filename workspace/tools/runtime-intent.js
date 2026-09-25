// Conservative deterministic grammar. Inspection and negation take precedence.
// SECURITY: classify() emits ONLY exact allowlisted commands. If the raw
// message contains anything beyond the recognized command phrase — shell
// operators, chaining, redirection, command substitution, backticks, or
// appended flags/arguments — classification returns null so the request is
// denied before any approval can be created. The gateway's exact-match policy
// is the second layer, never the only layer.
//
// TAIL RULES
// ----------
// A recognized command phrase ("run npm test") may only be followed by:
//   * end-of-message punctuation,
//   * a politeness word ("please"),
//   * an "and/then tell|report|show|let|explain|confirm|check ... me" clause,
//   * an "and/to make sure the build (still) passes" clause.
// None of those may contain shell metacharacters. Every other tail
// (chaining, redirection, substitution, appended flags, a second command)
// forces classification to null, which lands on the server's default-deny
// short-circuit: zero approval, zero process, zero model call.
const SHELL_METACHARS = /[;&|`$><]/;
// --------------------------------------------------------------- runtime
// Managed service wording. The ONLY addressable service identity is the
// configured one (projectId "drop" + serviceId "web"). The subject must
// therefore be a whole-message service phrase: an optional project qualifier
// ("drop"), an optional "web", an optional "dev"/"development", and the
// server/runtime noun. Nothing else — no extra words, ports, PIDs, paths or
// other project names — can address a process. Unresolved service requests
// are refused deterministically by the server (never sent to the model).
const SERVICE_SUBJECT =
  /^(?:the\s+)?(?:drop\s+)?(?:web\s+)?(?:dev(?:elopment)?\s+)?(?:server|runtime)$/;
const RUNTIME_ACTIONS = ['start', 'stop', 'restart', 'status', 'health', 'logs', 'port'];
const RUNTIME_READ_VERBS = /^(?:check|show|get|display|report|view|see)$/;
const RUNTIME_READ_NOUNS = { status: 'status', state: 'status', logs: 'logs', health: 'health', port: 'port' };
const RUNTIME_READ_ADDRESS = /^(status|logs|health|port|state) of (.+)$/;

// Deterministic, whole-message service-lifecycle grammar. Returns the runtime
// read tool for noun-first forms ("check the drop development server status",
// "status of the drop dev server") and the action tool for verb-first forms.
function classifyRuntimeActions(text) {
  const cleaned = text.replace(/[.!?]+$/, '').replace(/^please\s+/, '').trim();
  if (!cleaned) return null;
  const address = cleaned.match(RUNTIME_READ_ADDRESS);
  if (address && SERVICE_SUBJECT.test(address[2])) return 'runtime.' + RUNTIME_READ_NOUNS[address[1]];
  const words = cleaned.split(/\s+/);
  if (RUNTIME_ACTIONS.includes(words[0])) {
    return SERVICE_SUBJECT.test(words.slice(1).join(' ')) ? 'runtime.' + words[0] : null;
  }
  if (RUNTIME_READ_VERBS.test(words[0])) {
    const subject = words.slice(1);
    if (subject.length > 1 && ['me', 'us'].includes(subject[0])) subject.shift();
    let noun = 'status';
    if (subject.length > 1 && Object.hasOwn(RUNTIME_READ_NOUNS, subject[subject.length - 1])) noun = subject.pop();
    return SERVICE_SUBJECT.test(subject.join(' ')) ? 'runtime.' + RUNTIME_READ_NOUNS[noun] : null;
  }
  return null;
}
const BUILD_ENSURE = /\bmake sure (?:the )?build (?:still )?passes\b/;
const REPORT_CLAUSE =
  /^(?:and|then)\s+(?:please\s+)?(?:tell|report|show|let|explain|confirm|check)\b[\s\S]*\b(?:me|us)\b/;

function normalizeTail(tail) {
  return String(tail || '').replace(/^[.!?\s]+/, '').replace(/[.!?\s]+$/, '').toLowerCase();
}

// True only when the text following the recognized command phrase is benign.
function isBenignTail(tail) {
  const rest = normalizeTail(tail);
  if (!rest) return true;
  if (SHELL_METACHARS.test(rest)) return false;
  if (/^please[.!?]*$/.test(rest)) return true;
  if (REPORT_CLAUSE.test(rest)) return true;
  if (BUILD_ENSURE.test(rest) && !/\b(?:run|execute|rerun|re-run)\b/.test(rest)) return true;
  return false;
}

// Removes quoted spans so quoted CODE in an edit request ("`Drops worth
// opening`") is never mistaken for shell text (backticks) when scanning.
function stripQuotedSpans(text) {
  return String(text || '').replace(/`[^`]*`|"[^"]*"|'[^']*'/g, ' ');
}
function classify(message) {
  const text = String(message || '').trim().toLowerCase();
  const approval = text.match(/^(approve|reject) execution ([0-9a-f-]{36})[.!]?$/);
  if (approval) return { tool: 'execution.' + approval[1], args: { approvalId: approval[2] } };
  if (/\b(?:do not|don't|dont|never|without|not)\s+(?:\w+\s+)?(?:run|execute|start|restart|stop)\b/.test(text) || /\b(?:what|which|inspect|discover|find|list|show|explain)\b[^.]*\b(?:tests?|scripts?|commands?|package\.json|npm|build|lint)\b/.test(text)) {
    return /\b(?:test|script|command|package\.json|npm|build|lint)/.test(text) ? { tool: 'terminal.discover', args: { cwd: 'web' } } : null;
  }
  const runtimeTool = classifyRuntimeActions(text);
  if (runtimeTool) return { tool: runtimeTool, args: { serviceId: 'web' } };
  const command = text.match(/(?:^|[.!]\s*|\band\s+)(?:please\s+)?(?:run|execute|rerun|re-run)\s+(?:(?:the|drop)\s+)*(?:npm\s+(?:run\s+)?)?(tests?(?:\s+suite)?|build|lint)\b/);
  const ensureBuild = text.match(BUILD_ENSURE);
  // (A) An explicit "run/execute <target>" phrase must be the whole request:
  // only benign tails pass. "Run npm test; echo hacked", "Run npm test && ...",
  // "Run npm test > /tmp/x", "Run npm test `id`" and "Run npm run build --
  // --flag" all classify to NULL here, so the server denies them before any
  // approval or process exists.
  if (command && !isBenignTail(String(message || '').slice(command.index + command[0].length))) {
    return null;
  }
  // (B) "... and make sure the build still passes." is the combined
  // edit+verification flow (see planVerification). It maps to a CONSTANT
  // allowlisted command ("npm run build") with no arguments, so surrounding
  // edit context — file paths, quoted code such as `Drops worth opening` — is
  // harmless and is de-quoted before scanning. It is still denied when the
  // same sentence carries shell operators/substitution or a second,
  // unrecognized execution verb: that is an unauthorized command probe hiding
  // behind an allowlisted one.
  if (!command && ensureBuild) {
    const scanned = stripQuotedSpans(text);
    if (/[;&|><]/.test(scanned) || /\$[({]/.test(scanned)) return null;
    const buildIndex = scanned.indexOf(ensureBuild[0]);
    const prefix = buildIndex < 0 ? scanned : scanned.slice(0, buildIndex);
    if (/\b(?:run|execute|rerun|re-run)\b/.test(prefix)) return null;
  }
  if (command || ensureBuild) {
    const script = command ? command[1].startsWith('test') ? 'test' : command[1] : 'build';
    return { tool: 'terminal.run', args: { command: script === 'test' ? 'npm test' : 'npm run ' + script, cwd: 'web' } };
  }
  return null;
}
/*
  RENDERING

  Every runtime result carries an explicit `kind` (service | logs | port) or is
  a command execution (command + numeric exitCode). Rendering is keyed off that
  shape ONLY, so a managed-service snapshot can never be rendered as — or
  substituted by — the previous execution's stdout/stderr evidence. Before this
  was shape-keyed, `typeof data.exitCode !== "undefined"` matched a service
  snapshot (whose exitCode came from the earlier start execution, possibly
  null), so "Status of the DROP development server." re-displayed stale
  "Verification ... npm run dev" output instead of current state.
*/
const SERVICE_STATES = ['STARTING', 'RUNNING', 'STOPPING', 'STOPPED', 'FAILED'];
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours) return hours + 'h ' + (minutes % 60) + 'm';
  if (minutes) return minutes + 'm ' + (seconds % 60) + 's';
  return seconds + 's';
}
function renderService(data) {
  const lines = ['Runtime state: ' + data.state,
    'Project: ' + data.projectId,
    'Service: ' + data.serviceId,
    'PID: ' + (data.pid === null || data.pid === undefined ? 'none' : data.pid),
    'Port: ' + data.port + (data.url ? ' (' + data.url + ')' : ''),
    'Liveness: ' + (data.liveness || 'unknown'),
    'Health: ' + (data.health
      ? (data.health.healthy ? 'ready' : 'not ready') + ' (' + data.health.reason + ')'
      : 'unknown'),
    'Execution: ' + (data.executionId || 'none'),
    'Started: ' + (data.startedAt || 'n/a')];
  if (data.state === 'RUNNING') lines.push('Uptime: ' + formatDuration(data.uptimeMs));
  if (data.error) lines.push('Error: ' + data.error);
  if (data.reason) lines.push('Last exit reason: ' + data.reason);
  if (Number.isInteger(data.exitCode)) lines.push('Last exit code: ' + data.exitCode);
  return lines.join('\n');
}
function renderLogs(data) {
  return ['Runtime logs: ' + data.state + ' (service ' + data.serviceId + ', execution ' + (data.executionId || 'none') + ')',
    data.stdout ? 'stdout:\n' + data.stdout + (data.stdoutTruncated ? '\n... (stdout truncated)' : '') : 'stdout: (empty)',
    data.stderr ? 'stderr:\n' + data.stderr + (data.stderrTruncated ? '\n... (stderr truncated)' : '') : 'stderr: (empty)'
  ].join('\n');
}
function renderPort(data) {
  return ['Port: ' + data.port + ' on ' + data.host,
    'Listening: ' + (data.occupied ? 'yes' : 'no'),
    'Probe: ' + data.reason,
    'Owned by TOM managed PID: ' + (data.owned ? String(data.ownerPid) : 'no' + (data.ownerPid ? ' (managed PID ' + data.ownerPid + ' does not hold this port)' : '')),
    'URL: ' + data.url].join('\n');
}
function render(result) {
  if (!result.success) return 'Execution request not performed: ' + result.error;
  if (result.data.status === 'pending_approval') {
    return 'Approval required for consequential execution.\n' + JSON.stringify(result.data.action, null, 2) +
      '\nApproval ID: ' + result.data.approvalId + '\nExpires: ' + result.data.expiresAt +
      '\nReply "approve execution ' + result.data.approvalId + '" or "reject execution ' + result.data.approvalId + '".';
  }
  const data = result.data || {};
  if (data.kind === 'service' && SERVICE_STATES.includes(data.state)) return renderService(data);
  if (data.kind === 'logs') return renderLogs(data);
  if (data.kind === 'port') return renderPort(data);
  if (typeof data.command === 'string' && Number.isInteger(data.exitCode)) {
    const status = data.exitCode === 0 && !data.timedOut ? 'passed' : 'failed';
    return [
      `Verification ${status}: ${data.command}`,
      `Exit code: ${data.exitCode}`,
      data.stdout && data.stdout.trim() ? 'Output: ' + data.stdout.trim() : null,
      data.stderr && data.stderr.trim() ? 'Errors: ' + data.stderr.trim() : null
    ].filter(Boolean).join('\n');
  }
  return JSON.stringify(data, null, 2);
}
module.exports = { classify, render, classifyRuntimeActions };
