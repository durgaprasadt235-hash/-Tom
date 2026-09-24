const net = require('node:net');
const http = require('node:http');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
function portState(port, timeoutMs = 300) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let complete = false;
    const finish = (occupied, reason) => { if (complete) return; complete = true; socket.destroy(); resolve({ host: '127.0.0.1', port, occupied, reason }); };
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('error', error => finish(error.code !== 'ECONNREFUSED', error.code));
    socket.setTimeout(timeoutMs, () => finish(true, 'probe_timeout'));
  });
}
function httpHealth(port, pathname = '/', timeoutMs = 500) {
  const started = Date.now();
  return new Promise(resolve => {
    let completed = false;
    const finish = (healthy, reason, statusCode = null) => {
      if (completed) return; completed = true;
      resolve({ healthy, reason, statusCode, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started });
    };
    const request = http.get({ hostname: '127.0.0.1', port, path: pathname, timeout: timeoutMs }, response => {
      response.destroy(); finish(response.statusCode >= 200 && response.statusCode < 400, 'http_status', response.statusCode);
    });
    request.on('timeout', () => { finish(false, 'probe_timeout'); request.destroy(); });
    request.on('error', error => finish(false, error.code || 'http_error'));
  });
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
