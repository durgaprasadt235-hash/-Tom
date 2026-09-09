"""Tests for wake-word detection and synchronous wake orchestration."""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tom.responses import TomResponse
from tom.session import VoiceSession
from tom.speech import SpeechResult
from tom.voice import SpeechTimeoutError, SpeechNotUnderstandableError, SpeechServiceError
from tom.wake import WakeDetectionResult, WakeSession, WakeWordDetector, OfflineWakeRecognizer, main


class TestOfflineWakeRecognizer(unittest.TestCase):
    def setUp(self):
        self.module = MagicMock()
        patcher = patch.dict("sys.modules", {"vosk": self.module})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.model_path = MagicMock(spec=Path)
        self.model_path.is_dir.return_value = True
        self.recognizer = OfflineWakeRecognizer(self.model_path)
        self.audio = MagicMock()
        self.audio.get_raw_data.return_value = b"pcm"
        self.decoder = self.module.KaldiRecognizer.return_value
        self.decoder.AcceptWaveform.return_value = False
        self.decoder.FinalResult.return_value = '{"text": "hey tom"}'

    def test_model_loaded_once_but_decoder_is_fresh_each_utterance(self):
        self.assertEqual(self.recognizer.transcribe(self.audio), "hey tom")
        self.recognizer.transcribe(self.audio)
        self.module.Model.assert_called_once_with(str(self.model_path))
        self.assertEqual(self.module.KaldiRecognizer.call_count, 2)
        self.module.KaldiRecognizer.assert_called_with(
            self.module.Model.return_value, 16000, '["hey tom", "tom", "[unk]"]'
        )
        self.audio.get_raw_data.assert_called_with(convert_rate=16000, convert_width=2)
        self.decoder.AcceptWaveform.assert_called_with(b"pcm")

    def test_constrained_grammar_custom(self):
        custom = OfflineWakeRecognizer(self.model_path, grammar=["hey tom", "[unk]"], sample_rate=16000)
        custom.transcribe(self.audio)
        self.module.KaldiRecognizer.assert_called_with(
            self.module.Model.return_value, 16000, '["hey tom", "[unk]"]'
        )

    def test_unk_stripped_from_transcription(self):
        self.decoder.FinalResult.return_value = '{"text": "[unk] tom"}'
        self.assertEqual(self.recognizer.transcribe(self.audio), "tom")

    def test_only_unk_returns_empty_string(self):
        self.decoder.FinalResult.return_value = '{"text": "[unk]"}'
        self.assertEqual(self.recognizer.transcribe(self.audio), "")

    def test_endpoint_result_is_not_lost(self):
        self.decoder.AcceptWaveform.return_value = True
        self.decoder.Result.return_value = '{"text": "hello tom"}'
        self.decoder.FinalResult.return_value = '{"text": ""}'
        self.assertEqual(self.recognizer.transcribe(self.audio), "hello tom")

    def test_silence_returns_empty_text(self):
        self.decoder.FinalResult.return_value = '{"text": ""}'
        self.assertEqual(self.recognizer.transcribe(self.audio), "")

    def test_invalid_json_raises_value_error(self):
        self.decoder.FinalResult.return_value = "invalid"
        with self.assertRaises(ValueError):
            self.recognizer.transcribe(self.audio)

    def test_missing_model_reports_setup_error(self):
        self.model_path.is_dir.return_value = False
        with self.assertRaisesRegex(RuntimeError, "model missing"):
            self.recognizer.prepare()
        self.module.Model.assert_not_called()

    def test_missing_dependency_reports_setup_error(self):
        with patch.dict("sys.modules", {"vosk": None}):
            with self.assertRaisesRegex(RuntimeError, "Vosk could not load"):
                self.recognizer.prepare()

    def test_invalid_model_reports_setup_error(self):
        self.module.Model.side_effect = Exception("invalid model")
        with self.assertRaisesRegex(RuntimeError, "Could not load"):
            self.recognizer.prepare()

    def test_prepare_does_not_capture_audio(self):
        self.recognizer.prepare()
        self.audio.get_raw_data.assert_not_called()


