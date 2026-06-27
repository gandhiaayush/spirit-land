"use client";

const BOXES = [
  {
    title: "Perception & Evaluation",
    accent: "border-blue-200 bg-blue-50",
    titleColor: "text-blue-700",
    dotColor: "bg-blue-300",
    items: ["EuroSAT satellite tiles", "Gemini 3.5 multimodal", "Ground-truth scoring"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    title: "Memory Graph",
    accent: "border-violet-200 bg-violet-50",
    titleColor: "text-violet-700",
    dotColor: "bg-violet-300",
    items: ["networkx graph", "ErrorPattern & Heuristic nodes", "Embedding-based retrieval"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><circle cx="5" cy="5" r="2" />
        <line x1="12" y1="9" x2="19" y2="7" /><line x1="12" y1="15" x2="5" y2="17" /><line x1="14" y1="14" x2="17" y2="17" /><line x1="10" y1="10" x2="7" y2="7" />
      </svg>
    ),
  },
  {
    title: "Orchestration & Persistence",
    accent: "border-emerald-200 bg-emerald-50",
    titleColor: "text-emerald-700",
    dotColor: "bg-emerald-300",
    items: ["Antigravity (Interactions API)", "Session & run state", "Loop orchestration + UI"],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    ),
  },
];

export default function ArchitectureDiagram() {
  return (
    <div className="p-6">
      <div className="mb-5">
        <h2 className="label mb-1">System Architecture</h2>
        <p className="text-xs text-slate-400">
          Memory-driven adaptation — weights never change, accumulated experience does
        </p>
      </div>

      {/* Core loop */}
      <div className="mb-6 bg-slate-50 rounded-xl p-4 border border-slate-200">
        <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-3">Core Loop</p>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {["Classify Batch", "Score vs Ground Truth", "Extract Error Patterns", "Store in Graph", "Retrieve Heuristics"].map(
            (step, i, arr) => (
              <span key={step} className="flex items-center gap-1">
                <span className="px-2.5 py-1 bg-white border border-slate-200 rounded-md text-slate-600 shadow-sm">
                  {step}
                </span>
                {i < arr.length - 1 && <span className="text-slate-300">→</span>}
              </span>
            )
          )}
          <span className="text-slate-400 text-base ml-1">↺</span>
        </div>
      </div>

      {/* Three boxes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {BOXES.map((box, i) => (
          <div key={box.title} className="relative">
            <div className={`rounded-xl border p-4 ${box.accent}`}>
              <div className={`${box.titleColor} mb-3 flex items-center gap-2`}>
                {box.icon}
                <span className="text-xs font-semibold">{box.title}</span>
              </div>
              <ul className="space-y-1.5">
                {box.items.map((item) => (
                  <li key={item} className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <span className={`w-1 h-1 rounded-full ${box.dotColor} shrink-0`} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            {i < BOXES.length - 1 && (
              <div className="hidden md:flex absolute top-1/2 -right-3 -translate-y-1/2 z-10 text-slate-300 text-lg">
                ⇄
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
