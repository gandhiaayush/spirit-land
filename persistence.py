"""
Persistence layer for SubStrata session state via Google Interactions API (Antigravity).

The Antigravity environment acts as a hosted, stateful runtime. An environment_id
is created on first run and persisted locally so every subsequent batch call
can reference it via previous_interaction_id — keeping the full session history
server-side without a local database.
"""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_SESSION_FILE = Path(__file__).parent / "session.json"
_AGENT = "antigravity-preview-05-2026"
_STUB_MODE = os.environ.get("SUBSTRATA_STUB_MODE", "false").lower() == "true"

_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai  # only import when actually needed
        project = os.environ.get("GCP_PROJECT", "ai-hack-sf26sfo-7095")
        import config
        _client = genai.Client(vertexai=True, project=project, location="global", credentials=config.get_credentials())
    return _client


# Substrings that mark a transient/provisioning error worth retrying.
_RETRYABLE_MARKERS = (
    "Resource setup",
    "just started",
    "RESOURCE_EXHAUSTED",
    "429",
    "503",
    "UNAVAILABLE",
)


def _is_retryable(exc: Exception) -> bool:
    message = str(exc)
    return any(marker in message for marker in _RETRYABLE_MARKERS)


def _create_interaction_with_retry(client, *, attempts: int = 3, **kwargs):
    """
    Call client.interactions.create(**kwargs), retrying transient/provisioning
    errors up to `attempts` times with a ~4s sleep between tries.
    Raises the last exception if every attempt fails.
    """
    last_exc = None
    for attempt in range(1, attempts + 1):
        try:
            kwargs.setdefault("background", True)  # Antigravity requires background workflows
            return client.interactions.create(**kwargs)
        except Exception as exc:  # noqa: BLE001 — must never let a transient error crash the loop
            last_exc = exc
            if attempt < attempts and _is_retryable(exc):
                print(
                    f"[persistence] Antigravity not ready (attempt {attempt}/{attempts}): "
                    f"{exc}. Retrying in 4s..."
                )
                time.sleep(4)
                continue
            raise
    raise last_exc


def _load_local_session() -> dict | None:
    if _SESSION_FILE.exists():
        return json.loads(_SESSION_FILE.read_text())
    return None


def _save_local_session(session: dict) -> None:
    _SESSION_FILE.write_text(json.dumps(session, indent=2))


def create_session() -> dict:
    """
    Start a brand-new SubStrata run.
    In stub mode: writes a local session.json without calling Antigravity.
    In real mode: creates an Antigravity environment and stores the returned ID.
    """
    session_id = f"session_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"

    if _STUB_MODE:
        environment_id = f"stub_env_{session_id}"
    else:
        try:
            client = _get_client()
            interaction = _create_interaction_with_retry(
                client,
                agent=_AGENT,
                input=(
                    f"You are the state manager for SubStrata (session {session_id}), "
                    "a self-improving land-cover classification system. "
                    "Your job is to store and retrieve batch results, heuristic IDs, and accuracy history. "
                    "Acknowledge that the session has started."
                ),
                environment="remote",
            )
            environment_id = interaction.id
        except Exception as exc:  # noqa: BLE001 — degrade to local instead of crashing the run
            print(
                f"[persistence] Antigravity session creation failed ({exc}); "
                "falling back to local persistence."
            )
            session = {
                "session_id": session_id,
                "antigravity_environment_id": "local",
                "current_batch_number": 0,
                "batches": [],
            }
            _save_local_session(session)
            return session

    session = {
        "session_id": session_id,
        "antigravity_environment_id": environment_id,
        "current_batch_number": 0,
        "batches": [],
    }
    _save_local_session(session)
    return session


def save_batch(batch_summary: dict) -> dict:
    """
    Append a completed batch's results to the session.
    In stub mode: local-only. In real mode: calls Interactions API.
    """
    session = _load_local_session()
    if session is None:
        raise RuntimeError("No active session — call create_session() first")

    env_id = session.get("antigravity_environment_id")
    if not _STUB_MODE and env_id and env_id != "local":
        try:
            client = _get_client()
            interaction = _create_interaction_with_retry(
                client,
                agent=_AGENT,
                input=(
                    f"Batch {batch_summary['batch_number']} complete. "
                    f"Results: {json.dumps(batch_summary)}. "
                    "Append this to the session history and confirm."
                ),
                previous_interaction_id=env_id,
            )
            session["antigravity_environment_id"] = interaction.id
        except Exception as exc:  # noqa: BLE001 — batch must still persist locally
            print(
                f"[persistence] Antigravity batch save failed ({exc}); "
                "persisting batch locally only."
            )

    session["current_batch_number"] = batch_summary["batch_number"]
    session["batches"].append(batch_summary)
    _save_local_session(session)
    return session


def load_session() -> dict | None:
    """Return the locally cached Session/Run Record, or None if no run has started."""
    return _load_local_session()


def clear_session() -> None:
    """Wipe local session state (use when starting a fresh run)."""
    if _SESSION_FILE.exists():
        _SESSION_FILE.unlink()


# ── quick smoke test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Creating session...")
    session = create_session()
    print(f"  session_id: {session['session_id']}")
    print(f"  environment_id: {session['antigravity_environment_id']}")

    dummy_batch = {
        "batch_number": 1,
        "overall_accuracy": 0.72,
        "per_confusion_pair_error_rate": {"shrubland_forest": 0.28, "urban_water": 0.05},
        "active_heuristic_ids": [],
    }
    print("\nSaving dummy batch 1...")
    session = save_batch(dummy_batch)
    print(f"  batches stored: {len(session['batches'])}")
    print("Persistence smoke test passed.")