class TestWakeWordDetector(unittest.TestCase):
    def setUp(self):
        self.detector = WakeWordDetector()

    def test_result_is_frozen(self):
        result = self.detector.detect("Tom")
        with self.assertRaises((AttributeError, TypeError)):
            result.detected = False

    def test_result_preserves_text_and_normalizes_wake_word(self):
        result = WakeWordDetector(" TOM ").detect("Hey Tom")
        self.assertEqual(result, WakeDetectionResult(True, "Hey Tom", "tom"))

    def test_required_positive_phrases(self):
        for phrase in ("Tom", "tom", "Hey Tom", "hey tom", "hello tom", "Tom please", "okay tom"):
            with self.subTest(phrase=phrase):
                self.assertTrue(self.detector.detect(phrase).detected)

    def test_required_negative_phrases(self):
        for phrase in (
            "now",
            "tomorrow",
            "tomato",
            "atomic",
            "bottom",
            "phantom",
            "what is the weather today",
            "random background speech",
            "",
            "   ",
        ):
            with self.subTest(phrase=phrase):
                self.assertFalse(self.detector.detect(phrase).detected)

    def test_now_explicitly_rejected(self):
        self.assertFalse(self.detector.detect("now").detected)

    def test_invalid_text_is_safe(self):
        result = self.detector.detect(None)
        self.assertFalse(result.detected)
        self.assertEqual(result.text, "")


