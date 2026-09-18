"""Tests for tom/responses.py — ResponseGenerator and TomResponse.

Ensures:
- All intents generate correct, structured TomResponse objects.
- Time formatting uses local timezone.
- Open app responses properly reflect ActionResult status.
- No subprocess calls are ever made by ResponseGenerator.
- VoiceSession.run_response_once() runs only one listening cycle and returns TomResponse.
- Existing VoiceSession contracts (run_once, run_command_once, run_action_once) remain intact.

Run with:
    cd /Users/tdurg/Tom
    .venv/bin/python3 tests/test_responses.py
"""

import sys
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

sys.path.insert(0, "/Users/tdurg/Tom")

from tom.actions import ActionResult
from tom.commands import Command
from tom.responses import ResponseGenerator, TomResponse
from tom.weather import WeatherResult


class TestTomResponseDataclass(unittest.TestCase):
    """Structural tests for the TomResponse model."""

    def test_tom_response_is_frozen(self):
        res = TomResponse(success=True, text="Hello.", intent="greeting")
        with self.assertRaises((AttributeError, TypeError)):
            res.success = False  # type: ignore[misc]

    def test_tom_response_target_defaults_to_none(self):
        res = TomResponse(success=True, text="Hello.", intent="greeting")
        self.assertIsNone(res.target)

    def test_tom_response_repr_without_target(self):
        res = TomResponse(success=True, text="Hello.", intent="greeting")
        self.assertIn("greeting", repr(res))
        self.assertIn("Hello.", repr(res))
        self.assertNotIn("target=", repr(res))

    def test_tom_response_repr_with_target(self):
        res = TomResponse(success=True, text="Safari is open.", intent="open_app", target="Safari")
        self.assertIn("target='Safari'", repr(res))


class TestResponseGenerator(unittest.TestCase):
    """Unit tests for ResponseGenerator."""

    def setUp(self):
        self.generator = ResponseGenerator()

    # 1. Greeting
    def test_greeting_response(self):
        cmd = Command(intent="greeting", text="hello Tom")
        res = self.generator.generate(cmd)

        self.assertTrue(res.success)
        self.assertEqual(res.intent, "greeting")
        self.assertEqual(res.text, "Hello.")
        self.assertIsNone(res.target)

    # 2. Time command — formatted time
    def test_time_response_format(self):
        cmd = Command(intent="time", text="what time is it")
        res = self.generator.generate(cmd)

        self.assertTrue(res.success)
        self.assertEqual(res.intent, "time")
        self.assertTrue(res.text.startswith("The current time is "))
        self.assertTrue(res.text.endswith("."))

    def test_time_response_mocked(self):
        # Mock datetime to test exact output without leading zero
        fixed_dt = datetime(2026, 9, 8, 22, 42, tzinfo=timezone.utc)
        with patch("tom.responses.datetime") as mock_datetime:
            mock_datetime.now.return_value.astimezone.return_value = fixed_dt
            cmd = Command(intent="time", text="what time is it")
            res = self.generator.generate(cmd)

            self.assertTrue(res.success)
            self.assertEqual(res.text, "The current time is 10:42 PM.")

    def test_time_response_single_digit_hour(self):
        fixed_dt = datetime(2026, 9, 8, 9, 5, tzinfo=timezone.utc)
        with patch("tom.responses.datetime") as mock_datetime:
            mock_datetime.now.return_value.astimezone.return_value = fixed_dt
            cmd = Command(intent="time", text="what time is it")
            res = self.generator.generate(cmd)

            self.assertTrue(res.success)
            self.assertEqual(res.text, "The current time is 9:05 AM.")

    # 3. Weather
    def test_weather_response(self):
        cmd = Command(intent="weather", text="what's the weather today")
        res = self.generator.generate(cmd, weather_result=WeatherResult(
            True, "New York", 72, 71, "partly cloudy", 78, 64, 60
        ))

        self.assertTrue(res.success)
        self.assertEqual(res.intent, "weather")
        self.assertIn("72 degrees and partly cloudy in New York", res.text)
        self.assertEqual(res.target, "New York")

    # 4. Exit
    def test_exit_response(self):
        cmd = Command(intent="exit", text="goodbye Tom")
        res = self.generator.generate(cmd)

        self.assertTrue(res.success)
        self.assertEqual(res.intent, "exit")
        self.assertEqual(res.text, "Goodbye.")
        self.assertIsNone(res.target)

    # 5. Unknown
    def test_unknown_response(self):
        cmd = Command(intent="unknown", text="explain quantum computing")
        res = self.generator.generate(cmd)

        self.assertFalse(res.success)
        self.assertEqual(res.intent, "unknown")
        self.assertEqual(res.text, "I don't know how to handle that yet.")
        self.assertIsNone(res.target)

    # 6. Successful Safari open_app
    def test_open_safari_success(self):
        cmd = Command(intent="open_app", text="open Safari", target="safari")
        action_res = ActionResult(success=True, action="open_app", message="Opened Safari.", target="Safari")
        res = self.generator.generate(cmd, action_result=action_res)

        self.assertTrue(res.success)
        self.assertEqual(res.intent, "open_app")
        self.assertEqual(res.text, "Safari is open.")
        self.assertEqual(res.target, "Safari")

    # 7. Successful Chrome open_app
    def test_open_chrome_success(self):
        cmd = Command(intent="open_app", text="open Chrome", target="google chrome")
        action_res = ActionResult(success=True, action="open_app", message="Opened Google Chrome.", target="Google Chrome")
        res = self.generator.generate(cmd, action_result=action_res)

        self.assertTrue(res.success)
        self.assertEqual(res.intent, "open_app")
        self.assertEqual(res.text, "Google Chrome is open.")
        self.assertEqual(res.target, "Google Chrome")

    # 8. Successful Visual Studio Code open_app
    def test_open_vscode_success(self):
        cmd = Command(intent="open_app", text="open VS Code", target="visual studio code")
        action_res = ActionResult(success=True, action="open_app", message="Opened Visual Studio Code.", target="Visual Studio Code")
        res = self.generator.generate(cmd, action_result=action_res)

        self.assertTrue(res.success)
        self.assertEqual(res.intent, "open_app")
        self.assertEqual(res.text, "Visual Studio Code is open.")
        self.assertEqual(res.target, "Visual Studio Code")

    # 9. Failed open_app action
    def test_open_app_failed_action(self):
        cmd = Command(intent="open_app", text="open Terminal", target="terminal")
        action_res = ActionResult(success=False, action="open_app", message="Not allowed", target="terminal")
        res = self.generator.generate(cmd, action_result=action_res)

        self.assertFalse(res.success)
        self.assertEqual(res.intent, "open_app")
        self.assertEqual(res.text, "I couldn't open terminal.")

    # 10. open_app with missing ActionResult
    def test_open_app_missing_action_result(self):
        cmd = Command(intent="open_app", text="open Safari", target="safari")
        res = self.generator.generate(cmd, action_result=None)

        self.assertFalse(res.success)
        self.assertEqual(res.intent, "open_app")
        self.assertEqual(res.text, "I couldn't open safari.")

    # 11. Verify ResponseGenerator never calls subprocess
    @patch("subprocess.run")
    def test_response_generator_never_calls_subprocess(self, mock_subprocess):
        cmd = Command(intent="open_app", text="open Safari", target="safari")
        action_res = ActionResult(success=True, action="open_app", message="Opened Safari.", target="Safari")
        self.generator.generate(cmd, action_result=action_res)

        mock_subprocess.assert_not_called()


