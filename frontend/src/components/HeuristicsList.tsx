"use client";

import type { BatchRecord } from "@/types";

interface Props {
  batches: BatchRecord[];
}

export default function HeuristicsList({ batches }: Props) {
  // Collect all unique heuristic IDs seen across batches, in order of first appearance
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const b of batches) {
    for (const id of b.active_heuristic_ids) {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 h-full">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">
        Active Heuristics
        {ids.length > 0 && (
          <span className="ml-2 text-emerald-400">{ids.length}</span>
        )}
      </h2>
      {ids.length === 0 ? (
        <p className="text-gray-600 text-sm">No heuristics yet — they appear after the first batch.</p>
      ) : (
        <ul className="space-y-2 overflow-y-auto max-h-64">
          {ids.map((id) => (
            <li
              key={id}
              className="text-xs text-gray-300 bg-gray-800 rounded-lg px-3 py-2 font-mono border border-gray-700"
            >
              {id}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
