"use client";

import { useEffect, useRef, useState } from "react";
import AccuracyChart from "@/components/AccuracyChart";
import type { BatchRecord, TileRecord } from "@/types";

// ── Class info ────────────────────────────────────────────────────────────────

const CLASS_INFO: Record<string, { accent: string; overlay: string; label: string }> = {
  forest:         { accent: "#16a34a", overlay: "rgba(22,163,74,0.28)",   label: "Forest" },
  shrubland:      { accent: "#d97706", overlay: "rgba(217,119,6,0.28)",   label: "Shrubland" },
  water:          { accent: "#2563eb", overlay: "rgba(37,99,235,0.28)",   label: "Water" },
  urban:          { accent: "#6b7280", overlay: "rgba(107,114,128,0.28)", label: "Urban" },
  highway:        { accent: "#78716c", overlay: "rgba(120,113,108,0.28)", label: "Highway" },
  annual_crop:    { accent: "#ca8a04", overlay: "rgba(202,138,4,0.28)",   label: "Annual Crop" },
  permanent_crop: { accent: "#ea580c", overlay: "rgba(234,88,12,0.28)",   label: "Perm. Crop" },
  pasture:        { accent: "#65a30d", overlay: "rgba(101,163,13,0.28)",  label: "Pasture" },
  sea_lake:       { accent: "#0284c7", overlay: "rgba(2,132,199,0.28)",   label: "Sea / Lake" },
  industrial:     { accent: "#475569", overlay: "rgba(71,85,105,0.28)",   label: "Industrial" },
};
const FALLBACK = { accent: "#94a3b8", overlay: "rgba(148,163,184,0.12)", label: "—" };
function getInfo(label: string) { return CLASS_INFO[label] ?? FALLBACK; }

const EUROSAT_CLASSES = Object.keys(CLASS_INFO);
const CYCLE_MS = 3000;

// ── SplitComparison ───────────────────────────────────────────────────────────

