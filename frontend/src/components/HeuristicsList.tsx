"use client";

import { useEffect, useMemo, useState } from "react";
import type { BatchRecord, GraphNode, GraphResponse } from "@/types";

interface Props {
  batches: BatchRecord[];
}

export default function HeuristicsList({ batches }: Props) {
  // Map of heuristic node id -> node, sourced from the live memory graph.
  const [heuristicMap, setHeuristicMap] = useState<Record<string, GraphNode>>({});

  // Re-fetch the graph whenever a new batch arrives so fresh heuristics appear.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/graph")
      .then((r) => (r.ok ? (r.json() as Promise<GraphResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        const map: Record<string, GraphNode> = {};
        for (const node of data.nodes) {
          if (node.type === "heuristic") map[node.id] = node;
        }
        setHeuristicMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [batches.length]);

  const entries = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; addedBatch: number }[] = [];
    for (const b of batches) {
      for (const id of b.active_heuristic_ids) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push({ id, addedBatch: b.batch_number });
        }
      }
    }
    return out;
  }, [batches]);

  const total = entries.length;

  return (
    <div className="p-6 flex flex-col">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="label mb-1">Memory Graph</h2>
          <p className="text-xs text-slate-400">Heuristics accumulated across all batches</p>
        </div>
        {total > 0 && (
          <span className="text-[10px] font-medium px-2 py-0.5 bg-violet-50 text-violet-600 border border-violet-100">
            {total} heuristic{total !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-300 py-8">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" />
            <line x1="12" y1="9" x2="19" y2="7" /><line x1="12" y1="15" x2="5" y2="17" />
          </svg>
          <p className="text-sm text-slate-400">No heuristics yet</p>
          <p className="text-xs text-slate-300">They appear after the first batch with errors</p>
        </div>
      ) : (
        <ul className="space-y-2 overflow-y-auto max-h-64 pr-1">
          {entries.map(({ id, addedBatch }) => {
            const node = heuristicMap[id];
            const text = node?.text ?? id;
            const meta: string[] = [];
            if (node?.applies_to_class) {
              meta.push(node.applies_to_class.replace(/_/g, " "));
            }
            if (node?.confidence_weight !== undefined) {
              meta.push(`weight ${node.confidence_weight.toFixed(2)}`);
            }

            return (
              <li
                key={id}
                className="group flex items-start gap-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-xl px-3 py-2.5 transition-all duration-150"
              >
                <div className="mt-0.5 w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs text-slate-700 leading-relaxed ${
                      node?.text ? "" : "font-mono truncate"
                    }`}
                  >
                    {text}
                  </p>
                  {meta.length > 0 && (
                    <p className="text-[10px] text-slate-400 mt-0.5">{meta.join(" · ")}</p>
                  )}
                  <p className="text-[10px] text-slate-400 mt-0.5">Added in batch {addedBatch}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {total > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-3">
          <div className="text-center">
            <p className="text-lg font-bold text-violet-600">{total}</p>
            <p className="text-[10px] text-slate-400">Heuristics</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-600">{batches.length}</p>
            <p className="text-[10px] text-slate-400">Batches Processed</p>
          </div>
        </div>
      )}
    </div>
  );
}
