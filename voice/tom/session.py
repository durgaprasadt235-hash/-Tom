"""Tom voice session orchestration.

Provides a thin session layer that coordinates microphone selection,
ambient calibration, and one-shot speech capture.

Does NOT implement transcription or audio mechanics — those remain in voice.py.

Classes:
    VoiceSession  — one-shot listening session (no continuous loop, no LLM)

Typical usage::

    session = VoiceSession.create_default()
    text = session.run_once()
    if text is not None:
        print(f"You said: {text}")
"""

from __future__ import annotations

from typing import Optional
from speech_recognition import AudioData

from tom.voice import (
    MicrophoneManager,
    SpeechInput,
    SpeechTimeoutError,
    SpeechNotUnderstandableError,
    SpeechServiceError,
)
from tom.commands import Command, CommandInterpreter
from tom.actions import ActionResult, ActionExecutor
from tom.responses import TomResponse, ResponseGenerator
from tom.speech import SpeechResult, SpeechSynthesizer
from tom.weather import WeatherRequest, WeatherService


class VoiceSession:
    """One-shot voice session orchestrator.

    Responsibilities:
    - Microphone selection via MicrophoneManager
    - Ambient noise calibration (once at session start)
    - Delegate audio capture and transcription to SpeechInput
    - Translate exceptions into user-facing status messages
    - Return transcript to caller (or None on failure)

    Does NOT:
    - Implement continuous listening
    - Implement wake-word detection
    - Call any LLM or external AI API
    - Perform audio mechanics directly
    """

    def __init__(
        self,
        speech_input: SpeechInput,
        calibration_duration: float = 1.5,
        verbose: bool = True,
        *,
        weather_service: Optional[WeatherService] = None,
    ) -> None:
        """Initialise VoiceSession.

        Args:
            speech_input: Configured SpeechInput instance (from voice.py).
            calibration_duration: Seconds of ambient noise to sample before
                listening. Passed to SpeechInput.calibrate_ambient_noise().
            verbose: If True, print status messages to stdout.
        """
        self._speech = speech_input
        self._calibration_duration = calibration_duration
        self._verbose = verbose
        self._weather_service = weather_service

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def create_default(
        cls,
        preferred_microphone: str = "MacBook Air Microphone",
        timeout: float = 10.0,
        phrase_time_limit: float = 10.0,
        calibration_duration: float = 1.5,
        verbose: bool = True,
    ) -> "VoiceSession":
        """Create a VoiceSession using the preferred system microphone.

        Selects the microphone with MicrophoneManager and wires up a
        SpeechInput instance. No audio hardware is touched until
        run_once() is called.

        Args:
            preferred_microphone: Name of the preferred microphone.
                Defaults to "MacBook Air Microphone".
            timeout: Seconds to wait for speech to begin.
            phrase_time_limit: Max seconds to capture one utterance.
            calibration_duration: Seconds of ambient noise sampling.
            verbose: Print status lines to stdout when True.

        Returns:
            Configured VoiceSession ready for run_once().
        """
        manager = MicrophoneManager()
        mic = manager.get_preferred_microphone(preferred_microphone)

        speech_input = SpeechInput(
            microphone=mic,
            timeout=timeout,
            phrase_time_limit=phrase_time_limit,
            calibration_duration=calibration_duration,
        )

        return cls(
            speech_input=speech_input,
            calibration_duration=calibration_duration,
            verbose=verbose,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _log(self, message: str) -> None:
        """Print a status line if verbose mode is enabled."""
        if self._verbose:
            print(message)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def calibrate(self) -> None:
        """Calibrate ambient noise.

        Should be called once before the first run_once() in a session.
        Blocks for calibration_duration seconds.
        """
        self._log(f"[Tom] Calibrating ambient noise ({self._calibration_duration}s) — stay quiet...")
        self._speech.calibrate_ambient_noise(duration=self._calibration_duration)
        self._log("[Tom] Calibration complete.")

    def capture_audio_once(self) -> AudioData:
        """Capture one utterance without transcription or recalibration.

        Uses the session's selected, calibrated SpeechInput. The microphone
        is released before returning; capture errors propagate to the caller.
        """
        return self._speech.listen_once()

    def listen_active_once(self, *, timeout: float) -> str:
        """Listen/transcribe once with a temporary speech-start timeout.

        Preserve recognition exceptions so the active-session orchestrator can
        distinguish silence from unintelligible speech or service failure.
        Always restore the wake-mode timeout, including on Ctrl+C.
        """
        previous_timeout = self._speech.timeout
        try:
            self._speech.timeout = timeout
            return self._speech.listen_and_transcribe(calibrate=False)
        finally:
            self._speech.timeout = previous_timeout

    def run_once(self, *, calibrate: bool = True) -> Optional[str]:
        """Listen for one spoken utterance and return its transcript.

        Workflow:
            1. Optionally calibrate ambient noise.
            2. Prompt user to speak.
            3. Capture one utterance.
            4. Transcribe via Google Speech API.
            5. Return transcript string, or None on any failure.

        Args:
            calibrate: If True (default), calibrate ambient noise before
                listening. Pass False if you have already called calibrate()
                separately.

        Returns:
            Transcribed text string on success, or None on failure.
        """
        if calibrate:
            self.calibrate()

        self._log("[Tom] Listening... (speak now)")

        try:
            text = self._speech.listen_and_transcribe(calibrate=False)
            self._log(f"[Tom] Heard: {text!r}")
            return text

        except SpeechTimeoutError as exc:
            self._log(f"[Tom] No speech detected — {exc}")
            return None

        except SpeechNotUnderstandableError as exc:
            self._log(f"[Tom] Could not understand speech — {exc}")
            return None

        except SpeechServiceError as exc:
            self._log(f"[Tom] Transcription service error — {exc}")
            return None

    def run_command_once(self, *, calibrate: bool = True) -> Optional[Command]:
        """Listen for one utterance and return a structured Command.

        Combines run_once() with CommandInterpreter so the caller receives
        a typed Command instead of a raw string.

        Existing run_once() is unchanged — this is an additive method.

        Args:
            calibrate: Passed through to run_once().

        Returns:
            Command on success (intent may be 'unknown' for unrecognised
            speech), or None if no speech was captured.
        """
        text = self.run_once(calibrate=calibrate)
        if text is None:
            return None
        interpreter = CommandInterpreter()
        command = interpreter.interpret(text)
        self._log(f"[Tom] Intent: {command.intent!r}" +
                  (f", target: {command.target!r}" if command.target else ""))
        return command

    def run_action_once(self, *, calibrate: bool = True) -> Optional[ActionResult]:
        """Listen for one utterance, interpret the command, and execute it.

        Combines run_command_once() with ActionExecutor.

        Existing run_once() and run_command_once() contracts are unchanged.

        Args:
            calibrate: Passed through to run_command_once().

        Returns:
            ActionResult on success/failure of action execution, or None
            if no speech was captured / session timed out.
        """
        command = self.run_command_once(calibrate=calibrate)
        if command is None:
            return None

        executor = ActionExecutor()
        result = executor.execute(command)
        self._log(f"[Tom] Action result: success={result.success}, {result.message}")
        return result

    def run_response_once(self, *, calibrate: bool = True) -> Optional[TomResponse]:
        """Listen for one utterance, interpret, execute if needed, and return a response.

        Combines run_command_once(), ActionExecutor (for open_app), and
        ResponseGenerator without duplicating microphone capture.

        Existing run_once(), run_command_once(), and run_action_once()
        contracts are unchanged.

        Args:
            calibrate: Passed through to run_command_once().

        Returns:
            TomResponse on success, or None if no speech was captured / timed out.
        """
        text = self.run_once(calibrate=calibrate)
        if text is None:
            return None
        return self.process_transcript(text, speak=False)

    def process_transcript(
        self,
        text: str,
        *,
        speak: bool = True,
        voice: Optional[str] = None,
    ) -> TomResponse:
        """Process an already captured transcript without listening again.

        The transcript is interpreted once, executable commands are dispatched
        once, and one response is generated.  When ``speak`` is true the
        response is also passed to the local speech synthesizer once.  Speech
        failures are reported but do not replace the original TomResponse.
        """
        interpreter = CommandInterpreter()
        command = interpreter.interpret(text)
        self._log(f"[Tom] Intent: {command.intent!r}" +
                  (f", target: {command.target!r}" if command.target else ""))

        action_result: Optional[ActionResult] = None
        if command.intent == "open_app":
            executor = ActionExecutor()
            action_result = executor.execute(command)
            self._log(
                f"[Tom] Action result: success={action_result.success}, "
                f"{action_result.message}"
            )

        generator = ResponseGenerator()
        if command.intent == "weather":
            if self._weather_service is None:
                self._weather_service = WeatherService()
            weather_result = self._weather_service.get_weather(command.weather_request or WeatherRequest())
            response = generator.generate(command, weather_result=weather_result)
        else:
            response = generator.generate(command, action_result=action_result)
        self._log(f"[Tom] Response: {response.text}")

        if speak:
            speaker = SpeechSynthesizer(voice=voice)
            speech_result = speaker.speak(response.text)
            if not speech_result.success:
                self._log(f"[Tom] Speech synthesis warning: {speech_result.message}")

        return response

    def run_spoken_response_once(
        self,
        *,
        calibrate: bool = True,
        voice: Optional[str] = None,
    ) -> Optional[TomResponse]:
        """Listen for one utterance, interpret, execute if needed, respond, and speak.

        Combines run_response_once() with local macOS SpeechSynthesizer.
        Does NOT listen twice, execute actions twice, or re-run response generation.

        If speech synthesis encounters an error, the session does not crash
        and the TomResponse is still returned.

        Args:
            calibrate: Passed through to run_response_once().
            voice: Optional macOS voice name (e.g. "Samantha").

        Returns:
            TomResponse on success, or None if no speech was captured / timed out.
        """
        text = self.run_once(calibrate=calibrate)
        if text is None:
            return None
        return self.process_transcript(text, speak=True, voice=voice)


# ---------------------------------------------------------------------------
# Manual test entry point:  python -m tom.session
# ---------------------------------------------------------------------------

def _run_manual_test() -> None:
    """Manual one-shot voice session test (Step 8: Voice -> Command -> Action -> Response -> Speech)."""
    print("=" * 50)
    print("Tom — Step 8: One-Shot Voice Session + Speech Test")
    print("=" * 50)

    session = VoiceSession.create_default()
    response = session.run_spoken_response_once()

    print()
    if response is not None:
        status = "SUCCESS" if response.success else "FAILED"
        print(f"[{status}] Tom: {response.text}")
        print(f"Intent:  {response.intent}")
        if response.target:
            print(f"Target:  {response.target}")
    else:
        print("Session completed with no recognised speech.")

    print("=" * 50)


if __name__ == "__main__":
    _run_manual_test()
