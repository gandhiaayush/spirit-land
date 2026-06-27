"""
SubStrata main orchestration loop.

Drives the self-improving classification pipeline:
  for each batch:
    1. retrieve relevant heuristics from graph memory (E2)
    2. classify tiles with heuristic context injected   (E1)
    3. score predictions against ground truth           (E1)
    4. update graph with new error patterns/heuristics  (E2)
    5. persist batch results to Antigravity session     (E3 — this file)
    6. broadcast batch summary to SSE subscribers       (E3 — this file)

When E1/E2 modules are not yet available, the STUB_MODE flag uses local
dummy implementations so the orchestration loop can be developed independently.
"""

import asyncio
import json
import os
from pathlib import Path
from typing import AsyncGenerator

import persistence

# ── toggle stub mode until E1/E2 are ready ───────────────────────────────────
STUB_MODE = os.environ.get("SUBSTRATA_STUB_MODE", "true").lower() == "true"

# ── SSE subscriber queues (filled by run_loop, drained by api.py) ─────────────
_subscribers: list[asyncio.Queue] = []


def add_subscriber(q: asyncio.Queue) -> None:
    _subscribers.append(q)


def remove_subscriber(q: asyncio.Queue) -> None:
    _subscribers.remove(q)


async def _broadcast(event: dict) -> None:
    for q in list(_subscribers):
        await q.put(event)


# ── stub implementations (replaced by real imports when E1/E2 are ready) ──────

def _stub_get_relevant_heuristics(batch_context: str, top_k: int = 5) -> list[dict]:
    # Intentionally left empty — persistence.get_heuristics() is always used instead
    return []


def _stub_classify_batch(tile_paths: list[str], heuristics: list[dict]) -> list[dict]:
    import random
    labels = ["forest", "shrubland", "water", "urban", "highway", "annual_crop",
              "permanent_crop", "pasture", "sea_lake", "industrial"]
    # How many images exist per class (10 downloaded)
    _N_IMAGES = 10
    predictions = []
    for i, path in enumerate(tile_paths):
        true_label = random.choice(labels)
        predicted_label = random.choice(labels) if random.random() > 0.6 else true_label
        img_idx = (i + random.randint(0, _N_IMAGES - 1)) % _N_IMAGES
        predictions.append({
            "tile_id": Path(path).stem,
            "batch_id": "stub",
            "true_label": true_label,
            "predicted_label": predicted_label,
            "confidence": round(random.uniform(0.5, 0.99), 3),
            "correct": true_label == predicted_label,
            "model_reasoning": "stub classification",
            "retrieved_heuristic_ids": [h["node_id"] for h in heuristics],
            "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
            "image_url": f"/tiles/{true_label}/{img_idx:03d}.jpg",
        })
    return predictions


def _stub_score_batch(predictions: list[dict]) -> dict:
    total = len(predictions)
    correct = sum(1 for p in predictions if p["correct"])
    confusion: dict[str, int] = {}
    for p in predictions:
        if not p["correct"]:
            key = f"{p['true_label']}_{p['predicted_label']}"
            confusion[key] = confusion.get(key, 0) + 1
    return {
        "overall_accuracy": correct / total if total else 0.0,
        "per_confusion_pair_error_rate": {
            k: round(v / total, 4) for k, v in confusion.items()
        },
    }


def _stub_update_graph(predictions: list[dict]) -> list[str]:
    return []


# ── real imports (used when STUB_MODE is False) ───────────────────────────────

def _import_e1():
    import classifier  # type: ignore
    return classifier.classify_batch, classifier.score_batch


def _import_e2():
    import memory_graph  # type: ignore
    return memory_graph.get_relevant_heuristics, memory_graph.update_graph


# ── tile loader (replace with real EuroSAT dataset path) ─────────────────────

