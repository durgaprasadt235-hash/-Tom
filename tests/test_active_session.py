"""Step 11: deterministic sessions with all audio/network/action effects mocked."""

import unittest
from unittest.mock import MagicMock, call, patch

import speech_recognition as sr

from tom.commands import CommandInterpreter
from tom.responses import ResponseGenerator
from tom.session import VoiceSession
from tom.weather import WeatherResult, WeatherService
from tom.speech import SpeechResult
from tom.voice import SpeechInput, SpeechTimeoutError, SpeechNotUnderstandableError, SpeechServiceError
from tom.wake import (
    ACTIVE_SESSION_TIMEOUT_SECONDS, FOLLOW_UP_PROMPT, SESSION_CLOSE_RESPONSE,
    WAKE_GREETING, OfflineWakeRecognizer, SessionState, WakeSession, is_session_close, main,
)


class TestSessionClosePhrases(unittest.TestCase):
    def test_all_exact_close_phrases(self):
        for text in ("no", "no thanks", "no thank you", "that's all", "nothing else", "thanks", "thank you"):
            with self.subTest(text=text):
                self.assertTrue(is_session_close(text))

    def test_case_spacing_and_terminal_punctuation(self):
        for text in (" NO THANKS! ", "Thank   you.", "That’s all."):
            with self.subTest(text=text):
                self.assertTrue(is_session_close(text))

    def test_no_prefix_fuzzy_or_global_exit_matching(self):
        for text in ("no open safari", "thanks for opening safari", "nothing else matters",
                     "thank you open chrome", "goodbye", "stop Tom", "exit Tom", "", None):
            with self.subTest(text=text):
                self.assertFalse(is_session_close(text))


