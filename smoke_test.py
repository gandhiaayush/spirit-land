"""
Engineer 1 smoke test.
Tries GEE first; falls back to synthetic data automatically.

With GEE:
  export GCP_PROJECT=<your-project-id>
  gcloud auth application-default login

Without GEE: just run it — synthetic fallback kicks in.
"""

from classifier import ClassifierAgent, GemmaSummarizer, score_batch

# Try real GEE, fall back to synthetic
try:
    from dataset import DynamicWorldDataset
    ds = DynamicWorldDataset()
    patches = ds.get_demo_batch(
        target_classes=["trees", "shrub_and_scrub", "grass"],
        n_per_class=3,
        split="train",
    )
    print("Using real Dynamic World data.")
except Exception:
    from dataset_fallback import get_demo_batch
    patches = get_demo_batch(
        target_classes=["trees", "shrub_and_scrub", "grass"],
        n_per_class=3,
        split="train",
    )
    print("Using synthetic fallback data.")

print(f"Patches: {[p.true_label for p in patches]}\n")

summarizer = GemmaSummarizer()
print("Gemma summary for patch 0:")
print(summarizer.summarize(patches[0].image_path), "\n")

agent = ClassifierAgent()

print("--- Baseline (no heuristics) ---")
records = agent.classify_batch(patches, batch_id="baseline")
result = score_batch(records, batch_id="baseline")
print(result.summary())

heuristics = [
    "Trees have tall canopy (>5m), rough irregular texture, and >70% dark green cover.",
    "Shrub and scrub has low-medium canopy (1–5m), medium texture, 40–80% medium-green cover.",
    "Grass is near-zero canopy, smooth texture, 20–70% bright-green cover with very regular edges.",
]

print("\n--- With heuristics ---")
records2 = agent.classify_batch(patches, heuristics=heuristics, batch_id="with_heuristics")
result2 = score_batch(records2, batch_id="with_heuristics")
print(result2.summary())

print(f"\nAccuracy delta: {result2.accuracy - result.accuracy:+.1%}")
print("\nConfusion pairs (for Engineer 2):")
for cp in result.confusion_pairs:
    print(f"  {cp}")
