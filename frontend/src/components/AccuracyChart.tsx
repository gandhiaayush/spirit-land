"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
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
    accuracy: Math.round(b.overall_accuracy * 100),
  }));

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-4">
        Accuracy over Batches
      </h2>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
          No batches yet — start a run
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis
              dataKey="batch"
              label={{ value: "Batch", position: "insideBottom", offset: -2, fill: "#6b7280" }}
              tick={{ fill: "#6b7280", fontSize: 12 }}
            />
            <YAxis
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: "#6b7280", fontSize: 12 }}
            />
            <Tooltip
              formatter={(v) => [`${v}%`, "Accuracy"]}
              contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
              labelStyle={{ color: "#9ca3af" }}
            />
            <Line
              type="monotone"
              dataKey="accuracy"
              stroke="#34d399"
              strokeWidth={2}
              dot={{ fill: "#34d399", r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
