const net = require('node:net');
const http = require('node:http');
const { execFile } = require('node:child_process');
const fs = require('node:fs');

/*
  DUAL-STACK LOOPBACK PROBES (defect: readiness probe ECONNREFUSED)

  A managed service may bind IPv4 (127.0.0.1) or IPv6 (::1). The real DROP
  dev server on this machine prints "Local: http://localhost:5173/" yet
  listens on [::1] ONLY — even when started with --host 127.0.0.1 — so an
  IPv4-only probe received ECONNREFUSED for the ENTIRE readiness window and
  every start failed with readiness_timeout. Both loopbacks are probed
  before a port is called free, listening, or healthy.
*/
const PROBE_HOSTS = ['127.0.0.1', '::1'];

function probeConnect(host, port, timeoutMs) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    let complete = false;
    const finish = result => { if (complete) return; complete = true; socket.destroy(); resolve({ host, ...result }); };
    socket.once('connect', () => finish({ connected: true, code: 'connected' }));
    socket.once('error', error => finish({ connected: false, code: error.code || 'error' }));
    socket.setTimeout(timeoutMs, () => finish({ connected: false, code: 'probe_timeout' }));
  });
}

async function portState(port, timeoutMs = 300) {
  for (const host of PROBE_HOSTS) {
    const attempt = await probeConnect(host, port, timeoutMs);
    // A connect on EITHER stack answers "occupied". A non-refused failure
    // (probe_timeout, ...) keeps the fail-closed occupied verdict: something
    // may be listening where we could not prove otherwise.
    if (attempt.connected) return { host, port, occupied: true, reason: 'connected' };
    if (attempt.code !== 'ECONNREFUSED') return { host, port, occupied: true, reason: attempt.code };
  }
  return { host: '127.0.0.1', port, occupied: false, reason: 'ECONNREFUSED' };
}

function requestHealth(host, port, pathname, timeoutMs) {
  return new Promise(resolve => {
    let completed = false;
    const finish = result => { if (completed) return; completed = true; resolve({ host, ...result }); };
    const request = http.get({ hostname: host, port, path: pathname, timeout: timeoutMs }, response => {
      response.destroy();
      finish({ responded: true, healthy: response.statusCode >= 200 && response.statusCode < 400,
        reason: 'http_status', statusCode: response.statusCode });
    });
    request.on('timeout', () => { request.destroy(); finish({ responded: false, reason: 'probe_timeout' }); });
    request.on('error', error => finish({ responded: false, reason: error.code || 'http_error' }));
  });
}

async function httpHealth(port, pathname = '/', timeoutMs = 500) {
  const started = Date.now();
  let firstAnomaly = null;
  let lastReason = 'ECONNREFUSED';
  for (const host of PROBE_HOSTS) {
    const attempt = await requestHealth(host, port, pathname, timeoutMs);
    if (attempt.responded) {
      return { healthy: attempt.healthy, reason: attempt.reason, statusCode: attempt.statusCode,
        checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    }
    if (!firstAnomaly) firstAnomaly = attempt.reason;
    lastReason = attempt.reason;
  }
  return { healthy: false, reason: firstAnomaly || lastReason, statusCode: null,
    checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
}
// Read-only OS ownership evidence prevents an unrelated listener from satisfying readiness.
function ownsPort(pid, port) {
  const executable = ['/usr/sbin/lsof', '/usr/bin/lsof'].find(file => fs.existsSync(file));
  if (!executable || !Number.isInteger(pid)) return Promise.resolve(false);
  return new Promise(resolve => execFile(executable,
    ['-nP', '-a', '-g', String(pid), '-iTCP:' + port, '-sTCP:LISTEN', '-Fpg'],
    { timeout: 1000, maxBuffer: 32768, shell: false }, (error, stdout) => resolve(!error && String(stdout).split('\n').includes('g' + pid))));
}
module.exports = { portState, httpHealth, ownsPort };
