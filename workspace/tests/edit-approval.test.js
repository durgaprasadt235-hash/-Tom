const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const agent = require('../agent');
const vscodeBridge = require('../plugins/vscode/vscode-bridge');
const actionGateway = require('../tools/action-gateway');
const editApprovalStore = require('../tools/edit-approval-store');
const patchValidator = require('../tools/patch-validator');

const PROJECT_ID = 'drop';
const CLIENT_INSTANCE_ID = 'tom-test-client-edit-approval';

const FIXTURE_RELATIVE_PATH = '__tom_edit_approval_fixture.txt';
const FIXTURE_ABSOLUTE_PATH = path.join(agent.DROP_ROOT, FIXTURE_RELATIVE_PATH);
const ORIGINAL_CONTENT = 'line one\nline two\nline three\n';

const SYMLINK_RELATIVE_PATH = '__tom_edit_approval_symlink.txt';
const SYMLINK_ABSOLUTE_PATH = path.join(agent.DROP_ROOT, SYMLINK_RELATIVE_PATH);
const OUTSIDE_TARGET_PATH = path.join(require('os').tmpdir(), '__tom_outside_target.txt');

function connectBridge() {
  const challenge = vscodeBridge.beginHandshake(PROJECT_ID);
  return vscodeBridge.acceptHandshake(PROJECT_ID, {
    nonce: challenge.nonce,
    clientInstanceId: CLIENT_INSTANCE_ID,
    vscodeVersion: '1.0.0-test',
    workspaceFolders: [agent.DROP_ROOT],
    activeFile: path.join(agent.DROP_ROOT, 'web/app/page.tsx'),
    diagnostics: []
  });
}

let connection;

before(() => {
  connection = connectBridge();
  fs.writeFileSync(OUTSIDE_TARGET_PATH, 'outside content\n', 'utf8');
});

beforeEach(() => {
  editApprovalStore.resetForTests();
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, ORIGINAL_CONTENT, 'utf8');
});

after(() => {
  try {
    vscodeBridge.disconnect(PROJECT_ID, connection.sessionId, CLIENT_INSTANCE_ID);
  } catch {
    // best-effort cleanup
  }
  for (const p of [FIXTURE_ABSOLUTE_PATH, SYMLINK_ABSOLUTE_PATH, OUTSIDE_TARGET_PATH]) {
    try { fs.unlinkSync(p); } catch { /* already removed */ }
  }
});

// --------------------------------------------------
// 1-2. Valid minimal patch proposal; does not change disk
// --------------------------------------------------

test('a valid minimal patch is proposed without touching the file on disk', async () => {
  const result = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line two', newText: 'line TWO' }]
  });
  assert.equal(result.success, true);
  assert.equal(result.data.applied, false);
  assert.ok(result.data.approvalId);
  assert.deepEqual(result.data.summary, [{ removed: 'line two', added: 'line TWO' }]);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

// --------------------------------------------------
// 3. Exact approved patch applies
// --------------------------------------------------

test('a valid approval applies the exact approved patch', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line two', newText: 'line TWO' }]
  });
  assert.equal(proposal.success, true);

  const apply = await actionGateway.executeTool('vscode.file.apply_edit', {
    approvalId: proposal.data.approvalId,
    path: FIXTURE_RELATIVE_PATH
  });
  assert.equal(apply.success, true);
  assert.equal(apply.data.applied, true);
  assert.equal(apply.data.content, 'line one\nline TWO\nline three\n');
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), 'line one\nline TWO\nline three\n');
});

// --------------------------------------------------
// 4. Approval cannot supply different replacement content
// --------------------------------------------------

test('apply_edit does not accept replacement content at approval time', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line two', newText: 'line TWO' }]
  });
  const apply = await actionGateway.executeTool('vscode.file.apply_edit', {
    approvalId: proposal.data.approvalId,
    path: FIXTURE_RELATIVE_PATH,
    // apply_edit has no parameter for content/edits; this must be ignored.
    edits: [{ oldText: 'line two', newText: 'MALICIOUS REPLACEMENT' }],
    content: 'MALICIOUS FULL FILE REPLACEMENT'
  });
  assert.equal(apply.success, true);
  assert.equal(apply.data.content, 'line one\nline TWO\nline three\n');
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), 'line one\nline TWO\nline three\n');
});

