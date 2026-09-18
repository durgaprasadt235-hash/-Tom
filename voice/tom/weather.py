"""Open-Meteo weather data service. No audio, commands, actions, or TTS."""

from dataclasses import dataclass
from datetime import date, timedelta
import math

import requests

from tom.config import get_default_weather_location


@dataclass(frozen=True)
class WeatherRequest:
    location: str | None = None
    period: str = "today"
    query_type: str = "summary"


@dataclass(frozen=True)
class WeatherResult:
    success: bool
    location: str | None = None
    temperature_f: float | None = None
    apparent_temperature_f: float | None = None
    condition: str | None = None
    high_f: float | None = None
    low_f: float | None = None
    precipitation_probability: int | None = None
    message: str | None = None


WEATHER_UNAVAILABLE = "I couldn't get the weather right now."
LOCATION_NOT_FOUND = "I couldn't find that location."


def weather_condition(code) -> str | None:
    """WMO codes documented by Open-Meteo; unrecognized codes stay unknown."""
    if type(code) not in (int, float):
        return None
    return {
        0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "cloudy",
        45: "foggy", 48: "foggy", 51: "drizzle", 53: "drizzle", 55: "drizzle",
        56: "freezing drizzle", 57: "freezing drizzle", 61: "rain", 63: "rain",
        65: "rain", 66: "freezing rain", 67: "freezing rain", 71: "snow",
        73: "snow", 75: "snow", 77: "snow", 80: "rain showers",
        81: "rain showers", 82: "rain showers", 85: "snow showers",
        86: "snow showers", 95: "thunderstorms", 96: "thunderstorms",
        99: "thunderstorms",
    }.get(code)


_US_STATES = dict(item.split(":") for item in (
    "AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|"
    "CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|"
    "HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|"
    "LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|"
    "MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|"
    "NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|"
    "OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|"
    "SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|"
    "WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming"
).split("|"))


class WeatherService:
    GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
    FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

    def __init__(self, *, default_location: str | None = None, http_get=None,
                 timeout: float = 5.0) -> None:
        self.default_location = default_location or get_default_weather_location()
        self._get = http_get if http_get is not None else requests.get
        self.timeout = timeout

    def _json(self, url, params):
        response = self._get(url, params=params, timeout=self.timeout)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict) or data.get("error"):
            raise ValueError("Invalid provider response")
        return data

    @staticmethod
    def _number(value):
        if type(value) not in (int, float) or not math.isfinite(value):
            return None
        return float(value)

    def get_weather(self, request: WeatherRequest) -> WeatherResult:
        """One geocoding request and one forecast request; no implicit retries.

        Failures expose only fixed safe messages. Bare city names use the
        provider's highest-ranked match; comma-separated regions narrow it.
        """
        try:
            if request.period not in ("today", "tomorrow") or request.query_type not in ("summary", "temperature", "rain"):
                return WeatherResult(False, message=WEATHER_UNAVAILABLE)
            location = (request.location or self.default_location).strip()
            parts = [part.strip() for part in location.split(",")]
            if not parts[0] or any(not part for part in parts):
                return WeatherResult(False, message=LOCATION_NOT_FOUND)
            geocoded = self._json(self.GEOCODING_URL, {
                "name": parts[0], "count": 10, "language": "en", "format": "json",
            })
            places = geocoded.get("results", [])
            if not isinstance(places, list):
                raise ValueError("Invalid locations")
            for qualifier in parts[1:]:
                region = _US_STATES.get(qualifier.upper(), qualifier).casefold()
                places = [place for place in places if region in {
                    str(place.get(field, "")).casefold()
                    for field in ("admin1", "country", "country_code")
                }]
            if not places:
                return WeatherResult(False, message=LOCATION_NOT_FOUND)
            place = places[0]
            latitude = self._number(place["latitude"])
            longitude = self._number(place["longitude"])
            if latitude is None or longitude is None or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                raise ValueError("Invalid coordinates")
            name = place["name"]
            if not isinstance(name, str) or not name.strip():
                raise ValueError("Invalid location name")
            region = place.get("admin1")
            canonical = f"{name}, {region}" if isinstance(region, str) and region and region != name else name
            forecast = self._json(self.FORECAST_URL, {
                "latitude": latitude, "longitude": longitude,
                "current": "temperature_2m,apparent_temperature,weather_code",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
                "temperature_unit": "fahrenheit", "timezone": place.get("timezone") or "auto",
                "forecast_days": 2,
            })
            current = forecast["current"]
            daily = forecast["daily"]
            # Current.time and daily.time are local to the requested timezone,
            # so the host's timezone never shifts which day is called tomorrow.
            today = date.fromisoformat(current["time"].split("T")[0])
            wanted = today + timedelta(days=request.period == "tomorrow")
            index = daily["time"].index(wanted.isoformat())

            def day_value(field):
                values = daily.get(field)
                return values[index] if isinstance(values, list) and len(values) > index else None

            temperature = self._number(current.get("temperature_2m")) if request.period == "today" else None
            apparent = self._number(current.get("apparent_temperature")) if request.period == "today" else None
            high = self._number(day_value("temperature_2m_max"))
            low = self._number(day_value("temperature_2m_min"))
            probability = self._number(day_value("precipitation_probability_max"))
            if probability is not None and not 0 <= probability <= 100:
                probability = None
            condition = weather_condition(current.get("weather_code") if request.period == "today" else day_value("weather_code"))
            if request.query_type == "rain":
                required = [probability]
            elif request.query_type == "temperature" and request.period == "today":
                required = [temperature]
            else:
                required = [high, low] + ([temperature, condition] if request.period == "today" else [condition])
            if any(value is None for value in required):
                raise ValueError("Missing weather fields")
            return WeatherResult(True, canonical, temperature, apparent, condition,
                                 high, low, round(probability) if probability is not None else None)
        except Exception:
            # requests/network/JSON/schema errors must never end a voice session.
            # Deliberately do not catch KeyboardInterrupt or SystemExit.
            return WeatherResult(False, message=WEATHER_UNAVAILABLE)
