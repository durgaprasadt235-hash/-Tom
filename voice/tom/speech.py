"""Tom text-to-speech output foundation.

Provides local speech synthesis using macOS's built-in `say` command.

Responsibilities:
- Synthesizes text to speech using the local macOS `say` binary.
- Supports optional custom macOS voice name (e.g. "Samantha", "Alex", "Daniel").
- Defaults to the system-configured voice when no voice is specified.
- Safely handles empty input, whitespace, and subprocess failures without crashing.

Safety invariants:
- Subprocess is invoked with an explicit argument list — NEVER shell=True.
- No arbitrary shell formatting or string concatenation into a shell.
- Empty or whitespace-only inputs are rejected before subprocess invocation.

Classes:
    SpeechResult      — frozen dataclass holding synthesis status and message
    SpeechSynthesizer — safe interface to macOS `say`
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Optional


# ---------------------------------------------------------------------------
# SpeechResult model
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SpeechResult:
    """Immutable result of a speech synthesis attempt.

    Attributes:
        success: True if the speech synthesis executed without error.
        text:    The text passed for synthesis.
        message: Status description or error detail.
        voice:   Optional voice used for synthesis.
    """

    success: bool
    text: str
    message: str
    voice: Optional[str] = None

    def __repr__(self) -> str:
        voice_part = f", voice={self.voice!r}" if self.voice is not None else ""
        return (
            f"SpeechResult(success={self.success}, text={self.text!r}, "
            f"message={self.message!r}{voice_part})"
        )


# ---------------------------------------------------------------------------
# SpeechSynthesizer
# ---------------------------------------------------------------------------

class SpeechSynthesizer:
    """Interface to local macOS speech synthesis (`say`).

    Pure local execution:
    - No cloud APIs or network calls.
    - No external TTS libraries or dependencies.
    - Uses macOS built-in `/usr/bin/say`.
    """

    def __init__(self, voice: Optional[str] = None) -> None:
        """Initialise SpeechSynthesizer.

        Args:
            voice: Optional macOS voice name. If None, uses system default.
        """
        self._voice = voice

    @property
    def voice(self) -> Optional[str]:
        """Return configured voice name or None."""
        return self._voice

    def speak(self, text: str) -> SpeechResult:
        """Synthesize and speak text through macOS system audio.

        Args:
            text: Text to speak.

        Returns:
            SpeechResult indicating success or failure.
        """
        if not text or not isinstance(text, str) or not text.strip():
            return SpeechResult(
                success=False,
                text=text if isinstance(text, str) else "",
                message="Cannot speak: empty or whitespace-only text.",
                voice=self._voice,
            )

        cmd = ["say"]
        if self._voice:
            cmd.extend(["-v", self._voice])
        cmd.append(text)

        try:
            subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True,
            )
            return SpeechResult(
                success=True,
                text=text,
                message="Speech synthesized successfully.",
                voice=self._voice,
            )
        except subprocess.CalledProcessError as exc:
            return SpeechResult(
                success=False,
                text=text,
                message=f"Speech synthesis failed: {exc.stderr.strip() or str(exc)}",
                voice=self._voice,
            )
        except Exception as exc:
            return SpeechResult(
                success=False,
                text=text,
                message=f"Unexpected error during speech synthesis: {exc}",
                voice=self._voice,
            )