class TestActiveSession(unittest.TestCase):
    def setUp(self):
        self.audio = MagicMock()
        self.audio.timeout = 10.0
        self.weather = MagicMock(spec=WeatherService)
        self.weather.get_weather.return_value = WeatherResult(
            True, "New York", 72, 71, "partly cloudy", 78, 64, 60
        )
        self.voice = VoiceSession(self.audio, verbose=False, weather_service=self.weather)
        self.backend = MagicMock(spec=OfflineWakeRecognizer)
        self.backend.transcribe.return_value = "hey tom"
        self.wake = WakeSession(self.voice, verbose=False, wake_recognizer=self.backend)
        patcher = patch("tom.speech.SpeechSynthesizer.speak",
                        return_value=SpeechResult(True, "", "mocked"))
        self.speak = patcher.start()
        self.addCleanup(patcher.stop)

    def feed(self, *events):
        self.audio.listen_and_transcribe.side_effect = events

    def spoken(self):
        return [args.args[0] for args in self.speak.call_args_list]

    def test_wake_greeting_and_close_bypass_command_pipeline(self):
        self.feed("no")
        with patch("tom.session.CommandInterpreter") as interpret, \
             patch("tom.session.ResponseGenerator") as generate, \
             patch("tom.session.ActionExecutor") as execute:
            self.assertIsNone(self.wake.run_wake_cycle())
        self.assertEqual(self.spoken(), ["Hey Boss, how can I help you?", "Alright Boss."])
        interpret.assert_not_called()
        generate.assert_not_called()
        execute.assert_not_called()
        self.assertEqual(self.wake.state, SessionState.IDLE)

    def test_two_commands_one_wake_exactly_once_each(self):
        self.feed("what time is it", "open Safari", "no thanks")
        interpreter = MagicMock(wraps=CommandInterpreter())
        generator = MagicMock(wraps=ResponseGenerator())
        with patch("tom.session.CommandInterpreter", return_value=interpreter), \
             patch("tom.session.ResponseGenerator", return_value=generator), \
             patch("tom.actions.subprocess.run") as launch:
            response = self.wake.run_wake_cycle()
        self.assertEqual(response.text, "Safari is open.")
        self.audio.listen_once.assert_called_once()
        self.backend.transcribe.assert_called_once()
        self.assertEqual(self.audio.listen_and_transcribe.call_count, 3)  # Two commands + closure.
        self.assertEqual(interpreter.interpret.call_count, 2)
        self.assertEqual(generator.generate.call_count, 2)
        launch.assert_called_once_with(["open", "-a", "Safari"],
                                       check=True, capture_output=True, text=True)
        self.assertEqual(len(self.spoken()), 4)  # Greeting, two replies, closure.
        self.assertEqual(self.spoken().count("Safari is open."), 1)

    def test_timeout_restarts_only_after_speech_completes(self):
        events = []
        inputs = iter(["what time is it", "goodbye"])
        def listen(**kwargs):
            events.append(("listen", self.audio.timeout, self.wake.state))
            return next(inputs)
        def speak(text):
            events.append(("speak", text))
            return SpeechResult(True, text, "mocked")
        self.audio.listen_and_transcribe.side_effect = listen
        self.speak.side_effect = speak
        self.wake.run_wake_cycle()
        self.assertEqual([event[0] for event in events], ["speak", "listen", "speak", "listen", "speak"])
        for event in events:
            if event[0] == "listen":
                self.assertEqual(event[1:], (ACTIVE_SESSION_TIMEOUT_SECONDS, SessionState.ACTIVE_SESSION))
        self.assertEqual(self.audio.timeout, 10.0)

    def test_two_timeouts_prompt_once_then_silent_idle(self):
        self.feed(SpeechTimeoutError("silence"), SpeechTimeoutError("silence"))
        with patch.object(self.voice, "process_transcript") as process:
            self.assertIsNone(self.wake.run_wake_cycle())
        self.assertEqual(self.spoken(), [WAKE_GREETING, FOLLOW_UP_PROMPT])
        self.assertEqual(self.audio.listen_and_transcribe.call_count, 2)
        process.assert_not_called()
        self.assertEqual(self.wake.state, SessionState.IDLE)

    def test_command_after_prompt_does_not_replenish_prompt_budget(self):
        self.feed(SpeechTimeoutError("silence"), "what time is it", SpeechTimeoutError("silence"))
        response = self.wake.run_wake_cycle()
        self.assertEqual(response.intent, "time")
        self.assertEqual(self.spoken().count(FOLLOW_UP_PROMPT), 1)
        self.assertEqual(self.audio.listen_and_transcribe.call_count, 3)
        self.assertEqual(len(self.spoken()), 3)

    def test_prompt_after_initial_command(self):
        self.feed("what time is it", SpeechTimeoutError("silence"), "no thanks")
        self.wake.run_wake_cycle()
        self.assertEqual(self.spoken()[-2:], [FOLLOW_UP_PROMPT, SESSION_CLOSE_RESPONSE])

    def test_no_closes_session(self):
        self.feed("no")
        self.wake.run_wake_cycle()
        self.assertEqual(self.spoken(), [WAKE_GREETING, SESSION_CLOSE_RESPONSE])

    def test_no_thanks_closes_session(self):
        self.feed("no thanks")
        self.wake.run_wake_cycle()
        self.assertEqual(self.spoken(), [WAKE_GREETING, SESSION_CLOSE_RESPONSE])

    def test_thank_you_closes_session(self):
        self.feed("thank you")
        self.wake.run_wake_cycle()
        self.assertEqual(self.spoken(), [WAKE_GREETING, SESSION_CLOSE_RESPONSE])

    def test_close_returns_to_wake_without_terminating_process(self):
        self.feed("no thanks", "goodbye")
        self.wake.run_forever()
        self.assertEqual(self.audio.listen_once.call_count, 2)
        self.assertEqual(self.spoken(), [WAKE_GREETING, SESSION_CLOSE_RESPONSE, WAKE_GREETING, "Goodbye."])

    def test_global_exit_phrases_stop_continuous_loop(self):
        for text in ("goodbye", "stop Tom", "exit Tom"):
            with self.subTest(text=text):
                self.speak.reset_mock()
                self.audio.reset_mock()
                self.feed(text)
                self.wake.run_forever()
                self.audio.listen_once.assert_called_once()
                self.audio.listen_and_transcribe.assert_called_once_with(calibrate=False)
                self.assertEqual(self.spoken(), [WAKE_GREETING, "Goodbye."])

    def test_unknown_keeps_active_session_open(self):
        self.feed("explain quantum computing", "goodbye")
        self.wake.run_forever()
        self.audio.listen_once.assert_called_once()
        self.assertEqual(self.spoken(), [WAKE_GREETING, "I don't know how to handle that yet.", "Goodbye."])

    def test_weather_keeps_active_session_open(self):
        self.feed("what's the weather today", "goodbye")
        self.wake.run_forever()
        self.audio.listen_once.assert_called_once()
        self.assertEqual(self.spoken(), [WAKE_GREETING,
            "It's 72 degrees and partly cloudy in New York. Today's high is 78 and the low is 64.",
            "Goodbye."])

    def test_unintelligible_speech_moves_to_final_wait(self):
        self.feed(SpeechNotUnderstandableError("bad audio"), "goodbye")
        self.wake.run_wake_cycle()
        self.assertEqual(self.spoken(), [WAKE_GREETING, FOLLOW_UP_PROMPT, "Goodbye."])
        self.backend.transcribe.assert_called_once()

    def assert_final_failure_closes(self, final_result):
        self.feed(SpeechTimeoutError("silence"), final_result, AssertionError("Unexpected third listen"))
        self.wake._verbose = True
        with patch.object(self.voice, "process_transcript") as process, patch("builtins.print") as output:
            self.assertIsNone(self.wake.run_wake_cycle())
        self.assertEqual(self.audio.listen_and_transcribe.call_count, 2)
        self.assertEqual(self.spoken(), [WAKE_GREETING, FOLLOW_UP_PROMPT])
        self.assertEqual(self.wake.state, SessionState.IDLE)
        process.assert_not_called()
        lines = [item.args[0] for item in output.call_args_list]
        self.assertEqual(lines.count("[Tom] Listening for command..."), 2)
        self.assertFalse(any("Could not understand speech" in line for line in lines))

    def test_final_timeout_ends_after_one_attempt(self):
        self.assert_final_failure_closes(SpeechTimeoutError("silence"))

    def test_final_unintelligible_speech_ends_after_one_attempt(self):
        self.assert_final_failure_closes(SpeechNotUnderstandableError("noise"))

    def test_final_empty_transcript_ends_after_one_attempt(self):
        self.assert_final_failure_closes("")

    def test_final_whitespace_transcript_ends_after_one_attempt(self):
        self.assert_final_failure_closes("   ")

    def test_final_none_transcript_ends_after_one_attempt(self):
        self.assert_final_failure_closes(None)

    def test_repeated_unintelligible_speech_cannot_loop(self):
        self.feed(SpeechNotUnderstandableError("noise"), SpeechNotUnderstandableError("noise"),
                  AssertionError("Unexpected third listen"))
        self.wake.run_wake_cycle()
        self.assertEqual(self.audio.listen_and_transcribe.call_count, 2)
        self.assertEqual(self.spoken(), [WAKE_GREETING, FOLLOW_UP_PROMPT])

    def test_final_wait_command_executes_once_and_resumes_active_state(self):
        inputs = iter([SpeechTimeoutError("silence"), "can you open Safari", "no thanks"])
        states = []
        def listen(**kwargs):
            states.append(self.wake.state)
            item = next(inputs)
            if isinstance(item, Exception):
                raise item
            return item
        self.audio.listen_and_transcribe.side_effect = listen
        with patch("tom.actions.subprocess.run") as launch, \
             patch.object(self.voice, "process_transcript", wraps=self.voice.process_transcript) as process:
            self.wake.run_wake_cycle()
        self.assertEqual(states, [SessionState.ACTIVE_SESSION, SessionState.FINAL_WAIT, SessionState.ACTIVE_SESSION])
        process.assert_called_once_with("can you open Safari", speak=True)
        launch.assert_called_once_with(["open", "-a", "Safari"], check=True, capture_output=True, text=True)
        self.assertEqual(self.spoken(), [WAKE_GREETING, FOLLOW_UP_PROMPT, "Safari is open.", SESSION_CLOSE_RESPONSE])

    def test_global_exit_in_final_wait_terminates_continuous_process(self):
        self.feed(SpeechTimeoutError("silence"), "goodbye", AssertionError("Unexpected third listen"))
        self.wake.run_forever()
        self.audio.listen_once.assert_called_once()
        self.assertEqual(self.audio.listen_and_transcribe.call_count, 2)
        self.assertEqual(self.spoken(), [WAKE_GREETING, FOLLOW_UP_PROMPT, "Goodbye."])

    def test_failed_final_wait_returns_to_wake_in_continuous_mode(self):
        self.feed(SpeechTimeoutError("silence"), SpeechNotUnderstandableError("noise"), "goodbye")
        self.wake.run_forever()
        self.assertEqual(self.audio.listen_once.call_count, 2)
        self.assertEqual(self.audio.listen_and_transcribe.call_count, 3)
        self.assertEqual(self.spoken(), [WAKE_GREETING, FOLLOW_UP_PROMPT, WAKE_GREETING, "Goodbye."])

    def test_service_failure_returns_idle_without_inactivity_prompt(self):
        self.feed(SpeechServiceError("offline"))
        self.assertIsNone(self.wake.run_wake_cycle())
        self.assertEqual(self.spoken(), [WAKE_GREETING])
        self.assertEqual(self.wake.state, SessionState.IDLE)

    def test_ctrl_c_active_listen_cleans_up(self):
        self.feed(KeyboardInterrupt())
        self.wake._verbose = True
        with patch("builtins.print") as output:
            self.wake.run_forever()
        output.assert_any_call("Tom stopped.", flush=True)
        self.assertEqual(self.wake.state, SessionState.IDLE)
        self.assertEqual(self.audio.timeout, 10.0)

    def test_failed_tts_is_not_retried(self):
        self.speak.return_value = SpeechResult(False, "", "audio error")
        self.feed(SpeechTimeoutError("silence"), "no thanks")
        self.wake.run_wake_cycle()
        self.assertEqual(self.spoken(), [WAKE_GREETING, FOLLOW_UP_PROMPT, SESSION_CLOSE_RESPONSE])

    def test_new_session_gets_one_new_prompt(self):
        self.feed(SpeechTimeoutError("silence"), SpeechTimeoutError("silence"),
                  SpeechTimeoutError("silence"), "goodbye")
        self.wake.run_forever()
        self.assertEqual(self.spoken().count(FOLLOW_UP_PROMPT), 2)
        self.assertEqual(self.audio.listen_once.call_count, 2)