// --------------------------------------------------
// 5. oldText missing -> rejected
// --------------------------------------------------

test('an edit whose oldText is missing from the file is rejected', async () => {
  const result = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line does not exist', newText: 'x' }]
  });
  assert.equal(result.success, false);
  assert.match(result.error, /not found/i);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

// --------------------------------------------------
// 6. oldText occurs multiple times -> rejected
// --------------------------------------------------

test('an edit whose oldText occurs more than once is rejected', async () => {
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, 'dup\ndup\n', 'utf8');
  const result = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'dup', newText: 'x' }]
  });
  assert.equal(result.success, false);
  assert.match(result.error, /occur exactly once/i);
});

// --------------------------------------------------
// 7. Malformed model JSON -> rejected
// --------------------------------------------------

test('malformed model JSON is rejected', () => {
  assert.throws(
    () => patchValidator.parseModelEdits('{ "edits": [ this is not json'),
    /could not be safely validated/i
  );
});

// --------------------------------------------------
// 8. Prose + JSON model output -> rejected
// --------------------------------------------------

test('prose surrounding JSON model output is rejected', () => {
  assert.throws(
    () => patchValidator.parseModelEdits('Sure, here is the patch:\n{"edits":[{"oldText":"a","newText":"b"}]}'),
    /could not be safely validated/i
  );
});

// --------------------------------------------------
// 9. No-op edit -> rejected
// --------------------------------------------------

test('a no-op edit (identical oldText/newText) is rejected', async () => {
  const result = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line two', newText: 'line two' }]
  });
  assert.equal(result.success, false);
  assert.match(result.error, /no-op/i);
});

// --------------------------------------------------
// 10. Overlapping/conflicting edits -> rejected
// --------------------------------------------------

test('overlapping edits are rejected', async () => {
  const result = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [
      { oldText: 'line one\nline two', newText: 'a' },
      { oldText: 'line two\nline three', newText: 'b' }
    ]
  });
  assert.equal(result.success, false);
  assert.match(result.error, /overlap/i);
});

// --------------------------------------------------
// 11. Excessive patch size/count -> rejected
// --------------------------------------------------

test('too many edits in one patch is rejected', async () => {
  const bigFile = Array.from({ length: 30 }, (_, i) => `token${i}`).join('\n') + '\n';
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, bigFile, 'utf8');
  const edits = Array.from({ length: 25 }, (_, i) => ({ oldText: `token${i}`, newText: `TOKEN${i}` }));
  const result = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits
  });
  assert.equal(result.success, false);
  assert.match(result.error, /too many edits/i);
});

// --------------------------------------------------
// 12. Source file changed after proposal -> stale approval rejected
// --------------------------------------------------

test('an approval is rejected if the source file changed after proposal', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line two', newText: 'line TWO' }]
  });
  assert.equal(proposal.success, true);

  // Source file changes after the proposal was created.
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, ORIGINAL_CONTENT + 'extra line\n', 'utf8');

  const apply = await actionGateway.executeTool('vscode.file.apply_edit', {
    approvalId: proposal.data.approvalId,
    path: FIXTURE_RELATIVE_PATH
  });
  assert.equal(apply.success, false);
  assert.match(apply.error, /stale|changed/i);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT + 'extra line\n');
});

// --------------------------------------------------
// 13. Reused approval rejected
// --------------------------------------------------

test('a reused approval is rejected on the second attempt', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line two', newText: 'line TWO' }]
  });
  const first = await actionGateway.executeTool('vscode.file.apply_edit', {
    approvalId: proposal.data.approvalId,
    path: FIXTURE_RELATIVE_PATH
  });
  assert.equal(first.success, true);

  const second = await actionGateway.executeTool('vscode.file.apply_edit', {
    approvalId: proposal.data.approvalId,
    path: FIXTURE_RELATIVE_PATH
  });
  assert.equal(second.success, false);
  assert.match(second.error, /already been used/i);
});

// --------------------------------------------------
// 14. Expired approval rejected
// --------------------------------------------------

test('an expired approval is rejected', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line two', newText: 'line TWO' }]
  });
  const pending = editApprovalStore.getApproval(proposal.data.approvalId);
  pending.expiresAt = Date.now() - 1000; // force expiry

  const result = await actionGateway.executeTool('vscode.file.apply_edit', {
    approvalId: proposal.data.approvalId,
    path: FIXTURE_RELATIVE_PATH
  });
  assert.equal(result.success, false);
  assert.match(result.error, /expired/i);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

