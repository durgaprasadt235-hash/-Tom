"""Tom command structure and intent interpretation.

Converts a raw transcript string into a structured Command.

Does NOT perform any audio, microphone, or transcription work.
Does NOT execute any commands or call any external APIs.
Does NOT use LLMs, embeddings, or external AI services.

Classes:
    Command            — frozen dataclass representing a parsed command
    CommandInterpreter — deterministic rule-based intent classifier

Typical usage::

    interpreter = CommandInterpreter()
    command = interpreter.interpret("open Safari")
    # Command(intent='open_app', text='open Safari', target='safari')
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Optional
from tom.weather import WeatherRequest


# ---------------------------------------------------------------------------
# Command dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Command:
    """Structured representation of a recognised voice command.

    Attributes:
        intent: Classified intent label. One of:
            'greeting', 'weather', 'time', 'open_app', 'exit', 'unknown'
        text:   Original transcript string, preserved exactly as received.
        target: Optional extracted target (e.g. app name for open_app).
                Always lowercased when present.
    """

    intent: str
    text: str
    target: Optional[str] = None
    weather_request: Optional[WeatherRequest] = None

    def __repr__(self) -> str:
        if self.target is not None:
            return (
                f"Command(intent={self.intent!r}, "
                f"text={self.text!r}, target={self.target!r})"
            )
        return f"Command(intent={self.intent!r}, text={self.text!r})"


# ---------------------------------------------------------------------------
# CommandInterpreter
# ---------------------------------------------------------------------------

class CommandInterpreter:
    """Deterministic rule-based intent classifier.

    Normalises transcript text for matching without modifying the
    original transcript stored in Command.text.

    Matching strategy:
    - Text is lowercased and whitespace-collapsed before comparison.
    - Each intent has a list of keyword/phrase patterns that must appear
      as whole words or explicit phrases, preventing naive substring
      false positives (e.g. "weathering" does not trigger weather,
      "timeline" does not trigger time).
    - Intents are tested in priority order; the first match wins.
    - Anything that does not match returns intent='unknown'.

    No external libraries, APIs, or AI models are used.
    """

    # ------------------------------------------------------------------
    # Intent keyword tables
    # ------------------------------------------------------------------

    # Phrases that strongly indicate a greeting.
    # Matched as exact prefix phrases or full-sentence matches.
    _GREETING_TRIGGERS: tuple[str, ...] = (
        "hello tom",
        "hey tom",
        "hi tom",
        "hello there",
        "hey there",
        "good morning tom",
        "good afternoon tom",
        "good evening tom",
    )

    # Phrases that strongly indicate a weather query.
    # Must be whole-phrase matches to avoid "weathering steel" etc.
    _WEATHER_TRIGGERS: tuple[str, ...] = (
        "what's the weather",
        "what is the weather",
        "how is the weather",
        "how's the weather",
        "weather today",
        "weather outside",
        "weather forecast",
        "check the weather",
        "tell me the weather",
        "what's the weather like",
        "what is the weather like",
    )

    # Phrases that strongly indicate a time query.
    # Whole-phrase to avoid "timeline", "overtime", "pastime" etc.
    _TIME_TRIGGERS: tuple[str, ...] = (
        "what time is it",
        "what's the time",
        "what is the time",
        "tell me the time",
        "current time",
        "what's the current time",
        "what is the current time",
        "do you know the time",
        "got the time",
    )

    # Words that indicate open/launch intent.  Must appear as a standalone
    # word at the start of the utterance.
    _OPEN_VERBS: tuple[str, ...] = ("open", "launch", "start", "run")
    _OPEN_REQUEST_PREFIXES: tuple[str, ...] = (
        "can you please ", "could you please ", "would you please ",
        "please ", "can you ", "could you ", "would you ",
    )

    # Phrases that indicate the user wants to exit / stop Tom.
    _EXIT_TRIGGERS: tuple[str, ...] = (
        "exit",
        "quit",
        "stop tom",
        "goodbye tom",
        "bye tom",
        "goodbye",
        "shut down tom",
        "close tom",
        "turn off tom",
    )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def interpret(self, text: str) -> Command:
        """Classify a transcript string into a structured Command.

        Args:
            text: Raw transcript from the speech engine. May be empty.

        Returns:
            Command with intent, original text, and optional target.
        """
        if not text or not text.strip():
            return Command(intent="unknown", text=text)

        normalised = self._normalise(text)

        # Priority order matters — do not reorder without good reason.
        for handler in (
            self._try_greeting,
            self._try_exit,
            self._try_weather,
            self._try_time,
            self._try_open_app,
        ):
            result = handler(text, normalised)
            if result is not None:
                return result

        return Command(intent="unknown", text=text)

    # ------------------------------------------------------------------
    # Internal normalisation
    # ------------------------------------------------------------------

    @staticmethod
    def _normalise(text: str) -> str:
        """Lowercase and collapse internal whitespace."""
        return " ".join(text.lower().split())

    # ------------------------------------------------------------------
    # Per-intent matchers
    # ------------------------------------------------------------------

    def _try_greeting(self, text: str, normalised: str) -> Optional[Command]:
        for trigger in self._GREETING_TRIGGERS:
            if normalised == trigger or normalised.startswith(trigger):
                return Command(intent="greeting", text=text)
        return None

    def _try_exit(self, text: str, normalised: str) -> Optional[Command]:
        for trigger in self._EXIT_TRIGGERS:
            # Full-string match for short phrases like "exit", "quit",
            # or "goodbye"; prefix match for "goodbye Tom, see you later".
            if normalised == trigger or normalised.startswith(trigger + " "):
                return Command(intent="exit", text=text)
        return None

    def _try_weather(self, text: str, normalised: str) -> Optional[Command]:
        # Full grammar, rather than prefix matching, prevents unsupported dates
        # or unrelated uses of "weather" from silently becoming today's query.
        phrase = " ".join(text.replace("’", "'").split()).rstrip(".!?")
        match = re.fullmatch(
            r"(?P<head>(?:(?:what's|what is|how's|how is) the |check the |tell me the )?weather"
            r"|(?:(?:what's|what is) the )?temperature|will it rain|is it going to rain)"
            r"(?: (?:like|forecast))?(?: outside)?"
            r"(?: (?P<period>today|tomorrow))?"
            r"(?: in (?P<location>[\w .,'’-]+?))?"
            r"(?: (?P<end_period>today|tomorrow))?",
            phrase, re.IGNORECASE,
        )
        if not match:
            return None
        location = match.group("location")
        if location and re.search(r"\b(?:today|tomorrow|next|yesterday|tonight|week|month|and)\b", location, re.I):
            return None
        start, end = match.group("period"), match.group("end_period")
        if start and end:
            return None
        head = match.group("head").lower()
        kind = "rain" if "rain" in head else "temperature" if "temperature" in head else "summary"
        request = WeatherRequest(location, (start or end or "today").lower(), kind)
        return Command(intent="weather", text=text, weather_request=request)

    def _try_time(self, text: str, normalised: str) -> Optional[Command]:
        for trigger in self._TIME_TRIGGERS:
            if normalised == trigger or normalised.startswith(trigger):
                return Command(intent="time", text=text)
        return None

    def _try_open_app(self, text: str, normalised: str) -> Optional[Command]:
        """Strip one explicit polite prefix and parse a single app target.

        Never split a multi-app request or discard target qualifiers to guess
        an app. ActionExecutor remains the authority for the launch whitelist.
        """
        for request_prefix in self._OPEN_REQUEST_PREFIXES:
            if normalised.startswith(request_prefix):
                normalised = normalised[len(request_prefix):]
                break
        for verb in self._OPEN_VERBS:
            prefix = verb + " "
            if normalised.startswith(prefix):
                app_name = normalised[len(prefix):].rstrip(".!?").strip()
                if re.search(r"\b(?:and|or|on|then)\b|[,;&|]", app_name):
                    return None
                if app_name:  # Guard: reject bare "open" with nothing after
                    # Normalise well-known app aliases
                    app_name = self._normalise_app_name(app_name)
                    return Command(intent="open_app", text=text, target=app_name)
        return None

    # ------------------------------------------------------------------
    # App name normalisation
    # ------------------------------------------------------------------

    # Maps spoken variants to a canonical lowercase target string.
    _APP_ALIASES: dict[str, str] = {
        "vs code": "visual studio code",
        "vscode": "visual studio code",
        "visual studio code": "visual studio code",
        "chrome": "google chrome",
        "google chrome": "google chrome",
        "safari": "safari",
        "firefox": "firefox",
        "terminal": "terminal",
        "finder": "finder",
        "mail": "mail",
        "messages": "messages",
        "notes": "notes",
        "calendar": "calendar",
        "photos": "photos",
        "music": "music",
        "spotify": "spotify",
        "slack": "slack",
        "zoom": "zoom",
        "teams": "microsoft teams",
        "microsoft teams": "microsoft teams",
        "word": "microsoft word",
        "excel": "microsoft excel",
        "powerpoint": "microsoft powerpoint",
        "xcode": "xcode",
        "pycharm": "pycharm",
    }

    @classmethod
    def _normalise_app_name(cls, name: str) -> str:
        """Return canonical app name if known, otherwise return as-is."""
        return cls._APP_ALIASES.get(name, name)
