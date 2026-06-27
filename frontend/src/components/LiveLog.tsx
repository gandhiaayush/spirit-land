"use client";

import { useEffect, useRef } from "react";

export interface LogEntry {
  id: string;
  timestamp: string;
  type: "info" | "success" | "error" | "warn" | "step" | "correction";
  message: string;
}

const STYLES: Record<LogEntry["type"], { color: string; prefix: string }> = {
  info:       { color: "text-slate-500",   prefix: "·" },
  success:    { color: "text-emerald-600",  prefix: "✓" },
  error:      { color: "text-red-500",      prefix: "✗" },
  warn:       { color: "text-amber-600",    prefix: "!" },
  step:       { color: "text-blue-600",     prefix: "→" },
  correction: { color: "text-violet-600",   prefix: "✎" },
};

interface Props {
  entries: LogEntry[];
  running: boolean;
}

export default function LiveLog({ entries, running }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="card p-5 flex flex-col" style={{ height: 280 }}>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="label">Processing Log</h2>
          {running && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
        </div>
        <span className="text-[10px] text-slate-400 font-mono">{entries.length} events</span>
      </div>

      <div className="flex-1 overflow-y-auto font-mono text-[11px] space-y-px pr-1 min-h-0 bg-slate-50 rounded-xl p-3 border border-slate-100">
        {entries.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-300">
            <span className="animate-cursor-blink">_</span>
          </div>
        ) : (
          <>
            {entries.map((entry) => {
              const s = STYLES[entry.type];
              return (
                <div key={entry.id} className="flex gap-2 leading-relaxed py-px">
                  <span className="text-slate-300 shrink-0 tabular-nums">{entry.timestamp}</span>
                  <span className={`shrink-0 w-3 ${s.color}`}>{s.prefix}</span>
                  <span className={s.color}>{entry.message}</span>
                </div>
              );
            })}
            {running && (
              <div className="flex gap-2 leading-relaxed py-px">
                <span className="text-slate-300 shrink-0">        </span>
                <span className="text-slate-300 animate-cursor-blink">_</span>
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
