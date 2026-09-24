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
const SCAN_TARGETS = ['public', 'api', 'package.json', 'vercel.json'];

// Privileged Phase 1 / local-runtime capabilities that must never ship.
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
  'nvidia',
  'NVIDIA_API_KEY',
  'dotenv',
  '/tools/execute',
  '/tools',
  'express',
  '127.0.0.1',
  'localhost:3001'
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

// The deployed handlers must stay dependency-free.
const pkg = JSON.parse(fs.readFileSync(path.join(CLOUD_ROOT, 'package.json'), 'utf8'));
if (Object.keys(pkg.dependencies || {}).length !== 0) {
  console.error('BOUNDARY VIOLATION: cloud package.json must have zero dependencies');
  failures += 1;
}

if (failures > 0) {
  console.error(`\ncloud boundary check FAILED (${failures} violation(s))`);
  process.exit(1);
}
console.log('cloud boundary check passed: no privileged references in deployable bundle');
