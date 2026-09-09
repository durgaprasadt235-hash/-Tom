"""Tom voice input/output abstraction.

Handles microphone enumeration, selection, and transcription.
Does not perform any microphone or audio operations on import.

Classes:
    MicrophoneDevice         - Detected audio input device
    MicrophoneNotFoundError  - Preferred device not found
    MicrophoneManager        - Device enumeration and selection

    SpeechTimeoutError       - No speech detected before timeout
    SpeechNotUnderstandableError - Speech captured but not understood
    SpeechServiceError       - Transcription service / network failure
    SpeechInput              - One-shot listen + Google transcription
"""

from dataclasses import dataclass, field
from typing import List, Optional

import pyaudio
import speech_recognition as sr


@dataclass
class MicrophoneDevice:
    """Represents a detected microphone device."""
    
    index: int
    name: str
    
    def __repr__(self) -> str:
        return f"MicrophoneDevice(index={self.index}, name={self.name!r})"


class MicrophoneNotFoundError(Exception):
    """Raised when a preferred microphone cannot be found."""
    pass


class MicrophoneManager:
    """Manages microphone device enumeration and selection.
    
    Provides methods to:
    - List all available microphone devices
    - Find devices by name
    - Select a preferred microphone
    
    Does not open or listen to microphone during initialization.
    """
    
    def __init__(self):
        """Initialize microphone manager.
        
        Does not access microphone hardware during init.
        """
        self._recognizer = sr.Recognizer()
    
    def list_devices(self) -> List[MicrophoneDevice]:
        """List all available microphone devices.
        
        Returns:
            List of MicrophoneDevice objects with index and name.
        """
        devices = []
        
        # Use PyAudio to enumerate devices
        p = pyaudio.PyAudio()
        try:
            for i in range(p.get_device_count()):
                info = p.get_device_info_by_index(i)
                # Only include devices with input channels (microphones)
                if info.get('maxInputChannels', 0) > 0:
                    devices.append(MicrophoneDevice(index=i, name=info['name']))
        finally:
            p.terminate()
        
        return devices
    
    def find_device(
        self, 
        preferred_name: str,
        available_devices: Optional[List[MicrophoneDevice]] = None
    ) -> MicrophoneDevice:
        """Find a microphone device by name.
        
        Search strategy:
        1. Exact case-insensitive match
        2. Partial case-insensitive match
        3. Raise MicrophoneNotFoundError with available devices listed
        
        Args:
            preferred_name: Name of the preferred microphone (e.g., "MacBook Air Microphone")
            available_devices: Optional list of devices to search. If None, enumerates devices.
        
        Returns:
            MicrophoneDevice matching the preferred name.
        
        Raises:
            MicrophoneNotFoundError: If preferred microphone is not found.
        """
        if available_devices is None:
            available_devices = self.list_devices()
        
        if not available_devices:
            raise MicrophoneNotFoundError(
                f"Preferred microphone not found: {preferred_name!r} "
                "(no microphones detected)"
            )
        
        preferred_name_lower = preferred_name.lower()
        
        # Strategy 1: Exact match (case-insensitive)
        for device in available_devices:
            if device.name.lower() == preferred_name_lower:
                return device
        
        # Strategy 2: Partial match (case-insensitive)
        for device in available_devices:
            if preferred_name_lower in device.name.lower():
                return device
        
        # Strategy 3: Not found - provide helpful error
        available_names = [d.name for d in available_devices]
        available_list = "\n  ".join(available_names)
        
        raise MicrophoneNotFoundError(
            f"Preferred microphone not found: {preferred_name!r}\n"
            f"Available microphones:\n  {available_list}"
        )
    
    def create_microphone(
        self,
        device_index: Optional[int] = None,
        preferred_device_name: Optional[str] = None
    ) -> sr.Microphone:
        """Create a SpeechRecognition Microphone object.
        
        Args:
            device_index: Optional specific device index to use.
            preferred_device_name: Optional device name to search for.
                If provided, search for this device by name.
                If not found, raises MicrophoneNotFoundError.
        
        Returns:
            sr.Microphone object ready for use.
        
        Raises:
            MicrophoneNotFoundError: If preferred_device_name is specified
                but cannot be found.
        """
        if preferred_device_name is not None:
            device = self.find_device(preferred_device_name)
            device_index = device.index
        
        return sr.Microphone(device_index=device_index)
    
    def get_preferred_microphone(
        self,
        preferred_name: str = "MacBook Air Microphone"
    ) -> sr.Microphone:
        """Get the preferred microphone for Tom.
        
        Searches for a microphone matching the preferred name.
        Falls back gracefully with helpful error messages.
        
        Args:
            preferred_name: Name of the preferred microphone.
                Defaults to "MacBook Air Microphone" for Tom Personal.
        
        Returns:
            sr.Microphone object for the preferred device.
        
        Raises:
            MicrophoneNotFoundError: If preferred microphone cannot be found.
        """
        device = self.find_device(preferred_name)
        return self.create_microphone(device_index=device.index)


# ---------------------------------------------------------------------------
# Speech input exceptions
# ---------------------------------------------------------------------------

