"""
Persistence layer for SubStrata session state via Google Interactions API (Antigravity).

The Antigravity environment acts as a hosted, stateful runtime. An environment_id
is created on first run and persisted locally so every subsequent batch call
can reference it via previous_interaction_id — keeping the full session history
server-side without a local database.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

_SESSION_FILE = Path(__file__).parent / "session.json"
_AGENT = "antigravity-preview-05-2026"
_STUB_MODE = os.environ.get("SUBSTRATA_STUB_MODE", "true").lower() == "true"

_client = None


def _get_client():
    global _client
    if _client is None:
        from google import genai  # only import when actually needed
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key or api_key == "placeholder":
            raise EnvironmentError("Set a real GOOGLE_API_KEY in your .env file")
        _client = genai.Client(api_key=api_key)
    return _client


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
        client = _get_client()
        interaction = client.interactions.create(
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

    if not _STUB_MODE:
        client = _get_client()
        interaction = client.interactions.create(
            agent=_AGENT,
            input=(
                f"Batch {batch_summary['batch_number']} complete. "
                f"Results: {json.dumps(batch_summary)}. "
                "Append this to the session history and confirm."
            ),
            previous_interaction_id=session["antigravity_environment_id"],
        )
        session["antigravity_environment_id"] = interaction.id

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
