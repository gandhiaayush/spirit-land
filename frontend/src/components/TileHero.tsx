"use client";

import { useState } from "react";
import type { TileRecord } from "@/types";

const EUROSAT_CLASSES = [
  "forest", "shrubland", "water", "urban", "highway",
  "annual_crop", "permanent_crop", "pasture", "sea_lake", "industrial",
];

const CLASS_INFO: Record<string, { accent: string; bg: string; label: string }> = {
  forest:         { accent: "#22c55e", bg: "#052e16", label: "Forest" },
  shrubland:      { accent: "#f59e0b", bg: "#1c0a00", label: "Shrubland" },
  water:          { accent: "#3b82f6", bg: "#0c1a3d", label: "Water" },
  urban:          { accent: "#9ca3af", bg: "#111827", label: "Urban" },
  highway:        { accent: "#a8a29e", bg: "#1c1917", label: "Highway" },
  annual_crop:    { accent: "#fbbf24", bg: "#2d1810", label: "Annual Crop" },
  permanent_crop: { accent: "#fb923c", bg: "#231200", label: "Perm. Crop" },
  pasture:        { accent: "#a3e635", bg: "#1a2e05", label: "Pasture" },
  sea_lake:       { accent: "#60a5fa", bg: "#030d2b", label: "Sea / Lake" },
  industrial:     { accent: "#6b7280", bg: "#0d0d0d", label: "Industrial" },
};
const FALLBACK = { accent: "#475569", bg: "#0c1222", label: "Unknown" };

function getInfo(label: string) {
  return CLASS_INFO[label] ?? FALLBACK;
}

interface TileSquareProps {
  tile: TileRecord;
  selected: boolean;
  corrected?: string;
  onClick: () => void;
}

function TileSquare({ tile, selected, corrected, onClick }: TileSquareProps) {
  const base = getInfo(tile.true_label);
  const pred = getInfo(corrected ?? tile.predicted_label);
  const isCorrect = corrected ? corrected === tile.true_label : tile.correct;

  return (
    <button
      onClick={onClick}
      title={`${base.label} → ${pred.label} (${(tile.confidence * 100).toFixed(0)}%)`}
      className={`relative aspect-square rounded overflow-hidden transition-all duration-150 cursor-pointer animate-tile-pop
        ${selected
          ? "ring-2 ring-white/80 scale-110 z-10"
          : "hover:scale-105 hover:ring-1 hover:ring-white/30"
        }`}
      style={{ backgroundColor: base.bg }}
    >
      {/* Segmentation overlay — predicted class color */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: pred.accent, opacity: 0.62 }}
      />
      {/* Error dot — top-right if incorrect */}
      {!isCorrect && (
        <div className="absolute top-0 right-0 w-2 h-2 bg-rose-500 rounded-bl-sm" />
      )}
      {/* Correction indicator — subtle teal dot when manually corrected */}
      {corrected && (
        <div className="absolute top-0 left-0 w-2 h-2 bg-violet-400 rounded-br-sm" />
      )}
    </button>
  );
}

interface Props {
  tiles: TileRecord[];
  batchNumber: number | null;
  totalTiles: number;
  onCorrection: (tile: TileRecord, label: string) => void;
  corrections: Record<string, string>;
}

