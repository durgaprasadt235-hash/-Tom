const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const agent = require('../agent');
const { validatePatch } = require('../tools/tom-patch');

const FIXTURE_RELATIVE_PATH = '__tom_patch_v1_fixture.txt';
const FIXTURE_ABSOLUTE_PATH = path.join(agent.DROP_ROOT, FIXTURE_RELATIVE_PATH);
const ORIGINAL_CONTENT = 'line one\nline two\nline three\n';

before(() => {
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, ORIGINAL_CONTENT, 'utf8');
});

beforeEach(() => {
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, ORIGINAL_CONTENT, 'utf8');
});

after(() => {
  try { fs.unlinkSync(FIXTURE_ABSOLUTE_PATH); } catch { /* already removed */ }
});

function patchJson(overrides) {
  return JSON.stringify({
    version: 'tom-patch-v1',
    project: 'Drop',
    edits: [{ path: FIXTURE_RELATIVE_PATH, oldText: 'line two', newText: 'line TWO' }],
    ...overrides
  });
}

test('a valid patch is parsed and validated without touching the file on disk', () => {
  const result = validatePatch(patchJson());
  assert.equal(result.version, 'tom-patch-v1');
  assert.equal(result.project, 'Drop');
  assert.deepEqual(result.files, [
    { path: FIXTURE_RELATIVE_PATH, edits: [{ removed: 'line two', added: 'line TWO' }] }
  ]);
  assert.equal(fs.readFileSync(FIXTURE_ABSOLUTE_PATH, 'utf8'), ORIGINAL_CONTENT);
});

test('malformed JSON is rejected', () => {
  assert.throws(() => validatePatch('{ this is not json'), /malformed patch json/i);
});

test('wrong version is rejected', () => {
  assert.throws(
    () => validatePatch(patchJson({ version: 'tom-patch-v2' })),
    /version must be exactly/i
  );
});

test('a blocked path is rejected', () => {
  assert.throws(
    () => validatePatch(JSON.stringify({
      version: 'tom-patch-v1',
      project: 'Drop',
      edits: [{ path: '.env.local', oldText: 'a', newText: 'b' }]
    })),
    /blocked/i
  );
});

test('a traversal path is rejected', () => {
  assert.throws(
    () => validatePatch(JSON.stringify({
      version: 'tom-patch-v1',
      project: 'Drop',
      edits: [{ path: '../../../etc/passwd', oldText: 'a', newText: 'b' }]
    })),
    /blocked/i
  );
});

test('oldText missing from the file is rejected', () => {
  assert.throws(
    () => validatePatch(JSON.stringify({
      version: 'tom-patch-v1',
      project: 'Drop',
      edits: [{ path: FIXTURE_RELATIVE_PATH, oldText: 'does not exist', newText: 'x' }]
    })),
    /not found/i
  );
});

test('oldText appearing multiple times is rejected', () => {
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, 'dup\ndup\n', 'utf8');
  assert.throws(
    () => validatePatch(JSON.stringify({
      version: 'tom-patch-v1',
      project: 'Drop',
      edits: [{ path: FIXTURE_RELATIVE_PATH, oldText: 'dup', newText: 'x' }]
    })),
    /occur exactly once/i
  );
});

test('a no-op edit is rejected', () => {
  assert.throws(
    () => validatePatch(JSON.stringify({
      version: 'tom-patch-v1',
      project: 'Drop',
      edits: [{ path: FIXTURE_RELATIVE_PATH, oldText: 'line two', newText: 'line two' }]
    })),
    /no-op/i
  );
});

test('more than 20 edits in one patch is rejected', () => {
  const bigFile = Array.from({ length: 30 }, (_, i) => `token${i}`).join('\n') + '\n';
  fs.writeFileSync(FIXTURE_ABSOLUTE_PATH, bigFile, 'utf8');
  const edits = Array.from({ length: 21 }, (_, i) => ({
    path: FIXTURE_RELATIVE_PATH,
    oldText: `token${i}`,
    newText: `TOKEN${i}`
  }));
  assert.throws(
    () => validatePatch(JSON.stringify({ version: 'tom-patch-v1', project: 'Drop', edits })),
    /too many edits/i
  );
});