class SpeechTimeoutError(Exception):
    """No speech was detected before the listen timeout expired."""
    pass


class SpeechNotUnderstandableError(Exception):
    """Audio was captured but the transcription engine could not understand it."""
    pass


class SpeechServiceError(Exception):
    """Transcription service was unreachable or returned an error.

    Wraps sr.RequestError. Check .cause for the original exception.
    """

    def __init__(self, message: str, cause: Optional[Exception] = None):
        super().__init__(message)
        self.cause = cause


# ---------------------------------------------------------------------------
# SpeechInput — one-shot microphone capture + Google transcription
# ---------------------------------------------------------------------------

@dataclass
class SpeechInput:
    """One-shot speech capture and transcription.

    Lifecycle per call to listen_and_transcribe():
        acquire microphone context
        → optionally calibrate ambient noise   (if requested)
        → wait for speech up to `timeout` seconds
        → capture one utterance up to `phrase_time_limit` seconds
        → release microphone context
        → send audio to Google Speech API
        → return transcribed text to caller

    The microphone is held only inside the context manager used by
    listen_once() / listen_and_transcribe(). It is released as soon as
    the utterance ends or the timeout expires.

    No audio data, transcription text, or secrets are logged internally.
    The caller is responsible for any logging and for passphrase handling.

    Args:
        microphone: sr.Microphone instance created by MicrophoneManager.
        timeout: Seconds to wait for speech to begin. None = wait forever.
        phrase_time_limit: Max seconds to capture a single utterance.
        calibration_duration: Seconds of ambient noise to sample for
            energy-threshold calibration. Use 0 to skip calibration.
    """

    microphone: sr.Microphone
    timeout: Optional[float] = 8.0
    phrase_time_limit: Optional[float] = 10.0
    calibration_duration: float = 1.0

    # Shared recognizer — created once, reused across calls.
    _recognizer: sr.Recognizer = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._recognizer = sr.Recognizer()

    # ------------------------------------------------------------------
    # Calibration
    # ------------------------------------------------------------------

    def calibrate_ambient_noise(
        self,
        duration: Optional[float] = None,
    ) -> None:
        """Sample ambient noise and adjust the energy threshold.

        Call this once at session start (or after a long silence) rather
        than before every utterance.  The session layer decides when to
        calibrate; this method does not auto-invoke itself.

        Args:
            duration: Seconds to sample. Defaults to self.calibration_duration.
        """
        sample_duration = duration if duration is not None else self.calibration_duration
        with self.microphone as source:
            self._recognizer.adjust_for_ambient_noise(source, duration=sample_duration)

    # ------------------------------------------------------------------
    # Raw audio capture
    # ------------------------------------------------------------------

    def listen_once(self) -> sr.AudioData:
        """Open the microphone, capture one utterance, close the microphone.

        Blocks until:
        - `timeout` seconds pass with no speech start   → SpeechTimeoutError
        - One full utterance is captured                → returns AudioData

        The microphone is always released before returning or raising.

        Returns:
            sr.AudioData containing the captured audio.

        Raises:
            SpeechTimeoutError: Nobody spoke before timeout.
        """
        try:
            with self.microphone as source:
                audio = self._recognizer.listen(
                    source,
                    timeout=self.timeout,
                    phrase_time_limit=self.phrase_time_limit,
                )
            return audio
        except sr.WaitTimeoutError:
            raise SpeechTimeoutError(
                f"No speech detected within {self.timeout}s timeout."
            )

    # ------------------------------------------------------------------
    # Transcription
    # ------------------------------------------------------------------

    def transcribe_google(self, audio: sr.AudioData) -> str:
        """Send captured audio to Google Speech API and return transcript.

        Does not print or log the returned text. Caller handles display
        and passphrase logic.

        Args:
            audio: AudioData captured via listen_once().

        Returns:
            Transcribed text string (not stripped, not normalised).

        Raises:
            SpeechNotUnderstandableError: Audio received but not understood.
            SpeechServiceError: Network or API failure.
        """
        try:
            return self._recognizer.recognize_google(audio)
        except sr.UnknownValueError:
            raise SpeechNotUnderstandableError(
                "Speech was captured but could not be understood."
            )
        except sr.RequestError as exc:
            raise SpeechServiceError(
                "Google Speech transcription service error. "
                "Check your network connection.",
                cause=exc,
            )

    # ------------------------------------------------------------------
    # Combined convenience method
    # ------------------------------------------------------------------

    def listen_and_transcribe(
        self,
        *,
        calibrate: bool = False,
    ) -> str:
        """Capture one utterance and return its transcript.

        Combined convenience wrapper: optionally calibrates, then calls
        listen_once() followed by transcribe_google().

        Args:
            calibrate: If True, calibrate ambient noise before listening.
                Use sparingly — once per session is usually sufficient.

        Returns:
            Transcribed text string.

        Raises:
            SpeechTimeoutError: Nobody spoke before timeout.
            SpeechNotUnderstandableError: Speech captured but not understood.
            SpeechServiceError: Network or API failure.
        """
        if calibrate:
            self.calibrate_ambient_noise()

        audio = self.listen_once()
        return self.transcribe_google(audio)

