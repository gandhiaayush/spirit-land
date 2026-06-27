"""
Persistence layer for SubStrata session state via Google Interactions API (Antigravity).

Antigravity serves as the live memory for the self-improving loop:
  - save_batch():      sends batch results to Antigravity; asks it to synthesize
                       heuristics from the accumulated error history; stores them.
  - get_heuristics():  queries Antigravity for the most relevant rules before each
                       batch; returns structured heuristic dicts the classifier injects.

In STUB_MODE (SUBSTRATA_STUB_MODE=true) no API calls are made.
save_batch() derives heuristics directly from the confusion pairs so the
self-improving loop is observable in the demo without credentials.
"""

import json
import os
import re
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
        from google import genai
        api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
        if not api_key or api_key == "placeholder":
            raise EnvironmentError("Set a real GOOGLE_API_KEY in your .env file")
        _client = genai.Client(api_key=api_key)
    return _client


# ── local session file ────────────────────────────────────────────────────────

def _load_local_session() -> dict | None:
    if _SESSION_FILE.exists():
        return json.loads(_SESSION_FILE.read_text())
    return None


def _save_local_session(session: dict) -> None:
    _SESSION_FILE.write_text(json.dumps(session, indent=2))


# ── heuristic parsing ─────────────────────────────────────────────────────────

def _parse_heuristics(text: str, batch_number: int) -> list[dict]:
    """
    Extract structured heuristics from Antigravity's response.
    Expects lines matching: HEURISTIC: <id> | <rule text>
    Falls back to extracting any bullet lines if the model doesn't follow format exactly.
    """
    heuristics = []
    seen_ids: set[str] = set()

    for line in text.splitlines():
        line = line.strip()
        # Preferred format: HEURISTIC: id | rule
        m = re.match(r"HEURISTIC:\s*(\S+)\s*\|\s*(.+)", line, re.IGNORECASE)
        if m:
            node_id, rule = m.group(1).strip(), m.group(2).strip()
            if node_id not in seen_ids:
                seen_ids.add(node_id)
                heuristics.append({
                    "node_id": node_id,
                    "type": "heuristic",
                    "text": rule,
                    "applies_to_confusion_pairs": [],
                    "confidence_weight": 1.0,
                    "times_applied": 0,
                    "times_helped": 0,
                    "batch_origin": batch_number,
                })
            continue

        # Fallback: numbered or bulleted lines (- rule / 1. rule)
        m2 = re.match(r"^[-*\d.]+\s+(.{20,})", line)
        if m2 and "heuristic" not in line.lower()[:12]:
            rule = m2.group(1).strip()
            node_id = f"h_ag_{batch_number:03d}_{len(heuristics):02d}"
            if node_id not in seen_ids:
                seen_ids.add(node_id)
                heuristics.append({
                    "node_id": node_id,
                    "type": "heuristic",
                    "text": rule,
                    "applies_to_confusion_pairs": [],
                    "confidence_weight": 0.8,
                    "times_applied": 0,
                    "times_helped": 0,
                    "batch_origin": batch_number,
                })

    return heuristics


