const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { createRuntimeGateway } = require('../../tools/runtime-controller');
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function fixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tom-runtime-'));
  fs.mkdirSync(path.join(root, 'web'));
  const port = await freePort();
  const scripts = { test: 'node task.cjs', build: 'node task.cjs', lint: 'node task.cjs', dev: 'node server.cjs' };
  const packagePath = path.join(root, 'web/package.json');
  fs.writeFileSync(packagePath, JSON.stringify({ scripts }));
  fs.writeFileSync(path.join(root, 'web/task.cjs'), "console.log('stdout evidence'); console.error('stderr evidence');");
  fs.writeFileSync(path.join(root, 'web/server.cjs'), `
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
if (fs.existsSync('crash')) process.exit(7);
if (fs.existsSync('slow')) setInterval(() => {}, 1000);
else http.createServer((req,res) => { res.statusCode = fs.existsSync('unhealthy') ? 503 : 200; res.end('ready'); })
 .listen(port, '127.0.0.1', () => { console.log('ready runtime'); console.error('runtime diagnostic'); });
`);
  const gateway = createRuntimeGateway({ root, services: { web: { cwd: 'web', host: 'localhost', port, healthPath: '/' } }, timeoutMs: 2500, startupMs: 2500, graceMs: 100, maxBytes: 4096, ...options });
  return { root, port, gateway, packagePath, scripts,
    write(name, value) { fs.writeFileSync(path.join(root, 'web', name), value); },
    async cleanup() { await gateway.shutdown(); fs.rmSync(root, { recursive: true, force: true }); }
  };
}
async function approved(gateway, tool, args) {
  const proposal = await gateway.executeTool(tool, args);
  if (!proposal.success) throw new Error(proposal.error);
  return gateway.executeTool('execution.approve', { approvalId: proposal.data.approvalId });
}
module.exports = { fixture, approved, freePort };
