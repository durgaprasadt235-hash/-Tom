const { test } = require('node:test');
const assert = require('node:assert/strict');

const { stripChainOfThought } = require('../tools/response-sanitizer');

test('removes a <think>...</think> block and keeps the final answer', () => {
  const input = '<think>internal scratch notes about the plan</think>The home page uses a client component.';
  assert.equal(stripChainOfThought(input), 'The home page uses a client component.');
});

test('removes an <analysis>...</analysis> block and keeps the final answer', () => {
  const input = '<analysis>step by step internal notes</analysis>\n\nThe page renders a list of drops.';
  assert.equal(stripChainOfThought(input), 'The page renders a list of drops.');
});

test('removes an unclosed <think> block and everything after it', () => {
  const input = 'The final answer is ready.<think>oops still going';
  assert.equal(stripChainOfThought(input), 'The final answer is ready.');
});

test('removes a "**Analyze User Input**:" preamble and keeps the final answer', () => {
  const input =
    '**Analyze User Input**: User wants me to analyze web/app/page.tsx.\n\n' +
    'The page.tsx file defines the DROP home page using a client component with view-based routing.';
  assert.equal(
    stripChainOfThought(input),
    'The page.tsx file defines the DROP home page using a client component with view-based routing.'
  );
});

test('removes a "**Analysis**:" heading paragraph', () => {
  const input = '**Analysis**: breaking down the request internally.\n\nHere is the final summary you asked for.';
  assert.equal(stripChainOfThought(input), 'Here is the final summary you asked for.');
});

test('removes leading "We need to..." reasoning preamble', () => {
  const input = 'We need to check the file contents first.\n\nThe component manages state with useState hooks.';
  assert.equal(stripChainOfThought(input), 'The component manages state with useState hooks.');
});

test('removes leading "The user wants..." reasoning preamble', () => {
  const input = 'The user wants an architecture summary.\n\nThe app renders three main views: home, hub, and messages.';
  assert.equal(stripChainOfThought(input), 'The app renders three main views: home, hub, and messages.');
});

test('removes multiline/numbered internal reasoning steps entirely', () => {
  const input =
    '**Analyze User Input**: understand the request.\n\n' +
    '2. **Identify Key Requirements**: list what is needed.\n\n' +
    '3. **Examine the Provided File Content**: read the file.\n\n' +
    'The page component renders a dashboard with navigation between views.';
  assert.equal(
    stripChainOfThought(input),
    'The page component renders a dashboard with navigation between views.'
  );
});

test('leaves a normal answer containing the word "analysis" intact', () => {
  const input = 'This function requires further analysis of the edge cases before merging.';
  assert.equal(stripChainOfThought(input), input);
});

test('leaves a normal technical explanation containing "The user" intact', () => {
  const input = 'The user submits a form, which triggers client-side validation before the request is sent.';
  assert.equal(stripChainOfThought(input), input);
});

test('leaves a plain final answer with no reasoning markers completely unchanged', () => {
  const input = 'The DROP home page is a client component that switches between home, drop-hub, and messages views.';
  assert.equal(stripChainOfThought(input), input);
});

test('handles empty/non-string input safely', () => {
  assert.equal(stripChainOfThought(''), '');
  assert.equal(stripChainOfThought(undefined), '');
  assert.equal(stripChainOfThought(null), '');
});
