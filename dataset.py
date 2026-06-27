"""
Engineer 1 — dataset.py
Dynamic World → patch pipeline.

Fetches Sentinel-2 RGB + Dynamic World majority-vote labels for a region,
tiles into an N×N grid, caches locally as PNGs.

Usage:
    ds = DynamicWorldDataset()
    patches = ds.get_demo_batch(target_classes=["trees", "shrub_and_scrub", "grass"], n_per_class=10)
"""

import json
import os
import random
from pathlib import Path
from typing import Dict, List, Optional

import ee
import numpy as np
from PIL import Image

from config import (
    GCP_PROJECT,
    DEMO_GRID_SIZE,
    DEMO_REGION_BBOX,
    DEMO_SCALE_M,
    DW_LABEL_TO_CLASS,
    VEGETATION_CLUSTER,
)
from schemas import Patch

_SA_KEY = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")

CACHE_DIR = Path("data/patches")


class DynamicWorldDataset:
    def __init__(self, cache_dir: Path = CACHE_DIR):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._ee_ready = False

    def _init_ee(self):
        if not self._ee_ready:
            try:
                from config import get_credentials
                ee.Initialize(credentials=get_credentials(), project=GCP_PROJECT)
                self._ee_ready = True
            except Exception as e:
                print(f"[dataset] GEE unavailable ({e}). Using synthetic fallback.")
                raise

    # ------------------------------------------------------------------
    # Core scene fetch
    # ------------------------------------------------------------------

    def fetch_scene(
        self,
        region_bbox: Optional[List[float]] = None,
        scene_id: str = "demo",
        grid_size: Optional[int] = None,
        date_start: str = "2023-06-01",
        date_end: str = "2023-09-01",
    ) -> List[Patch]:
        """
        Tile a region into grid_size×grid_size patches.
        Each patch: S2 RGB saved as PNG, majority-vote DW label.
        Results are cached; re-runs are instant.
        """
        bbox = region_bbox or DEMO_REGION_BBOX
        n = grid_size or DEMO_GRID_SIZE
        self._init_ee()

        west, south, east, north = bbox
        lat_step = (north - south) / n
        lon_step = (east - west) / n
        geom = ee.Geometry.Rectangle(bbox)

        # Dynamic World mode composite over date range
        dw_label = (
            ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
            .filterBounds(geom)
            .filterDate(date_start, date_end)
            .select("label")
            .mode()
        )

        # Sentinel-2 SR median composite. Visualization range [0, 0.3] matches
        # GEE's default S2 True Color display (reflectance, not DN).
        s2_rgb = (
            ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
            .filterBounds(geom)
            .filterDate(date_start, date_end)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
            .select(["B4", "B3", "B2"])
            .median()
            .divide(10000)
            .clamp(0, 0.3)
        )
        PATCH_PX = 64  # output image size sent to Gemini

        patches: List[Patch] = []

        for row in range(n):
            for col in range(n):
                patch_id = f"{scene_id}_r{row:02d}c{col:02d}"
                img_path = self.cache_dir / f"{patch_id}.png"
                meta_path = self.cache_dir / f"{patch_id}.json"

                # Cache hit
                if img_path.exists() and meta_path.exists():
                    with open(meta_path) as f:
                        meta = json.load(f)
                    patches.append(Patch(
                        patch_id=patch_id, scene_id=scene_id,
                        grid_row=row, grid_col=col,
                        patch_bbox=meta["patch_bbox"],
                        image_path=str(img_path),
                        true_label=meta["true_label"],
                    ))
                    continue

                patch_bbox = [
                    west + col * lon_step,
                    south + row * lat_step,
                    west + (col + 1) * lon_step,
                    south + (row + 1) * lat_step,
                ]
                patch_geom = ee.Geometry.Rectangle(patch_bbox)

                # Majority-vote label
                label_result = dw_label.reduceRegion(
                    reducer=ee.Reducer.mode(),
                    geometry=patch_geom,
                    scale=DEMO_SCALE_M,
                    maxPixels=1e6,
                ).getInfo()
                label_int = int(label_result.get("label") or 6)
                true_label = DW_LABEL_TO_CLASS.get(label_int, "built")

                # Use computePixels for an exact PATCH_PX×PATCH_PX output.
                # Values are in [0, 0.3] (clamped above); scale to [0, 255].
                px_w = lon_step / PATCH_PX
                px_h = lat_step / PATCH_PX
                pixels = ee.data.computePixels({
                    "expression": s2_rgb,
                    "fileFormat": "NUMPY_NDARRAY",
                    "grid": {
                        "dimensions": {"width": PATCH_PX, "height": PATCH_PX},
                        "affineTransform": {
                            "scaleX": px_w, "shearX": 0, "translateX": patch_bbox[0],
                            "shearY": 0, "scaleY": -px_h, "translateY": patch_bbox[3],
                        },
                        "crsCode": "EPSG:4326",
                    },
                })
                r = np.array(pixels["B4"], dtype=np.float32)
                g = np.array(pixels["B3"], dtype=np.float32)
                b = np.array(pixels["B2"], dtype=np.float32)
                rgb = np.stack([r, g, b], axis=-1)
                rgb = (rgb / 0.3 * 255).clip(0, 255).astype(np.uint8)

                Image.fromarray(rgb).save(img_path)
                with open(meta_path, "w") as f:
                    json.dump({"true_label": true_label, "patch_bbox": patch_bbox}, f)

                patches.append(Patch(
                    patch_id=patch_id, scene_id=scene_id,
                    grid_row=row, grid_col=col,
                    patch_bbox=patch_bbox,
                    image_path=str(img_path),
                    true_label=true_label,
                ))

        return patches

    # ------------------------------------------------------------------
    # Batch helpers for the demo
    # ------------------------------------------------------------------

    def get_demo_batch(
        self,
        target_classes: Optional[List[str]] = None,
        n_per_class: int = 10,
        split: str = "train",
        seed: int = 42,
        **fetch_kwargs,
    ) -> List[Patch]:
        """
        Return a balanced batch filtered to target_classes.
        split='train' uses first 80% of each class; split='test' uses last 20%.
        """
        classes = target_classes or VEGETATION_CLUSTER
        all_patches = self.fetch_scene(**fetch_kwargs)

        by_class: Dict[str, List[Patch]] = {c: [] for c in classes}
        for p in all_patches:
            if p.true_label in by_class:
                by_class[p.true_label].append(p)

        rng = random.Random(seed)
        result: List[Patch] = []

        for cls, ps in by_class.items():
            rng.shuffle(ps)
            cutoff = int(len(ps) * 0.8)
            pool = ps[:cutoff] if split == "train" else ps[cutoff:]
            result.extend(pool[:n_per_class])

        rng.shuffle(result)
        return result

    def get_held_out_batch(
        self,
        target_classes: Optional[List[str]] = None,
        n_per_class: int = 10,
        **fetch_kwargs,
    ) -> List[Patch]:
        """Convenience: held-out test split for the before/after demo."""
        return self.get_demo_batch(
            target_classes=target_classes,
            n_per_class=n_per_class,
            split="test",
            **fetch_kwargs,
        )
