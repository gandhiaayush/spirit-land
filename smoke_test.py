"""
Engineer 1 smoke test — uses real GEE data if available, synthetic fallback otherwise.

Run with:
  GEMINI_API_KEY=<key> python3 smoke_test.py
"""

import classifier
from classifier import GemmaSummarizer, score_batch

try:
    from dataset import DynamicWorldDataset
    ds = DynamicWorldDataset()
    patches = ds.get_demo_batch(
        target_classes=["trees", "shrub_and_scrub", "grass"],
        n_per_class=3,
        split="train",
    )
    tile_paths = [p.image_path for p in patches]
    print(f"Using real Dynamic World data. ({len(patches)} patches)")
except Exception:
    from dataset_fallback import get_demo_batch
    patches = get_demo_batch(
        target_classes=["trees", "shrub_and_scrub", "grass"],
        n_per_class=3,
        split="train",
    )
    tile_paths = [p.image_path for p in patches]
    print(f"Using synthetic fallback data. ({len(patches)} patches)")

print(f"Labels: {[p.true_label for p in patches]}\n")

summarizer = GemmaSummarizer()
print("Gemma summary (patch 0):")
print(summarizer.summarize(tile_paths[0]), "\n")

print("--- Baseline (no heuristics) ---")
preds = classifier.classify_batch(tile_paths, heuristics=[])
result = score_batch(preds)
print(f"Accuracy: {result['overall_accuracy']:.1%}")
print(f"Confusions: {result['per_confusion_pair_error_rate']}\n")

demo_heuristics = [
    {"node_id": "h1", "text": "Trees have tall canopy (>5m), rough irregular texture, dark green, >70% cover."},
    {"node_id": "h2", "text": "Shrub and scrub has low-medium canopy (1-5m), medium texture, 40-80% lighter green cover."},
    {"node_id": "h3", "text": "Grass is near-zero canopy, smooth texture, 20-70% bright green, very regular edges."},
]

print("--- With heuristics ---")
preds2 = classifier.classify_batch(tile_paths, heuristics=demo_heuristics)
result2 = score_batch(preds2)
print(f"Accuracy: {result2['overall_accuracy']:.1%}")
print(f"Confusions: {result2['per_confusion_pair_error_rate']}\n")

delta = result2["overall_accuracy"] - result["overall_accuracy"]
print(f"Accuracy delta: {delta:+.1%}")
