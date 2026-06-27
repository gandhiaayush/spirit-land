"use client";

import type { BatchRecord } from "@/types";

interface Props {
  batches: BatchRecord[];
}

export default function ConfusionBreakdown({ batches }: Props) {
  const latest = batches[batches.length - 1];
  const pairs = latest ? Object.entries(latest.per_confusion_pair_error_rate) : [];

  const sorted = [...pairs].sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">
        Confusion Pairs{" "}
        <span className="text-gray-600 font-normal normal-case">
          (latest batch)
        </span>
      </h2>
      {sorted.length === 0 ? (
        <p className="text-gray-600 text-sm">No errors recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map(([pair, rate]) => {
            const [trueLabel, predLabel] = pair.split("_");
            const pct = Math.round(rate * 100 * 10) / 10;
            return (
              <li key={pair} className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-40 shrink-0">
                  <span className="text-amber-400">{trueLabel}</span>
                  {" → "}
                  <span className="text-rose-400">{predLabel}</span>
                </span>
                <div className="flex-1 bg-gray-800 rounded-full h-2">
                  <div
                    className="bg-rose-500 h-2 rounded-full"
                    style={{ width: `${Math.min(pct * 4, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400 w-10 text-right">{pct}%</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
