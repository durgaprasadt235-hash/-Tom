"""Tests for tom/speech.py — SpeechSynthesizer and SpeechResult.

Ensures:
- Subprocess is always mocked — NO real audio is produced during tests.
- Speech synthesis constructs correct command arguments for macOS 'say'.
- Custom voice option formats correctly.
- Empty and whitespace inputs are rejected without calling subprocess.
- Subprocess errors are handled gracefully without crashing.
- shell=True is never passed to subprocess.
- VoiceSession.run_spoken_response_once() executes each step exactly once.
- Speech failure does not prevent TomResponse from being returned.

Run with:
    cd /Users/tdurg/Tom
    .venv/bin/python3 tests/test_speech.py
"""

import subprocess
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, "/Users/tdurg/Tom")

from tom.responses import TomResponse
from tom.speech import SpeechResult, SpeechSynthesizer


class TestSpeechResultDataclass(unittest.TestCase):
    """Structural tests for the SpeechResult model."""

    def test_speech_result_is_frozen(self):
        res = SpeechResult(success=True, text="Hello.", message="OK")
        with self.assertRaises((AttributeError, TypeError)):
            res.success = False  # type: ignore[misc]

    def test_speech_result_voice_defaults_to_none(self):
        res = SpeechResult(success=True, text="Hello.", message="OK")
        self.assertIsNone(res.voice)

    def test_speech_result_repr_without_voice(self):
        res = SpeechResult(success=True, text="Hello.", message="OK")
        self.assertIn("Hello.", repr(res))
        self.assertNotIn("voice=", repr(res))

    def test_speech_result_repr_with_voice(self):
        res = SpeechResult(success=True, text="Hello.", message="OK", voice="Samantha")
        self.assertIn("voice='Samantha'", repr(res))


