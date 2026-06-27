"use client";

import type { PipelineStep } from "@/types";

const STEPS: { key: PipelineStep; label: string; desc: string }[] = [
  { key: "retrieving",  label: "Retrieve",  desc: "Pull relevant heuristics from memory graph" },
  { key: "classifying", label: "Classify",  desc: "Gemini multimodal inference on tiles" },
  { key: "scoring",     label: "Score",     desc: "Compare predictions to ground truth" },
  { key: "extracting",  label: "Extract",   desc: "Identify recurring error patterns" },
  { key: "storing",     label: "Store",     desc: "Write new heuristics to memory graph" },
];

interface Props {
  currentStep: PipelineStep | null;
  batchNumber: number | null;
  completedSteps: Set<PipelineStep>;
}

export default function PipelineStatus({ currentStep, batchNumber, completedSteps }: Props) {
  return (
    <div className="card p-5 animate-fade-in-up">
      <div className="flex items-center justify-between mb-4">
        <span className="label">Live Pipeline</span>
        {batchNumber && (
          <span className="badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Batch {batchNumber} in progress
          </span>
        )}
      </div>
      <div className="flex items-start gap-0">
        {STEPS.map((step, i) => {
          const isActive = currentStep === step.key;
          const isDone = completedSteps.has(step.key);
          const isPending = !isActive && !isDone;

          return (
            <div key={step.key} className="flex items-start flex-1 min-w-0">
              <div className="flex flex-col items-center flex-1 min-w-0">
                {/* Step node */}
                <div className={`
                  relative w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                  transition-all duration-300
                  ${isActive ? "bg-emerald-500 text-white animate-pulse-ring" : ""}
                  ${isDone ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : ""}
                  ${isPending ? "bg-slate-800 text-slate-600 border border-slate-700" : ""}
                `}>
                  {isDone ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </div>
                {/* Step label */}
                <div className="mt-2 text-center px-1">
                  <p className={`text-xs font-semibold ${isActive ? "text-emerald-400" : isDone ? "text-slate-400" : "text-slate-600"}`}>
                    {step.label}
                  </p>
                  <p className="text-[10px] text-slate-600 mt-0.5 leading-tight hidden sm:block">
                    {step.desc}
                  </p>
                </div>
              </div>
              {/* Connector line */}
              {i < STEPS.length - 1 && (
                <div className={`h-px w-full mt-4 mx-1 transition-colors duration-500 ${isDone ? "bg-emerald-500/40" : "bg-slate-800"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