class TestWakeSession(unittest.TestCase):
    def setUp(self):
        self.voice = MagicMock(spec=VoiceSession)
        self.backend = MagicMock(spec=OfflineWakeRecognizer)
        self.backend.transcribe.return_value = "hey tom"
        self.wake = WakeSession(self.voice, verbose=False, wake_recognizer=self.backend)
        self.response = TomResponse(True, "Hello.", "greeting")
        self.voice.listen_active_once.side_effect = ["hello Tom", "no thanks"]
        self.voice.process_transcript.return_value = self.response
        speaker = patch("tom.wake.SpeechSynthesizer")
        self.speaker = speaker.start().return_value
        self.addCleanup(speaker.stop)

    def test_local_success_listens_for_one_command_and_propagates_response(self):
        self.assertIs(self.wake.run_wake_cycle(), self.response)
        self.voice.capture_audio_once.assert_called_once_with()
        self.backend.transcribe.assert_called_once_with(self.voice.capture_audio_once.return_value)
        self.assertEqual(self.voice.listen_active_once.call_count, 2)  # command + closure
        self.voice.process_transcript.assert_called_once_with("hello Tom", speak=True)

    def test_no_wake_never_listens_for_command(self):
        for text in ("hello there", "tomorrow", "tomato", "atomic", "bottom", "phantom", ""):
            with self.subTest(text=text):
                self.voice.reset_mock()
                self.backend.transcribe.return_value = text
                self.assertIsNone(self.wake.run_wake_cycle())
                self.voice.capture_audio_once.assert_called_once_with()
                self.voice.listen_active_once.assert_not_called()
                self.voice.process_transcript.assert_not_called()
                self.speaker.speak.assert_not_called()

    def test_capture_failure_never_decodes_or_processes(self):
        for error in (SpeechTimeoutError, OSError):
            with self.subTest(error=error):
                self.voice.capture_audio_once.side_effect = error("test capture failure")
                self.assertIsNone(self.wake.run_wake_cycle())
                self.backend.transcribe.assert_not_called()
                self.voice.listen_active_once.assert_not_called()
                self.voice.process_transcript.assert_not_called()

    def test_decoder_failure_never_processes(self):
        self.backend.transcribe.side_effect = ValueError("bad result")
        self.assertIsNone(self.wake.run_wake_cycle())
        self.voice.listen_active_once.assert_not_called()
        self.voice.process_transcript.assert_not_called()

    def test_setup_failure_stops_before_capture(self):
        self.backend.prepare.side_effect = RuntimeError("missing model")
        with self.assertRaisesRegex(RuntimeError, "missing model"):
            self.wake.run_forever()
        self.voice.capture_audio_once.assert_not_called()

    def test_command_failure_does_not_process(self):
        self.voice.listen_active_once.side_effect = SpeechServiceError("network failure")
        self.assertIsNone(self.wake.run_wake_cycle())
        self.voice.listen_active_once.assert_called_once_with(timeout=6.0)
        self.voice.process_transcript.assert_not_called()

    def test_interrupt_exits_cleanly_during_capture(self):
        self.voice.capture_audio_once.side_effect = KeyboardInterrupt
        wake = WakeSession(self.voice, wake_recognizer=self.backend)
        with patch("builtins.print") as output:
            wake.run_forever()
        output.assert_any_call("Tom stopped.", flush=True)
        self.voice.listen_active_once.assert_not_called()

    def test_command_capture_happens_after_local_wake_decoding(self):
        events = []
        self.voice.capture_audio_once.side_effect = lambda: events.append("wake capture") or MagicMock()
        self.backend.transcribe.side_effect = lambda audio: events.append("local decoding") or "tom"
        self.voice.listen_active_once.side_effect = lambda **kw: events.append("command capture") or "no thanks"
        self.wake.run_wake_cycle()
        self.assertEqual(events, ["wake capture", "local decoding", "command capture"])

    def test_real_pipeline_opens_safari_and_speaks_once_even_if_tts_fails(self):
        for speech_success in (True, False):
            with self.subTest(speech_success=speech_success):
                audio = MagicMock()
                audio.listen_and_transcribe.side_effect = ["Open Safari", "no thanks"]
                session = VoiceSession(audio, verbose=False)
                with patch("tom.actions.subprocess.run") as launch, \
                     patch("tom.session.SpeechSynthesizer") as speaker, \
                     patch.object(session, "process_transcript", wraps=session.process_transcript) as process:
                    speaker.return_value.speak.return_value = SpeechResult(
                        speech_success, "Safari is open.", "test result"
                    )
                    response = WakeSession(
                        session, verbose=False, wake_recognizer=self.backend
                    ).run_wake_cycle()
                self.assertEqual(response.text, "Safari is open.")
                audio.listen_once.assert_called_once_with()
                self.assertEqual(audio.listen_and_transcribe.call_count, 2)
                audio.calibrate_ambient_noise.assert_not_called()
                process.assert_called_once_with("Open Safari", speak=True)
                launch.assert_called_once_with(
                    ["open", "-a", "Safari"], check=True, capture_output=True, text=True
                )
                speaker.return_value.speak.assert_called_once_with(response.text)

    def test_command_errors_never_execute_or_speak(self):
        for error in (SpeechTimeoutError, SpeechNotUnderstandableError, SpeechServiceError):
            with self.subTest(error=error):
                audio = MagicMock()
                audio.listen_and_transcribe.side_effect = [error("failure"), SpeechServiceError("end")]
                session = VoiceSession(audio, verbose=False)
                with patch("tom.session.ActionExecutor") as action, \
                     patch("tom.session.SpeechSynthesizer") as speaker:
                    self.assertIsNone(WakeSession(
                        session, verbose=False, wake_recognizer=self.backend
                    ).run_wake_cycle())
                action.assert_not_called()
                speaker.assert_not_called()  # Session prompts are mocked separately.

    def test_no_google_or_swift_used_for_wake(self):
        audio = MagicMock()
        session = VoiceSession(audio, verbose=False)
        self.backend.transcribe.return_value = "hello there"
        with patch("subprocess.Popen") as child, patch("subprocess.run") as run:
            WakeSession(session, verbose=False, wake_recognizer=self.backend).run_wake_cycle()
        audio.listen_once.assert_called_once_with()
        audio.listen_and_transcribe.assert_not_called()
        audio.transcribe_google.assert_not_called()
        child.assert_not_called()
        run.assert_not_called()

    def test_continuous_mode_terminates_on_exit_intent(self):
        time_resp = TomResponse(True, "The current time is 10:42 PM.", "time")
        exit_resp = TomResponse(True, "Goodbye.", "exit")
        self.voice.listen_active_once.side_effect = ["what time is it", "goodbye Tom"]
        self.voice.process_transcript.side_effect = [time_resp, exit_resp]
        self.wake.run_forever()
        self.voice.capture_audio_once.assert_called_once()
        self.assertEqual(self.voice.listen_active_once.call_count, 2)
        self.assertEqual(self.voice.process_transcript.call_count, 2)

    def test_continuous_mode_failed_wake_continues_loop(self):
        self.backend.transcribe.side_effect = ["random noise", "hey tom"]
        self.voice.listen_active_once.side_effect = ["goodbye Tom"]
        self.voice.process_transcript.return_value = TomResponse(True, "Goodbye.", "exit")
        self.wake.run_forever()
        self.assertEqual(self.voice.capture_audio_once.call_count, 2)
        self.voice.listen_active_once.assert_called_once()
        self.voice.process_transcript.assert_called_once()

    def test_continuous_mode_failed_command_continues_loop(self):
        self.voice.listen_active_once.side_effect = [SpeechServiceError("failure"), "goodbye Tom"]
        self.voice.process_transcript.return_value = TomResponse(True, "Goodbye.", "exit")
        self.wake.run_forever()
        self.assertEqual(self.voice.capture_audio_once.call_count, 2)
        self.assertEqual(self.voice.listen_active_once.call_count, 2)
        self.voice.process_transcript.assert_called_once()

    def test_two_successful_cycles_produce_exactly_two_command_listens_and_actions(self):
        safari_resp = TomResponse(True, "Safari is open.", "open_app", target="Safari")
        exit_resp = TomResponse(True, "Goodbye.", "exit")
        self.voice.listen_active_once.side_effect = ["open Safari", "no thanks", "goodbye Tom"]
        self.voice.process_transcript.side_effect = [safari_resp, exit_resp]
        self.wake.run_forever()
        self.assertEqual(self.voice.capture_audio_once.call_count, 2)
        self.assertEqual(self.voice.listen_active_once.call_count, 3)  # Two commands + closure.
        self.assertEqual(self.voice.process_transcript.call_count, 2)


