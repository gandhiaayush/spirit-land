"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  running?: boolean;
}

// A locally-applied scientist correction for a single tile.
interface Override {
  predicted_label: string;
  correct: boolean;
}

export default function SegmentationGrid({ tiles, running = false }: Props) {
  // Local scientist corrections, keyed by tile_id. These re-tint cells and
  // clear the error marker without waiting for a fresh stream.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  // Which cell currently has its "Correct to…" popover open.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Transient "memory updated" confirmation, keyed by cell.
  const [toastKey, setToastKey] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); };
  }, []);

  // Apply a scientist correction: persist it, then re-tint the cell locally.
  async function applyCorrection(tile: TileRecord, corrected: string, cellKey: string) {
    setOpenKey(null);
    const params = new URLSearchParams({
      tile_id: tile.tile_id,
      corrected_label: corrected,
      predicted_label: tile.predicted_label,
    });
    try {
      const res = await fetch(`/api/correction?${params.toString()}`, { method: "POST" });
      if (!res.ok) return;
    } catch {
      return;
    }
    setOverrides((prev) => ({
      ...prev,
      [tile.tile_id]: { predicted_label: corrected, correct: corrected === tile.true_label },
    }));
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastKey(cellKey);
    toastTimerRef.current = setTimeout(() => setToastKey(null), 2000);
  }

  // Accumulate latest tile per (row, col); latest in array wins.
  const { cells, cols, correct, total } = useMemo(() => {
    const map = new Map<string, TileRecord>();
    for (const t of tiles) {
      if (t.grid_row == null || t.grid_col == null) continue;
      const o = overrides[t.tile_id];
      map.set(`${t.grid_row}_${t.grid_col}`, o ? { ...t, predicted_label: o.predicted_label, correct: o.correct } : t);
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
  }, [tiles, overrides]);

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
      <div className="flex flex-1 flex-col items-center justify-center py-24 px-6 text-center">
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
          Live land-cover segmentation of the satellite scene. Each cell is a classified Sentinel-2 patch, bordered by the color of its predicted Dynamic World class.
        </p>
        <p className="text-sm text-slate-500 font-medium mt-5">
          {running ? "Segmenting live satellite scene…" : "Press Start to segment a live satellite scene"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 p-6">
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

      {/* ── Grid (hero scene) ─────────────────────────────────────────────── */}
      <div
        className="grid gap-1 mb-6 mx-auto w-full max-w-3xl"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {orderedCells.map((tile) => {
          const color = colorFor(tile.predicted_label);
          const isError = !tile.correct;
          const cellKey = `${tile.grid_row}_${tile.grid_col}`;
          const isOpen = openKey === cellKey;
          const showToast = toastKey === cellKey;
          return (
            <div
              key={cellKey}
              className="group relative aspect-square"
              style={{
                gridRowStart: (tile.grid_row ?? 0) + 1,
                gridColumnStart: (tile.grid_col ?? 0) + 1,
                zIndex: isOpen ? 30 : undefined,
              }}
            >
              {/* clipped tile body: crisp image + class-color border (+ red error ring) */}
              <div
                title={`pred: ${tile.predicted_label} | truth: ${tile.true_label} — click to correct`}
                onClick={() => setOpenKey((k) => (k === cellKey ? null : cellKey))}
                className="absolute inset-0 overflow-hidden bg-slate-100 cursor-pointer"
                style={{
                  // Inner border = predicted class color (inset, no layout shift).
                  // Errors add a bright red ring just outside the class border.
                  boxShadow: isError
                    ? `inset 0 0 0 3px ${color}, 0 0 0 2px #dc2626`
                    : `inset 0 0 0 3px ${color}`,
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
                {/* error marker */}
                {isError && (
                  <span className="absolute top-0 right-0 z-10 flex h-3.5 w-3.5 items-center justify-center bg-red-600 text-[9px] font-bold leading-none text-white">
                    ✕
                  </span>
                )}

                {/* hover hint: subtle pencil to signal "click to correct" */}
                {!isOpen && !showToast && (
                  <span className="pointer-events-none absolute bottom-0 left-0 z-10 flex h-4 w-4 items-center justify-center bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </span>
                )}

                {/* inline "memory updated" confirmation */}
                {showToast && (
                  <span className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center bg-emerald-600/90 px-1 py-0.5 text-[8px] font-semibold leading-none text-white">
                    ✓ memory updated
                  </span>
                )}
              </div>

              {/* "Correct to…" popover — rendered outside the clipped body */}
              {isOpen && (
                <div
                  className="absolute left-1/2 top-full z-40 mt-1 w-36 -translate-x-1/2 border border-slate-200 bg-white shadow-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="border-b border-slate-100 bg-slate-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                    Correct to…
                  </p>
                  <div className="max-h-44 overflow-y-auto py-0.5">
                    {DW_CLASSES.map((cls) => (
                      <button
                        key={cls}
                        onClick={() => applyCorrection(tile, cls, cellKey)}
                        className={`flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] capitalize transition-colors hover:bg-emerald-50 ${
                          cls === tile.predicted_label ? "font-semibold text-slate-900" : "text-slate-600"
                        }`}
                      >
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 border border-black/10"
                          style={{ backgroundColor: colorFor(cls) }}
                        />
                        {labelText(cls)}
                      </button>
                    ))}
                  </div>
                </div>
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
