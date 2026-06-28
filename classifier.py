"""
Engineer 1 — classifier.py
Perception & Evaluation: Gemini 3.5 Flash multimodal classification + Gemma summarizer + scoring.

Module-level interface (called by orchestrator.py):
    classify_batch(tile_paths, heuristics) -> list[dict]
    score_batch(predictions)              -> dict
    gemma_summarize(tile_path)            -> str   (Engineer 3 calls on retrieval path)

Internal classes (ClassifierAgent, GemmaSummarizer) back the module functions.
"""

import json
import re
import time
import warnings
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import PIL.Image
from google import genai

from config import GEMINI_API_KEY, GEMINI_MODEL, GEMMA_MODEL, DW_CLASSES, GCP_PROJECT, GCP_LOCATION

warnings.filterwarnings("ignore", message=".*thought_signature.*")

_client = genai.Client(vertexai=True, project=GCP_PROJECT, location="global")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_true_label(tile_path: str) -> str:
    """Derive ground-truth label from path. Supports DW cached patches and EuroSAT structure."""
    meta = Path(tile_path).with_suffix(".json")
    if meta.exists():
        with open(meta) as f:
            return json.load(f).get("true_label", "unknown")
    # EuroSAT: parent directory name is the class
    return Path(tile_path).parent.name.lower().replace(" ", "_")


# ---------------------------------------------------------------------------
# Gemma Summarizer — discriminative-feature retrieval key
# Called by Engineer 3 before heuristic retrieval.
# ---------------------------------------------------------------------------

_GEMMA_PROMPT = (
    "You are a remote-sensing feature extractor. "
    "Describe this satellite image patch using ONLY these discriminative features: "
    "canopy height (none/low/medium/tall), texture coarseness (smooth/medium/rough), "
    "vegetation fraction (0-100%), edge regularity (regular/irregular). "
    "Respond in exactly this format:\n"
    "canopy_height: <value>\n"
    "texture: <value>\n"
    "vegetation_pct: <value>\n"
    "edge_regularity: <value>\n"
    "summary: <one sentence>\n"
    "No other text."
)


class GemmaSummarizer:
    def summarize(self, image_path: str) -> str:
        img = PIL.Image.open(image_path).convert("RGB")
        response = _client.models.generate_content(
            model=GEMMA_MODEL,
            contents=[img, _GEMMA_PROMPT],
        )
        return response.text.strip()


def gemma_summarize(tile_path: str) -> str:
    """Module-level convenience — Engineer 3 calls this on the retrieval path."""
    return GemmaSummarizer().summarize(tile_path)


# ---------------------------------------------------------------------------
# Classifier Agent — Gemini 3.5 Flash multimodal with heuristic injection
# ---------------------------------------------------------------------------

_CLASSES_STR = "\n".join("  - " + c for c in DW_CLASSES)

_BASE_PROMPT = (
    "You are classifying an aerial satellite patch into exactly one land-cover class.\n\n"
    "Classes:\n" + _CLASSES_STR + "\n\n"
    "Respond in this exact format (no other text):\n"
    "LABEL: <class_name>\n"
    "CONFIDENCE: <0.00-1.00>\n"
    "REASONING: <one sentence citing the key visual evidence>\n"
)


def _build_prompt(heuristics: List[str]) -> str:
    if not heuristics:
        return _BASE_PROMPT
    rules = "\n".join("  - " + h for h in heuristics)
    return (
        _BASE_PROMPT
        + f"\nApply these classification heuristics before deciding:\n{rules}\n"
    )


def _parse(text: str):
    label, confidence, reasoning = "built", 0.5, ""
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("LABEL:"):
            raw = line.split(":", 1)[1].strip().lower().replace(" ", "_")
            label = (
                raw
                if raw in DW_CLASSES
                else next((c for c in DW_CLASSES if c in raw), raw)
            )
        elif line.startswith("CONFIDENCE:"):
            try:
                confidence = float(re.search(r"[\d.]+", line.split(":", 1)[1]).group())
            except (AttributeError, ValueError):
                pass
        elif line.startswith("REASONING:"):
            reasoning = line.split(":", 1)[1].strip()
    return label, confidence, reasoning


class ClassifierAgent:
    def classify_one(
        self,
        tile_path: str,
        heuristics: Optional[List[str]] = None,
        retrieved_heuristic_ids: Optional[List[str]] = None,
        batch_id: str = "",
    ) -> dict:
        prompt = _build_prompt(heuristics or [])
        img = PIL.Image.open(tile_path).convert("RGB")
        for attempt in range(3):
            try:
                response = _client.models.generate_content(
                    model=GEMINI_MODEL,
                    contents=[img, prompt],
                )
                break
            except Exception as e:
                if attempt == 2:
                    raise
                time.sleep(10 * (attempt + 1))
        predicted_label, confidence, reasoning = _parse(response.text)
        true_label = _get_true_label(tile_path)
        return {
            "tile_id": Path(tile_path).stem,
            "batch_id": batch_id,
            "true_label": true_label,
            "predicted_label": predicted_label,
            "confidence": confidence,
            "correct": predicted_label == true_label,
            "model_reasoning": reasoning,
            "retrieved_heuristic_ids": retrieved_heuristic_ids or [],
            "timestamp": _now(),
        }


# ---------------------------------------------------------------------------
# Module-level interface — called directly by orchestrator.py
# ---------------------------------------------------------------------------


def classify_batch(tile_paths: List[str], heuristics: List[dict]) -> List[dict]:
    """
    Classify a list of satellite tile image paths.

    heuristics: list of Heuristic node dicts from memory_graph.get_relevant_heuristics().
                Each dict must have a 'text' key with the plain-English rule.
    Returns:    list of Prediction Record dicts (see README schema).
    """
    heuristic_texts = [h["text"] for h in heuristics if h.get("text")]
    heuristic_ids = [h["node_id"] for h in heuristics if h.get("node_id")]

    agent = ClassifierAgent()
    return [
        agent.classify_one(
            path,
            heuristics=heuristic_texts,
            retrieved_heuristic_ids=heuristic_ids,
        )
        for path in tile_paths
    ]


def score_batch(predictions: List[dict]) -> dict:
    """
    Score a completed batch of prediction dicts against their embedded ground truth.

    Returns:
        {
          "overall_accuracy": float,
          "per_confusion_pair_error_rate": {"<true>_<predicted>": float, ...}
        }
    """
    total = len(predictions)
    if total == 0:
        return {"overall_accuracy": 0.0, "per_confusion_pair_error_rate": {}}

    correct = sum(1 for p in predictions if p["correct"])
    confusion: Counter = Counter()

    for p in predictions:
        if not p["correct"]:
            key = f"{p['true_label']}_{p['predicted_label']}"
            confusion[key] += 1

    return {
        "overall_accuracy": correct / total,
        "per_confusion_pair_error_rate": {
            k: round(v / total, 4) for k, v in confusion.most_common()
        },
    }
