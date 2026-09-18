"""Tom action execution foundation.

Executes structured Commands produced by the command interpretation layer.

Strictly sandboxed / whitelisted:
- Only intent == 'open_app' is executable in Step 6.
- Only a strict whitelist of known macOS apps may be launched.
- Subprocess is invoked with an explicit argument list — NEVER shell=True.
- No arbitrary transcript text is ever passed to the shell.

Classes:
    ActionResult   — frozen dataclass with execution outcome
    ActionExecutor — safely dispatches supported Commands to system actions

Typical usage::

    executor = ActionExecutor()
    result = executor.execute(command)
    if result.success:
        print(f"Action succeeded: {result.message}")
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from typing import Optional

from tom.commands import Command


# ---------------------------------------------------------------------------
# ActionResult model
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ActionResult:
    """Immutable result of an action execution attempt.

    Attributes:
        success: True if the action executed without error.
        action:  Identifier of the action attempted (e.g. 'open_app',
                 'unsupported', 'invalid_target').
        message: Human-readable status or error description.
        target:  Optional target that was acted upon (or attempted).
    """

    success: bool
    action: str
    message: str
    target: Optional[str] = None

    def __repr__(self) -> str:
        t = f", target={self.target!r}" if self.target is not None else ""
        return (
            f"ActionResult(success={self.success}, "
            f"action={self.action!r}, message={self.message!r}{t})"
        )


# ---------------------------------------------------------------------------
# ActionExecutor
# ---------------------------------------------------------------------------

class ActionExecutor:
    """Safely executes supported Commands on macOS.

    Safety invariants:
    1. Only `intent == "open_app"` is executable in Step 6.
    2. Only targets in `_APP_WHITELIST` can trigger subprocess.
    3. `subprocess.run()` is always called with an explicit list:
       `["open", "-a", APP_NAME]`, never `shell=True`.
    4. Target strings are normalised to lowercase before whitelist lookup.
    5. Malicious or unknown targets immediately return a failed ActionResult
       without invoking any system process.
    """

    # ------------------------------------------------------------------
    # Whitelist: lowercase key -> exact macOS application name
    # ------------------------------------------------------------------
    _APP_WHITELIST: dict[str, str] = {
        "safari": "Safari",
        "chrome": "Google Chrome",
        "google chrome": "Google Chrome",
        "visual studio code": "Visual Studio Code",
        "vs code": "Visual Studio Code",
        "vscode": "Visual Studio Code",
    }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def execute(self, command: Command) -> ActionResult:
        """Execute a Command and return an ActionResult.

        Never raises exceptions; all errors are captured and returned
        as an ActionResult with `success=False`.

        Args:
            command: Structured Command to execute.

        Returns:
            ActionResult describing success or failure.
        """
        if command.intent != "open_app":
            return ActionResult(
                success=False,
                action="unsupported",
                message=f"Intent {command.intent!r} is not executable yet.",
                target=command.target,
            )

        return self._execute_open_app(command)

    # ------------------------------------------------------------------
    # Private execution handlers
    # ------------------------------------------------------------------

    def _execute_open_app(self, command: Command) -> ActionResult:
        """Validate and open an allowed macOS application."""
        if not command.target or not command.target.strip():
            return ActionResult(
                success=False,
                action="open_app",
                message="Cannot open application: no target specified.",
                target=None,
            )

        target_key = command.target.strip().lower()

        if target_key not in self._APP_WHITELIST:
            return ActionResult(
                success=False,
                action="open_app",
                message=(
                    f"Application {command.target!r} is not in the allowed "
                    f"whitelist: {list(self._APP_WHITELIST.keys())}"
                ),
                target=command.target,
            )

        app_name = self._APP_WHITELIST[target_key]

        # Safe subprocess execution — explicit list, NO shell=True
        try:
            subprocess.run(
                ["open", "-a", app_name],
                check=True,
                capture_output=True,
                text=True,
            )
            return ActionResult(
                success=True,
                action="open_app",
                message=f"Opened {app_name}.",
                target=app_name,
            )
        except subprocess.CalledProcessError as exc:
            return ActionResult(
                success=False,
                action="open_app",
                message=f"Failed to open {app_name}: {exc.stderr.strip() or str(exc)}",
                target=app_name,
            )
        except Exception as exc:
            return ActionResult(
                success=False,
                action="open_app",
                message=f"Unexpected error opening {app_name}: {exc}",
                target=app_name,
            )
