"use client";

import { useEffect, useRef, useState } from "react";
import AccuracyChart from "@/components/AccuracyChart";
import type { BatchRecord, TileRecord } from "@/types";

// ── Class info ────────────────────────────────────────────────────────────────

const CLASS_INFO: Record<string, { accent: string; overlay: string; label: string }> = {
  forest:         { accent: "#16a34a", overlay: "rgba(22,163,74,0.18)",   label: "Forest" },
  shrubland:      { accent: "#d97706", overlay: "rgba(217,119,6,0.18)",   label: "Shrubland" },
  water:          { accent: "#2563eb", overlay: "rgba(37,99,235,0.18)",   label: "Water" },
  urban:          { accent: "#6b7280", overlay: "rgba(107,114,128,0.18)", label: "Urban" },
  highway:        { accent: "#78716c", overlay: "rgba(120,113,108,0.18)", label: "Highway" },
  annual_crop:    { accent: "#ca8a04", overlay: "rgba(202,138,4,0.18)",   label: "Annual Crop" },
  permanent_crop: { accent: "#ea580c", overlay: "rgba(234,88,12,0.18)",   label: "Perm. Crop" },
  pasture:        { accent: "#65a30d", overlay: "rgba(101,163,13,0.18)",  label: "Pasture" },
  sea_lake:       { accent: "#0284c7", overlay: "rgba(2,132,199,0.18)",   label: "Sea / Lake" },
  industrial:     { accent: "#475569", overlay: "rgba(71,85,105,0.18)",   label: "Industrial" },
};
const FALLBACK = { accent: "#94a3b8", overlay: "rgba(148,163,184,0.08)", label: "—" };
function getInfo(label: string) { return CLASS_INFO[label] ?? FALLBACK; }

const EUROSAT_CLASSES = Object.keys(CLASS_INFO);
const CYCLE_MS = 3500;

// ── Segmentation regions (per class) ─────────────────────────────────────────

type Segment = { label: string; x: number; y: number; w: number; h: number; pct: number; color: string };

