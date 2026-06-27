"use client";

import type { BatchRecord } from "@/types";

interface StatCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  sub?: string;
  icon: React.ReactNode;
  accentClass?: string;
}

function StatCard({ label, value, delta, deltaPositive, sub, icon, accentClass = "text-emerald-600" }: StatCardProps) {
  return (
    <div className="card card-hover p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className={`${accentClass} opacity-60`}>{icon}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={`text-3xl font-bold tracking-tight ${accentClass}`}>{value}</span>
        {delta && (
          <span className={`text-xs font-semibold pb-1 ${deltaPositive ? "text-emerald-600" : "text-red-500"}`}>
            {deltaPositive ? "↑" : "↓"} {delta}
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

interface Props {
  batches: BatchRecord[];
  running: boolean;
}

export default function StatCards({ batches, running }: Props) {
  const latest = batches[batches.length - 1];
  const first = batches[0];

  const currentAccuracy = latest ? `${(latest.overall_accuracy * 100).toFixed(1)}%` : "—";
  const accuracyDelta =
    latest && first && batches.length > 1
      ? `${((latest.overall_accuracy - first.overall_accuracy) * 100).toFixed(1)}%`
      : undefined;
  const accuracyPositive = latest && first ? latest.overall_accuracy >= first.overall_accuracy : true;

  const totalTiles = batches.reduce((sum, b) => sum + (b.tile_count ?? 0), 0);
  const uniqueHeuristics = new Set(batches.flatMap((b) => b.active_heuristic_ids)).size;
  const allPairs = new Set(batches.flatMap((b) => Object.keys(b.per_confusion_pair_error_rate)));

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Current Accuracy"
        value={currentAccuracy}
        delta={accuracyDelta}
        deltaPositive={accuracyPositive}
        sub={batches.length > 1 ? "vs. batch 1 baseline" : "waiting for first batch"}
        icon={<AccuracyIcon />}
        accentClass="text-emerald-600"
      />
      <StatCard
        label="Tiles Classified"
        value={totalTiles > 0 ? totalTiles.toLocaleString() : "—"}
        sub={`across ${batches.length} batch${batches.length !== 1 ? "es" : ""}`}
        icon={<TilesIcon />}
        accentClass="text-blue-600"
      />
      <StatCard
        label="Heuristics Active"
        value={uniqueHeuristics > 0 ? String(uniqueHeuristics) : "—"}
        sub="rules stored in memory graph"
        icon={<HeuristicsIcon />}
        accentClass="text-violet-600"
      />
      <StatCard
        label="Error Patterns"
        value={allPairs.size > 0 ? String(allPairs.size) : "—"}
        sub="unique confusion pairs found"
        icon={<PatternsIcon />}
        accentClass="text-amber-600"
      />
    </div>
  );
}

function AccuracyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  );
}
function TilesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}
function HeuristicsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" />
      <line x1="12" y1="9" x2="19" y2="7" /><line x1="12" y1="15" x2="5" y2="17" />
    </svg>
  );
}
function PatternsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
