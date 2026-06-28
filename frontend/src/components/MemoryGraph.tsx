"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { GraphNode, GraphResponse } from "@/types";

// react-force-graph needs the browser (canvas + window). Load it client-only.
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const COLORS: Record<GraphNode["type"], string> = {
  class: "#94a3b8",
  error_pattern: "#C4281B",
  heuristic: "#10b981",
};

interface FGNode {
  id: string;
  type: GraphNode["type"];
  label: string;
  val: number;
}

interface FGLink {
  source: string;
  target: string;
}

interface FGData {
  nodes: FGNode[];
  links: FGLink[];
}

export default function MemoryGraph() {
  const [data, setData] = useState<FGData>({ nodes: [], links: [] });
  const [arm, setArm] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // ForceGraph2D instance ref — used for the Zoom In / Zoom Out buttons.
  const fgRef = useRef<any>(null);

  // Container sizing so the canvas fills the available width.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 560 });

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/graph")
      .then((r) => (r.ok ? (r.json() as Promise<GraphResponse>) : null))
      .then((g) => {
        if (!g) return;
        const nodes: FGNode[] = g.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          label: n.type === "heuristic" ? n.text ?? n.id : n.id,
          val: n.type === "class" ? 4 : 8,
        }));
        const links: FGLink[] = g.edges.map((e) => ({
          source: e.source,
          target: e.target,
        }));
        setData({ nodes, links });
        setArm(g.arm ?? "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () =>
      setDims({ width: el.clientWidth, height: Math.max(el.clientHeight, 480) });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const fg = fgRef.current;
    if (!fg) return;
    const current = fg.zoom();
    fg.zoom(current * factor, 250);
  }, []);

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="label mb-1">Memory Graph</h2>
          <p className="text-xs text-slate-400">
            Classes, error patterns, and heuristics{arm ? ` — ${arm} arm` : ""}. Scroll to
            zoom, drag to pan.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => zoomBy(1.3)}
            className="px-3 py-1.5 text-xs font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-700 transition"
          >
            Zoom In
          </button>
          <button
            onClick={() => zoomBy(0.7)}
            className="px-3 py-1.5 text-xs font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-700 transition"
          >
            Zoom Out
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-40"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 text-[11px] text-slate-500">
        {(
          [
            ["class", "Class"],
            ["error_pattern", "Error pattern"],
            ["heuristic", "Heuristic"],
          ] as const
        ).map(([type, label]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full inline-block"
              style={{ background: COLORS[type] }}
            />
            {label}
          </span>
        ))}
      </div>

      <div
        ref={wrapRef}
        className="relative border border-slate-200 bg-slate-50 overflow-hidden"
        style={{ height: 560 }}
      >
        {data.nodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-300">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" />
              <line x1="12" y1="9" x2="19" y2="7" /><line x1="12" y1="15" x2="5" y2="17" />
            </svg>
            <p className="text-sm text-slate-400">No graph data yet</p>
            <p className="text-xs text-slate-300">Run a batch with errors to populate the memory graph</p>
          </div>
        ) : (
          <ForceGraph2D
            ref={fgRef}
            graphData={data}
            width={dims.width}
            height={dims.height}
            backgroundColor="#f8fafc"
            nodeLabel={(n: any) => n.label as string}
            nodeColor={(n: any) => COLORS[(n as FGNode).type]}
            nodeVal={(n: any) => (n as FGNode).val}
            nodeRelSize={4}
            linkColor={() => "#cbd5e1"}
            linkWidth={1}
            linkDirectionalArrowLength={3}
            linkDirectionalArrowRelPos={1}
          />
        )}
      </div>
    </div>
  );
}