const CLASS_SEGMENTS: Record<string, Segment[]> = {
  forest: [
    { label: "Dense Canopy",      x:  6, y:  5, w: 50, h: 52, color: "#4ade80", pct: 58 },
    { label: "Forest Edge",       x: 58, y: 10, w: 36, h: 44, color: "#86efac", pct: 26 },
    { label: "Understory Shadow", x:  8, y: 60, w: 46, h: 30, color: "#166534", pct: 16 },
  ],
  shrubland: [
    { label: "Shrub Patches",     x:  5, y:  6, w: 42, h: 50, color: "#fbbf24", pct: 47 },
    { label: "Bare Soil",         x: 50, y:  5, w: 44, h: 40, color: "#b45309", pct: 32 },
    { label: "Sparse Grass",      x:  8, y: 60, w: 82, h: 30, color: "#fde68a", pct: 21 },
  ],
  water: [
    { label: "Open Water Body",   x:  5, y:  5, w: 88, h: 74, color: "#60a5fa", pct: 82 },
    { label: "Shallow Margin",    x:  6, y: 78, w: 46, h: 14, color: "#93c5fd", pct: 12 },
    { label: "Shoreline",         x: 55, y: 76, w: 38, h: 16, color: "#bfdbfe", pct:  6 },
  ],
  urban: [
    { label: "Building Clusters", x:  5, y:  5, w: 44, h: 46, color: "#94a3b8", pct: 42 },
    { label: "Road Network",      x: 52, y:  7, w: 42, h: 36, color: "#64748b", pct: 28 },
    { label: "Green Spaces",      x:  6, y: 54, w: 38, h: 36, color: "#86efac", pct: 19 },
    { label: "Mixed Zone",        x: 52, y: 52, w: 42, h: 38, color: "#cbd5e1", pct: 11 },
  ],
  highway: [
    { label: "Main Carriageway",  x:  5, y: 37, w: 90, h: 24, color: "#a8a29e", pct: 54 },
    { label: "Shoulder / Barrier",x:  5, y: 26, w: 90, h: 13, color: "#78716c", pct: 26 },
    { label: "Surrounding Land",  x:  5, y: 63, w: 90, h: 26, color: "#d6d3d1", pct: 20 },
  ],
  annual_crop: [
    { label: "Active Crop Rows",  x:  5, y:  5, w: 56, h: 58, color: "#fde047", pct: 57 },
    { label: "Bare Soil Patches", x: 64, y:  7, w: 30, h: 50, color: "#ca8a04", pct: 29 },
    { label: "Field Margin",      x:  5, y: 67, w: 88, h: 24, color: "#fef9c3", pct: 14 },
  ],
  permanent_crop: [
    { label: "Orchard Rows",      x:  5, y:  5, w: 58, h: 64, color: "#fb923c", pct: 63 },
    { label: "Inter-row Gap",     x: 65, y:  7, w: 28, h: 56, color: "#fdba74", pct: 24 },
    { label: "Buffer Zone",       x:  5, y: 72, w: 88, h: 20, color: "#ffedd5", pct: 13 },
  ],
  pasture: [
    { label: "Grass Meadow",      x:  5, y:  5, w: 88, h: 54, color: "#86efac", pct: 66 },
    { label: "Grazed Zone",       x:  6, y: 62, w: 52, h: 30, color: "#4ade80", pct: 22 },
    { label: "Hedgerow / Edge",   x: 60, y: 60, w: 34, h: 32, color: "#166534", pct: 12 },
  ],
  sea_lake: [
    { label: "Deep Water",        x:  5, y:  5, w: 88, h: 64, color: "#38bdf8", pct: 75 },
    { label: "Littoral Zone",     x:  6, y: 72, w: 58, h: 20, color: "#7dd3fc", pct: 18 },
    { label: "Coastal Fringe",    x: 66, y: 70, w: 28, h: 22, color: "#bae6fd", pct:  7 },
  ],
  industrial: [
    { label: "Factory / Warehouse",x: 5, y:  5, w: 52, h: 54, color: "#94a3b8", pct: 51 },
    { label: "Hardstand / Lot",   x: 58, y:  7, w: 36, h: 46, color: "#64748b", pct: 32 },
    { label: "Thermal Signature", x:  7, y: 62, w: 48, h: 28, color: "#f87171", pct: 17 },
  ],
};

// ── RegionAnalysis ─────────────────────────────────────────────────────────────

