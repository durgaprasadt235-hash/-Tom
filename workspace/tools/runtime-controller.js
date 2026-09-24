const crypto = require('node:crypto');
const policy = require('./command-policy');
const { launch, delay } = require('./process-supervisor');
const probes = require('./runtime-probes');

const MUTATIONS = ['terminal.run', 'terminal.cancel', 'runtime.start', 'runtime.stop', 'runtime.restart'];
const READS = ['terminal.discover', 'terminal.status', 'runtime.status', 'runtime.logs', 'runtime.health', 'runtime.port'];
const TOOLS = [...MUTATIONS, ...READS, 'execution.approve', 'execution.reject'];
// Factory configuration is trusted application configuration, never tool/request arguments.
function createRuntimeGateway({ root, projectId = 'drop', services = { web: { cwd: 'web', port: 5173, healthPath: '/' } },
  timeoutMs = 120000, startupMs = 15000, graceMs = 500, maxBytes = 256 * 1024, approvalMs = 300000,
  executable = 'npm' }) {
  for (const value of [timeoutMs, startupMs, graceMs, maxBytes, approvalMs]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Runtime limits must be positive integers');
  }
  services = JSON.parse(JSON.stringify(services));
  const approvals = new Map(), processes = new Map(), commands = new Map(), locks = new Set();
  const clone = value => JSON.parse(JSON.stringify(value));
  const error = (tool, message) => ({ success: false, tool, error: message });
  function service(id) {
    if (typeof id !== 'string' || !Object.hasOwn(services, id)) throw new Error('Unknown configured service');
    const config = services[id];
    if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || typeof config.healthPath !== 'string' || !config.healthPath.startsWith('/') || config.healthPath.startsWith('//')) throw new Error('Invalid service configuration');
    return config;
  }
  function snapshot(record) {
    if (!record) throw new Error('Unknown managed process');
    const result = record.handle?.snapshot() || {};
    if (record.handle && !record.handle.alive && !['STOPPED', 'FAILED'].includes(record.state)) record.state = 'FAILED';
    return { ...result, projectId, serviceId: record.serviceId, state: record.state, health: record.health || null,
      port: record.port, url: `http://127.0.0.1:${record.port}`, error: record.error || result.error || null };
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
  function propose(tool, args) {
    cleanApprovals();
    if (approvals.size >= 100) throw new Error('Pending approval limit reached');
    const action = prepare(tool, args);
    const approvalId = crypto.randomUUID(), expires = Date.now() + approvalMs;
    approvals.set(approvalId, { action, args: clone(args), expires });
    return { status: 'pending_approval', riskLevel: 'consequential', approvalId,
      expiresAt: new Date(expires).toISOString(), action: clone(action) };
  }
  async function health(record) {
    const state = snapshot(record);
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
    return snapshot(record);
  }
  async function start(action) {
    const existing = processes.get(action.serviceId);
    if (existing?.handle?.alive) throw new Error('Service already running');
    const record = { serviceId: action.serviceId, state: 'STARTING', port: action.port, healthPath: action.healthPath };
    processes.set(action.serviceId, record);
    const port = await probes.portState(action.port);
    if (port.occupied) {
      record.state = 'FAILED'; record.error = 'port_conflict';
      return snapshot(record);
    }
    const definition = { ...action, args: [...action.args, '--', '--host', '127.0.0.1', '--port', String(action.port), '--strictPort'] };
    record.handle = launch(definition, { timeoutMs: 0, maxBytes, graceMs, persistent: true, executable });
    record.handle.done.then(() => { if (!['STOPPED', 'STOPPING'].includes(record.state)) record.state = 'FAILED'; });
    const deadline = Date.now() + startupMs;
    while (Date.now() < deadline && record.handle.alive) {
      const status = await health(record);
      if (status.health.healthy && record.handle.alive) { record.state = 'RUNNING'; return snapshot(record); }
      await delay(50);
    }
    const reason = record.handle.alive ? 'readiness_timeout' : 'startup_failure';
    await record.handle.terminate(reason);
    record.error = reason; record.state = 'FAILED';
    return snapshot(record);
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
  async function executeTool(tool, args = {}) {
    try {
      if (!TOOLS.includes(tool)) throw new Error('Unknown runtime tool');
      let data;
      if (MUTATIONS.includes(tool)) data = propose(tool, args);
      else if (tool === 'execution.approve' || tool === 'execution.reject') {
        policy.plainArgs(args, ['approvalId']);
        const pending = approvals.get(args.approvalId);
        if (!pending) throw new Error('Unknown or consumed approval');
        approvals.delete(args.approvalId); // Single use, including rejected/stale/failed actions.
        if (pending.expires <= Date.now()) throw new Error('Approval expired');
        if (tool === 'execution.reject') data = { status: 'rejected', approvalId: args.approvalId, action: pending.action };
        else {
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
        if (tool === 'runtime.port') data = { projectId, serviceId: args.serviceId, ...await probes.portState(config.port) };
        else {
          const record = processes.get(args.serviceId);
          data = tool === 'runtime.health' ? await health(record) : snapshot(record);
        }
      }
      return { success: true, tool, data, timestamp: new Date().toISOString() };
    } catch (failure) { return error(tool, failure.message); }
  }
  async function shutdown() {
    approvals.clear();
    await Promise.all([...commands.values()].map(handle => handle.terminate('cancelled')));
    await Promise.all([...processes.values()].map(stop));
  }
  return { executeTool, shutdown, getRegisteredTools: () => TOOLS.map(name => ({ name, capability: name,
    riskLevel: READS.includes(name) ? 'read' : 'consequential', description: 'Controlled ' + name })) };
}
module.exports = { createRuntimeGateway, TOOLS };
