"""Tests for tom/commands.py — CommandInterpreter and Command dataclass.

Run with:
    cd /Users/tdurg/Tom
    .venv/bin/python3 -m pytest tests/test_commands.py -v

Or without pytest:
    .venv/bin/python3 tests/test_commands.py
"""

import sys
import unittest

sys.path.insert(0, "/Users/tdurg/Tom")

from tom.commands import Command, CommandInterpreter


class TestCommandDataclass(unittest.TestCase):
    """Structural tests for the Command dataclass."""

    def test_command_is_frozen(self):
        cmd = Command(intent="greeting", text="hello Tom")
        with self.assertRaises((AttributeError, TypeError)):
            cmd.intent = "weather"  # type: ignore[misc]

    def test_command_target_defaults_to_none(self):
        cmd = Command(intent="greeting", text="hello Tom")
        self.assertIsNone(cmd.target)

    def test_command_with_target(self):
        cmd = Command(intent="open_app", text="open Safari", target="safari")
        self.assertEqual(cmd.target, "safari")

    def test_command_repr_without_target(self):
        cmd = Command(intent="greeting", text="hello Tom")
        self.assertIn("greeting", repr(cmd))
        self.assertNotIn("target", repr(cmd))

    def test_command_repr_with_target(self):
        cmd = Command(intent="open_app", text="open Safari", target="safari")
        self.assertIn("safari", repr(cmd))


class TestGreetingIntent(unittest.TestCase):
    interpreter = CommandInterpreter()

    def _intent(self, text: str) -> str:
        return self.interpreter.interpret(text).intent

    def test_hello_tom(self):
        self.assertEqual(self._intent("hello Tom"), "greeting")

    def test_hello_tom_lowercase(self):
        self.assertEqual(self._intent("hello tom"), "greeting")

    def test_hey_tom(self):
        self.assertEqual(self._intent("hey Tom"), "greeting")

    def test_hi_tom(self):
        self.assertEqual(self._intent("hi Tom"), "greeting")

    def test_greeting_preserves_original_text(self):
        cmd = self.interpreter.interpret("Hello Tom")
        self.assertEqual(cmd.text, "Hello Tom")

    def test_greeting_no_target(self):
        cmd = self.interpreter.interpret("hello Tom")
        self.assertIsNone(cmd.target)


class TestWeatherIntent(unittest.TestCase):
    interpreter = CommandInterpreter()

    def _intent(self, text: str) -> str:
        return self.interpreter.interpret(text).intent

    def test_whats_the_weather_today(self):
        self.assertEqual(self._intent("what's the weather today"), "weather")

    def test_what_is_the_weather(self):
        self.assertEqual(self._intent("what is the weather"), "weather")

    def test_weather_today(self):
        self.assertEqual(self._intent("weather today"), "weather")

    def test_how_is_the_weather(self):
        self.assertEqual(self._intent("how is the weather"), "weather")

    def test_weathering_steel_is_unknown(self):
        """'weathering' must not match weather intent."""
        self.assertEqual(self._intent("weathering steel is strong"), "unknown")

    def test_weather_preserves_original_text(self):
        original = "What's the weather today"
        cmd = self.interpreter.interpret(original)
        self.assertEqual(cmd.text, original)


class TestTimeIntent(unittest.TestCase):
    interpreter = CommandInterpreter()

    def _intent(self, text: str) -> str:
        return self.interpreter.interpret(text).intent

    def test_what_time_is_it(self):
        self.assertEqual(self._intent("what time is it"), "time")

    def test_tell_me_the_time(self):
        self.assertEqual(self._intent("tell me the time"), "time")

    def test_current_time(self):
        self.assertEqual(self._intent("current time"), "time")

    def test_timeline_is_unknown(self):
        """'timeline' must not match time intent."""
        self.assertEqual(self._intent("timeline of the project"), "unknown")

    def test_overtime_is_unknown(self):
        """'overtime' must not match time intent."""
        self.assertEqual(self._intent("overtime pay"), "unknown")

    def test_time_preserves_original_text(self):
        original = "What time is it"
        cmd = self.interpreter.interpret(original)
        self.assertEqual(cmd.text, original)


