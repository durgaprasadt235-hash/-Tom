// Shared Chat Control Panel logic (public/tom-controls.js) — pure derivation,
// validation parity, secret redaction, and voice graceful degradation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const controls = require('../public/tom-controls');

test('deriveButtons: buttons come ONLY from server-provided task.controls', () => {
  // Missing / unknown task = fail closed: no controls at all.
  for (const task of [null, undefined, {}, { taskId: 'x' }, { controls: null }]) {
    const derived = controls.deriveButtons(task);
    assert.deepEqual(derived, {
      attach: false, voice: false, send: false, pause: false, resume: false,
      stop: false, copy: false, share: false, showTaskControls: false
    }, JSON.stringify(task));
  }

  // Server control shapes (mirrors tools/task-session.js controls()).
  const active = controls.deriveButtons({
    taskId: 't1', state: 'PLANNING',
    controls: { canSend: true, canAttach: true, canVoice: true, canPause: true, canResume: false, canStop: true, canEdit: false, canCopy: true, canShare: true, busy: true }
  });
  assert.equal(active.pause, true);
  assert.equal(active.resume, false);
  assert.equal(active.stop, true);
  assert.equal(active.showTaskControls, true);

  const paused = controls.deriveButtons({
    taskId: 't1', state: 'PAUSED',
    controls: { canSend: true, canAttach: true, canVoice: true, canPause: false, canResume: true, canStop: true, canEdit: true, canCopy: true, canShare: true, busy: false }
  });
  assert.equal(paused.attach, false, 'paused composer is controlled by Resume/Stop');
  assert.equal(paused.voice, false, 'paused composer is controlled by Resume/Stop');
  assert.equal(paused.send, false, 'paused send is replaced by Resume/Stop');
  assert.equal(paused.pause, false);
  assert.equal(paused.resume, true);
  assert.equal(paused.stop, true);

  // Dishonest/partial controls never enable MORE than the server said.
  const partial = controls.deriveButtons({ taskId: 't2', controls: { canPause: true } });
  assert.equal(partial.resume, false, 'absent flags default to false');
  assert.equal(partial.stop, false, 'absent flags default to false');
  assert.equal(partial.send, true, 'canSend defaults open only when explicitly true-ish');
});

test('formatTaskStatus always shows state + revision', () => {
  assert.equal(controls.formatTaskStatus(null), 'No active task');
  assert.equal(
    controls.formatTaskStatus({ taskId: 'abc-123', state: 'PAUSED', revision: 3 }),
    'abc-123 · PAUSED · rev 3'
  );
  assert.match(controls.formatTaskStatus({ label: 'Long task name that is cut', taskId: 'x'.repeat(80), state: 'RUNNING' }), /· RUNNING$/);
});

test('redaction: secrets never survive buildShareText', () => {
  const secretSamples = [
    'api_key=sk-abcdefgh12345678 use this',
    'password: hunter2 is mine',
    'Authorization: Bearer abc123def456',
    'token: supersecrettokenvalue',
    'nvapi-1234567890abcdef1234'
  ];
  for (const secret of secretSamples) {
    const shared = controls.buildShareText({ role: 'tom', content: secret, taskState: 'COMPLETED' });
    assert.ok(!shared.includes(secret), 'raw secret leaked: ' + secret);
    assert.ok(/\[redacted\]|=\[redacted\]/.test(shared), shared);
    assert.match(shared, /^Tom response \(task COMPLETED\):\n\n/);
  }
  // Ordinary prose is untouched.
  const prose = 'The build passed and 12 tests are green.';
  assert.ok(controls.buildShareText({ role: 'user', content: prose }).includes(prose));
  // Share of a prompt uses the prompt header.
  assert.match(controls.buildShareText({ role: 'user', content: 'hello' }), /^Tom prompt:\n\nhello$/);
});

