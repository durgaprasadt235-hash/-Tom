const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CITATION_RANGE_LINES,
  numberSourceLines,
  buildInspectionEvidence,
  parseInspectionAnalysis,
  renderInspectionResponse
} = require('../tools/code-inspection-runtime');

test('inspection evidence filters diagnostics to the requested file without changing fields', () => {
  const evidence = buildInspectionEvidence('web/app/page.tsx', 'first\nsecond\n', [
    { file: 'web/app/page.tsx', severity: 'error', message: 'Actual error', line: 2, source: 'typescript' },
    { file: 'web/other.tsx', severity: 'warning', message: 'Other file warning', line: 9, source: 'eslint' }
  ]);
  assert.deepEqual(evidence.diagnostics, [
    { file: 'web/app/page.tsx', severity: 'error', message: 'Actual error', line: 2, source: 'typescript' }
  ]);
});

test('numberSourceLines adds deterministic line numbers without changing source content', () => {
  const content = 'first\nsecond\nthird';
  assert.equal(numberSourceLines(content), '1 | first\n2 | second\n3 | third');
  assert.equal(content, 'first\nsecond\nthird');
});

test('valid single-line citation is accepted', () => {
  const analysis = parseInspectionAnalysis(JSON.stringify({
    codeFacts: [{ lineStart: 2, lineEnd: 2, fact: 'A second line exists.' }],
    suggestions: []
  }), 'first\nsecond\n');

  assert.deepEqual(analysis.codeFacts, [
    { lineStart: 2, lineEnd: 2, fact: 'A second line exists.', source: 'second' }
  ]);
});

test('valid multi-line citation is accepted', () => {
  const analysis = parseInspectionAnalysis(JSON.stringify({
    codeFacts: [{ lineStart: 1, lineEnd: 3, fact: 'The block has three lines.' }],
    suggestions: []
  }), 'first\nsecond\nthird');

  assert.deepEqual(analysis.codeFacts, [
    { lineStart: 1, lineEnd: 3, fact: 'The block has three lines.', source: 'first\nsecond\nthird' }
  ]);
});

test('nonexistent line citation is rejected', () => {
  const analysis = parseInspectionAnalysis(JSON.stringify({
    codeFacts: [{ lineStart: 1, lineEnd: 99, fact: 'Invalid.' }],
    suggestions: []
  }), 'first\nsecond');
  assert.deepEqual(analysis.codeFacts, []);
});

test('reversed citation range is rejected', () => {
  const analysis = parseInspectionAnalysis(JSON.stringify({
    codeFacts: [{ lineStart: 2, lineEnd: 1, fact: 'Invalid.' }],
    suggestions: []
  }), 'first\nsecond');
  assert.deepEqual(analysis.codeFacts, []);
});

test('oversized citation range is rejected', () => {
  const content = Array.from({ length: MAX_CITATION_RANGE_LINES + 1 }, (_, index) => `line ${index + 1}`).join('\n');
  const analysis = parseInspectionAnalysis(JSON.stringify({
    codeFacts: [{ lineStart: 1, lineEnd: MAX_CITATION_RANGE_LINES + 1, fact: 'Too broad.' }],
    suggestions: []
  }), content);
  assert.deepEqual(analysis.codeFacts, []);
});

test('malformed JSON is rejected safely', () => {
  assert.deepEqual(parseInspectionAnalysis('{not json', 'first\nsecond'), {
    codeFacts: [],
    architecturalSuggestions: []
  });
});

test('model cannot inject diagnostics and suggestions remain suggestions', () => {
  const analysis = parseInspectionAnalysis(JSON.stringify({
    diagnostics: [{ severity: 'error', message: 'Invented model diagnostic', line: 99 }],
    codeFacts: [{ lineStart: 2, lineEnd: 2, fact: 'A valid fact.' }],
    suggestions: [
      { lineStart: 1, lineEnd: 2, suggestion: 'Consider extracting this responsibility.', reason: 'The block mixes concerns.' },
      { lineStart: 2, lineEnd: 1, suggestion: 'Invalid.', reason: 'Reversed.' }
    ]
  }), 'first\nsecond');

  assert.deepEqual(analysis.codeFacts, [
    { lineStart: 2, lineEnd: 2, fact: 'A valid fact.', source: 'second' }
  ]);
  assert.deepEqual(analysis.architecturalSuggestions, [
    {
      lineStart: 1,
      lineEnd: 2,
      suggestion: 'Consider extracting this responsibility.',
      reason: 'The block mixes concerns.',
      source: 'first\nsecond'
    }
  ]);
  assert.equal(Object.hasOwn(analysis, 'diagnostics'), false);
});

test('speculative observations cannot become confirmed code facts', () => {
  const analysis = parseInspectionAnalysis(JSON.stringify({
    codeFacts: [
      { lineStart: 1, lineEnd: 1, fact: 'This could cause a runtime error.' },
      { lineStart: 2, lineEnd: 2, fact: 'The second line declares a value.' }
    ],
    suggestions: []
  }), 'first\nconst value = 1;');

  assert.deepEqual(analysis.codeFacts, [
    {
      lineStart: 2,
      lineEnd: 2,
      fact: 'The second line declares a value.',
      source: 'const value = 1;'
    }
  ]);
});

test('rendered diagnostic section contains only tool diagnostics and suggestions stay separate', () => {
  const evidence = buildInspectionEvidence('web/app/page.tsx', 'first\nsecond', [
    { file: 'web/app/page.tsx', severity: 'warning', message: 'Actual warning', line: 2, source: 'eslint' }
  ]);
  const reply = renderInspectionResponse(evidence, {
    codeFacts: [{ lineStart: 1, lineEnd: 1, fact: 'The first line exists.', source: 'first' }],
    architecturalSuggestions: [{ lineStart: 1, lineEnd: 2, source: 'first\nsecond', suggestion: 'Extract this logic.', reason: 'The block mixes concerns.' }]
  });

  const diagnosticSection = reply.split('## Confirmed code facts')[0];
  assert.match(diagnosticSection, /\[warning\] web\/app\/page\.tsx:2 — Actual warning \(source: eslint\)/);
  assert.doesNotMatch(diagnosticSection, /Extract this logic/);
  assert.match(reply, /## Architectural suggestions\n- Lines 1-2: Extract this logic/);
  assert.doesNotMatch(reply, /Architectural suggestions[\s\S]*\[warning\]/);
});