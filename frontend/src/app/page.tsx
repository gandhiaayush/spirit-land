"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfusionBreakdown from "@/components/ConfusionBreakdown";
import HeuristicsList from "@/components/HeuristicsList";
import TileCarousel from "@/components/TileCarousel";
import type { BatchRecord, PipelineStep, SSEEvent, Session, TileRecord } from "@/types";

export default function Home() {
  const [session, setSession]         = useState<Session | null>(null);
  const [batches, setBatches]         = useState<BatchRecord[]>([]);
  const [running, setRunning]         = useState(false);
  const [currentBatch, setCurrentBatch] = useState<number | null>(null);
  const [currentStep, setCurrentStep]   = useState<PipelineStep | null>(null);
  const [currentBatchTiles, setCurrentBatchTiles] = useState<TileRecord[]>([]);
  const [totalTilesInBatch, setTotalTilesInBatch] = useState(0);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [nextFocus, setNextFocus] = useState<string[]>([]);

  // Run controls
  const [numBatches, setNumBatches] = useState(5);
  const [batchSize, setBatchSize]   = useState(20);

  // Dataset source
  const [datasetMode, setDatasetMode] = useState<"demo" | "upload">("demo");
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  const STEP_LABELS: Record<PipelineStep, string> = {
    retrieving: "Retrieving heuristics",
    classifying: "Classifying tiles",
    scoring: "Scoring predictions",
    extracting: "Extracting error patterns",
    storing: "Persisting to session",
  };

  useEffect(() => {
    fetch("/api/session")
      .then((r) => (r.status === 204 ? null : r.json()))
      .then((data: Session | null) => {
        if (data) { setSession(data); setBatches(data.batches ?? []); }
      })
      .catch(() => {});
  }, []);

  const connectSSE = useCallback(() => {
    if (esRef.current) esRef.current.close();
    const es = new EventSource("/api/stream");
    esRef.current = es;

    es.onmessage = (e) => {
      const event: SSEEvent = JSON.parse(e.data);

      if (event.type === "session_created" || event.type === "session_resumed" || event.type === "session_state") {
        setSession(event.session);
        setBatches(event.session.batches ?? []);
      } else if (event.type === "batch_start") {
        setCurrentBatch(event.batch_number);
        setCurrentStep(null);
        setCurrentBatchTiles([]);
        setTotalTilesInBatch(0);
      } else if (event.type === "step") {
        setCurrentStep(event.step);
      } else if (event.type === "tile_classified") {
        setTotalTilesInBatch(event.total_tiles);
        setCurrentBatchTiles((prev) => [...prev, event.tile]);
      } else if (event.type === "batch_complete") {
        setSession(event.session);
        setCurrentStep(null);
        setBatches((prev) => {
          const exists = prev.some((b) => b.batch_number === event.batch.batch_number);
          return exists
            ? prev.map((b) => (b.batch_number === event.batch.batch_number ? event.batch : b))
            : [...prev, event.batch];
        });
      } else if (event.type === "next_focus") {
        setNextFocus(event.classes);
      } else if (event.type === "run_complete") {
        setRunning(false);
        setCurrentBatch(null);
        setCurrentStep(null);
        es.close();
      }
    };

    es.onerror = () => { es.close(); setRunning(false); };
  }, []);

  const handleStart = useCallback(async () => {
    setUploadError(null);

    // If using uploaded images, push them first and resolve a dataset_dir.
    let datasetDir: string | null = null;
    if (datasetMode === "upload") {
      if (!uploadFiles || uploadFiles.length === 0) {
        setUploadError("Select at least one image to upload.");
        return;
      }
      try {
        const form = new FormData();
        Array.from(uploadFiles).forEach((f) => form.append("files", f));
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const data: { dataset_dir: string } = await res.json();
        datasetDir = data.dataset_dir;
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed.");
        return;
      }
    }

    setRunning(true);
    setNextFocus([]);
    // Switch the ablation arm before the run: Memory On → reflective, Memory Off → cold.
    try {
      await fetch(`/api/arm?arm=${memoryEnabled ? "reflective" : "cold"}`, { method: "POST" });
    } catch {
      // non-blocking: proceed with the run even if arm switch fails
    }
    connectSSE();
    let runUrl = `/api/run?num_batches=${numBatches}&batch_size=${batchSize}`;
    if (datasetDir) runUrl += `&dataset_dir=${encodeURIComponent(datasetDir)}`;
    await fetch(runUrl, { method: "POST" });
  }, [connectSSE, numBatches, batchSize, memoryEnabled, datasetMode, uploadFiles]);

  const handleClear = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" });
    setSession(null);
    setBatches([]);
    setCurrentBatch(null);
    setCurrentStep(null);
    setCurrentBatchTiles([]);
    setTotalTilesInBatch(0);
    setCorrections({});
    setNextFocus([]);
  }, []);

  const handleCorrection = useCallback((tile: TileRecord, label: string) => {
    setCorrections((prev) => ({ ...prev, [tile.tile_id]: label }));
  }, []);

  const hasTiles = currentBatchTiles.length > 0;

  return (
    <div className="min-h-screen bg-white">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-0 h-12 flex items-stretch border-x border-slate-200">

          {/* Logo */}
          <div className="flex items-center gap-2.5 px-5 border-r border-slate-200">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span className="text-sm font-bold tracking-tight text-slate-900">SubStrata</span>
          </div>

          {/* Status */}
          <div className="flex flex-col items-end justify-center px-4 ml-auto gap-0.5">
            {running ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 bg-emerald-500 animate-pulse" style={{ borderRadius: "0 !important" }} />
                {currentStep ? `${STEP_LABELS[currentStep]}…` : "Running…"}
              </div>
            ) : session ? (
              <span className="text-[11px] text-slate-400 font-mono">{session.current_batch_number} batch{session.current_batch_number !== 1 ? "es" : ""}</span>
            ) : null}
            {memoryEnabled && nextFocus.length > 0 && (
              <span className="text-[10px] text-emerald-700/70 font-medium">
                Next batch targeting: {nextFocus.map((c) => c.replace(/_/g, " ")).join(", ")}
              </span>
            )}
          </div>

          {/* Memory toggle — Apple-style switch, far right */}
          <div className="flex items-center gap-2.5 px-5 border-l border-slate-200">
            <span className="text-xs font-semibold tracking-wide text-slate-500">Memory</span>
            <button
              role="switch"
              aria-checked={memoryEnabled}
              aria-label="Toggle memory"
              onClick={() => setMemoryEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-400/50 ${
                memoryEnabled ? "bg-emerald-600" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                  memoryEnabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main dashboard surface ─────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto border-x border-b border-slate-200">

        {/* Control bar */}
        <div className="border-b border-slate-200 flex items-stretch flex-wrap">
          <div className="flex items-center gap-6 px-6 py-3 border-r border-slate-200">
            <div className="flex flex-col gap-0.5">
              <label className="label">Batches</label>
              <input
                type="number" min={1} max={20} value={numBatches}
                onChange={(e) => setNumBatches(Number(e.target.value))}
                disabled={running}
                className="w-16 bg-white border border-slate-200 px-2 py-1 text-slate-900 text-sm focus:outline-none focus:border-emerald-400 disabled:opacity-40"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="label">Tiles / Batch</label>
              <input
                type="number" min={1} max={100} value={batchSize}
                onChange={(e) => setBatchSize(Number(e.target.value))}
                disabled={running}
                className="w-20 bg-white border border-slate-200 px-2 py-1 text-slate-900 text-sm focus:outline-none focus:border-emerald-400 disabled:opacity-40"
              />
            </div>
          </div>

          {/* Dataset source */}
          <div className="flex flex-col gap-0.5 px-5 py-3 border-r border-slate-200">
            <label className="label">Dataset</label>
            <select
              value={datasetMode}
              onChange={(e) => { setDatasetMode(e.target.value as "demo" | "upload"); setUploadError(null); }}
              disabled={running}
              className="bg-white border border-slate-200 px-2 py-1 text-slate-900 text-sm focus:outline-none focus:border-emerald-400 disabled:opacity-40"
            >
              <option value="demo">Google EarthEngine (Sample)</option>
              <option value="upload">Upload files</option>
            </select>
            {datasetMode === "upload" && (
              <div className="flex flex-col gap-0.5 mt-1">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  disabled={running}
                  onChange={(e) => { setUploadFiles(e.target.files); setUploadError(null); }}
                  className="text-[11px] text-slate-500 file:mr-2 file:border file:border-slate-200 file:bg-white file:px-2 file:py-0.5 file:text-[11px] file:text-slate-600 hover:file:bg-slate-50 disabled:opacity-40"
                />
                {uploadError && (
                  <span className="text-[11px] text-red-500">{uploadError}</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 px-5 py-3">
            <button
              onClick={handleClear}
              disabled={running}
              className="px-4 py-1.5 text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-700 transition disabled:opacity-30"
            >
              Clear
            </button>
            <button
              onClick={handleStart}
              disabled={running}
              className="px-6 py-1.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:bg-slate-200 disabled:text-slate-400"
            >
              {running ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white animate-spin-slow" />
                  Running…
                </span>
              ) : "Start Run"}
            </button>
          </div>

          {/* Session info */}
          {session && (
            <div className="flex items-center gap-4 px-5 py-3 ml-auto border-l border-slate-200 text-[11px] text-slate-400">
              <span className="font-mono truncate max-w-48">{session.session_id}</span>
            </div>
          )}
        </div>

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {!hasTiles && !running && (
          <div className="flex flex-col items-center justify-center py-24 px-6 text-center border-b border-slate-200">
            <div className="w-12 h-12 border border-slate-200 flex items-center justify-center mb-5 bg-slate-50">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-slate-900 mb-2">SubStrata</h1>
            <p className="text-sm text-slate-400 max-w-md leading-relaxed">
              {memoryEnabled
                ? "Memory-driven land-cover classification. Each batch improves from accumulated error patterns stored in the memory graph."
                : "Base model mode — memory graph disabled. Classifications use the model directly without heuristic context."}
            </p>
            {batches.length > 0 && (
              <p className="text-xs text-slate-300 mt-4">{batches.length} prior batch{batches.length !== 1 ? "es" : ""} in session</p>
            )}
          </div>
        )}

        {/* ── Tile carousel + info + bottom grid ───────────────────────────── */}
        {(hasTiles || running) && (
          <TileCarousel
            tiles={currentBatchTiles}
            batchNumber={currentBatch}
            totalTiles={totalTilesInBatch}
            batches={batches}
            running={running}
            memoryEnabled={memoryEnabled}
            onCorrection={handleCorrection}
            corrections={corrections}
          />
        )}

        {/* ── Memory-gated: confusion + heuristics ─────────────────────────── */}
        {memoryEnabled && batches.length > 0 && (
          <div className="grid grid-cols-2 border-t border-slate-200 divide-x divide-slate-200">
            <ConfusionBreakdown batches={batches} />
            <HeuristicsList batches={batches} />
          </div>
        )}

        {/* Memory Off notice */}
        {!memoryEnabled && batches.length > 0 && (
          <div className="border-t border-slate-200 px-8 py-6 bg-slate-50">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-widest mb-1">Memory Disabled</p>
            <p className="text-sm text-slate-500">
              Error patterns and heuristics are not being accumulated. Toggle Memory On to enable the self-improving loop.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-200 px-6 py-4 flex items-center justify-between text-[11px] text-slate-300">
          <span>SubStrata — 2026 AI Engineer World&apos;s Fair Hackathon</span>
          <div className="flex items-center gap-3">
            <span>Gemini 3.5</span>
            <span>·</span>
            <span>Google Interactions API</span>
            <span>·</span>
            <span>Next.js 14</span>
          </div>
        </div>
      </main>
    </div>
  );
}