function SplitComparison({ tile, corrected }: { tile: TileRecord | null; corrected?: string }) {
  if (!tile) {
    return (
      <div className="h-full flex flex-col">
        <p className="label mb-3">Comparison</p>
        <div className="flex-1 flex items-center justify-center border border-dashed border-slate-200 text-xs text-slate-300">
          Select a tile
        </div>
      </div>
    );
  }

  const base = getInfo(tile.true_label);
  const pred = getInfo(corrected ?? tile.predicted_label);
  const isCorrect = corrected ? corrected === tile.true_label : tile.correct;

  return (
    <div className="h-full flex flex-col gap-3">
      <p className="label">Comparison</p>
      <div className="flex-1 grid grid-cols-2 border border-slate-200 divide-x divide-slate-200 overflow-hidden" style={{ minHeight: 100 }}>
        <div className="relative flex flex-col">
          <p className="text-[9px] text-slate-400 text-center uppercase tracking-widest font-semibold py-1 border-b border-slate-100 bg-slate-50">Real</p>
          <div className="flex-1 relative bg-slate-100">
            {tile.image_url && <img src={tile.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />}
          </div>
          <p className="text-[9px] text-center py-1 font-medium text-slate-600 bg-slate-50 border-t border-slate-100 truncate px-1">{base.label}</p>
        </div>
        <div className="relative flex flex-col">
          <p className="text-[9px] text-slate-400 text-center uppercase tracking-widest font-semibold py-1 border-b border-slate-100 bg-slate-50">Classified</p>
          <div className="flex-1 relative bg-slate-100">
            {tile.image_url && <img src={tile.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />}
            <div className="absolute inset-0" style={{ backgroundColor: pred.overlay }} />
          </div>
          <p
            className="text-[9px] text-center py-1 font-medium bg-slate-50 border-t border-slate-100 truncate px-1"
            style={{ color: isCorrect ? "#16a34a" : "#dc2626" }}
          >
            {pred.label}
          </p>
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
          <span>Confidence</span>
          <span className="font-semibold text-slate-600">{(tile.confidence * 100).toFixed(1)}%</span>
        </div>
        <div className="h-1 bg-slate-100 overflow-hidden">
          <div
            className="h-full transition-all duration-700"
            style={{ width: `${tile.confidence * 100}%`, backgroundColor: isCorrect ? "#16a34a" : "#dc2626" }}
          />
        </div>
      </div>
    </div>
  );
}

// ── ScientistPanel ────────────────────────────────────────────────────────────

function ScientistPanel({
  tile, onCorrection, corrections,
}: {
  tile: TileRecord | null;
  onCorrection: (tile: TileRecord, label: string) => void;
  corrections: Record<string, string>;
}) {
  const [selectedLabel, setSelectedLabel] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (tile) { setSelectedLabel(corrections[tile.tile_id] ?? tile.predicted_label); setSent(false); }
  }, [tile?.tile_id]);

  if (!tile) {
    return (
      <div className="h-full flex flex-col">
        <p className="label mb-3">Scientist Override</p>
        <div className="flex-1 flex items-center justify-center border border-dashed border-slate-200 text-xs text-slate-300 text-center px-3 leading-relaxed">
          Select a tile to apply corrections
        </div>
      </div>
    );
  }

  const currentPred = corrections[tile.tile_id] ?? tile.predicted_label;

  async function handleApply() {
    if (!tile || !selectedLabel) return;
    await fetch(`/api/correction?tile_id=${tile.tile_id}&corrected_label=${selectedLabel}`, { method: "POST" });
    onCorrection(tile, selectedLabel);
    setSent(true);
  }

  return (
    <div className="h-full flex flex-col gap-3">
      <p className="label">Scientist Override</p>
      <div className="flex-1 flex flex-col justify-between">
        <div className="divide-y divide-slate-100">
          {[
            { k: "Tile ID",    v: tile.tile_id,                            mono: true },
            { k: "True class", v: getInfo(tile.true_label).label           },
            { k: "Predicted",  v: getInfo(currentPred).label               },
            { k: "Confidence", v: `${(tile.confidence * 100).toFixed(1)}%` },
          ].map(({ k, v, mono }) => (
            <div key={k} className="flex items-center justify-between py-2 text-xs gap-2">
              <span className="text-slate-400 shrink-0">{k}</span>
              <span className={`text-slate-700 text-right truncate ${mono ? "font-mono text-[10px]" : "font-medium"}`}>{v}</span>
            </div>
          ))}
        </div>
        <div className="pt-3 border-t border-slate-100 space-y-2">
          {sent ? (
            <div className="py-2 border border-violet-200 bg-violet-50 text-center">
              <p className="text-xs text-violet-700 font-medium">Correction applied</p>
            </div>
          ) : (
            <>
              <p className="label">Correct to</p>
              <select
                value={selectedLabel}
                onChange={(e) => setSelectedLabel(e.target.value)}
                className="w-full text-xs bg-white border border-slate-200 px-2 py-1.5 text-slate-700 focus:outline-none focus:border-violet-400"
              >
                {EUROSAT_CLASSES.map((cls) => (
                  <option key={cls} value={cls}>{getInfo(cls).label}</option>
                ))}
              </select>
              <button
                onClick={handleApply}
                disabled={selectedLabel === currentPred}
                className="w-full py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Apply Correction
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main TileCarousel ─────────────────────────────────────────────────────────

interface Props {
  tiles: TileRecord[];
  batchNumber: number | null;
  totalTiles: number;
  batches: BatchRecord[];
  running: boolean;
  memoryEnabled: boolean;
  onCorrection: (tile: TileRecord, label: string) => void;
  corrections: Record<string, string>;
}

type AnimDir = "fall" | "slide";

export default function TileCarousel({
  tiles, batchNumber, totalTiles, batches, running, memoryEnabled, onCorrection, corrections,
}: Props) {
  const [displayIdx, setDisplayIdx]   = useState(-1);
  const [animKey, setAnimKey]         = useState(0);
  const [animDir, setAnimDir]         = useState<AnimDir>("fall");
  const [infoVisible, setInfoVisible] = useState(false);
  const [centerTile, setCenterTile]   = useState<TileRecord | null>(null);

  const cycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showAt(idx: number, dir: AnimDir, tileList: TileRecord[]) {
    if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
    if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current);
    setDisplayIdx(idx);
    setAnimDir(dir);
    setAnimKey((k) => k + 1);
    setInfoVisible(false);
    setCenterTile(tileList[idx] ?? null);
    infoTimerRef.current = setTimeout(() => setInfoVisible(true), 520);
  }

  // New tile arriving → fall animation
  useEffect(() => {
    if (tiles.length === 0) return;
    showAt(tiles.length - 1, "fall", tiles);
  }, [tiles.length]);

  // After run ends → cycle automatically
  useEffect(() => {
    if (running || tiles.length === 0 || displayIdx < 0) return;
    cycleTimerRef.current = setTimeout(() => {
      const next = (displayIdx + 1) % tiles.length;
      showAt(next, "slide", tiles);
    }, CYCLE_MS);
    return () => { if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current); };
  }, [displayIdx, running, tiles.length, animKey]);

  useEffect(() => {
    return () => {
      if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
      if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current);
    };
  }, []);

  function advance() {
    if (tiles.length === 0) return;
    showAt((displayIdx + 1) % tiles.length, "slide", tiles);
  }

  function goBack() {
    if (tiles.length === 0) return;
    showAt((displayIdx - 1 + tiles.length) % tiles.length, "slide", tiles);
  }

  const tile = centerTile;
  const prevTile = displayIdx > 0 ? tiles[displayIdx - 1] : (tiles.length > 1 ? tiles[tiles.length - 1] : null);
  const nextTile = displayIdx < tiles.length - 1 ? tiles[displayIdx + 1] : (tiles.length > 1 ? tiles[0] : null);

  const correctedLabel = tile ? corrections[tile.tile_id] : undefined;
  const predInfo = tile ? getInfo(correctedLabel ?? tile.predicted_label) : FALLBACK;
  const trueInfo = tile ? getInfo(tile.true_label) : FALLBACK;
  const isCorrect = tile
    ? correctedLabel ? correctedLabel === tile.true_label : tile.correct
    : false;

  const correctCount = tiles.filter((t) =>
    corrections[t.tile_id] ? corrections[t.tile_id] === t.true_label : t.correct
  ).length;

  const animClass = animDir === "fall" ? "animate-tile-fall" : "animate-tile-slide";

  return (
    <>
      {/* Progress bar */}
      <div className="h-0.5 bg-slate-100">
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: totalTiles > 0 ? `${(tiles.length / totalTiles) * 100}%` : "0%" }}
        />
      </div>

      {/* ── Tile image area ───────────────────────────────────────────────── */}
      <div className="relative bg-slate-950 overflow-hidden" style={{ height: 420 }}>

        {/* Prev tile peek — left */}
        <div
          className="absolute top-0 left-0 bottom-0 w-[13%] cursor-pointer select-none z-0 overflow-hidden"
          onClick={goBack}
          style={{ opacity: tiles.length > 1 ? 0.4 : 0, transition: "opacity 0.4s" }}
        >
          {prevTile?.image_url && (
            <img src={prevTile.image_url} alt="" className="w-full h-full object-cover" draggable={false} />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to right, transparent, rgba(2,6,23,0.75))" }} />
        </div>

        {/* Next tile peek — right */}
        <div
          className="absolute top-0 right-0 bottom-0 w-[13%] cursor-pointer select-none z-0 overflow-hidden"
          onClick={advance}
          style={{ opacity: tiles.length > 1 ? 0.4 : 0, transition: "opacity 0.4s" }}
        >
          {nextTile?.image_url && (
            <img src={nextTile.image_url} alt="" className="w-full h-full object-cover" draggable={false} />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to left, transparent, rgba(2,6,23,0.75))" }} />
        </div>

        {/* Center tile */}
        {tile ? (
          <div
            key={animKey}
            className={`absolute top-0 bottom-0 z-10 ${animClass}`}
            style={{ left: "8%", right: "8%" }}
          >
            {tile.image_url ? (
              <img src={tile.image_url} alt={trueInfo.label} className="w-full h-full object-cover" draggable={false} />
            ) : (
              <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-slate-600 border-t-slate-300 animate-spin-slow" />
              </div>
            )}
            {/* Classification overlay */}
            <div className="absolute inset-0" style={{ backgroundColor: predInfo.overlay }} />

            {/* Top gradient + counter */}
            <div
              className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
              style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)" }}
            >
              <span className="text-[10px] text-white/60 font-mono tracking-wide">
                {String(displayIdx + 1).padStart(2, "0")} / {String(tiles.length).padStart(2, "0")}
                {totalTiles > tiles.length && ` · ${totalTiles} total`}
              </span>
              {running && (
                <span className="text-[10px] text-emerald-300 font-medium flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-emerald-400 animate-pulse" />
                  Classifying
                </span>
              )}
            </div>

            {/* Result badge */}
            <div className="absolute top-3 right-3 z-10">
              <span className={`text-[10px] font-semibold px-2 py-1 border ${
                isCorrect
                  ? "bg-emerald-500/20 text-white border-emerald-400/30"
                  : "bg-red-500/20 text-white border-red-400/30"
              }`}>
                {isCorrect ? "✓ Correct" : "✗ Error"}
              </span>
            </div>

            {/* Nav dots */}
            {tiles.length > 1 && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1">
                {Array.from({ length: Math.min(tiles.length, 15) }).map((_, i) => {
                  const start = Math.max(0, Math.min(displayIdx - 7, tiles.length - 15));
                  const tIdx = start + i;
                  return (
                    <button
                      key={tIdx}
                      onClick={(e) => { e.stopPropagation(); showAt(tIdx, "slide", tiles); }}
                      className={`transition-all duration-200 ${tIdx === displayIdx ? "w-5 h-1 bg-white" : "w-1 h-1 bg-white/35 hover:bg-white/60"}`}
                    />
                  );
                })}
              </div>
            )}

            {/* Right arrow — bounces when info visible */}
            {tiles.length > 1 && infoVisible && (
              <button
                onClick={advance}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/25 border border-white/20 transition-colors animate-arrow-nudge z-20"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3l5 5-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" />
                </svg>
              </button>
            )}

            {/* Left arrow */}
            {tiles.length > 1 && (
              <button
                onClick={goBack}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/25 border border-white/20 transition-colors z-20"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8l5 5" stroke="white" strokeWidth="1.5" strokeLinecap="square" strokeLinejoin="miter" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-8 h-8 border-2 border-slate-700 border-t-slate-500 animate-spin-slow" />
            <p className="text-sm text-slate-500">Awaiting classification…</p>
          </div>
        )}
      </div>

      {/* ── Info strip ────────────────────────────────────────────────────── */}
      <div
        className={`grid border-b border-slate-200 transition-opacity duration-300 ${infoVisible && tile ? "opacity-100 animate-info-rise" : "opacity-0 pointer-events-none"}`}
        style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr auto" }}
      >
        <div className="px-6 py-4 border-r border-slate-200">
          <p className="label mb-1">True Class</p>
          <p className="text-sm font-bold text-slate-900">{tile ? trueInfo.label : "—"}</p>
        </div>
        <div className="px-6 py-4 border-r border-slate-200">
          <p className="label mb-1">Classified As</p>
          <p className="text-sm font-bold" style={{ color: tile ? predInfo.accent : "#94a3b8" }}>
            {tile ? predInfo.label : "—"}
          </p>
        </div>
        <div className="px-6 py-4 border-r border-slate-200">
          <p className="label mb-1">Confidence</p>
          <p className="text-sm font-bold text-slate-900">{tile ? `${(tile.confidence * 100).toFixed(1)}%` : "—"}</p>
        </div>
        <div className="px-6 py-4 border-r border-slate-200">
          <p className="label mb-1">Result</p>
          <p className={`text-sm font-bold ${isCorrect ? "text-emerald-600" : "text-red-500"}`}>
            {tile ? (isCorrect ? "Correct" : "Misclassified") : "—"}
          </p>
        </div>
        <div className="px-6 py-4 flex flex-col justify-center items-end gap-0.5">
          <p className="label">Batch</p>
          <p className="text-sm font-bold text-slate-900">
            {tiles.length > 0 ? `${((correctCount / tiles.length) * 100).toFixed(0)}%` : "—"}
          </p>
          <p className="text-[10px] text-slate-400">{correctCount} / {tiles.length}</p>
        </div>
      </div>

      {/* Spacer when info hidden */}
      {(!infoVisible || !tile) && <div className="h-16 border-b border-slate-200" />}

      {/* ── Bottom grid ───────────────────────────────────────────────────── */}
      {memoryEnabled ? (
        <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200">
          <div className="p-5">
            <AccuracyChart batches={batches} />
          </div>
          <div className="p-5">
            <SplitComparison tile={tile} corrected={correctedLabel} />
          </div>
          <div className="p-5">
            <ScientistPanel tile={tile} onCorrection={onCorrection} corrections={corrections} />
          </div>
        </div>
      ) : (
        <div className="border-b border-slate-200 p-5 max-w-lg">
          <AccuracyChart batches={batches} />
        </div>
      )}
    </>
  );
}
