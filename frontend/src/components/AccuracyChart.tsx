"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BatchRecord } from "@/types";

interface Props {
  batches: BatchRecord[];
}

export default function AccuracyChart({ batches }: Props) {
  const data = batches.map((b) => ({
    batch: b.batch_number,
    accuracy: parseFloat((b.overall_accuracy * 100).toFixed(1)),
  }));

  const first = data[0];
  const latest = data[data.length - 1];
  const delta =
    first && latest && data.length > 1
      ? (latest.accuracy - first.accuracy).toFixed(1)
      : null;
  const deltaPositive = delta !== null ? parseFloat(delta) >= 0 : true;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="label mb-1">Accuracy over Batches</h2>
          <p className="text-xs text-slate-400">Improving as heuristics accumulate in memory</p>
        </div>
        {delta && (
          <div className="text-right">
            <p className={`text-2xl font-bold ${deltaPositive ? "text-emerald-600" : "text-red-500"}`}>
              {deltaPositive ? "+" : ""}
              {delta}%
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">since batch 1</p>
          </div>
        )}
      </div>

      {data.length === 0 ? (
        <div className="h-44 flex flex-col items-center justify-center gap-2 text-slate-300">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          </svg>
          <p className="text-xs text-slate-400">Start a run to see accuracy improve</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 12 }}>
            <defs>
              <linearGradient id="accuracyGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#059669" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#059669" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="batch"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              axisLine={{ stroke: "#e2e8f0" }}
              tickLine={false}
              label={{ value: "Batch #", position: "insideBottom", offset: -8, fill: "#94a3b8", fontSize: 10 }}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            {first && data.length > 1 && (
              <ReferenceLine
                y={first.accuracy}
                stroke="#e2e8f0"
                strokeDasharray="4 4"
                label={{ value: "Baseline", position: "insideTopRight", fill: "#94a3b8", fontSize: 9 }}
              />
            )}
            <Tooltip
              formatter={(v: number) => [`${v}%`, "Accuracy"]}
              contentStyle={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: 0,
                fontSize: 12,
                color: "#475569",
              }}
              labelFormatter={(l) => `Batch ${l}`}
              cursor={{ stroke: "#e2e8f0" }}
            />
            <Area
              type="monotone"
              dataKey="accuracy"
              stroke="#059669"
              strokeWidth={2}
              fill="url(#accuracyGradient)"
              dot={{ fill: "#059669", r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: "#059669", stroke: "#ffffff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

