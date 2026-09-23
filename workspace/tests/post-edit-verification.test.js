const { test } = require('node:test');
const assert = require('node:assert/strict');

const { renderPostEditVerification } = require('../tools/post-edit-verification');

const evidence = {
  edits: [{ oldText: 'old', newText: 'new' }],
  application: { verified: true }
};
const diagnosticsSuccess = { success: true, data: { diagnostics: [] } };

test('verification is VERIFIED only with applied, diagnostics, and passing build evidence', () => {
  const passed = renderPostEditVerification(evidence, diagnosticsSuccess, [], {
    success: true,
    data: { command: 'npm run build', exitCode: 0, timedOut: false }
  });
  assert.match(passed, /## Verification\nVERIFIED$/);
  assert.match(passed, /0 diagnostics reported/);

  const noBuild = renderPostEditVerification(evidence, diagnosticsSuccess, [], null);
  assert.match(noBuild, /No trustworthy completed build evidence is stored/);
  assert.match(noBuild, /## Verification\nNOT VERIFIED$/);

  const failedDiagnostics = renderPostEditVerification(evidence, { success: false, error: 'offline' }, [], {
    success: true,
    data: { command: 'npm run build', exitCode: 0, timedOut: false }
  });
  assert.match(failedDiagnostics, /## Verification\nNOT VERIFIED$/);

  const failedBuild = renderPostEditVerification(evidence, diagnosticsSuccess, [], {
    success: true,
    data: { command: 'npm run build', exitCode: 1, timedOut: false }
  });
  assert.match(failedBuild, /Result: FAIL/);
  assert.match(failedBuild, /## Verification\nNOT VERIFIED$/);
});