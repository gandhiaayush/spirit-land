"use client";

import { useMemo } from "react";
import type { TileRecord } from "@/types";

// ── Dynamic World palette ───────────────────────────────────────────────────
const DW_PALETTE: Record<string, string> = {
  water:              "#419BDF",
  trees:              "#397D49",
  grass:              "#88B053",
  flooded_vegetation: "#7A87C6",
  crops:              "#E49635",
  shrub_and_scrub:    "#DFC35A",
  built:              "#C4281B",
  bare:               "#A59B8F",
  snow_and_ice:       "#B39FE1",
};
const DW_CLASSES = Object.keys(DW_PALETTE);
const FALLBACK_COLOR = "#94a3b8";

function colorFor(label: string): string {
  return DW_PALETTE[label] ?? FALLBACK_COLOR;
}
function labelText(label: string): string {
  return label.replace(/_/g, " ");
}

// ── Component ────────────────────────────────────────────────────────────────
interface Props {
  tiles: TileRecord[];
}

export default function SegmentationGrid({ tiles }: Props) {
  // Accumulate latest tile per (row, col); latest in array wins.
  const { cells, cols, correct, total } = useMemo(() => {
    const map = new Map<string, TileRecord>();
    for (const t of tiles) {
      if (t.grid_row == null || t.grid_col == null) continue;
      map.set(`${t.grid_row}_${t.grid_col}`, t);
    }
    const placed = Array.from(map.values());
    const maxCol = placed.reduce((m, t) => Math.max(m, t.grid_col ?? 0), -1);
    const correctCount = placed.filter((t) => t.correct).length;
    return {
      cells: map,
      cols: maxCol + 1,
      correct: correctCount,
      total: placed.length,
    };
  }, [tiles]);

  // Present classes (in palette order) for the legend.
  const presentClasses = useMemo(() => {
    const seen = new Set<string>();
    for (const t of cells.values()) {
      if (t.predicted_label) seen.add(t.predicted_label);
    }
    const ordered = DW_CLASSES.filter((c) => seen.has(c));
    const extras = Array.from(seen).filter((c) => !DW_PALETTE[c]);
    return [...ordered, ...extras];
  }, [cells]);

  const accuracy = total > 0 ? (correct / total) * 100 : 0;
  const orderedCells = Array.from(cells.values());

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div className="w-12 h-12 border border-slate-200 flex items-center justify-center mb-5 bg-slate-50">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">Segmentation</h2>
        <p className="text-sm text-slate-400 max-w-md leading-relaxed">
          Live land-cover segmentation of the satellite scene. Start a run to populate the grid — each cell is a classified Sentinel-2 patch, tinted by its predicted Dynamic World class.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* ── Header: live accuracy ─────────────────────────────────────────── */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <p className="label mb-1">Scene Segmentation</p>
          <p className="text-sm text-slate-500">
            {total} cell{total !== 1 ? "s" : ""} classified across {cols} column{cols !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="label mb-1">Pixel Accuracy</p>
          <p className="text-2xl font-bold tabular-nums text-slate-900">{accuracy.toFixed(1)}%</p>
          <p className="text-[10px] text-slate-400">{correct} / {total} cells correct</p>
        </div>
      </div>

      {/* ── Grid ──────────────────────────────────────────────────────────── */}
      <div
        className="grid gap-1 mb-6"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {orderedCells.map((tile) => {
          const color = colorFor(tile.predicted_label);
          const isError = !tile.correct;
          return (
            <div
              key={`${tile.grid_row}_${tile.grid_col}`}
              title={`pred: ${tile.predicted_label} | truth: ${tile.true_label}`}
              className="relative aspect-square overflow-hidden bg-slate-100"
              style={{
                gridRowStart: (tile.grid_row ?? 0) + 1,
                gridColumnStart: (tile.grid_col ?? 0) + 1,
                border: `2px solid ${isError ? "#dc2626" : color}`,
              }}
            >
              {tile.image_url && (
                <img
                  src={tile.image_url}
                  alt={tile.predicted_label}
                  className="absolute inset-0 w-full h-full object-cover"
                  draggable={false}
                />
              )}
              {/* translucent class tint */}
              <div className="absolute inset-0" style={{ backgroundColor: color, opacity: 0.42 }} />
              {/* error marker */}
              {isError && (
                <span className="absolute top-0 right-0 z-10 flex h-3.5 w-3.5 items-center justify-center bg-red-600 text-[9px] font-bold leading-none text-white">
                  ✕
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="border-t border-slate-200 pt-4">
        <p className="label mb-2">Dynamic World Classes</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {(presentClasses.length > 0 ? presentClasses : DW_CLASSES).map((cls) => (
            <div key={cls} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 border border-black/10"
                style={{ backgroundColor: colorFor(cls) }}
              />
              <span className="text-[11px] text-slate-600 capitalize">{labelText(cls)}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 border border-red-600 bg-white relative">
              <span className="absolute -top-px -right-px h-2 w-2 bg-red-600" />
            </span>
            <span className="text-[11px] text-slate-600">Misclassified</span>
          </div>
        </div>
      </div>
    </div>
  );
}