class TestProcessTranscript(unittest.TestCase):
    def setUp(self):
        self.speech_input = MagicMock()
        self.session = VoiceSession(self.speech_input, verbose=False)

    def test_does_not_access_microphone_and_runs_pipeline_once(self):
        command = MagicMock(intent="time", target=None)
        response = TomResponse(True, "The current time is 10:42 PM.", "time")
        with patch("tom.session.CommandInterpreter") as interpreter_cls, \
             patch("tom.session.ResponseGenerator") as generator_cls, \
             patch("tom.session.ActionExecutor") as executor_cls, \
             patch("tom.session.SpeechSynthesizer") as speaker_cls:
            interpreter_cls.return_value.interpret.return_value = command
            generator_cls.return_value.generate.return_value = response

            result = self.session.process_transcript("what time is it", speak=False)

        self.assertIs(result, response)
        self.speech_input.listen_and_transcribe.assert_not_called()
        interpreter_cls.return_value.interpret.assert_called_once_with("what time is it")
        generator_cls.return_value.generate.assert_called_once_with(
            command, action_result=None
        )
        executor_cls.assert_not_called()
        speaker_cls.assert_not_called()

    def test_open_safari_executes_and_speaks_once(self):
        with patch("tom.actions.subprocess.run") as run, \
             patch("tom.session.SpeechSynthesizer") as speaker_cls:
            run.return_value = MagicMock(returncode=0)
            speaker_cls.return_value.speak.return_value = SpeechResult(
                True, "Safari is open.", "ok"
            )
            result = self.session.process_transcript("open Safari", speak=True)

        run.assert_called_once_with(
            ["open", "-a", "Safari"], check=True, capture_output=True, text=True
        )
        speaker_cls.return_value.speak.assert_called_once_with("Safari is open.")
        self.assertEqual(result.text, "Safari is open.")

    def test_speak_false_does_not_speak(self):
        with patch("tom.session.SpeechSynthesizer") as speaker_cls:
            self.session.process_transcript("what time is it", speak=False)
        speaker_cls.assert_not_called()

    def test_speech_failure_returns_original_response_without_retry(self):
        failed = SpeechResult(False, "Hello.", "audio error")
        with patch("tom.session.SpeechSynthesizer") as speaker_cls:
            speaker_cls.return_value.speak.return_value = failed
            result = self.session.process_transcript("hello Tom", speak=True)
        self.assertEqual(result.text, "Hello.")
        speaker_cls.return_value.speak.assert_called_once_with("Hello.")

    def test_run_spoken_response_listens_then_processes_once(self):
        response = TomResponse(True, "Hello.", "greeting")
        with patch.object(self.session, "run_once", return_value="hello Tom") as listen, \
             patch.object(self.session, "process_transcript", return_value=response) as process:
            result = self.session.run_spoken_response_once(calibrate=False)
        self.assertIs(result, response)
        listen.assert_called_once_with(calibrate=False)
        process.assert_called_once_with("hello Tom", speak=True, voice=None)