export default function TileHero({ tiles, batchNumber, totalTiles, onCorrection, corrections }: Props) {
  const [selected, setSelected] = useState<TileRecord | null>(null);
  const [correctedLabel, setCorrectedLabel] = useState("");
  const [correctionSent, setCorrectionSent] = useState(false);

  const displayTile = selected ?? tiles[tiles.length - 1] ?? null;

  function handleSelectTile(tile: TileRecord) {
    setSelected(tile);
    setCorrectedLabel(corrections[tile.tile_id] ?? tile.predicted_label);
    setCorrectionSent(false);
  }

  async function handleSubmitCorrection() {
    if (!displayTile || !correctedLabel) return;
    await fetch(`/api/correction?tile_id=${displayTile.tile_id}&corrected_label=${correctedLabel}`, {
      method: "POST",
    });
    onCorrection(displayTile, correctedLabel);
    setCorrectionSent(true);
  }

  const correct = tiles.filter((t) => {
    const c = corrections[t.tile_id];
    return c ? c === t.true_label : t.correct;
  }).length;

  const slots = Math.max(totalTiles, tiles.length);

  return (
    <div className="card p-6">
      <div className="flex gap-8">
        {/* ── LEFT: tile grid ─────────────────────── */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="label mb-1">EuroSAT Satellite Tiles</h2>
              <p className="text-xs text-slate-600">
                {batchNumber ? `Batch ${batchNumber} · ` : ""}
                {tiles.length}{slots > 0 ? `/${slots}` : ""} tiles classified
              </p>
            </div>
            {tiles.length > 0 && (
              <div className="flex gap-4 text-xs">
                <span>
                  <span className="text-emerald-400 font-bold">{correct}</span>
                  <span className="text-slate-600"> correct</span>
                </span>
                <span>
                  <span className="text-rose-400 font-bold">{tiles.length - correct}</span>
                  <span className="text-slate-600"> errors</span>
                </span>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {slots > 0 && (
            <div className="h-px bg-slate-900 rounded-full mb-4 overflow-hidden">
              <div
                className="h-full bg-emerald-500/70 transition-all duration-300 rounded-full"
                style={{ width: `${(tiles.length / slots) * 100}%` }}
              />
            </div>
          )}

          {/* Class legend */}
          {tiles.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mb-4">
              {EUROSAT_CLASSES.filter(cls =>
                tiles.some(t => t.true_label === cls || t.predicted_label === cls)
              ).map((cls) => {
                const info = getInfo(cls);
                return (
                  <div key={cls} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: info.accent }} />
                    <span className="text-[10px] text-slate-600">{info.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tile grid */}
          {tiles.length === 0 ? (
            <div className="h-36 flex flex-col items-center justify-center text-slate-700 gap-2">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <p className="text-sm">Tiles appear here during classification</p>
            </div>
          ) : (
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(32px, 1fr))" }}
            >
              {Array.from({ length: slots }).map((_, i) => {
                const tile = tiles[i];
                return tile ? (
                  <TileSquare
                    key={tile.tile_id}
                    tile={tile}
                    selected={displayTile?.tile_id === tile.tile_id && selected !== null}
                    corrected={corrections[tile.tile_id]}
                    onClick={() => handleSelectTile(tile)}
                  />
                ) : (
                  <div
                    key={i}
                    className="aspect-square rounded bg-slate-900/50 border border-slate-800/40"
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT: comparison + metadata + intervention ── */}
        <div className="w-52 shrink-0 flex flex-col gap-5">
          {displayTile ? (
            <>
              {/* Split comparison */}
              <div>
                <p className="label mb-2">Comparison</p>
                <div className="grid grid-cols-2 gap-2">
                  {/* Raw */}
                  <div>
                    <p className="text-[10px] text-slate-600 text-center mb-1">Raw</p>
                    <div
                      className="aspect-square rounded-lg border border-slate-800"
                      style={{ backgroundColor: getInfo(displayTile.true_label).bg }}
                    >
                      <div className="w-full h-full rounded-lg bg-gradient-to-br from-white/5 to-transparent" />
                    </div>
                    <p className="text-[10px] text-slate-600 text-center mt-1 truncate">
                      {getInfo(displayTile.true_label).label}
                    </p>
                  </div>
                  {/* Classified */}
                  <div>
                    <p className="text-[10px] text-slate-600 text-center mb-1">Classified</p>
                    <div
                      className="aspect-square rounded-lg border border-slate-700 relative overflow-hidden"
                      style={{ backgroundColor: getInfo(displayTile.true_label).bg }}
                    >
                      <div
                        className="absolute inset-0 rounded-lg"
                        style={{
                          backgroundColor: getInfo(
                            corrections[displayTile.tile_id] ?? displayTile.predicted_label
                          ).accent,
                          opacity: 0.75,
                        }}
                      />
                    </div>
                    <p
                      className="text-[10px] text-center mt-1 truncate font-medium"
                      style={{
                        color: (() => {
                          const c = corrections[displayTile.tile_id];
                          const isOk = c ? c === displayTile.true_label : displayTile.correct;
                          return isOk ? "#34d399" : "#f87171";
                        })(),
                      }}
                    >
                      {getInfo(corrections[displayTile.tile_id] ?? displayTile.predicted_label).label}
                    </p>
                  </div>
                </div>
              </div>

              {/* Metadata */}
              <div>
                <p className="label mb-2">Classification</p>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Confidence</span>
                    <span className="text-slate-300">{(displayTile.confidence * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Result</span>
                    {(() => {
                      const c = corrections[displayTile.tile_id];
                      const isOk = c ? c === displayTile.true_label : displayTile.correct;
                      return (
                        <span className={isOk ? "text-emerald-400 font-semibold" : "text-rose-400 font-semibold"}>
                          {isOk ? "✓ Correct" : "✗ Incorrect"}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Tile</span>
                    <span className="text-slate-500 font-mono text-[10px] truncate max-w-[100px]">
                      {displayTile.tile_id}
                    </span>
                  </div>
                </div>
              </div>

              {/* Scientist Intervention */}
              <div>
                <p className="label mb-2">Scientist Override</p>
                {correctionSent ? (
                  <div className="text-xs text-violet-400 py-2 text-center bg-violet-500/5 rounded-lg border border-violet-500/20">
                    ✓ Correction applied
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={correctedLabel}
                      onChange={(e) => setCorrectedLabel(e.target.value)}
                      className="w-full text-xs bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-slate-600 appearance-none"
                    >
                      {EUROSAT_CLASSES.map((cls) => (
                        <option key={cls} value={cls}>
                          {getInfo(cls).label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleSubmitCorrection}
                      disabled={correctedLabel === (corrections[displayTile.tile_id] ?? displayTile.predicted_label)}
                      className="w-full text-xs py-1.5 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
                    >
                      Apply Correction
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-700 text-xs text-center px-4 leading-relaxed">
              Click any tile to inspect its classification and apply corrections
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
