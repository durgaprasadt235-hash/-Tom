"""Weather parsing, provider, formatting, and active-session tests; no live I/O."""

from copy import deepcopy
from dataclasses import FrozenInstanceError
import unittest
from unittest.mock import MagicMock, patch

import requests

from tom.commands import Command, CommandInterpreter
from tom.config import get_default_weather_location
from tom.responses import ResponseGenerator
from tom.session import VoiceSession
from tom.speech import SpeechResult
from tom.wake import WakeSession, OfflineWakeRecognizer, WAKE_GREETING, SESSION_CLOSE_RESPONSE
from tom.weather import (
    WeatherRequest, WeatherResult, WeatherService, weather_condition,
    LOCATION_NOT_FOUND, WEATHER_UNAVAILABLE,
)


GEOCODE = {"results": [{"name": "New York", "admin1": "New York", "country": "United States",
    "country_code": "US", "latitude": 40.7, "longitude": -74.0, "timezone": "America/New_York"}]}
FORECAST = {
    "current": {"time": "2026-09-09T23:45", "temperature_2m": 72, "apparent_temperature": 71, "weather_code": 2},
    "daily": {"time": ["2026-09-09", "2026-09-10"], "temperature_2m_max": [78, 75],
              "temperature_2m_min": [64, 62], "weather_code": [3, 2],
              "precipitation_probability_max": [60, 5]},
}
RESULT = WeatherResult(True, "New York", 72, 71, "partly cloudy", 78, 64, 60)


class TestWeatherParsing(unittest.TestCase):
    def check(self, text, period="today", query="summary", location=None):
        command = CommandInterpreter().interpret(text)
        self.assertEqual(command.intent, "weather")
        self.assertEqual(command.weather_request, WeatherRequest(location, period, query))
        self.assertIsNone(command.target)
        self.assertEqual(command.text, text)

    def test_today_summary(self):
        for text in ("what's the weather today", "what is the weather today", "weather today"):
            self.check(text)

    def test_tomorrow_summary(self):
        self.check("what's the weather tomorrow", "tomorrow")
        self.check("weather tomorrow", "tomorrow")

    def test_boston(self):
        self.check("weather in Boston", location="Boston")

    def test_new_york(self):
        self.check("what's the weather in New York", location="New York")

    def test_philadelphia(self):
        self.check("weather in Philadelphia", location="Philadelphia")

    def test_temperature(self):
        for text in ("what's the temperature outside", "what's the temperature", "temperature outside"):
            self.check(text, query="temperature")

    def test_rain_today(self):
        self.check("will it rain today", query="rain")
        self.check("is it going to rain today", query="rain")

    def test_rain_tomorrow(self):
        self.check("will it rain tomorrow", period="tomorrow", query="rain")

    def test_location_and_period_orders(self):
        self.check("What's the weather tomorrow in Boston?", "tomorrow", location="Boston")
        self.check("What's the weather in Boston tomorrow?", "tomorrow", location="Boston")

    def test_unsupported_and_unrelated_are_unknown(self):
        for text in ("weather next month", "what's the weather next week", "weather in Boston next month",
                     "weathering steel", "we should weather the storm", "what about tomorrow",
                     "weather today tomorrow", "weather in Boston and New York"):
            with self.subTest(text=text):
                self.assertEqual(CommandInterpreter().interpret(text).intent, "unknown")

    def test_old_command_constructor_and_frozen_request(self):
        command = Command("open_app", "open Safari", "safari")
        self.assertIsNone(command.weather_request)
        with self.assertRaises(FrozenInstanceError):
            WeatherRequest().period = "tomorrow"