class TestSessionResponseIntegration(unittest.TestCase):
    """Test VoiceSession integration with ResponseGenerator and verify contracts."""

    def test_run_once_still_returns_str(self):
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe", return_value="hello Tom"):
            result = session.run_once(calibrate=True)

        self.assertIsInstance(result, str)
        self.assertEqual(result, "hello Tom")

    def test_run_command_once_still_returns_command(self):
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe", return_value="what time is it"):
            result = session.run_command_once(calibrate=True)

        self.assertIsInstance(result, Command)
        self.assertEqual(result.intent, "time")

    @patch("subprocess.run")
    def test_run_action_once_still_returns_action_result(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe", return_value="open Safari"):
            result = session.run_action_once(calibrate=True)

        self.assertIsInstance(result, ActionResult)
        self.assertTrue(result.success)

    # 17. Verify run_response_once() performs only one transcription/listening cycle
    def test_run_response_once_single_transcription_cycle(self):
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise") as mock_cal, \
             patch.object(speech, "listen_and_transcribe", return_value="hello Tom") as mock_listen:
            res = session.run_response_once(calibrate=True)

        mock_listen.assert_called_once_with(calibrate=False)
        mock_cal.assert_called_once()
        self.assertIsInstance(res, TomResponse)
        self.assertTrue(res.success)
        self.assertEqual(res.text, "Hello.")
        self.assertEqual(res.intent, "greeting")

    @patch("subprocess.run")
    def test_run_response_once_open_app_executes_action(self, mock_subprocess):
        mock_subprocess.return_value = MagicMock(returncode=0)
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe", return_value="open Safari") as mock_listen:
            res = session.run_response_once(calibrate=True)

        mock_listen.assert_called_once_with(calibrate=False)
        mock_subprocess.assert_called_once_with(
            ["open", "-a", "Safari"],
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertIsInstance(res, TomResponse)
        self.assertTrue(res.success)
        self.assertEqual(res.text, "Safari is open.")
        self.assertEqual(res.intent, "open_app")
        self.assertEqual(res.target, "Safari")

    @patch("subprocess.run")
    def test_run_response_once_non_open_app_does_not_execute_action(self, mock_subprocess):
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe", return_value="what time is it"):
            res = session.run_response_once(calibrate=True)

        mock_subprocess.assert_not_called()
        self.assertIsInstance(res, TomResponse)
        self.assertTrue(res.success)
        self.assertEqual(res.intent, "time")
        self.assertTrue(res.text.startswith("The current time is "))

    def test_run_response_once_returns_none_on_no_speech(self):
        import speech_recognition as sr
        from tom.voice import SpeechInput, SpeechTimeoutError
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe",
                          side_effect=SpeechTimeoutError("timeout")):
            res = session.run_response_once(calibrate=True)

        self.assertIsNone(res)


if __name__ == "__main__":
    unittest.main(verbosity=2)
