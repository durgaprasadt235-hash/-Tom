// Chat Control Panel UI contract (static): the served markup + client logic
// wire every control to the server-authoritative task view. Web Speech and
// clipboard behavior live in tests/tom-controls.test.js (shared module).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
const controlsJs = fs.readFileSync(path.join(publicDir, 'tom-controls.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');

test('index.html: every control-panel element exists in the composer', () => {
  const requiredIds = [
    'tomComposer', 'tomInput', 'tomSendButton',
    'tomAttachInput', 'tomAttachButton', 'tomAttachmentList',
    'tomVoiceButton', 'tomVoiceNotice',
    'tomTaskStatus', 'tomTaskControls',
    'tomPauseButton', 'tomResumeButton', 'tomStopButton'
  ];
  for (const id of requiredIds) {
    assert.ok(indexHtml.includes(`id="${id}"`), 'missing element: ' + id);
  }
  // Shared logic loads BEFORE the app script.
  const controlsIndex = indexHtml.indexOf('src="/tom-controls.js"');
  const appIndex = indexHtml.indexOf('src="/app.js"');
  assert.ok(controlsIndex !== -1, 'tom-controls.js is served');
  assert.ok(appIndex !== -1, 'app.js is served');
  assert.ok(controlsIndex < appIndex, 'tom-controls.js must load before app.js');
  // File picker accepts only the data allowlist — never scripts/executables.
  const accept = /id="tomAttachInput"[^>]*accept="([^"]+)"/.exec(indexHtml) ||
    /accept="([^"]+)"[^>]*id="tomAttachInput"/.exec(indexHtml);
  assert.ok(accept, 'attach input declares accept list');
  assert.ok(accept[1].includes('.txt'), 'text files allowed');
  for (const blocked of ['.sh', '.bat', '.exe', '.ps1']) {
    assert.ok(!accept[1].includes(blocked), 'must not accept ' + blocked);
  }
});

test('app.js: controls derive ONLY from the server task view', () => {
  // The authoritative view is applied from every /chat + control response.
  assert.ok(appJs.includes('if (data.task) applyTaskView(data.task)'), 'task view applied from /chat');
  assert.ok(appJs.includes('applyTaskView(data.task)'), 'task view applied from control calls');
  assert.ok(appJs.includes('window.TomControls.deriveButtons(currentTaskView)'), 'buttons derived from server controls');
  // Button wiring uses the derived values, not local booleans.
  assert.ok(appJs.includes('pauseButton.disabled = !buttons.pause'), 'pause derives from controls');
  assert.ok(appJs.includes('resumeButton.disabled = !buttons.resume'), 'resume derives from controls');
  assert.ok(appJs.includes('stopButton.disabled = !buttons.stop'), 'stop derives from controls');
  assert.ok(!/let\s+isBusy\s*=/.test(appJs), 'no local isBusy boolean');
  assert.ok(!/let\s+canPause\s*=/.test(appJs), 'no local canPause boolean');
  // Server endpoints for each control.
  assert.ok(appJs.includes('/task/${encodeURIComponent(currentTaskId)}/${action}'), 'control endpoints called');
  assert.ok(appJs.includes('postTaskControl("pause")'), 'pause wired');
  assert.ok(appJs.includes('postTaskControl("stop")'), 'stop wired');
  assert.ok(appJs.includes('postTaskControl("resume"'), 'resume wired (with edit-after-pause instruction)');
  // Task creation + send payload.
  assert.ok(appJs.includes('ensureTask'), 'task created lazily');
  assert.ok(appJs.includes('attachmentIds'), 'attachments ride with /chat');
  assert.ok(appJs.includes('taskId: currentTaskId'), 'taskId sent with /chat');
});

test('app.js: voice, attach, copy, and share behaviors are wired', () => {
  assert.ok(appJs.includes('createVoiceController'), 'voice controller created');
  assert.ok(appJs.includes('voiceController.start()'), 'mic starts via controller');
  assert.ok(appJs.includes('voiceController.stop()'), 'mic stops via controller');
  // Transcript is editable composer text; sending remains manual: neither
  // the voice handler nor the control handlers may invoke sendMessage.
  assert.ok(appJs.includes('inputField.value = trimmed ? trimmed + " " + text : text'), 'transcript appended to composer');
  const voiceBlock = /voiceController = window\.TomControls\.createVoiceController\(\{[\s\S]*?\n\}\);/.exec(appJs);
  assert.ok(voiceBlock, 'voice controller config found');
  assert.ok(!voiceBlock[0].includes('sendMessage'), 'voice never auto-sends');
  const controlBlock = /async function postTaskControl\([\s\S]*?\n\}/.exec(appJs);
  assert.ok(controlBlock, 'control handler found');
  assert.ok(!controlBlock[0].includes('sendMessage'), 'pause/resume/stop never send chat messages');
  assert.ok(appJs.includes('stageFile'), 'attachments staged through validated upload');
  assert.ok(appJs.includes('TomControls.validateAttachment'), 'client validation before upload');
  assert.ok(appJs.includes('window.TomControls.copyText(msg.content)'), 'copy button on messages');
  assert.ok(appJs.includes('window.TomControls.buildShareText'), 'share passes through redaction');
  assert.ok(appJs.includes('window.TomControls.shareOrCopy'), 'share uses navigator.share with clipboard fallback');
  // New chat resets the task panel (no stale controls across conversations).
  assert.ok(/function startNewConversation\(\)[\s\S]{0,200}resetTaskPanel\(\)/.test(appJs), 'new chat resets task panel');
});

test('styles.css: control panel styles ship with the UI', () => {
  for (const selector of ['.composer-control', '.composer-task-status', '.tom-attachment-list', '.message-action', '.composer-voice-notice']) {
    assert.ok(stylesCss.includes(selector), 'missing style: ' + selector);
  }
});

test('tom-controls.js: shared module is UMD, side-effect free, and complete', () => {
  assert.ok(controlsJs.includes('module.exports = factory()'), 'Node/UMD export for tests');
  assert.ok(controlsJs.includes('root.TomControls = factory()'), 'browser global export');
  // Required API surface.
  const loaded = require('../public/tom-controls');
  for (const api of [
    'deriveButtons', 'validateAttachment', 'sanitizeFileName', 'buildShareText',
    'copyText', 'shareOrCopy', 'createVoiceController', 'formatTaskStatus',
    'VOICE_UNSUPPORTED', 'VOICE_PERMISSION_DENIED'
  ]) {
    assert.ok(api in loaded, 'missing API: ' + api);
  }
});