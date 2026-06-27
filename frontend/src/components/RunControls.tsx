"use client";

import { useState } from "react";

interface Props {
  running: boolean;
  currentBatch: number | null;
  onStart: (numBatches: number, batchSize: number) => void;
  onClear: () => void;
}

export default function RunControls({ running, currentBatch, onStart, onClear }: Props) {
  const [numBatches, setNumBatches] = useState(5);
  const [batchSize, setBatchSize] = useState(20);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-4 flex-1 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="label">Batches</label>
            <input
              type="number"
              min={1}
              max={20}
              value={numBatches}
              onChange={(e) => setNumBatches(Number(e.target.value))}
              disabled={running}
              className="w-20 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition disabled:opacity-40 disabled:bg-slate-50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="label">Tiles / Batch</label>
            <input
              type="number"
              min={1}
              max={100}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              disabled={running}
              className="w-24 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-900 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition disabled:opacity-40 disabled:bg-slate-50"
            />
          </div>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={onClear}
            disabled={running}
            className="px-4 py-2 text-slate-500 hover:text-slate-700 text-sm rounded-lg border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Clear
          </button>
          <button
            onClick={() => onStart(numBatches, batchSize)}
            disabled={running}
            className="relative px-6 py-2 text-sm font-semibold rounded-lg transition-all duration-200 disabled:cursor-not-allowed overflow-hidden
              bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/20 hover:shadow-emerald-500/30
              disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                Batch {currentBatch ?? "…"} running
              </span>
            ) : (
              "Start Run"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