class TestOpenAppIntent(unittest.TestCase):
    interpreter = CommandInterpreter()

    def _cmd(self, text: str) -> Command:
        return self.interpreter.interpret(text)

    def test_open_safari(self):
        cmd = self._cmd("open Safari")
        self.assertEqual(cmd.intent, "open_app")
        self.assertEqual(cmd.target, "safari")

    def test_launch_chrome(self):
        cmd = self._cmd("launch Chrome")
        self.assertEqual(cmd.intent, "open_app")
        self.assertEqual(cmd.target, "google chrome")

    def test_open_visual_studio_code(self):
        cmd = self._cmd("open Visual Studio Code")
        self.assertEqual(cmd.intent, "open_app")
        self.assertEqual(cmd.target, "visual studio code")

    def test_open_vs_code_alias(self):
        cmd = self._cmd("open VS Code")
        self.assertEqual(cmd.intent, "open_app")
        self.assertEqual(cmd.target, "visual studio code")

    def test_open_firefox(self):
        cmd = self._cmd("open Firefox")
        self.assertEqual(cmd.intent, "open_app")
        self.assertEqual(cmd.target, "firefox")

    def test_open_app_preserves_original_text(self):
        original = "Open Safari"
        cmd = self._cmd(original)
        self.assertEqual(cmd.text, original)

    def test_bare_open_is_unknown(self):
        """'open' with nothing after it must not match open_app."""
        cmd = self._cmd("open")
        self.assertEqual(cmd.intent, "unknown")


class TestNaturalOpenApp(unittest.TestCase):
    def assert_target(self, text, target):
        command = CommandInterpreter().interpret(text)
        self.assertEqual(command.intent, "open_app")
        self.assertEqual(command.target, target)
        self.assertEqual(command.text, text)

    def test_can_you_open_safari(self):
        self.assert_target("can you open Safari", "safari")

    def test_could_you_open_google_chrome(self):
        self.assert_target("could you open Google Chrome", "google chrome")

    def test_please_open_vs_code(self):
        self.assert_target("please open VS Code", "visual studio code")

    def test_can_you_please_open_safari(self):
        self.assert_target("can you please open Safari", "safari")

    def test_other_polite_forms(self):
        for text, target in (
            ("would you open Safari", "safari"),
            ("please open Safari", "safari"),
            ("could you open Chrome", "google chrome"),
            ("can you please open Google Chrome", "google chrome"),
            ("Can   you open Safari?", "safari"),
        ):
            with self.subTest(text=text):
                self.assert_target(text, target)

    def test_ambiguous_targets_are_unknown_and_never_launch(self):
        from unittest.mock import patch
        from tom.actions import ActionExecutor
        with patch("tom.actions.subprocess.run") as launch:
            for text in ("can you open Safari and Chrome", "can you open Safari on Chrome",
                         "open Safari or Chrome", "please open Safari, Chrome"):
                with self.subTest(text=text):
                    command = CommandInterpreter().interpret(text)
                    self.assertEqual(command.intent, "unknown")
                    self.assertFalse(ActionExecutor().execute(command).success)
            launch.assert_not_called()

    def test_arbitrary_apps_and_shell_text_stay_blocked(self):
        from unittest.mock import patch
        from tom.actions import ActionExecutor
        with patch("tom.actions.subprocess.run") as launch:
            for text in ("please open UnlistedApp", "can you open Terminal",
                         "open /tmp/example", "please open Safari; echo unsafe",
                         "can you open $(echo unsafe)", "can you open Safary"):
                with self.subTest(text=text):
                    self.assertFalse(ActionExecutor().execute(CommandInterpreter().interpret(text)).success)
            launch.assert_not_called()

    def test_polite_prefix_is_not_a_substring_search(self):
        for text in ("I wonder if you can you open Safari", "can you please open",
                     "can you not open Safari", "please please open Safari"):
            with self.subTest(text=text):
                self.assertEqual(CommandInterpreter().interpret(text).intent, "unknown")


