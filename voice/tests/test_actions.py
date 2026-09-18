"""Tests for tom/actions.py — ActionExecutor and ActionResult.

All subprocess calls are strictly mocked — no real applications are opened.

Run with:
    cd /Users/tdurg/Tom
    .venv/bin/python3 tests/test_actions.py
"""

import sys
import unittest
from unittest.mock import MagicMock, call, patch

sys.path.insert(0, "/Users/tdurg/Tom")

from tom.actions import ActionExecutor, ActionResult
from tom.commands import Command


class TestActionResultDataclass(unittest.TestCase):
    """Structural tests for the ActionResult model."""

    def test_action_result_is_frozen(self):
        res = ActionResult(success=True, action="open_app", message="OK")
        with self.assertRaises((AttributeError, TypeError)):
            res.success = False  # type: ignore[misc]

    def test_action_result_target_defaults_to_none(self):
        res = ActionResult(success=True, action="open_app", message="OK")
        self.assertIsNone(res.target)

    def test_action_result_repr_without_target(self):
        res = ActionResult(success=True, action="open_app", message="OK")
        self.assertIn("open_app", repr(res))
        self.assertNotIn("target=", repr(res))

    def test_action_result_repr_with_target(self):
        res = ActionResult(success=True, action="open_app", message="OK", target="Safari")
        self.assertIn("target='Safari'", repr(res))


