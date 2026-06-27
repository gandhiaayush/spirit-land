"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ArchitectureDiagram from "@/components/ArchitectureDiagram";
import ConfusionBreakdown from "@/components/ConfusionBreakdown";
import HeuristicsList from "@/components/HeuristicsList";
import ImprovementGraph from "@/components/ImprovementGraph";
import TileCarousel from "@/components/TileCarousel";
import type { BatchRecord, PipelineStep, SSEEvent, Session, TileRecord } from "@/types";

type View = "dashboard" | "graph";

export default function Home() {
  const [session, setSession]           = useState<Session | null>(null);
  const [batches, setBatches]           = useState<BatchRecord[]>([]);
  const [running, setRunning]           = useState(false);
  const [currentBatch, setCurrentBatch] = useState<number | null>(null);
  const [currentStep, setCurrentStep]   = useState<PipelineStep | null>(null);
  const [currentBatchTiles, setCurrentBatchTiles] = useState<TileRecord[]>([]);
  const [totalTilesInBatch, setTotalTilesInBatch] = useState(0);
  const [corrections, setCorrections]   = useState<Record<string, string>>({});
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [view, setView]                 = useState<View>("dashboard");

  const [numBatches, setNumBatches] = useState(5);
  const [batchSize, setBatchSize]   = useState(20);

  const esRef = useRef<EventSource | null>(null);

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
    setRunning(true);
    connectSSE();
    await fetch(`/api/run?num_batches=${numBatches}&batch_size=${batchSize}`, { method: "POST" });
  }, [connectSSE, numBatches, batchSize]);

  const handleClear = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" });
    setSession(null);
    setBatches([]);
    setCurrentBatch(null);
    setCurrentStep(null);
    setCurrentBatchTiles([]);
    setTotalTilesInBatch(0);
    setCorrections({});
  }, []);

  const handleCorrection = useCallback((tile: TileRecord, label: string) => {
    setCorrections((prev) => ({ ...prev, [tile.tile_id]: label }));
  }, []);

  const hasTiles = currentBatchTiles.length > 0;

  return (
    <div className="min-h-screen bg-white">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200">
        <div className="flex items-stretch h-12">

          {/* Logo */}
          <div className="flex items-center gap-2.5 px-5 border-r border-slate-200 shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
            <span className="text-sm font-bold tracking-tight text-slate-900">SubStrata</span>
          </div>

          {/* View tabs */}
          <div className="flex items-stretch border-r border-slate-200">
            {(["dashboard", "graph"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-5 text-xs font-semibold tracking-wide border-r border-slate-200 last:border-r-0 transition-colors ${
                  view === v
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                {v === "dashboard" ? "Dashboard" : "Improvement Graph"}
              </button>
            ))}
          </div>

          {/* Memory toggle */}
          <div className="flex items-stretch border-r border-slate-200">
            <button
              onClick={() => setMemoryEnabled(true)}
              className={`px-4 text-xs font-semibold tracking-wide transition-colors ${
                memoryEnabled ? "bg-emerald-600 text-white" : "bg-white text-slate-400 hover:text-slate-600"
              }`}
            >
              Memory On
            </button>
            <button
              onClick={() => setMemoryEnabled(false)}
              className={`px-4 text-xs font-semibold tracking-wide border-l border-slate-200 transition-colors ${
                !memoryEnabled ? "bg-slate-800 text-white" : "bg-white text-slate-400 hover:text-slate-600"
              }`}
            >
              Memory Off
            </button>
          </div>

          {/* Status */}
          <div className="flex items-center px-4 ml-auto shrink-0">
            {running ? (
              <div className="flex items-center gap-2 text-xs text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 bg-emerald-500 animate-pulse" />
                Batch {currentBatch ?? "…"}{currentStep ? ` — ${currentStep}` : ""}
              </div>
            ) : session ? (
              <span className="text-[11px] text-slate-400 font-mono">{session.current_batch_number} batch{session.current_batch_number !== 1 ? "es" : ""} done</span>
            ) : null}
          </div>
        </div>
      </header>

      {/* ── Control bar ───────────────────────────────────────────────────── */}
      <div className="border-b border-slate-200 bg-white flex items-stretch flex-wrap">
        <div className="flex items-center gap-6 px-6 py-3 border-r border-slate-200">
          <div className="flex flex-col gap-0.5">
            <label className="label">Batches</label>
            <input type="number" min={1} max={20} value={numBatches}
              onChange={(e) => setNumBatches(Number(e.target.value))} disabled={running}
              className="w-16 bg-white border border-slate-200 px-2 py-1 text-slate-900 text-sm focus:outline-none focus:border-emerald-400 disabled:opacity-40" />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="label">Tiles / Batch</label>
            <input type="number" min={1} max={100} value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))} disabled={running}
              className="w-20 bg-white border border-slate-200 px-2 py-1 text-slate-900 text-sm focus:outline-none focus:border-emerald-400 disabled:opacity-40" />
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 py-3">
          <button onClick={handleClear} disabled={running}
            className="px-4 py-1.5 text-sm text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-700 transition disabled:opacity-30">
            Clear
          </button>
          <button onClick={handleStart} disabled={running}
            className="px-6 py-1.5 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:bg-slate-200 disabled:text-slate-400">
            {running ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border-2 border-white/40 border-t-white animate-spin-slow" />
                Running…
              </span>
            ) : "Start Run"}
          </button>
        </div>
        {session && (
          <div className="flex items-center px-5 ml-auto border-l border-slate-200 text-[11px] text-slate-300 font-mono">
            {session.session_id}
          </div>
        )}
      </div>

      {/* ── Dashboard view ──────────────────────────────────────────────────── */}
      {view === "dashboard" && (
        <>
          {/* Empty state */}
          {!hasTiles && !running && (
            <div className="flex flex-col items-center justify-center py-28 text-center">
              <div className="w-12 h-12 border border-slate-200 flex items-center justify-center mb-5 bg-slate-50">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-slate-700 mb-2">SubStrata</p>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                {memoryEnabled
                  ? "Memory-driven land-cover classification. Start a run to see EuroSAT satellite imagery classified in real time."
                  : "Base model mode — memory disabled. Start a run for classification without heuristic context."}
              </p>
              {batches.length > 0 && (
                <p className="text-[11px] text-slate-300 mt-4 font-mono">{batches.length} prior batch{batches.length !== 1 ? "es" : ""} in session</p>
              )}
            </div>
          )}

          {/* Tile carousel — full width, no container */}
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

          {/* Memory sections — contained */}
          {memoryEnabled && batches.length > 0 && (
            <div className="max-w-7xl mx-auto w-full border-x border-slate-200">
              <div className="grid grid-cols-2 border-b border-slate-200 divide-x divide-slate-200">
                <ConfusionBreakdown batches={batches} />
                <HeuristicsList batches={batches} />
              </div>
            </div>
          )}

          {!memoryEnabled && batches.length > 0 && (
            <div className="max-w-7xl mx-auto w-full border-x border-b border-slate-200 px-8 py-6 bg-slate-50">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Memory Disabled</p>
              <p className="text-sm text-slate-400">Toggle Memory On to enable the self-improving heuristics loop.</p>
            </div>
          )}

          {/* Architecture */}
          <div className="max-w-7xl mx-auto w-full border-x border-b border-slate-200">
            <ArchitectureDiagram />
          </div>

          {/* Footer */}
          <div className="max-w-7xl mx-auto w-full border-x border-b border-slate-200 px-6 py-4 flex items-center justify-between text-[11px] text-slate-300">
            <span>SubStrata — 2026 AI Engineer World&apos;s Fair Hackathon</span>
            <span>Gemini 3.5 · Google Interactions API · Next.js 14</span>
          </div>
        </>
      )}

      {/* ── Improvement graph view ───────────────────────────────────────────── */}
      {view === "graph" && (
        <div className="max-w-7xl mx-auto w-full border-x border-b border-slate-200 flex flex-col" style={{ minHeight: "calc(100vh - 96px)" }}>
          <ImprovementGraph
            batches={batches}
            currentBatchTiles={currentBatchTiles}
            batchNumber={currentBatch}
            totalTiles={totalTilesInBatch}
            currentStep={currentStep}
            running={running}
          />
        </div>
      )}
    </div>
  );
}
