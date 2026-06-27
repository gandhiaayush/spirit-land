"""
Engineer 1's module — Perception & Evaluation.

These stubs define the interface that orchestrator.py calls.
Replace each function body with the real Gemini multimodal implementation.
"""


def classify_batch(tile_paths: list[str], heuristics: list[dict]) -> list[dict]:
    """
    Classify a list of EuroSAT tile image paths.

    Args:
        tile_paths: Absolute or relative paths to satellite image tiles.
        heuristics: List of Heuristic node dicts retrieved from the memory graph.
                    Inject these as context into the Gemini prompt so past learnings
                    guide the current classification.

    Returns:
        List of Prediction Records matching the schema in README.md:
        [
          {
            "tile_id": str,
            "batch_id": str,
            "true_label": str,          # from EuroSAT filename / ground truth
            "predicted_label": str,     # Gemini's answer
            "confidence": float,
            "correct": bool,
            "model_reasoning": str,
            "retrieved_heuristic_ids": [str, ...],
            "timestamp": ISO8601 str,
          },
          ...
        ]
    """
    raise NotImplementedError("Engineer 1: implement classify_batch()")


def score_batch(predictions: list[dict]) -> dict:
    """
    Score a completed batch of predictions against ground truth.

    Args:
        predictions: Output of classify_batch().

    Returns:
        {
          "overall_accuracy": float,                         # fraction correct
          "per_confusion_pair_error_rate": {                 # e.g. "shrubland_forest": 0.12
            "<true>_<predicted>": float,
            ...
          }
        }
    """
    raise NotImplementedError("Engineer 1: implement score_batch()")