class TestActiveListening(unittest.TestCase):
    def test_real_input_captures_and_transcribes_once_and_releases_microphone(self):
        microphone = MagicMock(spec=sr.Microphone)
        speech = SpeechInput(microphone, timeout=10.0)
        voice = VoiceSession(speech, verbose=False)
        with patch.object(speech._recognizer, "listen", return_value="audio") as listen, \
             patch.object(speech._recognizer, "recognize_google", return_value="hello") as transcribe:
            self.assertEqual(voice.listen_active_once(timeout=6.0), "hello")
        listen.assert_called_once_with(microphone.__enter__.return_value, timeout=6.0, phrase_time_limit=10.0)
        microphone.__exit__.assert_called_once()
        transcribe.assert_called_once_with("audio")
        self.assertEqual(speech.timeout, 10.0)

    def test_timeout_restored_for_all_failure_types(self):
        for error in (SpeechTimeoutError, SpeechNotUnderstandableError, SpeechServiceError, KeyboardInterrupt):
            with self.subTest(error=error):
                speech = MagicMock(timeout=10.0)
                speech.listen_and_transcribe.side_effect = error("failure")
                with self.assertRaises(error):
                    VoiceSession(speech).listen_active_once(timeout=6.0)
                self.assertEqual(speech.timeout, 10.0)
                speech.calibrate_ambient_noise.assert_not_called()


