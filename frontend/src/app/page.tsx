"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AccuracyChart from "@/components/AccuracyChart";
import ConfusionBreakdown from "@/components/ConfusionBreakdown";
import HeuristicsList from "@/components/HeuristicsList";
import RunControls from "@/components/RunControls";
import type { BatchRecord, SSEEvent, Session } from "@/types";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [currentBatch, setCurrentBatch] = useState<number | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const esRef = useRef<EventSource | null>(null);

  // Load existing session on mount
  useEffect(() => {
    fetch("/api/session")
      .then((r) => (r.status === 204 ? null : r.json()))
      .then((data: Session | null) => {
        if (data) {
          setSession(data);
          setBatches(data.batches ?? []);
          setStatusMsg(`Resumed session ${data.session_id}`);
        }
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
        setStatusMsg(`Running batch ${event.batch_number}…`);
      } else if (event.type === "batch_complete") {
        setSession(event.session);
        setBatches((prev) => {
          const exists = prev.some((b) => b.batch_number === event.batch.batch_number);
          return exists ? prev.map((b) => b.batch_number === event.batch.batch_number ? event.batch : b) : [...prev, event.batch];
        });
        setStatusMsg(`Batch ${event.batch.batch_number} — accuracy ${(event.batch.overall_accuracy * 100).toFixed(1)}%`);
      } else if (event.type === "run_complete") {
        setRunning(false);
        setCurrentBatch(null);
        setStatusMsg("Run complete");
        es.close();
      }
    };

    es.onerror = () => {
      es.close();
      setRunning(false);
    };
  }, []);

  const handleStart = useCallback(
    async (numBatches: number, batchSize: number) => {
      setRunning(true);
      setStatusMsg("Starting…");
      connectSSE();
      await fetch(`/api/run?num_batches=${numBatches}&batch_size=${batchSize}`, {
        method: "POST",
      });
    },
    [connectSSE],
  );

  const handleClear = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" });
    setSession(null);
    setBatches([]);
    setCurrentBatch(null);
    setStatusMsg("Session cleared");
  }, []);

  return (
    <main className="max-w-5xl mx-auto px-6 py-10 space-y-6">
      {/* Header */}
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">SubStrata</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Self-improving land-cover classification
          </p>
        </div>
        {statusMsg && (
          <span className="text-xs text-emerald-400 bg-emerald-950 border border-emerald-800 rounded-full px-3 py-1">
            {statusMsg}
          </span>
        )}
      </div>

      {/* Session meta */}
      {session && (
        <div className="text-xs text-gray-600 space-x-4">
          <span>Session: <span className="text-gray-400">{session.session_id}</span></span>
          <span>Batches: <span className="text-gray-400">{session.current_batch_number}</span></span>
        </div>
      )}

      {/* Controls */}
      <RunControls
        running={running}
        currentBatch={currentBatch}
        onStart={handleStart}
        onClear={handleClear}
      />

      {/* Charts */}
      <AccuracyChart batches={batches} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ConfusionBreakdown batches={batches} />
        <HeuristicsList batches={batches} />
      </div>
    </main>
  );
}
