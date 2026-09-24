'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CLOUD_ROOT = path.resolve(__dirname, '..');
const health = require('../api/health');
const { checkDatabaseStatus } = require('../api/lib/db');
const status = require('../api/status');

function syncInvoke(handler) {
  let statusCode = null;
  let body = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(payload) { body = payload; return this; }
  };
  const out = handler({ method: 'GET' }, res);
  if (out && typeof out.then === 'function') return out.then(() => ({ statusCode, body }));
  return { statusCode, body };
}

test('GET /api/health returns a static safe payload', async () => {
  const { statusCode, body } = await syncInvoke(health);
  assert.equal(statusCode, 200);
  assert.deepEqual(body, { service: 'tom-cloud', status: 'ok', version: '0.1.0' });
});

test('GET /api/health reveals no local-machine information', async () => {
  const { body } = await syncInvoke(health);
  const serialized = JSON.stringify(body);
  for (const banned of ['root', 'path', 'env', 'host', 'hostname', 'pid', 'platform', 'arch', 'localhost', '127.0.0.1', 'vscode', 'terminal', 'runtime', 'process']) {
    assert.ok(!serialized.toLowerCase().includes(banned), `health payload must not contain ${banned}`);
  }
});

test('GET /api/health source never reads the database or the environment', () => {
  const content = fs.readFileSync(path.join(CLOUD_ROOT, 'api/health.js'), 'utf8');
  for (const banned of ['DATABASE_URL', 'process.env', './lib/db', '@neondatabase']) {
    assert.ok(!content.includes(banned), `api/health.js must not reference ${banned}`);
  }
});

test('database probe reports not_configured when DATABASE_URL is absent', async () => {
  assert.equal(await checkDatabaseStatus({}), 'not_configured');
  assert.equal(await checkDatabaseStatus({ DATABASE_URL: '' }), 'not_configured');
  assert.equal(await checkDatabaseStatus({ DATABASE_URL: '   ' }), 'not_configured');
});

test('database probe reports unavailable for an unreachable URL and never leaks it', async () => {
  // Synthetic fixture only: an unreachable host proving failures map to
  // 'unavailable' without echoing the URL. Not a real credential.
  const secret = 'postgres://user:SUPERSECRET123@ep-test-12345.us-east-2.aws.neon.tech/db?sslmode=require';
  assert.equal(await checkDatabaseStatus({ DATABASE_URL: secret }), 'unavailable');
});

test('GET /api/status returns only a database status enum, never credentials', async () => {
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const { statusCode, body } = await syncInvoke(status);
    assert.equal(statusCode, 200);
    assert.equal(body.service, 'tom-cloud');
    assert.equal(body.auth, 'not_configured');
    assert.equal(body.database.provider, 'neon');
    assert.equal(body.database.status, 'not_configured');
    assert.equal(body.localAgent.status, 'not_paired');
    assert.deepEqual(body.endpoints, ['/api/health', '/api/status']);
    const serialized = JSON.stringify(body);
    for (const banned of ['postgres', 'neon.tech', 'SUPERSECRET', 'connection string']) {
      assert.ok(!serialized.includes(banned), `status payload must not contain ${banned}`);
    }
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
  const statusSrc = fs.readFileSync(path.join(CLOUD_ROOT, 'api/status.js'), 'utf8');
  assert.ok(!statusSrc.includes('DATABASE_URL_UNPOOLED'), 'status must not touch sibling Neon vars');
  assert.ok(!statusSrc.includes('console.log'), 'status must not log');
});

test('status error paths cannot echo the connection string or driver errors', () => {
  for (const file of ['api/status.js', 'api/lib/db.js']) {
    const content = fs.readFileSync(path.join(CLOUD_ROOT, file), 'utf8');
    assert.ok(!content.includes('console.log'), `${file} must not log`);
    assert.ok(!content.includes('console.error'), `${file} must not log errors`);
    assert.ok(!content.includes('err.message'), `${file} must not echo driver errors`);
    assert.ok(!content.includes('error.message'), `${file} must not echo driver errors`);
    assert.ok(!content.includes('String(err'), `${file} must not stringify driver errors`);
  }
  const dbSrc = fs.readFileSync(path.join(CLOUD_ROOT, 'api/lib/db.js'), 'utf8');
  assert.ok(dbSrc.includes('SELECT 1'), 'probe must use the lightweight SELECT 1 query');
  assert.ok(dbSrc.includes('DATABASE_URL'), 'probe must read DATABASE_URL');
  assert.ok(!dbSrc.includes('DATABASE_URL_UNPOOLED'), 'probe must not use the unpooled variable');
  // Only one env var name is sanctioned: every env.X / process.env.X
  // reference (code or comment) must name DATABASE_URL.
  const envRefs = dbSrc.match(/(?:env|process\.env)\.([A-Za-z_][A-Za-z0-9_]*)/g) || [];
  const varNames = new Set(envRefs.map((r) => r.split('.').pop()));
  assert.deepEqual([...varNames].sort(), ['DATABASE_URL']);
});

test('cloud handlers import nothing privileged', () => {
  for (const file of ['api/health.js', 'api/status.js', 'api/lib/db.js']) {
    const content = fs.readFileSync(path.join(CLOUD_ROOT, file), 'utf8');
    assert.ok(!content.includes('../workspace'), `${file} must not reference the local runtime dir`);
    assert.ok(!content.includes('workspace/'), `${file} must not reference the local runtime dir`);
    assert.ok(!content.includes('child_process'), `${file} must not use child_process`);
    assert.ok(!content.includes('node:fs'), `${file} must not use the filesystem`);
    assert.ok(!content.includes('express'), `${file} must not bundle express`);
    assert.ok(!content.includes('dotenv'), `${file} must not use dotenv`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(CLOUD_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.dependencies || {}), ['@neondatabase/serverless']);
  assert.ok(fs.existsSync(path.join(CLOUD_ROOT, 'package-lock.json')), 'package-lock.json must exist for pinned Vercel installs');
});

test('cloud landing page calls only the safe cloud surface', () => {
  const html = fs.readFileSync(path.join(CLOUD_ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.includes('/api/health'), 'landing page should use /api/health');
  assert.ok(html.includes('/api/status'), 'landing page should surface database status');
  for (const banned of ['/chat', '/project', '/file', '/tools', '/plugins', '/context', 'terminal', 'vscode', 'DROP', 'DATABASE_URL', 'postgres']) {
    assert.ok(!html.includes(banned), `landing page must not reference ${banned}`);
  }
});

test('vercel.json pins an explicit cloud-only configuration', () => {
  const config = JSON.parse(fs.readFileSync(path.join(CLOUD_ROOT, 'vercel.json'), 'utf8'));
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.installCommand, 'npm install');
});
