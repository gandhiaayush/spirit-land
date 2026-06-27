"""
Shared data schemas — matches the README spec exactly.
All three engineers import from here; do not duplicate field definitions.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Patch:
    """A single tile from a tiled satellite scene."""
    patch_id: str
    scene_id: str
    grid_row: int
    grid_col: int
    patch_bbox: List[float]   # [west, south, east, north] in WGS-84
    image_path: str            # local path to RGB PNG
    true_label: str            # majority-vote DW class


@dataclass
class PredictionRecord:
    """One classified patch — the atomic unit flowing through the loop."""
    patch_id: str
    scene_id: str
    grid_row: int
    grid_col: int
    patch_bbox: list[float]
    batch_id: str
    true_label: str
    predicted_label: str
    confidence: float
    correct: bool
    model_reasoning: str
    retrieved_heuristic_ids: List[str] = field(default_factory=list)
    timestamp: str = field(default_factory=_now)

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class ConfusionPair:
    true_class: str
    predicted_class: str
    count: int

    def key(self) -> str:
        return f"{self.true_class}_{self.predicted_class}"


@dataclass
class ScoringResult:
    """Output of score_batch — consumed by Engineer 2 for heuristic extraction."""
    batch_id: str
    total: int
    correct: int
    accuracy: float
    error_rate: float
    confusion_pairs: List[ConfusionPair]       # sorted by frequency, errors only
    per_class_accuracy: Dict[str, float]
    prediction_records: List[PredictionRecord]  # full records for persistence

    def top_confusion_pairs(self, n: int = 5) -> List[ConfusionPair]:
        return self.confusion_pairs[:n]

    def summary(self) -> str:
        lines = [
            f"Batch [{self.batch_id}]  accuracy={self.accuracy:.1%}  ({self.correct}/{self.total})",
        ]
        if self.confusion_pairs:
            lines.append("Top confusions:")
            for cp in self.top_confusion_pairs(5):
                lines.append(f"  {cp.true_class} → {cp.predicted_class}  (n={cp.count})")
        return "\n".join(lines)
