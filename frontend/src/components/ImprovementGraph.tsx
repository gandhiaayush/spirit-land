"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell,
  Legend, Line, LineChart, ReferenceDot, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import type { BatchRecord, PipelineStep, TileRecord } from "@/types";

// ── Pipeline step diagram ─────────────────────────────────────────────────────

const STEPS: { key: PipelineStep; label: string; short: string }[] = [
  { key: "retrieving",  label: "Retrieve Heuristics",  short: "Retrieve" },
  { key: "classifying", label: "Classify Tiles",        short: "Classify" },
  { key: "scoring",     label: "Score vs Ground Truth", short: "Score" },
  { key: "extracting",  label: "Extract Patterns",      short: "Extract" },
  { key: "storing",     label: "Store to Antigravity",  short: "Store" },
];

function PipelineFlow({ currentStep }: { currentStep: PipelineStep | null }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="label">Recursive Loop — Live Step</p>
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => {
          const active = s.key === currentStep;
          return (
            <div key={s.key} className="flex items-center flex-1">
              <div
                className={`flex-1 flex flex-col items-center justify-center py-2.5 px-2 border transition-all duration-500 ${
                  active
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : "bg-white border-slate-200 text-slate-400"
                }`}
              >
                <span className={`text-[9px] font-bold uppercase tracking-widest ${active ? "text-white" : "text-slate-400"}`}>
                  0{i + 1}
                </span>
                <span className={`text-[11px] font-semibold mt-0.5 text-center leading-tight ${active ? "text-white" : "text-slate-500"}`}>
                  {s.short}
                </span>
                {active && (
                  <span className="mt-1 w-1.5 h-1.5 bg-white animate-pulse" />
                )}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-5 h-px shrink-0 ${active ? "bg-emerald-400" : "bg-slate-200"}`} />
              )}
            </div>
          );
        })}
        {/* Loop back arrow */}
        <div className="flex items-center gap-1 ml-2 text-[10px] text-slate-300 font-mono">
          <div className="w-4 h-px bg-slate-200" />
          <span>↺</span>
        </div>
      </div>
      <p className="text-[10px] text-slate-400 leading-relaxed">
        Each loop iteration: heuristics retrieved from Antigravity → injected into classifier →
        errors scored → patterns extracted → new heuristics stored back.
      </p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PAIR_COLORS = ["#059669", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6"];

function formatPairLabel(key: string) {
  const multiWord = ["annual_crop", "permanent_crop", "sea_lake"];
  for (const cls of multiWord) {
    if (key.startsWith(cls + "_")) {
      const pred = key.slice(cls.length + 1).replace(/_/g, " ");
      return `${cls.replace(/_/g, " ")} → ${pred}`;
    }
  }
  return key.replace(/_/g, " → ").replace(/ → ([^ ]+)$/, " → $1");
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  batches: BatchRecord[];
  currentBatchTiles: TileRecord[];
  batchNumber: number | null;
  totalTiles: number;
  currentStep: PipelineStep | null;
  running: boolean;
}

export default function ImprovementGraph({
  batches, currentBatchTiles, batchNumber, totalTiles, currentStep, running,
}: Props) {
  // ── Accuracy chart data (with live current-batch point) ───────────────────
  const accuracyData = batches.map((b) => ({
    batch: b.batch_number,
    accuracy: parseFloat((b.overall_accuracy * 100).toFixed(1)),
    live: false,
  }));

  let liveAcc: number | null = null;
  if (running && currentBatchTiles.length > 0 && batchNumber) {
    liveAcc = parseFloat(
      ((currentBatchTiles.filter((t) => t.correct).length / currentBatchTiles.length) * 100).toFixed(1)
    );
    accuracyData.push({ batch: batchNumber, accuracy: liveAcc, live: true });
  }

  // ── Heuristics growth ─────────────────────────────────────────────────────
  let cumHeuristics = 0;
  const heuristicsData = batches.map((b) => {
    cumHeuristics += b.active_heuristic_ids.length;
    return { batch: b.batch_number, heuristics: b.active_heuristic_ids.length, cumulative: cumHeuristics };
  });

  // ── Confusion pair trends (top 5 across all batches) ─────────────────────
  const pairSet = new Set<string>();
  batches.forEach((b) => Object.keys(b.per_confusion_pair_error_rate).forEach((k) => pairSet.add(k)));
  // Rank by total error across all batches, take top 5
  const pairTotals = Array.from(pairSet).map((p) => ({
    pair: p,
    total: batches.reduce((s, b) => s + (b.per_confusion_pair_error_rate[p] ?? 0), 0),
  }));
  const topPairs = pairTotals.sort((a, b) => b.total - a.total).slice(0, 5).map((x) => x.pair);

  const confusionData = batches.map((b) => {
    const row: Record<string, number | string> = { batch: b.batch_number };
    topPairs.forEach((p) => {
      row[p] = parseFloat(((b.per_confusion_pair_error_rate[p] ?? 0) * 100).toFixed(1));
    });
    return row;
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalTilesAll = batches.reduce((s, b) => s + (b.tile_count ?? 0), 0) + currentBatchTiles.length;
  const latestAcc = liveAcc ?? (batches.length > 0 ? batches[batches.length - 1].overall_accuracy * 100 : null);
  const firstAcc  = batches.length > 0 ? batches[0].overall_accuracy * 100 : null;
  const delta     = latestAcc !== null && firstAcc !== null ? latestAcc - firstAcc : null;
  const totalHeuristics = batches.reduce((s, b) => s + b.active_heuristic_ids.length, 0);

  // ── Tooltip styles ────────────────────────────────────────────────────────
  const tooltipStyle = {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 0,
    fontSize: 11,
    color: "#475569",
  };

  if (batches.length === 0 && !running) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-24 border-b border-slate-200">
        <div className="w-10 h-10 border border-slate-200 flex items-center justify-center bg-slate-50">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-slate-700 mb-1">No run data yet</p>
          <p className="text-xs text-slate-400">Start a run from the Dashboard to see live improvement metrics</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* Pipeline flow */}
      <div className="border-b border-slate-200 px-8 py-5">
        <PipelineFlow currentStep={currentStep} />
      </div>

      {/* ── Bento grid ─────────────────────────────────────────────────────── */}
      <div
        className="flex-1 grid border-b border-slate-200"
        style={{ gridTemplateColumns: "1fr 420px", gridTemplateRows: "1fr 1fr" }}
      >
        {/* ── Accuracy — spans 2 rows ─── */}
        <div
          className="border-r border-slate-200 p-6 flex flex-col"
          style={{ gridRow: "1 / 3" }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Classification Accuracy</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Updates live as each batch completes
                {running && <span className="text-emerald-500 ml-1.5 font-medium">● Live</span>}
              </p>
            </div>
            {delta !== null && (
              <div className="text-right">
                <p className={`text-2xl font-bold leading-none ${delta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                </p>
                <p className="text-[10px] text-slate-400 mt-1">vs batch 1</p>
              </div>
            )}
          </div>

          {accuracyData.length > 0 ? (
            <div className="flex-1 min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={accuracyData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="accGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#059669" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="batch" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} label={{ value: "Batch", position: "insideBottom", offset: -2, fill: "#94a3b8", fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number, _: string, props: any) => [
                      `${v}%${props.payload?.live ? " (live)" : ""}`,
                      "Accuracy",
                    ]}
                    labelFormatter={(l) => `Batch ${l}`}
                    cursor={{ stroke: "#e2e8f0" }}
                  />
                  <Area type="monotone" dataKey="accuracy" stroke="#059669" strokeWidth={2} fill="url(#accGrad)"
                    dot={(props: any) => {
                      const { cx, cy, payload } = props;
                      if (payload.live) {
                        return (
                          <g key={`dot-live-${cx}-${cy}`}>
                            <circle cx={cx} cy={cy} r={6} fill="#059669" opacity={0.2} />
                            <circle cx={cx} cy={cy} r={4} fill="#059669" stroke="#ffffff" strokeWidth={1.5} />
                          </g>
                        );
                      }
                      return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={3} fill="#059669" stroke="#ffffff" strokeWidth={1.5} />;
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-2 text-slate-300">
                <div className="w-4 h-4 border-2 border-slate-200 border-t-emerald-400 animate-spin-slow" />
                <span className="text-xs text-slate-400">Waiting for first batch…</span>
              </div>
            </div>
          )}
        </div>

        {/* ── Heuristics bar chart ─── */}
        <div className="border-b border-slate-200 p-5 flex flex-col">
          <div className="mb-3">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Memory Graph Growth</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">Heuristics accumulated per batch</p>
          </div>
          {heuristicsData.length > 0 ? (
            <div className="flex-1 min-h-0" style={{ minHeight: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={heuristicsData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="batch" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                  <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, "Heuristics"]} labelFormatter={(l) => `Batch ${l}`} cursor={{ fill: "#f8fafc" }} />
                  <Bar dataKey="heuristics" fill="#8b5cf6" maxBarSize={32}>
                    {heuristicsData.map((_, i) => (
                      <Cell key={i} fill={i === heuristicsData.length - 1 && running ? "#059669" : "#8b5cf6"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-300">No data yet</div>
          )}
        </div>

        {/* ── Live stats ─── */}
        <div className="p-5 flex flex-col justify-between">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-4">Live Stats</h3>
          <div className="grid grid-cols-2 gap-3 flex-1">
            {[
              { label: "Tiles Classified", value: totalTilesAll.toLocaleString(), accent: "#059669" },
              { label: "Batches Complete", value: batches.length.toString(), accent: "#3b82f6" },
              { label: "Latest Accuracy",  value: latestAcc !== null ? `${latestAcc.toFixed(1)}%` : "—", accent: delta !== null && delta >= 0 ? "#059669" : "#ef4444" },
              { label: "Heuristics Stored", value: totalHeuristics.toString(), accent: "#8b5cf6" },
            ].map(({ label, value, accent }) => (
              <div key={label} className="border border-slate-100 p-3 bg-slate-50 flex flex-col justify-between">
                <p className="text-[9px] text-slate-400 uppercase tracking-widest font-semibold leading-tight">{label}</p>
                <p className="text-xl font-bold mt-2 leading-none" style={{ color: accent }}>{value}</p>
              </div>
            ))}
          </div>

          {/* Current batch progress */}
          {running && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                <span>Batch {batchNumber} progress</span>
                <span>{currentBatchTiles.length} / {totalTiles || "?"}</span>
              </div>
              <div className="h-1.5 bg-slate-100 w-full">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: totalTiles > 0 ? `${(currentBatchTiles.length / totalTiles) * 100}%` : "0%" }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Confusion pair trends — full width ─────────────────────────────────── */}
      <div className="border-b border-slate-200 p-6" style={{ height: 220 }}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Confusion Pair Error Rates</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {topPairs.length > 0
                ? `Tracking top ${topPairs.length} misclassification pairs — lower is better`
                : "No confusion data yet"}
            </p>
          </div>
          {topPairs.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 justify-end">
              {topPairs.map((p, i) => (
                <div key={p} className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <span className="w-2 h-0.5 inline-block" style={{ background: PAIR_COLORS[i] }} />
                  {formatPairLabel(p)}
                </div>
              ))}
            </div>
          )}
        </div>

        {confusionData.length > 0 ? (
          <ResponsiveContainer width="100%" height={140}>
            <LineChart data={confusionData} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="batch" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
              <YAxis tickFormatter={(v) => `${v}%`} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [`${v}%`, formatPairLabel(name)]} labelFormatter={(l) => `Batch ${l}`} cursor={{ stroke: "#e2e8f0" }} />
              {topPairs.map((pair, i) => (
                <Line key={pair} type="monotone" dataKey={pair} stroke={PAIR_COLORS[i]} strokeWidth={1.5}
                  dot={{ r: 2.5, fill: PAIR_COLORS[i], strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: PAIR_COLORS[i], stroke: "#fff", strokeWidth: 1.5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-36 flex items-center justify-center text-xs text-slate-300">
            Confusion pairs appear after the first batch
          </div>
        )}
      </div>
    </div>
  );
}