class TestActionExecutorOpenApp(unittest.TestCase):
    """Test ActionExecutor for open_app intent — all subprocess calls mocked."""

    def setUp(self):
        self.executor = ActionExecutor()

    # 1. Safari -> ["open", "-a", "Safari"]
    @patch("subprocess.run")
    def test_open_safari(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        cmd = Command(intent="open_app", text="open Safari", target="safari")
        result = self.executor.execute(cmd)

        self.assertTrue(result.success)
        self.assertEqual(result.action, "open_app")
        self.assertEqual(result.target, "Safari")
        mock_run.assert_called_once_with(
            ["open", "-a", "Safari"],
            check=True,
            capture_output=True,
            text=True,
        )

    # 2. Chrome -> ["open", "-a", "Google Chrome"]
    @patch("subprocess.run")
    def test_open_chrome(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        cmd = Command(intent="open_app", text="launch Chrome", target="chrome")
        result = self.executor.execute(cmd)

        self.assertTrue(result.success)
        self.assertEqual(result.action, "open_app")
        self.assertEqual(result.target, "Google Chrome")
        mock_run.assert_called_once_with(
            ["open", "-a", "Google Chrome"],
            check=True,
            capture_output=True,
            text=True,
        )

    # 3. Visual Studio Code -> ["open", "-a", "Visual Studio Code"]
    @patch("subprocess.run")
    def test_open_visual_studio_code(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        cmd = Command(intent="open_app", text="open Visual Studio Code", target="visual studio code")
        result = self.executor.execute(cmd)

        self.assertTrue(result.success)
        self.assertEqual(result.action, "open_app")
        self.assertEqual(result.target, "Visual Studio Code")
        mock_run.assert_called_once_with(
            ["open", "-a", "Visual Studio Code"],
            check=True,
            capture_output=True,
            text=True,
        )

    # 3b. VS Code alias -> ["open", "-a", "Visual Studio Code"]
    @patch("subprocess.run")
    def test_open_vs_code_alias(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        cmd = Command(intent="open_app", text="open VS Code", target="vs code")
        result = self.executor.execute(cmd)

        self.assertTrue(result.success)
        self.assertEqual(result.action, "open_app")
        self.assertEqual(result.target, "Visual Studio Code")
        mock_run.assert_called_once_with(
            ["open", "-a", "Visual Studio Code"],
            check=True,
            capture_output=True,
            text=True,
        )

    # 4. Unsupported target: terminal -> success=False, subprocess NOT called
    @patch("subprocess.run")
    def test_unsupported_target_terminal(self, mock_run):
        cmd = Command(intent="open_app", text="open Terminal", target="terminal")
        result = self.executor.execute(cmd)

        self.assertFalse(result.success)
        self.assertEqual(result.action, "open_app")
        self.assertIn("not in the allowed whitelist", result.message)
        mock_run.assert_not_called()

    # 5. target=None -> success=False, subprocess NOT called
    @patch("subprocess.run")
    def test_target_is_none(self, mock_run):
        cmd = Command(intent="open_app", text="open", target=None)
        result = self.executor.execute(cmd)

        self.assertFalse(result.success)
        self.assertEqual(result.action, "open_app")
        self.assertIn("no target specified", result.message)
        mock_run.assert_not_called()

    # 6. weather intent -> success=False, action="unsupported", subprocess NOT called
    @patch("subprocess.run")
    def test_weather_intent_not_executable(self, mock_run):
        cmd = Command(intent="weather", text="what's the weather today")
        result = self.executor.execute(cmd)

        self.assertFalse(result.success)
        self.assertEqual(result.action, "unsupported")
        self.assertIn("not executable yet", result.message)
        mock_run.assert_not_called()

    # 7. unknown intent -> success=False, action="unsupported", subprocess NOT called
    @patch("subprocess.run")
    def test_unknown_intent_not_executable(self, mock_run):
        cmd = Command(intent="unknown", text="explain quantum computing")
        result = self.executor.execute(cmd)

        self.assertFalse(result.success)
        self.assertEqual(result.action, "unsupported")
        self.assertIn("not executable yet", result.message)
        mock_run.assert_not_called()

    # 7b. greeting intent -> success=False, action="unsupported", subprocess NOT called
    @patch("subprocess.run")
    def test_greeting_intent_not_executable(self, mock_run):
        cmd = Command(intent="greeting", text="hello Tom")
        result = self.executor.execute(cmd)

        self.assertFalse(result.success)
        self.assertEqual(result.action, "unsupported")
        mock_run.assert_not_called()

    # 7c. exit intent -> success=False, action="unsupported", subprocess NOT called
    @patch("subprocess.run")
    def test_exit_intent_not_executable(self, mock_run):
        cmd = Command(intent="exit", text="stop Tom")
        result = self.executor.execute(cmd)

        self.assertFalse(result.success)
        self.assertEqual(result.action, "unsupported")
        mock_run.assert_not_called()

    # 8. Malicious-looking target -> success=False, subprocess NOT called
    @patch("subprocess.run")
    def test_malicious_target_rejected(self, mock_run):
        cmd = Command(intent="open_app", text="open rm -rf /", target="rm -rf /")
        result = self.executor.execute(cmd)

        self.assertFalse(result.success)
        self.assertEqual(result.action, "open_app")
        self.assertIn("not in the allowed whitelist", result.message)
        mock_run.assert_not_called()

    # 9. Verify shell=True is NEVER passed to subprocess.run
    @patch("subprocess.run")
    def test_shell_is_never_true(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        cmd = Command(intent="open_app", text="open Safari", target="safari")
        self.executor.execute(cmd)

        _, kwargs = mock_run.call_args
        self.assertNotIn("shell", kwargs)  # Never pass shell=True


class TestSessionActionIntegration(unittest.TestCase):
    """Test VoiceSession.run_action_once() and verify contracts."""

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
             patch.object(speech, "listen_and_transcribe", return_value="open Safari"):
            result = session.run_command_once(calibrate=True)

        self.assertIsInstance(result, Command)
        self.assertEqual(result.intent, "open_app")
        self.assertEqual(result.target, "safari")

    @patch("subprocess.run")
    def test_run_action_once_returns_action_result(self, mock_run):
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
        self.assertEqual(result.action, "open_app")
        self.assertEqual(result.target, "Safari")
        mock_run.assert_called_once_with(
            ["open", "-a", "Safari"],
            check=True,
            capture_output=True,
            text=True,
        )

    def test_run_action_once_returns_none_on_no_speech(self):
        import speech_recognition as sr
        from tom.voice import SpeechInput, SpeechTimeoutError
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe",
                          side_effect=SpeechTimeoutError("timeout")):
            result = session.run_action_once(calibrate=True)

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
