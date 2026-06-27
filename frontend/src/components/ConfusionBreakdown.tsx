"use client";

import type { BatchRecord } from "@/types";

interface Props {
  batches: BatchRecord[];
}

// Dynamic World land-cover classes. Keys are `${true_label}_${predicted_label}`.
const DW_CLASSES = [
  "trees", "shrub_and_scrub", "grass", "crops", "flooded_vegetation",
  "water", "snow_and_ice", "built", "bare",
];

function formatPair(key: string): [string, string] {
  // Match the longest valid DW class prefix as the `true` label, leaving the
  // remainder as the `pred` label (e.g. "shrub_and_scrub_trees" → ["shrub_and_scrub", "trees"]).
  let best: [string, string] | null = null;
  for (const cls of DW_CLASSES) {
    if (key.startsWith(cls + "_") && key.length > cls.length + 1) {
      const rest = key.slice(cls.length + 1);
      if (DW_CLASSES.includes(rest) && (!best || cls.length > best[0].length)) {
        best = [cls, rest];
      }
    }
  }
  if (best) return best;
  const idx = key.indexOf("_");
  return idx >= 0 ? [key.slice(0, idx), key.slice(idx + 1)] : [key, "?"];
}

function fmt(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ConfusionBreakdown({ batches }: Props) {
  const latest = batches[batches.length - 1];
  const prev = batches[batches.length - 2];
  const pairs = latest ? Object.entries(latest.per_confusion_pair_error_rate) : [];
  const sorted = [...pairs].sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 flex flex-col">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="label mb-1">Confusion Pairs</h2>
          <p className="text-xs text-slate-400">
            {latest ? `Batch ${latest.batch_number}` : "No data yet"} — classes most often mis-labeled
          </p>
        </div>
        {latest && (
          <span className="text-[10px] font-medium px-2 py-0.5 bg-red-50 text-red-600 border border-red-100">
            {sorted.length} active
          </span>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-300 py-8">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm text-slate-400">No errors recorded yet</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {sorted.map(([pair, rate]) => {
            const [trueLabel, predLabel] = formatPair(pair);
            const pct = rate * 100;
            const prevRate = prev?.per_confusion_pair_error_rate[pair];
            const trend =
              prevRate !== undefined
                ? rate < prevRate
                  ? "better"
                  : rate > prevRate
                  ? "worse"
                  : "same"
                : null;

            return (
              <li key={pair}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs">
                    <span className="text-amber-600 font-medium">{fmt(trueLabel)}</span>
                    <span className="text-slate-300 mx-1.5">→</span>
                    <span className="text-red-500 font-medium">{fmt(predLabel)}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    {trend && (
                      <span
                        className={`text-[10px] font-semibold ${
                          trend === "better"
                            ? "text-emerald-600"
                            : trend === "worse"
                            ? "text-red-500"
                            : "text-slate-400"
                        }`}
                      >
                        {trend === "better" ? "↓ improving" : trend === "worse" ? "↑ worse" : "→ same"}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-slate-600">{pct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-red-400 to-red-500 transition-all duration-700"
                    style={{ width: `${Math.min(pct * 5, 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
