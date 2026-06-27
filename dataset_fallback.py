"""
Fallback dataset — no Earth Engine required.
Generates synthetic Sentinel-2-like RGB patches with realistic
color distributions for each Dynamic World vegetation class.
Gemini will genuinely confuse trees/shrub/grass on these (same as real data).

Used automatically by dataset.py when GEE auth fails.
"""

import json
import random
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from PIL import Image

from schemas import Patch

CACHE_DIR = Path("data/patches_fallback")

# Realistic per-class RGB statistics (approx. Sentinel-2 band 4/3/2 after normalisation)
# Format: mean_rgb (0-255), std, texture_scale
CLASS_PROFILES = {
    "trees": {
        "mean": (34, 68, 30), "std": 18,
        "texture": "rough", "freq": 0.08,
    },
    "shrub_and_scrub": {
        "mean": (65, 95, 45), "std": 22,
        "texture": "medium", "freq": 0.12,
    },
    "grass": {
        "mean": (100, 140, 60), "std": 15,
        "texture": "smooth", "freq": 0.18,
    },
    "crops": {
        "mean": (130, 150, 80), "std": 25,
        "texture": "regular", "freq": 0.10,
    },
    "flooded_vegetation": {
        "mean": (40, 90, 90), "std": 20,
        "texture": "medium", "freq": 0.06,
    },
    "built": {
        "mean": (160, 155, 150), "std": 30,
        "texture": "regular", "freq": 0.06,
    },
    "bare": {
        "mean": (180, 165, 130), "std": 20,
        "texture": "smooth", "freq": 0.08,
    },
    "water": {
        "mean": (30, 50, 110), "std": 10,
        "texture": "smooth", "freq": 0.04,
    },
    "snow_and_ice": {
        "mean": (230, 235, 240), "std": 8,
        "texture": "smooth", "freq": 0.02,
    },
}

IMG_SIZE = 64  # pixels per patch side


def _make_patch_image(class_name: str, seed: int) -> np.ndarray:
    rng = np.random.RandomState(seed)
    profile = CLASS_PROFILES[class_name]
    mr, mg, mb = profile["mean"]
    std = profile["std"]
    freq = profile["freq"]

    # Base colour noise
    r = np.clip(rng.normal(mr, std, (IMG_SIZE, IMG_SIZE)), 0, 255)
    g = np.clip(rng.normal(mg, std, (IMG_SIZE, IMG_SIZE)), 0, 255)
    b = np.clip(rng.normal(mb, std, (IMG_SIZE, IMG_SIZE)), 0, 255)

    # Spatial texture via low-frequency cosine waves
    x = np.linspace(0, 1, IMG_SIZE)
    y = np.linspace(0, 1, IMG_SIZE)
    xx, yy = np.meshgrid(x, y)

    n_waves = {"rough": 6, "medium": 3, "smooth": 1, "regular": 4}[profile["texture"]]
    for _ in range(n_waves):
        phase_x = rng.uniform(0, 2 * np.pi)
        phase_y = rng.uniform(0, 2 * np.pi)
        amp = rng.uniform(10, 30)
        wave_freq = freq * rng.uniform(5, 20)
        wave = amp * np.sin(wave_freq * xx + phase_x) * np.sin(wave_freq * yy + phase_y)
        r += wave * 0.5
        g += wave
        b += wave * 0.3

    # Clamp and stack
    rgb = np.stack([
        np.clip(r, 0, 255).astype(np.uint8),
        np.clip(g, 0, 255).astype(np.uint8),
        np.clip(b, 0, 255).astype(np.uint8),
    ], axis=-1)
    return rgb


def generate_synthetic_scene(
    scene_id: str = "synthetic",
    grid_size: int = 8,
    target_classes: Optional[List[str]] = None,
    seed: int = 42,
    cache_dir: Path = CACHE_DIR,
) -> List[Patch]:
    """
    Generate a synthetic N×N scene with patches drawn from target_classes.
    Cached on first call; instant on re-runs.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    classes = target_classes or ["trees", "shrub_and_scrub", "grass", "crops"]
    rng = random.Random(seed)

    patches: List[Patch] = []
    patch_idx = 0

    for row in range(grid_size):
        for col in range(grid_size):
            true_label = rng.choice(classes)
            patch_id = f"{scene_id}_r{row:02d}c{col:02d}"
            img_path = cache_dir / f"{patch_id}.png"
            meta_path = cache_dir / f"{patch_id}.json"

            if not img_path.exists():
                arr = _make_patch_image(true_label, seed=seed * 1000 + patch_idx)
                Image.fromarray(arr).save(img_path)
                with open(meta_path, "w") as f:
                    json.dump({"true_label": true_label}, f)
            else:
                with open(meta_path) as f:
                    true_label = json.load(f)["true_label"]

            # Fake bbox centred on demo region
            patches.append(Patch(
                patch_id=patch_id,
                scene_id=scene_id,
                grid_row=row,
                grid_col=col,
                patch_bbox=[-122.0 + col * 0.1, 37.2 + row * 0.1,
                            -121.9 + col * 0.1, 37.3 + row * 0.1],
                image_path=str(img_path),
                true_label=true_label,
            ))
            patch_idx += 1

    return patches


def get_demo_batch(
    target_classes: Optional[List[str]] = None,
    n_per_class: int = 10,
    split: str = "train",
    seed: int = 42,
) -> List[Patch]:
    """Same interface as DynamicWorldDataset.get_demo_batch — drop-in replacement."""
    classes = target_classes or ["trees", "shrub_and_scrub", "grass", "crops"]

    all_patches = generate_synthetic_scene(
        scene_id=f"synthetic_{split}",
        grid_size=10,
        target_classes=classes,
        seed=seed if split == "train" else seed + 99,
    )

    by_class: Dict[str, List[Patch]] = {c: [] for c in classes}
    for p in all_patches:
        if p.true_label in by_class:
            by_class[p.true_label].append(p)

    result: List[Patch] = []
    for ps in by_class.values():
        result.extend(ps[:n_per_class])

    random.Random(seed).shuffle(result)
    return result