class TestWeatherService(unittest.TestCase):
    def setUp(self):
        self.get = MagicMock()
        self.geocode = deepcopy(GEOCODE)
        self.forecast = deepcopy(FORECAST)
        self.geo_response = MagicMock()
        self.geo_response.json.side_effect = lambda: self.geocode
        self.forecast_response = MagicMock()
        self.forecast_response.json.side_effect = lambda: self.forecast
        self.get.side_effect = [self.geo_response, self.forecast_response]
        self.service = WeatherService(http_get=self.get, default_location="New York, NY")

    def test_geocoding_and_today_current_forecast(self):
        self.assertEqual(self.service.get_weather(WeatherRequest()), RESULT)
        self.assertEqual(self.get.call_count, 2)
        self.assertEqual(self.get.call_args_list[0].kwargs["params"]["name"], "New York")
        self.geo_response.raise_for_status.assert_called_once()
        self.forecast_response.raise_for_status.assert_called_once()

    def test_tomorrow_uses_daily_condition_not_current(self):
        self.forecast["current"]["weather_code"] = 95
        result = self.service.get_weather(WeatherRequest(period="tomorrow"))
        self.assertTrue(result.success)
        self.assertEqual((result.high_f, result.low_f, result.condition), (75, 62, "partly cloudy"))
        self.assertIsNone(result.temperature_f)

    def test_fahrenheit_timezone_and_timeouts(self):
        self.service.get_weather(WeatherRequest())
        params = self.get.call_args.kwargs["params"]
        self.assertEqual(params["temperature_unit"], "fahrenheit")
        self.assertEqual(params["timezone"], "America/New_York")
        self.assertEqual(params["forecast_days"], 2)
        self.assertEqual(params["latitude"], 40.7)
        for request in self.get.call_args_list:
            self.assertEqual(request.kwargs["timeout"], 5.0)

    def test_timezone_auto_when_not_returned(self):
        del self.geocode["results"][0]["timezone"]
        self.assertTrue(self.service.get_weather(WeatherRequest()).success)
        self.assertEqual(self.get.call_args.kwargs["params"]["timezone"], "auto")

    def test_unknown_location(self):
        self.geocode = {}
        result = self.service.get_weather(WeatherRequest("unfindable"))
        self.assertEqual(result.message, LOCATION_NOT_FOUND)
        self.get.assert_called_once()

    def test_empty_geocoding(self):
        self.geocode = {"results": []}
        self.assertEqual(self.service.get_weather(WeatherRequest()).message, LOCATION_NOT_FOUND)

    def test_explicit_location_overrides_default(self):
        self.geocode["results"][0].update(name="Boston", admin1="Massachusetts")
        result = self.service.get_weather(WeatherRequest("Boston"))
        self.assertEqual(result.location, "Boston, Massachusetts")
        self.assertEqual(self.get.call_args_list[0].kwargs["params"]["name"], "Boston")

    def test_region_mismatch_is_not_silently_ignored(self):
        self.assertEqual(self.service.get_weather(WeatherRequest("New York, CA")).message, LOCATION_NOT_FOUND)
        self.get.assert_called_once()

    def test_network_errors_are_safe(self):
        for error in (requests.Timeout("private URL"), requests.ConnectionError("DNS failure"), OSError("offline")):
            with self.subTest(error=error):
                self.get.side_effect = error
                self.assertEqual(self.service.get_weather(WeatherRequest()).message, WEATHER_UNAVAILABLE)

    def test_http_error_is_safe(self):
        self.forecast_response.raise_for_status.side_effect = requests.HTTPError("503 secret details")
        self.assertEqual(self.service.get_weather(WeatherRequest()).message, WEATHER_UNAVAILABLE)

    def test_malformed_json_is_safe(self):
        self.geo_response.json.side_effect = ValueError("invalid JSON")
        self.assertFalse(self.service.get_weather(WeatherRequest()).success)

    def test_malformed_forecast_and_provider_errors(self):
        for data in ({}, [], {"error": True}, {"current": None, "daily": {}}):
            with self.subTest(data=data):
                self.get.side_effect = [self.geo_response, self.forecast_response]
                self.forecast = data
                self.assertEqual(self.service.get_weather(WeatherRequest()).message, WEATHER_UNAVAILABLE)

    def test_missing_required_field_fails(self):
        del self.forecast["current"]["temperature_2m"]
        self.assertFalse(self.service.get_weather(WeatherRequest()).success)

    def test_optional_apparent_temperature_can_be_absent(self):
        del self.forecast["current"]["apparent_temperature"]
        self.assertTrue(self.service.get_weather(WeatherRequest()).success)

    def test_missing_probability_is_not_zero_chance(self):
        del self.forecast["daily"]["precipitation_probability_max"]
        self.assertFalse(self.service.get_weather(WeatherRequest(query_type="rain")).success)

    def test_invalid_numbers_fail_safely(self):
        for value in (None, "72", True, float("nan"), float("inf")):
            with self.subTest(value=value):
                self.get.side_effect = [self.geo_response, self.forecast_response]
                self.forecast["current"]["temperature_2m"] = value
                self.assertFalse(self.service.get_weather(WeatherRequest()).success)

    def test_unsupported_period_never_calls_provider(self):
        self.assertFalse(self.service.get_weather(WeatherRequest(period="next month")).success)
        self.get.assert_not_called()

    def test_condition_mapping(self):
        for code, expected in ((0, "clear"), (1, "mostly clear"), (2, "partly cloudy"), (3, "cloudy"),
                               (45, "foggy"), (53, "drizzle"), (63, "rain"), (75, "snow"),
                               (81, "rain showers"), (86, "snow showers"), (95, "thunderstorms")):
            self.assertEqual(weather_condition(code), expected)
        self.assertIsNone(weather_condition(999))

    def test_environment_default(self):
        with patch.dict("os.environ", {"TOM_WEATHER_LOCATION": "Boston, MA"}):
            self.assertEqual(WeatherService(http_get=self.get).default_location, "Boston, MA")
        with patch.dict("os.environ", {"TOM_WEATHER_LOCATION": " "}):
            self.assertEqual(get_default_weather_location(), "New York, NY")


