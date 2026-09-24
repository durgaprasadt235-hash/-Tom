'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLOUD_ROOT = path.resolve(__dirname, '..');
const health = require('../api/health');
const status = require('../api/status');

function invoke(handler) {
  let statusCode = null;
  let body = null;
  const req = { method: 'GET' };
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; }
  };
  handler(req, res);
  return { statusCode, body };
}

test('GET /api/health returns a static safe payload', () => {
  const { statusCode, body } = invoke(health);
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { service: 'tom-cloud', status: 'ok', version: '0.1.0' });
});

test('GET /api/health reveals no local-machine information', () => {
  const { body } = invoke(health);
  const serialized = JSON.stringify(body);
  for (const banned of ['root', 'path', 'env', 'host', 'hostname', 'pid', 'platform', 'arch', 'localhost', '127.0.0.1', 'vscode', 'terminal', 'runtime', 'process']) {
    assert.ok(!serialized.toLowerCase().includes(banned), `health payload must not contain ${banned}`);
  }
});

test('GET /api/status reports auth/db/agent slots without secrets', () => {
  const { statusCode, body } = invoke(status);
  assert.equal(statusCode, 200);
  assert.equal(body.auth, 'not_configured');
  assert.equal(body.database.status, 'not_configured');
  assert.equal(body.localAgent.status, 'not_paired');
  const serialized = JSON.stringify(body);
  for (const banned of ['key', 'secret', 'token', 'password', 'connection', 'url', 'nvidia']) {
    assert.ok(!serialized.toLowerCase().includes(banned), `status payload must not contain ${banned}`);
  }
});

test('cloud handlers import nothing privileged', () => {
  for (const file of ['api/health.js', 'api/status.js']) {
    const content = fs.readFileSync(path.join(CLOUD_ROOT, file), 'utf8');
    assert.ok(!content.includes('../workspace'), `${file} must not reference the local runtime dir`);
    assert.ok(!content.includes('workspace/'), `${file} must not reference the local runtime dir`);
    assert.ok(!content.includes('child_process'), `${file} must not use child_process`);
    assert.ok(!content.includes('fs'), `${file} must not use fs`);
  }
});

test('cloud landing page calls only the safe cloud surface', () => {
  const html = fs.readFileSync(path.join(CLOUD_ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.includes('/api/health'), 'landing page should use /api/health');
  assert.ok(html.includes('/api/status'), 'landing page should use /api/status');
  for (const banned of ['/chat', '/project', '/file', '/tools', '/plugins', '/context', 'terminal', 'vscode', 'DROP']) {
    assert.ok(!html.includes(banned), `landing page must not reference ${banned}`);
  }
});

test('vercel.json pins an explicit cloud-only configuration', () => {
  const config = JSON.parse(fs.readFileSync(path.join(CLOUD_ROOT, 'vercel.json'), 'utf8'));
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.installCommand, 'npm install');
});