class TestSpeechSynthesizer(unittest.TestCase):
    """Unit tests for SpeechSynthesizer — all subprocess calls strictly mocked."""

    # 1. Default voice: ["say", "Hello."]
    @patch("subprocess.run")
    def test_speak_default_voice(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        speaker = SpeechSynthesizer()
        result = speaker.speak("Hello.")

        self.assertTrue(result.success)
        self.assertEqual(result.text, "Hello.")
        self.assertIsNone(result.voice)
        mock_run.assert_called_once_with(
            ["say", "Hello."],
            check=True,
            capture_output=True,
            text=True,
        )

    # 2. Custom voice: ["say", "-v", "Some Voice", "Hello."]
    @patch("subprocess.run")
    def test_speak_custom_voice(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        speaker = SpeechSynthesizer(voice="Some Voice")
        result = speaker.speak("Hello.")

        self.assertTrue(result.success)
        self.assertEqual(result.text, "Hello.")
        self.assertEqual(result.voice, "Some Voice")
        mock_run.assert_called_once_with(
            ["say", "-v", "Some Voice", "Hello."],
            check=True,
            capture_output=True,
            text=True,
        )

    # 3. Empty text -> success=False, subprocess NOT called
    @patch("subprocess.run")
    def test_speak_empty_text(self, mock_run):
        speaker = SpeechSynthesizer()
        result = speaker.speak("")

        self.assertFalse(result.success)
        self.assertIn("empty or whitespace", result.message)
        mock_run.assert_not_called()

    # 4. Whitespace-only text -> success=False, subprocess NOT called
    @patch("subprocess.run")
    def test_speak_whitespace_only(self, mock_run):
        speaker = SpeechSynthesizer()
        result = speaker.speak("   \t\n  ")

        self.assertFalse(result.success)
        self.assertIn("empty or whitespace", result.message)
        mock_run.assert_not_called()

    # 5. subprocess CalledProcessError -> success=False, no crash
    @patch("subprocess.run")
    def test_speak_called_process_error(self, mock_run):
        mock_run.side_effect = subprocess.CalledProcessError(
            returncode=1, cmd=["say", "Hello."], stderr="Device unavailable"
        )
        speaker = SpeechSynthesizer()
        result = speaker.speak("Hello.")

        self.assertFalse(result.success)
        self.assertIn("Speech synthesis failed", result.message)
        self.assertIn("Device unavailable", result.message)

    # 5b. Unexpected general Exception -> success=False, no crash
    @patch("subprocess.run")
    def test_speak_unexpected_exception(self, mock_run):
        mock_run.side_effect = OSError("System error")
        speaker = SpeechSynthesizer()
        result = speaker.speak("Hello.")

        self.assertFalse(result.success)
        self.assertIn("Unexpected error", result.message)

    # 6. Verify shell=True is never used
    @patch("subprocess.run")
    def test_shell_is_never_true(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        speaker = SpeechSynthesizer()
        speaker.speak("Hello.")

        _, kwargs = mock_run.call_args
        self.assertNotIn("shell", kwargs)

    # 7. Verify raw text is passed as a subprocess argument, not formatted shell string
    @patch("subprocess.run")
    def test_text_passed_as_list_argument(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        speaker = SpeechSynthesizer()
        complex_text = "The time is 10:42 PM; rm -rf /; echo 'test'"
        speaker.speak(complex_text)

        called_cmd = mock_run.call_args[0][0]
        self.assertIsInstance(called_cmd, list)
        self.assertEqual(called_cmd, ["say", complex_text])


class TestSessionSpeechIntegration(unittest.TestCase):
    """Test VoiceSession.run_spoken_response_once() and session contracts."""

    # 11. session.run_response_once() remains unchanged
    def test_run_response_once_still_returns_tom_response(self):
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe", return_value="hello Tom"):
            result = session.run_response_once(calibrate=True)

        self.assertIsInstance(result, TomResponse)
        self.assertEqual(result.text, "Hello.")

    # 12. run_spoken_response_once() invokes run_response_once() once and speaker.speak() once
    @patch("subprocess.run")
    def test_run_spoken_response_once_invokes_each_step_once(self, mock_subprocess):
        mock_subprocess.return_value = MagicMock(returncode=0)
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise") as mock_cal, \
             patch.object(speech, "listen_and_transcribe", return_value="hello Tom") as mock_listen:
            res = session.run_spoken_response_once(calibrate=True)

        mock_cal.assert_called_once()
        mock_listen.assert_called_once_with(calibrate=False)
        mock_subprocess.assert_called_once_with(
            ["say", "Hello."],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertIsInstance(res, TomResponse)
        self.assertEqual(res.text, "Hello.")

    # 12b. run_spoken_response_once() with custom voice passes voice to say
    @patch("subprocess.run")
    def test_run_spoken_response_once_with_custom_voice(self, mock_subprocess):
        mock_subprocess.return_value = MagicMock(returncode=0)
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe", return_value="hello Tom"):
            res = session.run_spoken_response_once(calibrate=True, voice="Samantha")

        mock_subprocess.assert_called_once_with(
            ["say", "-v", "Samantha", "Hello."],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertIsInstance(res, TomResponse)

    # 13. if run_response_once() returns None -> speaker is NOT called
    @patch("subprocess.run")
    def test_run_spoken_response_once_no_speech_does_not_speak(self, mock_subprocess):
        import speech_recognition as sr
        from tom.voice import SpeechInput, SpeechTimeoutError
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe",
                          side_effect=SpeechTimeoutError("timeout")):
            res = session.run_spoken_response_once(calibrate=True)

        mock_subprocess.assert_not_called()
        self.assertIsNone(res)

    # 14. if SpeechSynthesizer.speak() fails -> TomResponse still returned, no retry
    @patch("subprocess.run")
    def test_run_spoken_response_once_speech_failure_still_returns_response(self, mock_subprocess):
        mock_subprocess.side_effect = subprocess.CalledProcessError(
            returncode=1, cmd=["say", "Hello."], stderr="Audio error"
        )
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe", return_value="hello Tom") as mock_listen:
            res = session.run_spoken_response_once(calibrate=True)

        # Called once only, no retry
        mock_listen.assert_called_once()
        self.assertIsInstance(res, TomResponse)
        self.assertEqual(res.text, "Hello.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