function RegionAnalysis({ tile, corrected }: { tile: TileRecord | null; corrected?: string }) {
  if (!tile) {
    return (
      <div className="h-full flex flex-col">
        <p className="label mb-3">Region Analysis</p>
        <div className="flex-1 flex items-center justify-center border border-dashed border-slate-200 text-xs text-slate-300">
          Select a tile
        </div>
      </div>
    );
  }

  const segments = CLASS_SEGMENTS[tile.true_label] ?? [];
  const pred = getInfo(corrected ?? tile.predicted_label);
  const base = getInfo(tile.true_label);
  const isCorrect = corrected ? corrected === tile.true_label : tile.correct;

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="label">Region Analysis</p>
        <span
          className="text-[10px] font-bold px-2 py-0.5"
          style={{ backgroundColor: isCorrect ? "#dcfce7" : "#fee2e2", color: isCorrect ? "#16a34a" : "#dc2626" }}
        >
          {pred.label}
        </span>
      </div>

      {/* Region bars */}
      <div className="flex-1 space-y-3">
        {segments.map((seg) => (
          <div key={seg.label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 shrink-0" style={{ backgroundColor: seg.color }} />
                <span className="text-[11px] text-slate-700 font-medium">{seg.label}</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">{seg.pct}%</span>
            </div>
            <div className="h-1.5 bg-slate-100 overflow-hidden">
              <div
                className="h-full transition-all duration-700"
                style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Mini real vs classified */}
      <div className="grid grid-cols-2 border border-slate-100 divide-x divide-slate-100 overflow-hidden" style={{ height: 88 }}>
        <div className="flex flex-col">
          <p className="text-[8px] text-slate-400 text-center py-0.5 border-b border-slate-100 bg-slate-50 uppercase tracking-widest">
            Ground Truth
          </p>
          <div className="flex-1 relative bg-slate-100">
            {tile.image_url && (
              <img src={tile.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black/60 py-0.5 text-center">
              <span className="text-[8px] font-semibold text-white">{base.label}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <p className="text-[8px] text-slate-400 text-center py-0.5 border-b border-slate-100 bg-slate-50 uppercase tracking-widest">
            Classified
          </p>
          <div className="flex-1 relative bg-slate-100">
            {tile.image_url && (
              <img src={tile.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
            )}
            <div className="absolute inset-0" style={{ backgroundColor: pred.overlay }} />
            <div className="absolute bottom-0 left-0 right-0 py-0.5 text-center" style={{ backgroundColor: isCorrect ? "#16a34a" : "#dc2626" }}>
              <span className="text-[8px] font-semibold text-white">{pred.label}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Confidence bar */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
          <span>Model Confidence</span>
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
  const [displayIdx, setDisplayIdx]         = useState(-1);
  const [animKey, setAnimKey]               = useState(0);
  const [animDir, setAnimDir]               = useState<AnimDir>("fall");
  const [infoVisible, setInfoVisible]       = useState(false);
  const [centerTile, setCenterTile]         = useState<TileRecord | null>(null);
  const [visibleSegments, setVisibleSegments] = useState(0);

  const cycleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segTimersRef  = useRef<ReturnType<typeof setTimeout>[]>([]);

  function clearSegTimers() {
    segTimersRef.current.forEach(clearTimeout);
    segTimersRef.current = [];
  }

  function showAt(idx: number, dir: AnimDir, tileList: TileRecord[]) {
    if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
    if (cycleTimerRef.current) clearTimeout(cycleTimerRef.current);
    clearSegTimers();
    setDisplayIdx(idx);
    setAnimDir(dir);
    setAnimKey((k) => k + 1);
    setInfoVisible(false);
    setVisibleSegments(0);
    const t = tileList[idx] ?? null;
    setCenterTile(t);
    infoTimerRef.current = setTimeout(() => setInfoVisible(true), 520);

    // Stagger segment overlays in after the tile lands
    if (t) {
      const segs = CLASS_SEGMENTS[t.true_label] ?? [];
      segs.forEach((_, i) => {
        const timer = setTimeout(() => setVisibleSegments(i + 1), 850 + i * 220);
        segTimersRef.current.push(timer);
      });
    }
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
      clearSegTimers();
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
  const activeSegments = tile ? (CLASS_SEGMENTS[tile.true_label] ?? []).slice(0, visibleSegments) : [];

  return (
    <>
      {/* Progress bar */}
      <div className="h-0.5 bg-slate-100">
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: totalTiles > 0 ? `${(tiles.length / totalTiles) * 100}%` : "0%" }}
        />
      </div>

      {/* ── Tile image area — full width, dark ───────────────────────────── */}
      <div className="relative bg-slate-950 overflow-hidden" style={{ height: 500 }}>

        {/* Prev tile — vertically inset so center dominates */}
        <div
          className="absolute left-0 cursor-pointer select-none z-0 overflow-hidden"
          style={{
            width: "20%", top: "9%", height: "82%",
            opacity: tiles.length > 1 ? 0.5 : 0, transition: "opacity 0.4s"
          }}
          onClick={goBack}
        >
          {prevTile?.image_url && (
            <img src={prevTile.image_url} alt="" className="w-full h-full object-cover" draggable={false} />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to right, transparent 30%, rgba(2,6,23,0.92) 100%)" }} />
          <div className="absolute inset-0 flex items-center justify-start pl-3">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="opacity-40">
              <path d="M10 3L5 8l5 5" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
            </svg>
          </div>
        </div>

        {/* Next tile — vertically inset */}
        <div
          className="absolute right-0 cursor-pointer select-none z-0 overflow-hidden"
          style={{
            width: "20%", top: "9%", height: "82%",
            opacity: tiles.length > 1 ? 0.5 : 0, transition: "opacity 0.4s"
          }}
          onClick={advance}
        >
          {nextTile?.image_url && (
            <img src={nextTile.image_url} alt="" className="w-full h-full object-cover" draggable={false} />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to left, transparent 30%, rgba(2,6,23,0.92) 100%)" }} />
          <div className="absolute inset-0 flex items-center justify-end pr-3">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" className="opacity-40">
              <path d="M6 3l5 5-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
            </svg>
          </div>
        </div>

        {/* Center tile — full height, animated */}
        {tile ? (
          <div
            key={animKey}
            className={`absolute top-0 bottom-0 z-10 ${animClass}`}
            style={{ left: "15%", right: "15%" }}
          >
            {tile.image_url ? (
              <img src={tile.image_url} alt={trueInfo.label} className="w-full h-full object-cover" draggable={false} />
            ) : (
              <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-slate-600 border-t-slate-300 animate-spin-slow" />
              </div>
            )}

            {/* ── Segmentation region overlays ── */}
            {activeSegments.map((seg) => (
              <div
                key={seg.label}
                className="absolute pointer-events-none animate-info-rise"
                style={{
                  left: `${seg.x}%`, top: `${seg.y}%`,
                  width: `${seg.w}%`, height: `${seg.h}%`,
                  backgroundColor: `${seg.color}1a`,
                  border: `1.5px dashed ${seg.color}bb`,
                }}
              >
                {/* Region label badge */}
                <div
                  className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 text-white"
                  style={{ backgroundColor: `${seg.color}ee`, fontSize: 9, fontWeight: 700, lineHeight: 1.3 }}
                >
                  <span>{seg.label}</span>
                  <span style={{ opacity: 0.75 }}>{seg.pct}%</span>
                </div>
              </div>
            ))}

            {/* ── Top bar: counter + live indicator ── */}
            <div className="absolute top-0 left-0 right-0 px-5 py-4 flex items-center justify-between"
              style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.65) 0%, transparent 100%)" }}>
              <span className="text-[11px] text-white/50 font-mono tracking-widest">
                {String(displayIdx + 1).padStart(2, "0")} / {String(tiles.length).padStart(2, "0")}
              </span>
              <div className="flex items-center gap-3">
                {running && (
                  <span className="text-[10px] text-emerald-300 font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-400 animate-pulse" />
                    Classifying
                  </span>
                )}
                {visibleSegments > 0 && !running && (
                  <span className="text-[10px] text-amber-300 font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-amber-400 animate-pulse" />
                    {activeSegments.length} region{activeSegments.length !== 1 ? "s" : ""} detected
                  </span>
                )}
                <span className={`text-[10px] font-semibold px-2 py-0.5 border ${
                  isCorrect ? "bg-emerald-500/20 text-white border-emerald-400/30" : "bg-red-500/20 text-white border-red-400/30"
                }`}>
                  {isCorrect ? "✓ Correct" : "✗ Error"}
                </span>
              </div>
            </div>

            {/* ── Bottom: info overlay ── */}
            {infoVisible && (
              <div
                className="absolute bottom-0 left-0 right-0 animate-info-rise"
                style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.65) 60%, transparent 100%)" }}
              >
                <div className="px-6 pt-10 pb-3 grid grid-cols-4 gap-0">
                  {[
                    { label: "True Class",    value: trueInfo.label,                           color: "text-white" },
                    { label: "Classified As", value: predInfo.label,                           color: "", style: { color: predInfo.accent } },
                    { label: "Confidence",    value: `${(tile.confidence * 100).toFixed(1)}%`, color: "text-white" },
                    { label: "Result",        value: isCorrect ? "Correct" : "Misclassified",  color: isCorrect ? "text-emerald-400" : "text-red-400" },
                  ].map(({ label, value, color, style }) => (
                    <div key={label} className="px-1">
                      <p className="text-[9px] text-white/40 uppercase tracking-widest font-semibold mb-0.5">{label}</p>
                      <p className={`text-sm font-bold leading-tight ${color}`} style={style}>{value}</p>
                    </div>
                  ))}
                </div>
                <div className="px-6 pb-4 mt-2 flex items-center gap-3">
                  <div className="flex-1 h-px bg-white/10">
                    <div className="h-full bg-white/30 transition-all duration-700"
                      style={{ width: tiles.length > 0 ? `${(correctCount / tiles.length) * 100}%` : "0%" }} />
                  </div>
                  <span className="text-[10px] text-white/35 font-mono shrink-0">
                    {correctCount}/{tiles.length} correct
                  </span>
                </div>
              </div>
            )}

            {/* Nav dots */}
            {tiles.length > 1 && (
              <div className="absolute left-0 right-0 flex justify-center gap-1" style={{ bottom: infoVisible ? 110 : 12 }}>
                {Array.from({ length: Math.min(tiles.length, 15) }).map((_, i) => {
                  const start = Math.max(0, Math.min(displayIdx - 7, tiles.length - 15));
                  const tIdx = start + i;
                  return (
                    <button key={tIdx}
                      onClick={(e) => { e.stopPropagation(); showAt(tIdx, "slide", tiles); }}
                      className={`transition-all duration-200 ${tIdx === displayIdx ? "w-5 h-1 bg-white" : "w-1 h-1 bg-white/30 hover:bg-white/60"}`}
                    />
                  );
                })}
              </div>
            )}

            {/* Arrows */}
            {tiles.length > 1 && infoVisible && (
              <button onClick={advance}
                className="absolute right-4 top-1/3 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/15 transition-colors animate-arrow-nudge z-20">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 3l5 5-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
                </svg>
              </button>
            )}
            {tiles.length > 1 && (
              <button onClick={goBack}
                className="absolute left-4 top-1/3 w-10 h-10 flex items-center justify-center bg-white/10 hover:bg-white/20 border border-white/15 transition-colors z-20">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8l5 5" stroke="white" strokeWidth="1.5" strokeLinecap="square" />
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

      {/* ── Bottom grid ────────────────────────────────────────────────────── */}
      {memoryEnabled ? (
        <div
          className="grid border-b border-slate-200 divide-x divide-slate-200"
          style={{ gridTemplateColumns: "1fr 1.55fr 0.8fr", minHeight: 300 }}
        >
          {/* Left: accuracy chart */}
          <div className="p-5 flex flex-col">
            <AccuracyChart batches={batches} />
          </div>

          {/* Center: region analysis (replaces split comparison) */}
          <div className="p-6 flex flex-col">
            <RegionAnalysis tile={tile} corrected={correctedLabel} />
          </div>

          {/* Right: scientist */}
          <div className="p-5 flex flex-col">
            <ScientistPanel tile={tile} onCorrection={onCorrection} corrections={corrections} />
          </div>
        </div>
      ) : (
        <div className="border-b border-slate-200 flex">
          <div className="p-6 w-96">
            <AccuracyChart batches={batches} />
          </div>
          <div className="flex-1 border-l border-slate-200 flex items-center justify-center px-8">
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs text-center">
              Memory Off — heuristics not accumulating.
              <br />Toggle <span className="text-emerald-600 font-semibold">Memory On</span> to enable recursive improvement.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