class TestActiveCLI(unittest.TestCase):
    def setUp(self):
        self.voice = MagicMock(spec=VoiceSession)
        self.backend = MagicMock(spec=OfflineWakeRecognizer)
        self.backend.transcribe.return_value = "tom"
        for target, value in (("tom.wake.OfflineWakeRecognizer", self.backend),
                              ("tom.wake.VoiceSession.create_default", self.voice)):
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        speaker = patch("tom.speech.SpeechSynthesizer.speak", return_value=SpeechResult(True, "", "ok"))
        speaker.start()
        self.addCleanup(speaker.stop)

    def test_once_runs_one_active_session_without_second_wake(self):
        self.voice.listen_active_once.side_effect = ["what time is it", "no thanks"]
        self.voice.process_transcript.return_value = ResponseGenerator().generate(CommandInterpreter().interpret("what time is it"))
        main(["--once"])
        self.voice.capture_audio_once.assert_called_once()
        self.assertEqual(self.voice.listen_active_once.call_count, 2)
        self.voice.calibrate.assert_called_once()

    def test_calibration_and_recognizer_instance_once_across_sessions(self):
        from tom.wake import OfflineWakeRecognizer as factory
        self.voice.listen_active_once.side_effect = ["no thanks", "goodbye"]
        self.voice.process_transcript.return_value = ResponseGenerator().generate(CommandInterpreter().interpret("goodbye"))
        main([])
        factory.assert_called_once_with()
        self.assertEqual(self.voice.capture_audio_once.call_count, 2)
        self.voice.calibrate.assert_called_once()


if __name__ == "__main__":
    unittest.main()