test('copyText and shareOrCopy: clipboard first, Web Share when available', async () => {
  const written = [];
  const clipboard = { writeText: async (value) => { written.push(value); } };

  assert.equal(await controls.copyText('hello world', clipboard), true);
  assert.deepEqual(written, ['hello world']);

  await assert.rejects(() => controls.copyText('x', {}), /Clipboard unavailable/);
  await assert.rejects(() => controls.copyText('x', null), /Clipboard unavailable/,
    'no navigator in Node must fail closed, not silently pass');

  // navigator.share present -> native share.
  let sharedPayload = null;
  const navWithShare = { share: async (payload) => { sharedPayload = payload; } };
  const outcome = await controls.shareOrCopy('share me', clipboard, navWithShare);
  assert.equal(outcome, 'shared');
  assert.deepEqual(sharedPayload, { title: 'Tom', text: 'share me' });

  // No share API -> clipboard fallback.
  const outcomeFallback = await controls.shareOrCopy('fallback', clipboard, {});
  assert.equal(outcomeFallback, 'copied');
  assert.deepEqual(written, ['hello world', 'fallback']);
});

test('voice: unsupported API degrades with a visible notice, never throws', () => {
  const states = [];
  const controller = controls.createVoiceController({
    Recognition: null, // Node / browser without Web Speech
    onState: (state) => states.push(state),
    onTranscript: () => { throw new Error('must not transcribe without API'); }
  });
  assert.equal(controller.supported, false);
  assert.doesNotThrow(() => controller.start());
  assert.equal(states.length, 1);
  assert.equal(states[0].notice, controls.VOICE_UNSUPPORTED);
  assert.equal(states[0].listening, false);
  assert.doesNotThrow(() => controller.stop());
  assert.doesNotThrow(() => controller.dispose());
});

test('voice: transcript is editable input data — manual send, no auto-action', () => {
  const events = { transcripts: [], states: [] };
  let recognitionInstance = null;
  class FakeRecognition {
    constructor() { recognitionInstance = this; }
    start() { this.started = true; }
    stop() { this.stopped = true; if (this.onend) this.onend(); }
    abort() { this.aborted = true; }
  }

  const controller = controls.createVoiceController({
    Recognition: FakeRecognition,
    onTranscript: (text) => events.transcripts.push(text),
    onInterim: () => {},
    onState: (state) => events.states.push(state)
  });
  assert.equal(controller.supported, true);

  controller.start();
  assert.equal(controller.listening, true);
  assert.equal(events.states[0].notice, controls.VOICE_LISTENING);
  assert.ok(recognitionInstance.started);

  // Final result -> editable transcript handed to the caller (composer).
  const finalResult = [{ transcript: 'fix the bug' }];
  finalResult.isFinal = true;
  const interimResult = [{ transcript: ' today' }];
  interimResult.isFinal = false;
  recognitionInstance.onresult({ resultIndex: 0, results: [interimResult] });
  recognitionInstance.onresult({ resultIndex: 0, results: [finalResult] });
  assert.ok(events.transcripts.includes('fix the bug'), 'final transcript delivered');
  assert.ok(!events.transcripts.some((text) => text.includes('today')), 'interim never finalizes');

  controller.stop();
  assert.equal(controller.listening, false);
  assert.equal(events.states[events.states.length - 1].notice, null);
});

test('voice: permission denial is a visible, graceful notice', () => {
  const states = [];
  let recognitionInstance = null;
  class DenyRecognition {
    constructor() { recognitionInstance = this; }
    start() {}
    stop() {}
    abort() {}
  }
  const controller = controls.createVoiceController({
    Recognition: DenyRecognition,
    onState: (state) => states.push(state),
    onTranscript: () => {}
  });
  controller.start();
  recognitionInstance.onerror({ error: 'not-allowed' });
  const last = states[states.length - 1];
  assert.equal(last.notice, controls.VOICE_PERMISSION_DENIED);
  assert.equal(last.listening, false);
});

test('control module performs no network I/O and never auto-sends', () => {
  const source = fs.readFileSync(require.resolve('../public/tom-controls'), 'utf8');
  for (const token of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendMessage(']) {
    assert.ok(!source.includes(token), 'forbidden token in shared control logic: ' + token);
  }
  // Voice notices the spec requires, verbatim fallbacks.
  assert.match(controls.VOICE_UNSUPPORTED, /unavailable in this browser/);
  assert.match(controls.VOICE_PERMISSION_DENIED, /Microphone access was denied/);
});
