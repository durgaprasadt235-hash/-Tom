# Offline wake recognition

Wake audio is decoded locally with Vosk. Commands still use the existing
Google transcription and macOS speech output. The Swift helper is no longer used.

Install the additional dependency into the existing project environment:

```bash
cd /Users/tdurg/Tom
.venv/bin/python3 -m pip install -r requirements-wake.txt
```

Download the official small US English model (about 40 MB) from
https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
and extract it so this directory exists:

```text
/Users/tdurg/Tom/models/vosk-model-small-en-us-0.15
```

There are no automatic model downloads at runtime. Only the command stage
requires an internet connection. Microphone permission for the terminal/app is
still required; Apple Speech Recognition permission is not used.

Run one cycle:

```bash
.venv/bin/python3 -m tom.wake --once
```

Wait for calibration and the wake prompt. Say **Hey Tom**, pause, then wait for
**Listening for command...** before saying **What time is it?** Standalone **Tom**
is also accepted; the longer phrase gives the recognizer more speech to work with.
Matching is case-insensitive and requires the standalone word Tom. Acoustic
recognition can still make mistakes; watch the displayed wake transcript.

For continuous cycles, omit `--once`. Ctrl+C stops the loop. Capture is synchronous:
one completed wake utterance, then exactly one command utterance after detection.
There are no background listeners or streaming transcription. The existing input
timeout applies to each attempt; a failed single cycle prints its outcome and exits.