def _load_tile_paths(batch_size: int, batch_number: int, dataset_dir: str) -> list[str]:
    dataset_path = Path(dataset_dir)
    if not dataset_path.exists() or STUB_MODE:
        # Return fake paths in stub mode
        return [f"tile_{batch_number}_{i:03d}.tif" for i in range(batch_size)]
    all_tiles = sorted(dataset_path.rglob("*.jpg")) + sorted(dataset_path.rglob("*.tif"))
    start = (batch_number - 1) * batch_size
    return [str(p) for p in all_tiles[start: start + batch_size]]


# ── main loop ─────────────────────────────────────────────────────────────────

async def run_loop(
    num_batches: int = 5,
    batch_size: int = 20,
    dataset_dir: str = "data/eurosat",
) -> None:
    """
    Run the full SubStrata loop for num_batches batches.
    Broadcasts SSE events after each batch so the frontend can update live.
    """
    if STUB_MODE:
        classify_batch = _stub_classify_batch
        score_batch = _stub_score_batch
        get_relevant_heuristics = _stub_get_relevant_heuristics
        update_graph = _stub_update_graph
    else:
        classify_batch, score_batch = _import_e1()
        get_relevant_heuristics, update_graph = _import_e2()

    # Start (or resume) a session
    session = persistence.load_session()
    if session is None:
        session = persistence.create_session()
        await _broadcast({"type": "session_created", "session": session})
    else:
        await _broadcast({"type": "session_resumed", "session": session})

    start_batch = session["current_batch_number"] + 1

    for batch_num in range(start_batch, start_batch + num_batches):
        await _broadcast({"type": "batch_start", "batch_number": batch_num})

        # 1. Retrieve relevant heuristics — Antigravity is the source of truth (E3).
        #    When E2's memory_graph is ready, merge its results here alongside these.
        await _broadcast({"type": "step", "step": "retrieving", "batch_number": batch_num})
        heuristics = persistence.get_heuristics(batch_number=batch_num, top_k=5)

        # 2. Classify tiles
        await _broadcast({"type": "step", "step": "classifying", "batch_number": batch_num})
        tile_paths = _load_tile_paths(batch_size, batch_num, dataset_dir)
        predictions = classify_batch(tile_paths, heuristics)

        # Emit per-tile events for live frontend display
        for i, pred in enumerate(predictions):
            await _broadcast({
                "type": "tile_classified",
                "tile": pred,
                "batch_number": batch_num,
                "tile_index": i,
                "total_tiles": len(predictions),
            })
            if STUB_MODE:
                await asyncio.sleep(0.18)  # stagger so tiles appear one-by-one

        # 3. Score against ground truth
        await _broadcast({"type": "step", "step": "scoring", "batch_number": batch_num})
        scores = score_batch(predictions)

        # 4. Update graph with new error patterns / heuristics
        await _broadcast({"type": "step", "step": "extracting", "batch_number": batch_num})
        new_heuristic_ids = update_graph(predictions)

        # 5. Build batch summary (matches Session/Run Record schema)
        await _broadcast({"type": "step", "step": "storing", "batch_number": batch_num})
        # active_ids: heuristics used this batch (from Antigravity) + any new ones from E2's graph
        active_ids = [h["node_id"] for h in heuristics] + new_heuristic_ids
        batch_summary = {
            "batch_number": batch_num,
            "overall_accuracy": scores["overall_accuracy"],
            "per_confusion_pair_error_rate": scores["per_confusion_pair_error_rate"],
            "active_heuristic_ids": active_ids,
            "tile_count": len(tile_paths),
        }

        # 6. Persist to Antigravity
        session = persistence.save_batch(batch_summary)

        # 7. Broadcast to SSE subscribers
        await _broadcast({"type": "batch_complete", "batch": batch_summary, "session": session})

        # small yield so FastAPI can flush SSE events
        await asyncio.sleep(0)

    await _broadcast({"type": "run_complete", "session": session})


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run SubStrata classification loop")
    parser.add_argument("--batches", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--dataset-dir", default="data/eurosat")
    args = parser.parse_args()

    print(f"STUB_MODE={STUB_MODE}")
    asyncio.run(run_loop(args.batches, args.batch_size, args.dataset_dir))
