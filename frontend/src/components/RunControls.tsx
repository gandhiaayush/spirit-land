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
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">
        Run Controls
      </h2>

      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Batches
          <input
            type="number"
            min={1}
            max={20}
            value={numBatches}
            onChange={(e) => setNumBatches(Number(e.target.value))}
            disabled={running}
            className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100 text-sm focus:outline-none focus:border-emerald-500"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Tiles / Batch
          <input
            type="number"
            min={1}
            max={100}
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value))}
            disabled={running}
            className="w-24 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-100 text-sm focus:outline-none focus:border-emerald-500"
          />
        </label>

        <button
          onClick={() => onStart(numBatches, batchSize)}
          disabled={running}
          className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
        >
          {running ? `Running batch ${currentBatch ?? "…"}` : "Start Run"}
        </button>

        <button
          onClick={onClear}
          disabled={running}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-400 text-sm rounded-lg transition border border-gray-700"
        >
          Clear Session
        </button>
      </div>
    </div>
  );
}
