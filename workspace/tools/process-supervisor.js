// Internal execution mechanism. Only the runtime gateway supplies validated actions.
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const now = () => new Date().toISOString();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function launch(definition, { timeoutMs, maxBytes, graceMs, persistent = false, executable = 'npm' }) {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Owned process groups require a supported POSIX platform');
  const started = Date.now();
  const evidence = { executionId: randomUUID(), projectId: definition.projectId, serviceId: definition.serviceId || null,
    command: definition.command, cwd: definition.cwd, pid: null, startedAt: now(), completedAt: null, durationMs: 0,
    state: 'STARTING', exitCode: null, signal: null, reason: null, stdout: '', stderr: '', stdoutTruncated: false,
    stderrTruncated: false, timedOut: false, cancelled: false, error: null };
  let child, alive = true, finished = false, timer, killTimer, resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const buffers = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  function signalGroup(signal) {
    // PID is obtained only from our live ChildProcess; never accept caller-supplied PIDs.
    if (!child?.pid || finished) return;
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') evidence.error = error.code; }
  }
  function terminate(reason) {
    if (finished) return done;
    if (!evidence.reason) evidence.reason = reason;
    evidence.timedOut = evidence.reason === 'timeout';
    evidence.cancelled = evidence.reason === 'cancelled';
    evidence.state = 'STOPPING';
    signalGroup('SIGTERM');
    if (!killTimer) killTimer = setTimeout(() => signalGroup('SIGKILL'), graceMs);
    return done;
  }
  function capture(stream, chunk) {
    const joined = Buffer.concat([buffers[stream], chunk]);
    if (joined.length > maxBytes) {
      evidence[stream + 'Truncated'] = true;
      buffers[stream] = persistent ? joined.subarray(joined.length - maxBytes) : joined.subarray(0, maxBytes);
      if (!persistent) terminate('output_limit');
    } else buffers[stream] = joined;
    evidence[stream] = buffers[stream].toString('utf8');
  }
  function complete(code, signal) {
    if (finished) return;
    finished = true; alive = false;
    clearTimeout(timer); clearTimeout(killTimer);
    evidence.exitCode = code; evidence.signal = signal;
    evidence.reason ||= signal ? 'signal' : code === 0 ? 'success' : 'nonzero_exit';
    evidence.state = ['stopped', 'cancelled'].includes(evidence.reason) ? 'STOPPED' : evidence.reason === 'success' ? 'EXITED' : 'FAILED';
    evidence.completedAt = now(); evidence.durationMs = Date.now() - started;
    resolveDone(snapshot());
  }
  function snapshot() { return { ...evidence, durationMs: finished ? evidence.durationMs : Date.now() - started }; }
  try {
    child = spawn(executable, definition.args, {
      cwd: definition.cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', NO_COLOR: '1',
        TOM_RUNTIME_ID: evidence.executionId }
    });
    evidence.pid = child.pid || null;
    child.stdout.on('data', chunk => capture('stdout', chunk));
    child.stderr.on('data', chunk => capture('stderr', chunk));
    child.on('error', error => { evidence.reason = 'spawn_failure'; evidence.error = error.code || error.message; });
    child.on('exit', () => {
      alive = false;
      // Kill descendants still in the owned group before PID identity can be discarded.
      signalGroup('SIGKILL');
    });
    child.on('close', complete);
    if (timeoutMs) timer = setTimeout(() => terminate('timeout'), timeoutMs);
  } catch (error) {
    evidence.reason = 'spawn_failure'; evidence.error = error.code || error.message; complete(null, null);
  }
  return { done, snapshot, terminate, get alive() { return alive && !finished; } };
}
module.exports = { launch, delay };
