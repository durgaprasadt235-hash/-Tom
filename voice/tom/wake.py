"""Synchronous local wake-word orchestration for Tom."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

from tom.responses import TomResponse
from tom.session import VoiceSession
from tom.speech import SpeechSynthesizer
from tom.voice import SpeechTimeoutError, SpeechNotUnderstandableError, SpeechServiceError


ACTIVE_SESSION_TIMEOUT_SECONDS = 6.0
WAKE_GREETING = "Hey Boss, how can I help you?"
FOLLOW_UP_PROMPT = "Is there anything else I can help you with?"
SESSION_CLOSE_RESPONSE = "Alright Boss."


class SessionState(Enum):
    IDLE = "idle"
    ACTIVE_SESSION = "active_session"
    FINAL_WAIT = "final_wait"


def is_session_close(text: str) -> bool:
    """Exact session-control phrases; never infer closure from a prefix."""
    if not isinstance(text, str):
        return False
    normalized = " ".join(text.lower().replace("’", "'").split()).strip(" .!?,")
    return normalized in {
        "no", "no thanks", "no thank you", "that's all", "nothing else",
        "thanks", "thank you",
    }


class OfflineWakeRecognizer:
    """Decode completed wake utterances with a locally installed Vosk model.

    Uses a constrained Vosk grammar to maximize accuracy for the wake phrase
    and reject out-of-vocabulary speech as [unk].

    No network, microphone access, streaming, or subprocesses in this layer.
    A fresh decoder per utterance prevents wake text leaking into later cycles.
    """

    DEFAULT_GRAMMAR: list[str] = ["hey tom", "tom", "[unk]"]
    DEFAULT_SAMPLE_RATE: int = 16000
    sample_rate: int = DEFAULT_SAMPLE_RATE
    grammar: list[str] = DEFAULT_GRAMMAR

    def __init__(
        self,
        model_path: Optional[Path] = None,
        grammar: Optional[list[str]] = None,
        sample_rate: int = 16000,
    ) -> None:
        self.model_path = model_path or (
            Path(__file__).resolve().parent.parent / "models" / "vosk-model-small-en-us-0.15"
        )
        self.grammar = list(grammar) if grammar is not None else list(self.DEFAULT_GRAMMAR)
        self.sample_rate = sample_rate
        self._grammar_json = json.dumps(self.grammar)
        self._model = None
        self._decoder_factory = None

    def prepare(self) -> None:
        if self._model is not None:
            return
        if not self.model_path.is_dir():
            raise RuntimeError(f"Offline wake model missing: {self.model_path}. See WAKE_SETUP.md.")
        try:
            from vosk import Model, KaldiRecognizer, SetLogLevel
        except (ImportError, OSError) as exc:
            raise RuntimeError("Vosk could not load. Install requirements-wake.txt; see WAKE_SETUP.md.") from exc
        SetLogLevel(-1)
        try:
            self._model = Model(str(self.model_path))
        except Exception as exc:
            raise RuntimeError(f"Could not load offline wake model: {exc}") from exc
        self._decoder_factory = KaldiRecognizer

    def transcribe(self, audio) -> str:
        self.prepare()
        decoder = self._decoder_factory(self._model, self.sample_rate, self._grammar_json)
        pcm = audio.get_raw_data(convert_rate=self.sample_rate, convert_width=2)
        parts = []
        if decoder.AcceptWaveform(pcm):
            res = json.loads(decoder.Result())
            text = res.get("text", "")
            if text:
                parts.append(text)
        final_res = json.loads(decoder.FinalResult())
        final_text = final_res.get("text", "")
        if final_text:
            parts.append(final_text)
        raw_text = " ".join(parts).strip()
        cleaned_words = [w for w in raw_text.lower().split() if w != "[unk]"]
        return " ".join(cleaned_words).strip()


@dataclass(frozen=True)
class WakeDetectionResult:
    """Immutable result of checking recognized speech for a wake word."""

    detected: bool
    text: str
    wake_word: str


class WakeWordDetector:
    """Deterministically detect a configured standalone wake word."""

    def __init__(self, wake_word: str = "tom") -> None:
        normalized = wake_word.strip().lower() if isinstance(wake_word, str) else ""
        if not normalized:
            normalized = "tom"
        self._wake_word = normalized
        self._pattern = re.compile(
            rf"(?<!\w){re.escape(normalized)}(?!\w)", re.IGNORECASE
        )

    @property
    def wake_word(self) -> str:
        return self._wake_word

    def detect(self, text: str) -> WakeDetectionResult:
        """Return whether *text* contains the standalone wake word."""
        original = text if isinstance(text, str) else ""
        return WakeDetectionResult(
            detected=bool(original and self._pattern.search(original)),
            text=original,
            wake_word=self._wake_word,
        )


class WakeSession:
    """Coordinate idle wake detection and a short active command session."""

    def __init__(
        self,
        voice_session: VoiceSession,
        detector: Optional[WakeWordDetector] = None,
        verbose: bool = True,
        *,
        wake_recognizer: Optional[OfflineWakeRecognizer] = None,
        active_timeout: float = ACTIVE_SESSION_TIMEOUT_SECONDS,
    ) -> None:
        self._voice_session = voice_session
        self._detector = detector or WakeWordDetector()
        self._verbose = verbose
        self._wake_recognizer = wake_recognizer or OfflineWakeRecognizer()
        self._active_timeout = active_timeout
        self.state = SessionState.IDLE

    def _log(self, message: str) -> None:
        if self._verbose:
            print(message, flush=True)

    def _wait_for_local_wake(self) -> bool:
        """Capture once, release the microphone, then decode locally."""
        self._wake_recognizer.prepare()
        if not hasattr(self, "_logged_recognizer_info") or not self._logged_recognizer_info:
            sample_rate = getattr(self._wake_recognizer, "sample_rate", OfflineWakeRecognizer.DEFAULT_SAMPLE_RATE)
            grammar = getattr(self._wake_recognizer, "grammar", OfflineWakeRecognizer.DEFAULT_GRAMMAR)
            self._log(
                f"[Tom] Wake recognizer active (sample_rate={sample_rate}Hz, "
                f"grammar={grammar})"
            )
            self._logged_recognizer_info = True
        try:
            audio = self._voice_session.capture_audio_once()
            text = self._wake_recognizer.transcribe(audio)
        except (SpeechTimeoutError, SpeechNotUnderstandableError, SpeechServiceError, OSError, ValueError) as exc:
            self._log(f"[Tom] Wake recognition failed: {exc}")
            return False
        self._log(f"[Tom] Heard wake phrase: {text or '(no recognized speech)'}")
        detected = self._detector.detect(text).detected
        if not detected:
            self._log("[Tom] Wake word not detected. Try saying 'Hey Tom'.")
        return detected

    def run_wake_cycle(self) -> Optional[TomResponse]:
        """Run one wake attempt and one active session; return its last response."""
        self._log("[Tom] Waiting for wake word... (say 'Hey Tom')")
        if not self._wait_for_local_wake():
            return None

        self._log("[Tom] Wake word detected.")
        return self.run_active_session()

    def _speak_session_text(self, text: str) -> None:
        """Speak a control prompt directly, without interpreting a command."""
        self._log(f"[Tom] {text}")
        result = SpeechSynthesizer().speak(text)
        if not result.success:
            self._log(f"[Tom] Speech synthesis warning: {result.message}")

    def run_active_session(self) -> Optional[TomResponse]:
        """Accept commands until closure, exit, or inactivity after one prompt.

        A successful command starts a fresh listen after its response finishes.
        The follow-up prompt budget is not reset by commands: at most one prompt
        is spoken over the entire active session.
        """
        self.state = SessionState.ACTIVE_SESSION
        last_response = None
        prompted = False
        try:
            self._speak_session_text(WAKE_GREETING)
            while True:
                self._log("[Tom] Listening for command...")
                try:
                    command_text = self._voice_session.listen_active_once(
                        timeout=self._active_timeout
                    )
                except (SpeechTimeoutError, SpeechNotUnderstandableError):
                    command_text = ""
                except (SpeechServiceError, OSError) as exc:
                    self._log(f"[Tom] Command recognition failed — {exc}")
                    return last_response

                # Any unusable speech consumes this opportunity. In particular,
                # FINAL_WAIT must not retry unintelligible or empty input.
                if not isinstance(command_text, str) or not command_text.strip():
                    if prompted:
                        return last_response
                    prompted = True
                    self.state = SessionState.FINAL_WAIT
                    self._speak_session_text(FOLLOW_UP_PROMPT)
                    continue

                self.state = SessionState.ACTIVE_SESSION
                self._log(f"[Tom] Heard command: {command_text}")
                if is_session_close(command_text):
                    self._speak_session_text(SESSION_CLOSE_RESPONSE)
                    return last_response

                last_response = self._voice_session.process_transcript(command_text, speak=True)
                status = "SUCCESS" if last_response.success else "FAILED"
                self._log(f"[{status}] Tom: {last_response.text}")
                if last_response.intent == "exit":
                    return last_response
        finally:
            self.state = SessionState.IDLE

    def run_forever(self) -> None:
        """Run synchronous wake cycles until stopped by an exit command or Ctrl+C."""
        try:
            while True:
                response = self.run_wake_cycle()
                if response is not None and response.intent == "exit":
                    break
        except KeyboardInterrupt:
            self._log("Tom stopped.")


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Run Tom in wake-word mode.")
    parser.add_argument(
        "--once", action="store_true", help="Run one wake attempt and active session, then exit."
    )
    args = parser.parse_args(argv)

    try:
        print("[Tom] Loading offline wake model...", flush=True)
        recognizer = OfflineWakeRecognizer()
        recognizer.prepare()
        voice_session = VoiceSession.create_default()
        wake_session = WakeSession(voice_session, wake_recognizer=recognizer)
        voice_session.calibrate()
        if args.once:
            wake_session.run_wake_cycle()
        else:
            wake_session.run_forever()
    except KeyboardInterrupt:
        print("Tom stopped.")
    except RuntimeError as exc:
        print(f"[Tom] Wake setup error: {exc}")


if __name__ == "__main__":
    main()
