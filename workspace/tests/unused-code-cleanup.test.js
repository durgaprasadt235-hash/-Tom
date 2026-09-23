const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createUnusedImportEdits } = require('../tools/unused-code-cleanup');
const patchValidator = require('../tools/patch-validator');

test('creates small exact edits for standalone unused imports', () => {
  const content = [
    "'use client';",
    'import {',
    '  Dialog,',
    '  DialogDescription,',
    '  DialogHeader,',
    "} from '@/components/ui/dialog';",
    "import ClubroomProfile from '@/components/clubrooms/clubroom-profile';",
    '',
    'export default function Page() {',
    '  return <Dialog />;',
    '}',
    ''
  ].join('\n');
  const diagnostics = [
    { line: 4, message: "'DialogDescription' is declared but its value is never read." },
    { line: 7, message: "'ClubroomProfile' is declared but its value is never read." },
    { line: 9, message: "'Page' is declared but its value is never read." }
  ];

  const cleanup = createUnusedImportEdits(content, diagnostics);
  assert.deepEqual(cleanup.edits, [
    { oldText: '  DialogDescription,\n', newText: '' },
    { oldText: "import ClubroomProfile from '@/components/clubrooms/clubroom-profile';\n", newText: '' }
  ]);
  const validated = patchValidator.validateEdits(content, cleanup.edits);
  assert.equal(validated.content.includes('DialogDescription'), false);
  assert.equal(validated.content.includes('ClubroomProfile'), false);
  assert.equal(validated.content.includes('return <Dialog />;'), true);
  assert.equal(cleanup.skipped.some((item) => item.symbol === 'Page'), true);
});

test('preserves CRLF in exact oldText', () => {
  const content = "import {\r\n  Unused,\r\n  Used,\r\n} from 'pkg';\r\n";
  const cleanup = createUnusedImportEdits(content, [
    { line: 2, message: "'Unused' is declared but its value is never read." }
  ]);
  assert.deepEqual(cleanup.edits, [{ oldText: '  Unused,\r\n', newText: '' }]);
  assert.doesNotThrow(() => patchValidator.validateEdits(content, cleanup.edits));
});