const crypto = require('node:crypto');
const policy = require('./command-policy');
const { launch, delay } = require('./process-supervisor');
const probes = require('./runtime-probes');

const MUTATIONS = ['terminal.run', 'terminal.cancel', 'runtime.start', 'runtime.stop', 'runtime.restart'];
const READS = ['terminal.discover', 'terminal.status', 'runtime.status', 'runtime.logs', 'runtime.health', 'runtime.port', 'runtime.openApp'];
const TOOLS = [...MUTATIONS, ...READS, 'execution.approve', 'execution.reject'];
// Factory configuration is trusted application configuration, never tool/request arguments.
function createRuntimeGateway({ root, projectId = 'drop', services = { web: { cwd: 'web', host: 'localhost', port: 5173, healthPath: '/' } },
  timeoutMs = 120000, startupMs = 15000, graceMs = 500, maxBytes = 256 * 1024, approvalMs = 300000,
  executable = 'npm' }) {
  for (const value of [timeoutMs, startupMs, graceMs, maxBytes, approvalMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Runtime limits must be positive integers');
  }
  services = JSON.parse(JSON.stringify(services));
  const approvals = new Map(), processes = new Map(), commands = new Map(), locks = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));
  const error = (tool, message) => ({ success: false, tool, error: message });
  // Browser destinations are a closed server-owned allowlist. A request, tool
  // argument, model reply, healthPath, or port observed on another process can
  // never extend this set.
  const browserOrigins = new Map(Object.entries(services).map(([id, config]) =>
    [id, `http://${config.host || 'localhost'}:${config.port}`]));
  async function openAppEvidence(record, config) {
    const result = record?.handle?.snapshot() || {};
    const pid = result.pid || null;
    const state = await probes.portState(config.port);
    const live = Boolean(pid && record?.handle?.alive) && record.state === 'RUNNING';
    const healthy = Boolean(record?.health?.healthy);
    const owned = live && healthy && state.occupied && await probes.ownsPort(pid, config.port);
    return owned ? { serviceId: record.serviceId, projectId, url: browserOrigins.get(record.serviceId),
      executionId: result.executionId || null, pid, healthy: true } : null;
  }
  function service(id) {
    if (typeof id !== 'string' || !Object.hasOwn(services, id)) throw new Error('Unknown configured service');
    const config = services[id];
    if (config.host !== undefined && config.host !== 'localhost') throw new Error('Invalid service configuration');
    if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 ||
      !['localhost', '127.0.0.1'].includes(config.host) || typeof config.healthPath !== 'string' || !config.healthPath.startsWith('/') || config.healthPath.startsWith('//')) throw new Error('Invalid service configuration');
    return config;
  }
  /*
    CURRENT-STATE VIEWS (defect: stale execution evidence)

    The supervised process record contains the *previous execution's* evidence
    (command, stdout, stderr, exitCode). Spreading that record into a read
    result made "Status of the DROP development server." re-render the last
    start execution's output instead of current state. Every runtime result is
    therefore shaped into ONE of the explicit views below, and none of them
    ever carries command/stdout/stderr except the logs view, where logs are the
    requested data.
  */
  function uptimeMs(result) {
    const parsed = result.startedAt ? Date.parse(result.startedAt) : NaN;
    return Number.isFinite(parsed) ? Math.max(0, Date.now() - parsed) : 0;
  }
  function serviceView(record) {
    if (!record) throw new Error('Unknown managed process');
    const result = record.handle?.snapshot() || {};
    if (record.handle && !record.handle.alive && !['STOPPED', 'FAILED'].includes(record.state)) record.state = 'FAILED';
    const alive = Boolean(record.handle?.alive) && !['STOPPED', 'FAILED'].includes(record.state);
    return { kind: 'service', projectId, serviceId: record.serviceId, state: record.state,
      pid: alive ? result.pid || null : null, port: record.port, url: `http://localhost:${record.port}`,
      liveness: alive ? 'alive' : 'not_running', health: record.health || null,
      executionId: result.executionId || null, startedAt: result.startedAt || null,
      uptimeMs: alive ? uptimeMs(result) : 0, exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
      reason: alive ? null : result.reason || null, error: record.error || result.error || null };
  }
  function logsView(record) {
    if (!record) throw new Error('Unknown managed process');
    const result = record.handle?.snapshot() || {};
    return { kind: 'logs', projectId, serviceId: record.serviceId, state: record.state,
      pid: record.handle?.alive ? result.pid || null : null, executionId: result.executionId || null,
      startedAt: result.startedAt || null, stdout: result.stdout || '', stderr: result.stderr || '',
      stdoutTruncated: Boolean(result.stdoutTruncated), stderrTruncated: Boolean(result.stderrTruncated),
      capturedAt: new Date().toISOString() };
  }
  function prepare(tool, args) {
    if (tool === 'terminal.run') {
      policy.plainArgs(args, ['command', 'cwd']);
      const relativeCwd = args.cwd === undefined ? 'web' : args.cwd;
      return { tool, projectId, relativeCwd, ...policy.command(root, relativeCwd, args.command) };
    }
    if (tool === 'terminal.cancel') {
      policy.plainArgs(args, ['executionId']);
      if (typeof args.executionId !== 'string' || !commands.has(args.executionId)) throw new Error('Unknown owned execution');
      return { tool, projectId, executionId: args.executionId };
    }
    policy.plainArgs(args, ['serviceId']);
    const config = service(args.serviceId);
    const record = processes.get(args.serviceId);
    if (tool === 'runtime.stop') {
      if (!record) throw new Error('Unknown managed service');
      return { tool, projectId, serviceId: args.serviceId, executionId: record.handle?.snapshot().executionId || null };
    }
    return { tool, projectId, serviceId: args.serviceId, relativeCwd: config.cwd,
      ...policy.command(root, config.cwd, 'npm run dev', true), port: config.port, healthPath: config.healthPath,
      previousExecutionId: record?.handle?.snapshot().executionId || null };
  }
  function cleanApprovals() {
    for (const [id, item] of approvals) if (item.expires <= Date.now()) approvals.delete(id);
  }
  function propose(tool, args, context = {}) {
    cleanApprovals();
    if (approvals.size >= 100) throw new Error('Pending approval limit reached');
    const action = prepare(tool, args);
    const approvalId = crypto.randomUUID(), expires = Date.now() + approvalMs;
    // Approvals proposed for a chat task are bound to that task's authority
    // revision. Editing the task instruction afterwards (new user authority)
    // makes these approvals permanently stale — checked at approve time.
    const bound = context && typeof context.taskId === 'string' && Number.isInteger(context.revision)
      ? { context: { taskId: context.taskId, revision: context.revision } } : {};
    approvals.set(approvalId, { action, args: clone(args), expires, ...bound });
    return { status: 'pending_approval', riskLevel: 'consequential', approvalId,
      expiresAt: new Date(expires).toISOString(), action: clone(action) };
  }
  async function health(record) {
    const state = serviceView(record);
    let result;
    if (!record.handle?.alive || state.state === 'STOPPED' || state.state === 'FAILED') result = { healthy: false, reason: 'process_not_running', checkedAt: new Date().toISOString(), latencyMs: 0 };
    else if (!await probes.ownsPort(state.pid, record.port)) result = { healthy: false, reason: 'listener_not_owned', checkedAt: new Date().toISOString(), latencyMs: 0 };
    else result = await probes.httpHealth(record.port, record.healthPath);
    record.health = result;
    return { ...state, health: result };
  }
  async function stop(record) {
    if (!record) throw new Error('Unknown managed service');
    if (record.handle?.alive) {
      record.state = 'STOPPING';
      await record.handle.terminate('stopped');
    }
    record.state = 'STOPPED';
    record.health = { healthy: false, reason: 'stopped', checkedAt: new Date().toISOString(), latencyMs: 0 };
    return serviceView(record);
  }
  async function start(action) {
    const existing = processes.get(action.serviceId);
    if (existing?.handle?.alive) throw new Error('Service already running');
    const record = { serviceId: action.serviceId, state: 'STARTING', port: action.port, healthPath: action.healthPath };
    processes.set(action.serviceId, record);
    const port = await probes.portState(action.port);
    if (port.occupied) {
      record.state = 'FAILED'; record.error = 'port_conflict';
      return serviceView(record);
    }
    const definition = { ...action, args: [...action.args, '--', '--host', '127.0.0.1', '--port', String(action.port), '--strictPort'] };
    record.handle = launch(definition, { timeoutMs: 0, maxBytes, graceMs, persistent: true, executable });
    record.handle.done.then(() => { if (!['STOPPED', 'STOPPING'].includes(record.state)) record.state = 'FAILED'; });
    const deadline = Date.now() + startupMs;
    while (Date.now() < deadline && record.handle.alive) {
      const status = await health(record);
      if (status.health.healthy && record.handle.alive) { record.state = 'RUNNING'; return serviceView(record); }
      await delay(50);
    }
    const reason = record.handle.alive ? 'readiness_timeout' : 'startup_failure';
    await record.handle.terminate(reason);
    record.error = reason; record.state = 'FAILED';
    return serviceView(record);
  }
  async function execute(action) {
    if (action.tool === 'terminal.cancel') {
      const handle = commands.get(action.executionId);
      return handle.terminate('cancelled');
    }
    if (action.tool === 'terminal.run') {
      if ([...commands.values()].filter(handle => handle.alive).length >= 4) throw new Error('Active command limit reached');
      // Retain bounded completed evidence; active handles are never evicted.
      for (const [id, handle] of commands) if (commands.size >= 50 && !handle.alive) commands.delete(id);
      const handle = launch(action, { timeoutMs, maxBytes, graceMs, executable });
      commands.set(handle.snapshot().executionId, handle);
      return handle.done;
    }
    if (locks.has(action.serviceId)) throw new Error('Service operation already in progress');
    locks.add(action.serviceId);
    try {
      if (action.tool === 'runtime.stop') return await stop(processes.get(action.serviceId));
      if (action.tool === 'runtime.restart' && processes.has(action.serviceId)) await stop(processes.get(action.serviceId));
      return await start(action);
    } finally { locks.delete(action.serviceId); }
  }
  async function executeTool(tool, args = {}, context = {}) {
    try {
      if (!TOOLS.includes(tool)) throw new Error('Unknown runtime tool');
      let data;
      if (MUTATIONS.includes(tool)) data = propose(tool, args, context);
      else if (tool === 'execution.approve' || tool === 'execution.reject') {
        policy.plainArgs(args, ['approvalId']);
        const pending = approvals.get(args.approvalId);
        if (!pending) throw new Error('Unknown or consumed approval');
        approvals.delete(args.approvalId); // Single use, including rejected/stale/failed actions.
        if (pending.expires <= Date.now()) throw new Error('Approval expired');
        if (tool === 'execution.reject') data = { status: 'rejected', approvalId: args.approvalId, action: pending.action };
        else {
          // Task-authority binding: an approval proposed before an instruction
          // edit (revision bump) or under a different task can never execute.
          if (pending.context && (typeof context.taskId !== 'string' || context.taskId !== pending.context.taskId ||
            !Number.isInteger(context.revision) || context.revision !== pending.context.revision)) {
            throw new Error('Approval invalidated by task edit');
          }
          const current = prepare(pending.action.tool, pending.args);
          if (JSON.stringify(current) !== JSON.stringify(pending.action)) throw new Error('Approved action is stale');
          data = { ...await execute(current), approvalId: args.approvalId, action: current };
        }
      } else if (tool === 'terminal.discover') {
        policy.plainArgs(args, ['cwd']); data = { projectId, ...policy.inspect(root, args.cwd === undefined ? 'web' : args.cwd) };
      } else if (tool === 'terminal.status') {
        policy.plainArgs(args, ['executionId']);
        if (args.executionId !== undefined && typeof args.executionId !== 'string') throw new Error('Invalid executionId');
        if (args.executionId && !commands.has(args.executionId)) throw new Error('Unknown owned execution');
        data = args.executionId ? commands.get(args.executionId).snapshot() : [...commands.values()].map(handle => handle.snapshot());
      } else {
        policy.plainArgs(args, ['serviceId']); const config = service(args.serviceId);
        if (tool === 'runtime.port') {
          // Current listener evidence plus whether that listener is the managed
          // process TOM owns. The port itself is configuration, never an argument.
          const state = await probes.portState(config.port);
          const record = processes.get(args.serviceId);
          const ownerPid = record?.handle?.alive ? record.handle.snapshot().pid || null : null;
          data = { kind: 'port', projectId, serviceId: args.serviceId, url: `http://localhost:${config.port}`,
            ...state, ownerPid,
            owned: Boolean(ownerPid && state.occupied && await probes.ownsPort(ownerPid, config.port)) };
        } else {
          const record = processes.get(args.serviceId);
          if (tool === 'runtime.logs') data = logsView(record);
          else data = tool === 'runtime.health' ? await health(record) : serviceView(record);
        }
      }
      return { success: true, tool, data, timestamp: new Date().toISOString() };
    } catch (failure) { return error(tool, failure.message); }
  }
  // Task-control plane (Stop): drop every pending approval bound to a task.
  // Returns the cancelled ids so the server can record the evidence.
  function cancelTaskApprovals(taskId) {
    if (typeof taskId !== 'string') return [];
    const cancelled = [];
    for (const [id, pending] of [...approvals]) {
      if (pending.context && pending.context.taskId === taskId) {
        approvals.delete(id);
        cancelled.push(id);
      }
    }
    return cancelled;
  }
  /*
    Task-control plane (Stop): terminate a TOM-owned command directly.
    This NEVER proposes and never starts anything — it only terminates a
    process this gateway itself spawned (commands registry, owned PID only),
    authorized by the operator's explicit Stop through the task-store gate.
  */
  async function cancelOwnedExecution(executionId) {
    try {
      if (typeof executionId !== 'string' || !commands.has(executionId)) throw new Error('Unknown owned execution');
      const result = await execute(prepare('terminal.cancel', { executionId }));
      return { success: true, tool: 'terminal.cancel', data: result, timestamp: new Date().toISOString() };
    } catch (failure) { return error('terminal.cancel', failure.message); }
  }
  async function getBrowserTarget() {
    // One derivation path only: configured service + current process + current
    // health + current port ownership. No request/model/tool argument is read.
    const id = 'web';
    const config = service(id);
    if (config.host !== 'localhost') return { available: false, serviceId: id, label: 'Open App', url: null };
    const record = processes.get(id);
    if (!record || record.state !== 'RUNNING' || !record.handle?.alive) {
      return { available: false, serviceId: id, label: 'Open App', url: null, executionId: null };
    }
    const current = await health(record);
    const snapshot = record.handle.snapshot();
    const port = await probes.portState(config.port);
    if (current.state === 'RUNNING' && current.health?.healthy && port.occupied &&
        snapshot.pid && await probes.ownsPort(snapshot.pid, config.port)) {
      return { available: true, serviceId: id, label: 'Open App', url: `http://${config.host}:${config.port}`,
        executionId: snapshot.executionId || null, healthy: true, owned: true, updatedAt: new Date().toISOString() };
    }
    return { available: false, serviceId: id, label: 'Open App', url: null, executionId: null,
      healthy: false, owned: false, updatedAt: new Date().toISOString() };
  }
  // Browser opening is deliberately a no-op in the server: the client receives
  // only this verified descriptor and uses a user-click anchor. There is no
  // process-spawning/browser-launch path and no model-provided destination.
  function openApp() {
    return Promise.resolve({ available: false, reason: 'Use the verified Open App link' });
  }
  async function browserTarget() {
    const id = 'web';
    const config = service(id);
    const record = processes.get(id);
    if (!record || record.state !== 'RUNNING' || !record.handle?.alive) {
      return { available: false, reason: 'service_not_running' };
    }
    const status = await health(record);
    const owned = Boolean(status.health?.healthy && await probes.ownsPort(status.pid, config.port));
    if (!owned) return { available: false, reason: 'listener_not_owned' };
    // The host and port are factory configuration. No request, model, or
    // runtime output can supply or redirect this destination.
    return { available: true, serviceId: id, url: `http://${config.host || 'localhost'}:${config.port}`,
      executionId: status.executionId, checkedAt: new Date().toISOString() };
  }

  async function shutdown() {
    approvals.clear();
    await Promise.all([...commands.values()].map(handle => handle.terminate('cancelled')));
    await Promise.all([...processes.values()].map(stop));
  }
  return { executeTool, cancelTaskApprovals, cancelOwnedExecution, openApp, getBrowserTarget, shutdown, getRegisteredTools: () => TOOLS.filter(name => name !== 'runtime.openApp').map(name => ({ name, capability: name,
    riskLevel: READS.includes(name) ? 'read' : 'consequential', description: 'Controlled ' + name })) };
}
module.exports = { createRuntimeGateway, TOOLS };