class TestExitIntent(unittest.TestCase):
    interpreter = CommandInterpreter()

    def _intent(self, text: str) -> str:
        return self.interpreter.interpret(text).intent

    def test_exit(self):
        self.assertEqual(self._intent("exit"), "exit")

    def test_quit(self):
        self.assertEqual(self._intent("quit"), "exit")

    def test_stop_tom(self):
        self.assertEqual(self._intent("stop Tom"), "exit")

    def test_goodbye_tom(self):
        self.assertEqual(self._intent("goodbye Tom"), "exit")

    def test_exit_preserves_original_text(self):
        original = "Goodbye Tom"
        cmd = self.interpreter.interpret(original)
        self.assertEqual(cmd.text, original)

    def test_exit_no_target(self):
        cmd = self.interpreter.interpret("exit")
        self.assertIsNone(cmd.target)


class TestUnknownIntent(unittest.TestCase):
    interpreter = CommandInterpreter()

    def _intent(self, text: str) -> str:
        return self.interpreter.interpret(text).intent

    def test_explain_quantum(self):
        self.assertEqual(self._intent("explain quantum computing"), "unknown")

    def test_empty_string(self):
        self.assertEqual(self._intent(""), "unknown")

    def test_whitespace_only(self):
        self.assertEqual(self._intent("   "), "unknown")

    def test_random_sentence(self):
        self.assertEqual(self._intent("the quick brown fox"), "unknown")

    def test_unknown_preserves_original_text(self):
        original = "explain quantum computing"
        cmd = self.interpreter.interpret(original)
        self.assertEqual(cmd.text, original)

    def test_unknown_no_target(self):
        cmd = self.interpreter.interpret("explain quantum computing")
        self.assertIsNone(cmd.target)


class TestFalsePrevention(unittest.TestCase):
    """Explicit false-positive prevention tests."""

    interpreter = CommandInterpreter()

    def _intent(self, text: str) -> str:
        return self.interpreter.interpret(text).intent

    def test_weathering_not_weather(self):
        self.assertEqual(self._intent("weathering steel"), "unknown")

    def test_timeline_not_time(self):
        self.assertEqual(self._intent("timeline"), "unknown")

    def test_overtime_not_time(self):
        self.assertEqual(self._intent("overtime"), "unknown")

    def test_pastime_not_time(self):
        self.assertEqual(self._intent("pastime activities"), "unknown")

    def test_open_ended_question_not_open_app(self):
        # "open" in a non-command context
        self.assertEqual(self._intent("I have an open question"), "unknown")


class TestSessionRunOnceContractUnchanged(unittest.TestCase):
    """Verify VoiceSession.run_once() still returns str | None."""

    def test_run_once_returns_str_on_success(self):
        from unittest.mock import MagicMock, patch
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

    def test_run_once_returns_none_on_timeout(self):
        from unittest.mock import MagicMock, patch
        import speech_recognition as sr
        from tom.voice import SpeechInput, SpeechTimeoutError
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe",
                          side_effect=SpeechTimeoutError("timeout")):
            result = session.run_once(calibrate=True)

        self.assertIsNone(result)

    def test_run_command_once_returns_command_on_success(self):
        from unittest.mock import MagicMock, patch
        import speech_recognition as sr
        from tom.voice import SpeechInput
        from tom.session import VoiceSession
        from tom.commands import Command

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe",
                          return_value="what's the weather today"):
            result = session.run_command_once(calibrate=True)

        self.assertIsInstance(result, Command)
        self.assertEqual(result.intent, "weather")
        self.assertEqual(result.text, "what's the weather today")

    def test_run_command_once_returns_none_on_no_speech(self):
        from unittest.mock import MagicMock, patch
        import speech_recognition as sr
        from tom.voice import SpeechInput, SpeechTimeoutError
        from tom.session import VoiceSession

        mic_mock = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone=mic_mock, timeout=5.0, phrase_time_limit=5.0)
        session = VoiceSession(speech_input=speech, verbose=False)

        with patch.object(speech, "calibrate_ambient_noise"), \
             patch.object(speech, "listen_and_transcribe",
                          side_effect=SpeechTimeoutError("timeout")):
            result = session.run_command_once(calibrate=True)

        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main(verbosity=2)