def _derive_stub_heuristics(batch_summary: dict) -> list[dict]:
    """
    In stub mode: generate heuristics directly from the batch's confusion pairs.
    Produces a concrete, observable heuristic for each top error pair so the
    self-improving loop is visible in the demo.
    """
    confusion = batch_summary.get("per_confusion_pair_error_rate", {})
    batch_num = batch_summary["batch_number"]
    heuristics = []

    # Map of common confusion-pair → actionable rule
    RULES = {
        ("forest",       "shrubland"):    "Check canopy density — dense continuous cover → forest; sparse patchy cover → shrubland.",
        ("shrubland",    "forest"):       "Shrubland has irregular texture and brown-green mix; true forest has uniform dark green.",
        ("urban",        "industrial"):   "Industrial areas have large uniform rooftops and no road grids; urban has street patterns.",
        ("industrial",   "urban"):        "Look for warehouses or large heat-emitting structures to distinguish industrial from urban.",
        ("annual_crop",  "permanent_crop"): "Annual crops show seasonal bare-soil patches; permanent crops stay green year-round.",
        ("permanent_crop","annual_crop"): "Permanent crop rows are tighter, uniform, and visible in all seasons.",
        ("sea_lake",     "water"):        "Sea/Lake tiles are large, uniform blue; smaller irregular water bodies are 'water' class.",
        ("water",        "sea_lake"):     "Narrow rivers and canals are 'water'; large open bodies with no shore → sea_lake.",
        ("pasture",      "annual_crop"):  "Pasture has smooth green texture without row patterns; crop rows are periodic and straight.",
        ("highway",      "urban"):        "Highway tiles show linear structures with no building density; urban has block patterns.",
    }

    sorted_pairs = sorted(confusion.items(), key=lambda x: -x[1])
    for pair_key, rate in sorted_pairs[:4]:
        # pair_key is like "forest_shrubland" — split on first underscore match
        parts = None
        for cls in ["annual_crop", "permanent_crop", "sea_lake"]:
            if pair_key.startswith(cls + "_"):
                parts = (cls, pair_key[len(cls) + 1:])
                break
        if not parts:
            idx = pair_key.find("_")
            if idx > 0:
                parts = (pair_key[:idx], pair_key[idx + 1:])

        if not parts:
            continue

        true_cls, pred_cls = parts
        rule = RULES.get((true_cls, pred_cls)) or (
            f"True class '{true_cls}' is being confused with '{pred_cls}' "
            f"({rate:.1%} error rate) — apply stricter spectral/texture checks."
        )
        node_id = f"h_{true_cls.replace('_','')[:4]}_{pred_cls.replace('_','')[:4]}_{batch_num:03d}"
        heuristics.append({
            "node_id": node_id,
            "type": "heuristic",
            "text": rule,
            "applies_to_confusion_pairs": [pair_key],
            "confidence_weight": round(max(0.3, 1.0 - rate * 2), 2),
            "times_applied": 0,
            "times_helped": 0,
            "batch_origin": batch_num,
        })

    return heuristics


# ── public API ────────────────────────────────────────────────────────────────

def create_session() -> dict:
    """
    Start a new SubStrata session.
    Real mode: creates an Antigravity interaction thread and stores the ID.
    Stub mode: creates a local session without API calls.
    """
    session_id = f"session_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"

    if _STUB_MODE:
        environment_id = f"stub_env_{session_id}"
    else:
        client = _get_client()
        interaction = client.interactions.create(
            agent=_AGENT,
            environment="remote",
            input=(
                f"You are the memory and state manager for SubStrata (session {session_id}), "
                "a self-improving land-cover classification system operating on EuroSAT satellite imagery. "
                "Your role is to accumulate error patterns across batches and synthesize actionable "
                "heuristics that improve classification accuracy in subsequent batches. "
                "The 10 land-cover classes are: forest, shrubland, water, urban, highway, "
                "annual_crop, permanent_crop, pasture, sea_lake, industrial. "
                "Session started. Acknowledge and stand by for batch results."
            ),
        )
        environment_id = interaction.id

    session = {
        "session_id": session_id,
        "antigravity_environment_id": environment_id,
        "current_batch_number": 0,
        "batches": [],
        "heuristics": [],
    }
    _save_local_session(session)
    return session


