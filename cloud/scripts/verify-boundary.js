'use strict';

// Boundary verifier for the TOM cloud surface.
//
// Scans ONLY the deployed cloud bundle (public/, api/, package.json,
// vercel.json) for privileged local-runtime references. Fails closed:
// any match exits non-zero, which fails `npm run build` on Vercel.
//
// NOTE: this script itself, and tests/, intentionally live outside the
// scanned bundle so their own pattern strings cannot trip the check.

const fs = require('node:fs');
const path = require('node:path');

const CLOUD_ROOT = path.resolve(__dirname, '..');
const SCAN_TARGETS = ['public', 'api', 'package.json', 'package-lock.json', 'vercel.json'];

// Privileged Phase 1 / local-runtime capabilities that must never ship.
// NOTE: '.env', 'DATABASE_URL', 'neon', and 'process.env' ARE allowed in the
// deployed bundle — DATABASE_URL is the Vercel-Neon integration's sanctioned
// server-side channel and @neondatabase/serverless is the single approved
// dependency. They are policed instead by rules below (dependency allowlist,
// no credential echoing, no local-runtime imports) and by tests.
const BANNED_PATTERNS = [
  'terminal.run',
  'terminal.cancel',
  'terminal.discover',
  'runtime.start',
  'runtime.stop',
  'runtime.restart',
  'execution.approve',
  'execution.reject',
  'child_process',
  'process.kill',
  'SIGTERM',
  'SIGKILL',
  'lsof',
  'DROP_ROOT',
  'listProjectFiles',
  'readProjectFile',
  'vscode',
  'VS Code',
  'action-gateway',
  'runtime-controller',
  'process-supervisor',
  'command-policy',
  'dotenv',
  '/tools/execute',
  '"/tools"',
  "'/tools'",
  '`/tools',
  'express',
  '127.0.0.1',
  'localhost:3001',
  '../workspace',
  'workspace/',
  // Credential-shaped material must never be committed into the bundle.
  'nvapi-',
  'BEGIN PRIVATE KEY',
  'DATABASE_URL_UNPOOLED'
];

function collectFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

let failures = 0;
for (const target of SCAN_TARGETS) {
  const abs = path.join(CLOUD_ROOT, target);
  const files = fs.existsSync(abs) && fs.statSync(abs).isDirectory()
    ? collectFiles(abs, [])
    : [abs];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of BANNED_PATTERNS) {
      if (content.includes(pattern)) {
        console.error(`BOUNDARY VIOLATION: ${path.relative(CLOUD_ROOT, file)} contains ${JSON.stringify(pattern)}`);
        failures += 1;
      }
    }
  }
}

// The deployed bundle may depend ONLY on the Neon serverless driver
// (the sanctioned cloud-database channel). Anything else fails closed.
const ALLOWED_CLOUD_DEPENDENCIES = ['@neondatabase/serverless'];
const pkg = JSON.parse(fs.readFileSync(path.join(CLOUD_ROOT, 'package.json'), 'utf8'));
const depNames = Object.keys(pkg.dependencies || {});
for (const dep of depNames) {
  if (!ALLOWED_CLOUD_DEPENDENCIES.includes(dep)) {
    console.error(`BOUNDARY VIOLATION: cloud dependency ${JSON.stringify(dep)} is not allowlisted`);
    failures += 1;
  }
}

// DATABASE_URL must never appear as a committed value — only as an env
// reference read server-side (api/lib/db.js). Scan for credential-shaped
// values: postgres:// URLs with credentials or bare env assignments.
// tests/ is excluded: it holds a synthetic unreachable fixture (no real
// credential) used to prove the probe never leaks the URL. The scanner
// script itself is likewise excluded.
const CREDENTIAL_VALUE_PATTERNS = [
  /postgres(ql)?:\/\/[^'"\s]*:[^'"\s]*@/i,
  /DATABASE_URL\s*=\s*['"]?postgres/i
];
const CREDENTIAL_SCAN_EXCLUDED_DIRS = new Set(['tests', 'scripts', 'node_modules']);
function credentialScanFiles(abs) {
  const all = fs.statSync(abs).isDirectory() ? collectFiles(abs, []) : [abs];
  return all.filter((file) => {
    const rel = path.relative(CLOUD_ROOT, file);
    const top = rel.split(path.sep)[0];
    return !CREDENTIAL_SCAN_EXCLUDED_DIRS.has(top);
  });
}
for (const target of SCAN_TARGETS) {
  const abs = path.join(CLOUD_ROOT, target);
  if (!fs.existsSync(abs)) continue;
  const files = credentialScanFiles(abs);
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const re of CREDENTIAL_VALUE_PATTERNS) {
      if (re.test(content)) {
        console.error(`BOUNDARY VIOLATION: ${path.relative(CLOUD_ROOT, file)} contains a credential-shaped value (${re})`);
        failures += 1;
      }
    }
  }
}

// package-lock.json must exist so Vercel installs the pinned driver.
// node_modules must never be TRACKED by git (it exists on disk after any
// local `npm install`, which is fine). Fail only if git would commit it.
if (!fs.existsSync(path.join(CLOUD_ROOT, 'package-lock.json'))) {
  console.error('BOUNDARY VIOLATION: cloud/package-lock.json is missing (run npm install in cloud/)');
  failures += 1;
}
try {
  const { execFileSync } = require('node:child_process');
  const tracked = execFileSync('git', ['ls-files', '--', 'cloud/node_modules'], { cwd: path.resolve(CLOUD_ROOT, '..'), encoding: 'utf8' }).trim();
  if (tracked) {
    console.error('BOUNDARY VIOLATION: cloud/node_modules must not be committed');
    failures += 1;
  }
} catch {
  // If git is unavailable, fall back to the ignore rule: node_modules/
  // must be covered by .gitignore. Failing closed only when untracked
  // status cannot be proven AND the directory is committed content.
  if (fs.existsSync(path.join(CLOUD_ROOT, 'node_modules')) && process.env.VERCEL) {
    console.error('BOUNDARY VIOLATION: cloud/node_modules present in build');
    failures += 1;
  }
}

if (failures > 0) {
  console.error(`\ncloud boundary check FAILED (${failures} violation(s))`);
  process.exit(1);
}
console.log('cloud boundary check passed: no privileged references in deployable bundle');