// --------------------------------------------------
// 15. Wrong path rejected
// --------------------------------------------------

test('an approval id used with a different path is rejected', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: FIXTURE_RELATIVE_PATH,
    edits: [{ oldText: 'line two', newText: 'line TWO' }]
  });
  const result = await actionGateway.executeTool('vscode.file.apply_edit', {
    approvalId: proposal.data.approvalId,
    path: 'web/app/page.tsx'
  });
  assert.equal(result.success, false);
  assert.match(result.error, /does not match/i);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

test('a fake/unknown approval id is rejected', async () => {
  const result = await actionGateway.executeTool('vscode.file.apply_edit', {
    approvalId: '00000000-0000-4000-8000-000000000000',
    path: FIXTURE_RELATIVE_PATH
  });
  assert.equal(result.success, false);
  assert.match(result.error, /unknown or invalid approval/i);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

test('apply_edit requires an approvalId argument', async () => {
  const result = await actionGateway.executeTool('vscode.file.apply_edit', { path: FIXTURE_RELATIVE_PATH });
  assert.equal(result.success, false);
  assert.match(result.error, /approvalId/i);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

// --------------------------------------------------
// 16-18. Security boundary reused for writes
// --------------------------------------------------

test('.env is blocked from proposal', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: '.env.local',
    edits: [{ oldText: 'a', newText: 'b' }]
  });
  assert.equal(proposal.success, false);
  assert.match(proposal.error, /blocked/i);
});

test('web-git-backup is blocked from proposal', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: 'web-git-backup/HEAD',
    edits: [{ oldText: 'a', newText: 'b' }]
  });
  assert.equal(proposal.success, false);
  assert.match(proposal.error, /blocked/i);
});

test('../ path traversal is blocked from proposal', async () => {
  const proposal = await actionGateway.executeTool('vscode.file.propose_edit', {
    path: '../../../etc/passwd',
    edits: [{ oldText: 'a', newText: 'b' }]
  });
  assert.equal(proposal.success, false);
  assert.match(proposal.error, /blocked/i);
});

// --------------------------------------------------
// 19. Symlink escape blocked
// --------------------------------------------------

test('symlink escape is blocked when applying an approved edit', async () => {
  fs.symlinkSync(OUTSIDE_TARGET_PATH, SYMLINK_ABSOLUTE_PATH);
  try {
    // The approval store itself doesn't touch the filesystem, so craft an
    // approval directly to exercise agent.js's write-time symlink guard.
    const sourceHash = require('crypto').createHash('sha256').update('outside content\n', 'utf8').digest('hex');
    const approvalId = editApprovalStore.createApproval(
      SYMLINK_RELATIVE_PATH,
      [{ oldText: 'outside', newText: 'escaped' }],
      sourceHash
    );
    const result = await actionGateway.executeTool('vscode.file.apply_edit', {
      approvalId,
      path: SYMLINK_RELATIVE_PATH
    });
    assert.equal(result.success, false);
    assert.match(result.error, /symbolic link|outside .*project is blocked/i);
    assert.equal(fs.readFileSync(OUTSIDE_TARGET_PATH, 'utf8'), 'outside content\n');
  } finally {
    fs.unlinkSync(SYMLINK_ABSOLUTE_PATH);
  }
});

// --------------------------------------------------
// 20-22. Existing read tools unaffected
// --------------------------------------------------

test('existing vscode.file.read still works', async () => {
  const result = await actionGateway.executeTool('vscode.file.read', { path: 'web/app/page.tsx' });
  assert.equal(result.success, true);
  assert.ok(result.data.content.length > 0);
});

test('existing vscode.diagnostics still works', async () => {
  const diagnostics = await actionGateway.executeTool('vscode.diagnostics');
  assert.equal(diagnostics.success, true);
});

test('existing Git read tools still work', async () => {
  const gitStatus = await actionGateway.executeTool('git.status');
  assert.equal(gitStatus.success, true);

  const tree = await actionGateway.executeTool('vscode.workspace.tree');
  assert.equal(tree.success, true);
});
