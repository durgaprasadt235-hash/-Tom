"""Tom configuration management.

Loads and validates environment configuration from .env file.
Provides typed configuration structure for all Tom modules.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


TOM_DEFAULT_WEATHER_LOCATION = "New York, NY"


def get_default_weather_location() -> str:
    """Weather needs no legacy credentials or precise device location."""
    return os.getenv("TOM_WEATHER_LOCATION", "").strip() or TOM_DEFAULT_WEATHER_LOCATION


@dataclass
class OmniRouteConfig:
    """OmniRoute LLM provider configuration."""

    base_url: str
    api_key: str
    model: str = "auto/best-free"

    def __repr__(self) -> str:
        """Safe repr that never exposes credentials."""
        return f"OmniRouteConfig(base_url={self.base_url!r}, model={self.model!r})"


@dataclass
class AuthConfig:
    """Authentication configuration."""

    passphrase: str

    def __repr__(self) -> str:
        """Safe repr that never exposes passphrase."""
        return "AuthConfig(passphrase=***)"


@dataclass
class TomConfig:
    """Complete Tom configuration.
    
    Loaded from .env file. Provides all configuration needed for Tom runtime.
    """

    omniroute: OmniRouteConfig
    auth: AuthConfig

    def __repr__(self) -> str:
        """Safe repr that never exposes credentials."""
        return f"TomConfig(omniroute={self.omniroute!r}, auth={self.auth!r})"


def load_config(env_path: Optional[Path] = None) -> TomConfig:
    """Load Tom configuration from .env file.
    
    Args:
        env_path: Path to .env file. If None, searches in current directory.
        
    Returns:
        TomConfig with validated configuration.
        
    Raises:
        FileNotFoundError: If .env file not found.
        ValueError: If required configuration values are missing.
    """
    if env_path is None:
        env_path = Path.cwd() / ".env"
    
    if not env_path.exists():
        raise FileNotFoundError(f".env file not found at {env_path}")
    
    # Load environment variables from .env
    load_dotenv(env_path)
    
    # Read required configuration
    omniroute_base_url = os.getenv("OMNIROUTE_BASE_URL")
    omniroute_api_key = os.getenv("OMNIROUTE_API_KEY")
    tom_passphrase = os.getenv("TOM_PASSPHRASE")
    
    # Validate required values
    if not omniroute_base_url:
        raise ValueError("Missing required configuration: OMNIROUTE_BASE_URL")
    
    if not omniroute_api_key:
        raise ValueError("Missing required configuration: OMNIROUTE_API_KEY")
    
    if not tom_passphrase:
        raise ValueError("Missing required configuration: TOM_PASSPHRASE")
    
    # Create configuration structure
    omniroute_config = OmniRouteConfig(
        base_url=omniroute_base_url,
        api_key=omniroute_api_key,
        model="auto/best-free",
    )
    
    auth_config = AuthConfig(
        passphrase=tom_passphrase,
    )
    
    return TomConfig(
        omniroute=omniroute_config,
        auth=auth_config,
    )