class TestWakeCli(unittest.TestCase):
    def setUp(self):
        patcher = patch("tom.wake.OfflineWakeRecognizer")
        self.recognizer = patcher.start().return_value
        self.addCleanup(patcher.stop)

    @patch("tom.wake.WakeSession")
    @patch("tom.wake.VoiceSession.create_default")
    def test_once_calibrates_once_and_runs_one_cycle(self, create_default, wake_cls):
        voice = create_default.return_value
        main(["--once"])
        voice.calibrate.assert_called_once_with()
        wake_cls.return_value.run_wake_cycle.assert_called_once_with()
        wake_cls.return_value.run_forever.assert_not_called()

    @patch("tom.wake.WakeSession")
    @patch("tom.wake.VoiceSession.create_default")
    def test_continuous_calibrates_once_and_runs_forever(self, create_default, wake_cls):
        voice = create_default.return_value
        main([])
        voice.calibrate.assert_called_once_with()
        wake_cls.return_value.run_forever.assert_called_once_with()


class TestOfflineWakeRecognizerIntegration(unittest.TestCase):
    """Integration test using the real offline Vosk model with synthetic PCM audio."""

    def test_real_model_synthetic_silence_decodes_cleanly_without_mic(self):
        import speech_recognition as sr
        model_path = Path(__file__).resolve().parent.parent / "models" / "vosk-model-small-en-us-0.15"
        if not model_path.is_dir():
            self.skipTest("Vosk model not present")

        recognizer = OfflineWakeRecognizer(model_path=model_path)
        recognizer.prepare()
        self.assertEqual(recognizer.sample_rate, 16000)
        self.assertEqual(recognizer.grammar, ["hey tom", "tom", "[unk]"])

        # Synthetic 1-second silence AudioData (16kHz, 16-bit mono)
        silence_pcm = b"\x00" * 32000
        audio = sr.AudioData(silence_pcm, 16000, 2)
        text = recognizer.transcribe(audio)
        self.assertEqual(text, "")

        detector = WakeWordDetector()
        result = detector.detect(text)
        self.assertFalse(result.detected)


if __name__ == "__main__":
    unittest.main(verbosity=2)




if __name__ == "__main__":
    unittest.main(verbosity=2)
