"""
No-API real-image dataset for the SubStrata demo.

Uses the real EuroSAT satellite thumbnails bundled in frontend/public/tiles/ (10 classes,
~10 images each) — no Earth Engine, no network. EuroSAT folder names are mapped onto the
Dynamic World taxonomy the memory graph uses, and batches are sequenced to stage the is_a
transfer beat: teach trees↔shrub first, then hit a never-seen grass↔shrub.
"""

import json
from pathlib import Path

TILES_DIR = Path(__file__).parent / "frontend" / "public" / "tiles"

# EuroSAT thumbnail folder -> Dynamic World leaf class (the memory taxonomy)
EUROSAT_TO_DW = {
    "forest": "trees",
    "shrubland": "shrub_and_scrub",
    "pasture": "grass",
    "annual_crop": "crops",
    "permanent_crop": "crops",
    "highway": "built",
    "industrial": "built",
    "urban": "built",
    "sea_lake": "water",
    "water": "water",
}

# Which EuroSAT folders appear in each demo batch — staged for the is_a transfer beat.
_BATCH_PLAN = [
    ["forest", "shrubland"],                            # 1: teach trees ↔ shrub
    ["pasture", "shrubland"],                            # 2: NEVER-SEEN grass ↔ shrub (transfer)
    ["annual_crop", "permanent_crop", "shrubland"],     # 3: crops ↔ shrub
    ["forest", "shrubland", "pasture", "annual_crop", "urban", "water"],  # 4+: mixed breadth
]


def available() -> bool:
    return TILES_DIR.is_dir() and any(TILES_DIR.iterdir())


def _images(eurosat: str) -> list[Path]:
    d = TILES_DIR / eurosat
    if not d.is_dir():
        return []
    return sorted(p for p in d.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))


def ensure_labels() -> None:
    """Write a sidecar <img>.json holding the DW true_label next to each image (idempotent),
    so classifier._get_true_label returns the Dynamic World class, not the folder name."""
    for eurosat, dw in EUROSAT_TO_DW.items():
        for img in _images(eurosat):
            meta = img.with_suffix(".json")
            if not meta.exists():
                meta.write_text(json.dumps({"true_label": dw}))


def demo_batch(batch_number: int, batch_size: int) -> list[str]:
    """One diverse batch: a shuffled mix spanning ALL classes, rotating which images appear
    each batch so consecutive rounds see fresh tiles across the full land-cover spectrum."""
    import random
    ensure_labels()
    pool: list[str] = []
    for eurosat in EUROSAT_TO_DW:
        imgs = _images(eurosat)
        if not imgs:
            continue
        k = (batch_number - 1) % len(imgs)         # rotate the starting image per batch
        rotated = imgs[k:] + imgs[:k]
        pool.extend(str(p) for p in rotated)
    random.Random(batch_number).shuffle(pool)      # deterministic-but-varied per batch
    return pool[:batch_size]


def to_image_url(path: str) -> str | None:
    """Map a bundled tile disk path to the URL Next serves it at (.../public/tiles/x → /tiles/x)."""
    s = str(path).replace("\\", "/")
    i = s.find("/public/")
    return s[i + len("/public"):] if i >= 0 else None
