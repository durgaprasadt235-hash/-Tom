// ---------------------------------------
// TOM CHAT CONTROL PANEL — shared pure logic (browser + Node)
// ---------------------------------------
// UMD so the browser gets window.TomControls and tests can require() it.
// Everything here is DERIVED from server-provided state (task.controls) or
// deterministic validation — never from local booleans the server didn't send.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TomControls = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Mirror of tools/attachment-store.js validation (parity is asserted in
  // tests/attachment-store.test.js). The SERVER re-validates everything:
  // this only avoids wasted uploads and gives instant feedback.
  var ALLOWED_EXTENSIONS = [".txt", ".md", ".json", ".csv", ".tsv", ".log",
    ".yaml", ".yml", ".js", ".jsx", ".ts", ".tsx",
    ".py", ".html", ".css", ".sql", ".xml", ".ini"];
  var BLOCKED_EXTENSIONS = [".sh", ".bash", ".zsh", ".csh", ".fish", ".bat", ".cmd",
    ".ps1", ".psm1", ".exe", ".com", ".scr", ".dll", ".so", ".dylib", ".app",
    ".msi", ".deb", ".rpm", ".pkg", ".dmg", ".jar", ".apk", ".bin",
    ".pem", ".key", ".p12", ".pfx"];
  var MAX_BYTES = 1024 * 1024;
  var MAX_FILES_PER_TASK = 5;
  var MAX_NAME_LENGTH = 80;

  var VOICE_UNSUPPORTED =
    "Voice input is unavailable in this browser. Type your message instead.";
  var VOICE_PERMISSION_DENIED =
    "Microphone access was denied. Allow the microphone in your browser settings, or type your message instead.";
  var VOICE_LISTENING = "Listening… speak now. Your words appear in the box — edit them, then press Send.";

  function extensionOf(name) {
    var match = /\.([A-Za-z0-9]+)$/.exec(String(name || ""));
    return match ? "." + match[1].toLowerCase() : "";
  }

  function sanitizeFileName(input) {
    var base = String(input || "").replace(/\\/g, "/").split("/").pop() || "";
    var cleaned = base
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .replace(/\.{2,}/g, ".")
      .replace(/^[._-]+/, "")
      .slice(0, MAX_NAME_LENGTH);
    if (!cleaned || cleaned === "." || cleaned === "-") return null;
    return cleaned;
  }

  function validateAttachment(file, existingCount) {
    var name = sanitizeFileName(file && file.name);
    if (!name) return { ok: false, error: "Attachment name is required" };
    var ext = extensionOf(name);
    if (!ext) return { ok: false, error: "Attachment must have a file extension" };
    if (BLOCKED_EXTENSIONS.indexOf(ext) !== -1) {
      return { ok: false, error: "Attachment type is not allowed: " + ext };
    }
    if (ALLOWED_EXTENSIONS.indexOf(ext) === -1) {
      return { ok: false, error: "Attachment type is not allowed: " + ext };
    }
    var size = file && Number.isSafeInteger(file.size) ? file.size : NaN;
    if (!Number.isSafeInteger(size) || size <= 0) {
      return { ok: false, error: "Attachment is empty" };
    }
    if (size > MAX_BYTES) return { ok: false, error: "Attachment exceeds the 1 MB limit" };
    if (existingCount >= MAX_FILES_PER_TASK) {
      return { ok: false, error: "Attachment limit reached (max " + MAX_FILES_PER_TASK + " files per task)" };
    }
    return { ok: true, name: name };
  }

  // The only source of button availability: the server-provided controls for
  // the current task state. Unknown/missing task = fail closed (no controls).
  function deriveButtons(task) {
    if (!task || typeof task !== "object" || !task.controls || typeof task.controls !== "object") {
      return { attach: false, voice: false, send: false, pause: false, resume: false, stop: false, copy: false, share: false, showTaskControls: false };
    }
    var controls = task.controls;
  const actions = { attach: [], voice: [], send: [], pause: [], resume: [], stop: [] };
    const state = String(task.state || 'IDLE');
    if (['IDLE', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(state)) {
      actions.attach.push(controls.canAttach === true);
      actions.voice.push(controls.canVoice === true);
      // Send is the normal composer action unless the server explicitly
      // disables it. Other task controls remain fail-closed when omitted.
      actions.send.push(controls.canSend !== false);
    } else if (state === 'PAUSED') {
      // The send area is replaced by Resume + Stop; the textarea remains
      // editable so the user can change authority before resuming.
      actions.resume.push(controls.canResume === true);
      actions.stop.push(controls.canStop === true);
    } else if (['PLANNING', 'RUNNING'].includes(state)) {
      actions.pause.push(controls.canPause === true);
      actions.stop.push(controls.canStop === true);
    } else if (state === 'PAUSING') {
      actions.stop.push(controls.canStop === true);
    } else if (state === 'WAITING_FOR_APPROVAL') {
      actions.stop.push(controls.canStop === true);
    } else if (state === 'CANCELLING') {
      actions.stop.push(controls.canStop === true);
    }
    return {
      attach: actions.attach.length ? actions.attach[0] : false,
      voice: actions.voice.length ? actions.voice[0] : false,
      send: actions.send.length ? actions.send[0] : false,
      pause: actions.pause.length ? actions.pause[0] : false,
      resume: actions.resume.length ? actions.resume[0] : false,
      stop: actions.stop.length ? actions.stop[0] : false,
      copy: controls.canCopy === true,
      share: controls.canShare === true,
      showTaskControls: Boolean(task.taskId)
    };
  }

  function formatTaskStatus(task) {
    if (!task || typeof task !== "object" || !task.state) return "No active task";
    var label = String(task.label || task.taskId || "Task").slice(0, 40);
    return label + " · " + task.state + (Number.isInteger(task.revision) ? " · rev " + task.revision : "");
  }

  // Copy/Share payloads are sanitized: secrets never leave the machine.
  function redactSecrets(text) {
    var value = String(text || "");
    value = value.replace(/\b(authorization|bearer|password|passwd|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi,
      function (match, key) { return key + "=[redacted]"; });
    value = value.replace(/\b(?:sk|nvapi|hf|gh[pous]|glpat)[-_][A-Za-z0-9_-]{8,}\b/g, "[redacted]");
    value = value.replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted]");
    value = value.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[redacted]");
    return value;
  }

  function buildShareText(message) {
    var body = redactSecrets(message && typeof message.content === "string" ? message.content : String(message || ""));
    var header = "Tom " + (message && message.role === "user" ? "prompt" : "response");
    if (message && message.taskState) header += " (task " + message.taskState + ")";
    return header + ":\n\n" + body;
  }

  async function copyText(text, clipboard) {
    var value = String(text || "");
    var transport = clipboard || (typeof navigator !== "undefined" ? navigator.clipboard : null);
    if (transport && typeof transport.writeText === "function") {
      await transport.writeText(value);
      return true;
    }
    throw new Error("Clipboard unavailable");
  }

  function shareOrCopy(text, clipboard, navigatorRef) {
    var nav = navigatorRef || (typeof navigator !== "undefined" ? navigator : null);
    if (nav && typeof nav.share === "function") {
      return Promise.resolve(nav.share({ title: "Tom", text: String(text || "") })).then(function () { return "shared"; });
    }
    return copyText(text, clipboard).then(function () { return "copied"; });
  }

  /*
    Voice input — Web Speech API with graceful degradation.
    * Unsupported browser / missing API  -> supported:false + exact notice,
      mic button disabled, app keeps working (typing unaffected).
    * Permission denied / service error -> notice, listening stops.
    * Transcript arrives as EDITABLE text the user can fix before sending.
      The controller NEVER sends anything: sending stays a manual action.
  */
  function createVoiceController(options) {
    var config = options || {};
    var Recognition = config.Recognition ||
      (typeof window !== "undefined"
        ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
        : null);
    var onTranscript = typeof config.onTranscript === "function" ? config.onTranscript : function () {};
    var onInterim = typeof config.onInterim === "function" ? config.onInterim : function () {};
    var onState = typeof config.onState === "function" ? config.onState : function () {};
    var recognition = null;
    var listening = false;

    function notice(message) { onState({ listening: false, supported: Boolean(Recognition), notice: message }); }

    if (!Recognition) {
      return {
        supported: false,
        listening: false,
        start: function () { notice(VOICE_UNSUPPORTED); },
        stop: function () { notice(null); },
        dispose: function () {}
      };
    }

    function build() {
      var instance = new Recognition();
      instance.lang = config.lang || "en-US";
      instance.interimResults = true;
      instance.continuous = false;
      instance.maxAlternatives = 1;
      instance.onresult = function (event) {
        var interim = "";
        var finalText = "";
        for (var i = event.resultIndex; i < event.results.length; i += 1) {
          var transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalText += transcript;
          else interim += transcript;
        }
        if (interim) onInterim(interim);
        if (finalText) onTranscript(finalText.trim());
      };
      instance.onerror = function (event) {
        listening = false;
        if (event && (event.error === "not-allowed" || event.error === "service-not-allowed")) {
          notice(VOICE_PERMISSION_DENIED);
        } else if (event && event.error === "no-speech") {
          onState({ listening: false, supported: true, notice: "No speech heard. Try again or type your message." });
        } else {
          notice(VOICE_UNSUPPORTED);
        }
      };
      instance.onend = function () {
        if (listening) {
          listening = false;
          onState({ listening: false, supported: true, notice: null });
        }
      };
      return instance;
    }

    return {
      supported: true,
      get listening() { return listening; },
      start: function () {
        if (listening) return;
        try {
          recognition = build();
          recognition.start();
          listening = true;
          onState({ listening: true, supported: true, notice: VOICE_LISTENING });
        } catch (_) {
          listening = false;
          notice(VOICE_UNSUPPORTED);
        }
      },
      stop: function () {
        listening = false;
        if (recognition) { try { recognition.stop(); } catch (_) { /* already stopped */ } }
        onState({ listening: false, supported: true, notice: null });
      },
      dispose: function () {
        listening = false;
        if (recognition) { try { recognition.abort(); } catch (_) { /* already gone */ } }
        recognition = null;
      }
    };
  }

  return {
    ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS,
    BLOCKED_EXTENSIONS: BLOCKED_EXTENSIONS,
    MAX_BYTES: MAX_BYTES,
    MAX_FILES_PER_TASK: MAX_FILES_PER_TASK,
    VOICE_UNSUPPORTED: VOICE_UNSUPPORTED,
    VOICE_PERMISSION_DENIED: VOICE_PERMISSION_DENIED,
    VOICE_LISTENING: VOICE_LISTENING,
    extensionOf: extensionOf,
    sanitizeFileName: sanitizeFileName,
    validateAttachment: validateAttachment,
    deriveButtons: deriveButtons,
    formatTaskStatus: formatTaskStatus,
    redactSecrets: redactSecrets,
    buildShareText: buildShareText,
    copyText: copyText,
    shareOrCopy: shareOrCopy,
    createVoiceController: createVoiceController
  };
});