def save_batch(batch_summary: dict) -> dict:
    """
    Persist a completed batch.
    Real mode: sends results to Antigravity and asks it to synthesize heuristics
               from the full session history; stores the parsed heuristics.
    Stub mode: derives heuristics from confusion pairs locally.
    """
    session = _load_local_session()
    if session is None:
        raise RuntimeError("No active session — call create_session() first")

    batch_num = batch_summary["batch_number"]
    confusion = batch_summary.get("per_confusion_pair_error_rate", {})
    accuracy = batch_summary.get("overall_accuracy", 0)
    top_errors = sorted(confusion.items(), key=lambda x: -x[1])[:5]

    if _STUB_MODE:
        heuristics = _derive_stub_heuristics(batch_summary)
    else:
        client = _get_client()
        top_error_str = "\n".join(
            f"  - {pair}: {rate:.1%}" for pair, rate in top_errors
        ) or "  (none)"

        interaction = client.interactions.create(
            agent=_AGENT,
            previous_interaction_id=session["antigravity_environment_id"],
            input=(
                f"Batch {batch_num} complete.\n"
                f"Overall accuracy: {accuracy:.1%}\n"
                f"Tile count: {batch_summary.get('tile_count', 'unknown')}\n"
                f"Top confusion pairs (true_class_predicted_class: error rate):\n{top_error_str}\n\n"
                "Based on ALL batch results so far, synthesize 2-4 specific, actionable heuristics "
                "for improving the next batch's classification. Focus on the persistent confusion pairs. "
                "Format each heuristic exactly as:\n"
                "HEURISTIC: <snake_case_id> | <one-sentence rule referencing spectral or texture cues>\n\n"
                "Then confirm how many batches have been processed."
            ),
        )
        session["antigravity_environment_id"] = interaction.id
        heuristics = _parse_heuristics(getattr(interaction, "text", "") or "", batch_num)

    # Merge new heuristics into session (deduplicate by node_id)
    existing_ids = {h["node_id"] for h in session.get("heuristics", [])}
    for h in heuristics:
        if h["node_id"] not in existing_ids:
            session.setdefault("heuristics", []).append(h)
            existing_ids.add(h["node_id"])

    session["current_batch_number"] = batch_num
    session["batches"].append(batch_summary)
    _save_local_session(session)
    return session


def get_heuristics(batch_number: int, top_k: int = 5) -> list[dict]:
    """
    Retrieve the most relevant heuristics before classifying a batch.
    Real mode: asks Antigravity to rank heuristics for the upcoming batch.
    Stub mode: returns the heuristics accumulated in the local session so far.
    """
    session = _load_local_session()
    if not session:
        return []

    stored = session.get("heuristics", [])
    if not stored:
        return []

    if _STUB_MODE:
        # Return the most recently generated heuristics (from last batch)
        return sorted(stored, key=lambda h: h.get("batch_origin", 0), reverse=True)[:top_k]

    client = _get_client()
    stored_summary = "\n".join(
        f"  - {h['node_id']}: {h['text']}" for h in stored
    )
    interaction = client.interactions.create(
        agent=_AGENT,
        previous_interaction_id=session["antigravity_environment_id"],
        input=(
            f"We are about to classify batch {batch_number}. "
            f"Current accumulated heuristics:\n{stored_summary}\n\n"
            f"Which {top_k} heuristics are most relevant for the next batch, "
            "given the error history? Return them ranked by importance in the same "
            "HEURISTIC: <id> | <rule> format. Only return heuristics from the list above."
        ),
    )
    session["antigravity_environment_id"] = interaction.id
    _save_local_session(session)

    ranked = _parse_heuristics(getattr(interaction, "text", "") or "", batch_number)
    # Fall back to all stored if parsing yields nothing
    if not ranked:
        return stored[:top_k]

    # Resolve full heuristic dicts by matching node_id
    by_id = {h["node_id"]: h for h in stored}
    resolved = [by_id[h["node_id"]] for h in ranked if h["node_id"] in by_id]
    return (resolved or stored)[:top_k]


def load_session() -> dict | None:
    """Return the locally cached session, or None if no run has started."""
    return _load_local_session()


def clear_session() -> None:
    """Wipe local session state."""
    if _SESSION_FILE.exists():
        _SESSION_FILE.unlink()


# ── smoke test ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print(f"STUB_MODE={_STUB_MODE}")
    print("Creating session...")
    s = create_session()
    print(f"  session_id: {s['session_id']}")

    batch = {
        "batch_number": 1,
        "overall_accuracy": 0.60,
        "per_confusion_pair_error_rate": {
            "forest_shrubland": 0.15,
            "urban_industrial": 0.10,
            "annual_crop_permanent_crop": 0.08,
        },
        "active_heuristic_ids": [],
        "tile_count": 20,
    }
    print("Saving batch 1...")
    s = save_batch(batch)
    heuristics = s.get("heuristics", [])
    print(f"  heuristics generated: {len(heuristics)}")
    for h in heuristics:
        print(f"    [{h['node_id']}] {h['text'][:80]}")

    print("Retrieving heuristics for batch 2...")
    retrieved = get_heuristics(batch_number=2, top_k=3)
    print(f"  retrieved: {len(retrieved)}")
    for h in retrieved:
        print(f"    [{h['node_id']}] {h['text'][:80]}")