class TestWeatherResponses(unittest.TestCase):
    def response(self, period="today", query="summary", result=RESULT):
        return ResponseGenerator().generate(Command("weather", "weather", weather_request=WeatherRequest(
            period=period, query_type=query)), weather_result=result)

    def test_today_summary(self):
        self.assertEqual(self.response().text,
            "It's 72 degrees and partly cloudy in New York. Today's high is 78 and the low is 64.")

    def test_tomorrow_summary(self):
        self.assertEqual(self.response("tomorrow").text,
            "Tomorrow in New York, the high will be 78 and the low 64, with partly cloudy conditions.")

    def test_temperature(self):
        self.assertEqual(self.response(query="temperature").text,
            "It's 72 degrees in New York, and it feels like 71.")

    def test_rain(self):
        self.assertEqual(self.response(query="rain").text,
            "There's a 60 percent chance of rain in New York today.")

    def test_low_rain_probability(self):
        result = WeatherResult(True, "Boston", precipitation_probability=5)
        self.assertEqual(self.response(query="rain", result=result).text,
            "Rain is unlikely in Boston today, with about a 5 percent chance.")

    def test_unknown_location(self):
        self.assertEqual(self.response(result=WeatherResult(False, message=LOCATION_NOT_FOUND)).text, LOCATION_NOT_FOUND)

    def test_failure_never_exposes_details(self):
        response = self.response(result=WeatherResult(False, message="https://secret/provider error traceback"))
        self.assertFalse(response.success)
        self.assertEqual(response.text, WEATHER_UNAVAILABLE)

    def test_missing_result_is_safe(self):
        self.assertEqual(self.response(result=None).text, WEATHER_UNAVAILABLE)


class TestWeatherIntegration(unittest.TestCase):
    def setUp(self):
        self.weather = MagicMock(spec=WeatherService)
        self.weather.get_weather.return_value = RESULT
        self.audio = MagicMock()
        self.audio.timeout = 10
        self.voice = VoiceSession(self.audio, verbose=False, weather_service=self.weather)
        patcher = patch("tom.speech.SpeechSynthesizer.speak", return_value=SpeechResult(True, "", "mock"))
        self.speak = patcher.start()
        self.addCleanup(patcher.stop)

    def test_weather_lookup_response_and_speech_once_without_action(self):
        with patch("tom.session.ActionExecutor") as action:
            response = self.voice.process_transcript("weather in Boston")
        self.weather.get_weather.assert_called_once_with(WeatherRequest("Boston"))
        self.speak.assert_called_once_with(response.text)
        self.audio.listen_and_transcribe.assert_not_called()
        action.assert_not_called()

    def test_weather_success_and_failure_keep_session_active(self):
        for result in (RESULT, WeatherResult(False, message=WEATHER_UNAVAILABLE)):
            with self.subTest(success=result.success):
                self.weather.reset_mock()
                self.speak.reset_mock()
                self.audio.reset_mock()
                self.weather.get_weather.return_value = result
                self.audio.listen_and_transcribe.side_effect = ["weather today", "what time is it", "no thanks"]
                wake_backend = MagicMock(spec=OfflineWakeRecognizer)
                wake_backend.transcribe.return_value = "tom"
                WakeSession(self.voice, verbose=False, wake_recognizer=wake_backend).run_wake_cycle()
                self.weather.get_weather.assert_called_once()
                wake_backend.transcribe.assert_called_once()
                self.assertEqual(self.audio.listen_and_transcribe.call_count, 3)
                texts = [item.args[0] for item in self.speak.call_args_list]
                self.assertEqual(len(texts), 4)
                self.assertEqual(texts[0], WAKE_GREETING)
                self.assertTrue(texts[2].startswith("The current time is"))
                self.assertEqual(texts[3], SESSION_CLOSE_RESPONSE)

    def test_non_weather_does_not_create_or_call_weather_service(self):
        with patch("tom.session.WeatherService") as factory:
            VoiceSession(self.audio, verbose=False).process_transcript("what time is it", speak=False)
        factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
