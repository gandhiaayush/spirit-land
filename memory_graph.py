"""
Engineer 2's module — Memory & Graph Structure.

These stubs define the interface that orchestrator.py calls.
Replace each function body with the real networkx + Gemini embeddings implementation.
"""


def get_relevant_heuristics(batch_context: str, top_k: int = 5) -> list[dict]:
    """
    Retrieve the most relevant heuristics for an upcoming batch.

    Args:
        batch_context: A short text description of the current batch context
                       (e.g. class distribution, tile metadata). Used to embed
                       and query the graph by similarity.
        top_k:         Maximum number of heuristics to return.

    Returns:
        List of Heuristic node dicts (subset of graph node schema in README.md):
        [
          {
            "node_id": str,
            "type": "heuristic",
            "text": str,                           # plain-language rule
            "applies_to_confusion_pairs": [...],
            "embedding": [float, ...],
            "confidence_weight": float,
            "times_applied": int,
            "times_helped": int,
          },
          ...
        ]
    """
    raise NotImplementedError("Engineer 2: implement get_relevant_heuristics()")


def update_graph(predictions: list[dict]) -> list[str]:
    """
    Analyze a completed batch's predictions, extract error patterns, derive
    new heuristics, and write them into the memory graph.

    Args:
        predictions: Output of classifier.classify_batch() — list of Prediction Records.

    Returns:
        List of newly created Heuristic node_ids (strings).
        Empty list if no new heuristics were generated this batch.
    """
    raise NotImplementedError("Engineer 2: implement update_graph()")
