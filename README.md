# SubStrata 🛰️

**A self-improving land-cover classification agent that gets less wrong over time — through memory, not retraining.**

---

## The Problem

Land-cover data — captured by satellites, citizen science, and remote sensing programs at agencies like NASA and ESA — has to be manually classified by domain experts: road, grass, tree, water, residential density, and so on. This labeling work is slow, repetitive, and the same confusion patterns (e.g. dense residential mistaken for medium residential due to gradual transitions in housing density) recur across batches without the classification system ever learning from its own mistakes.

Most AI classification tools don't fix this. They run inference, produce labels, and forget everything about *why* they were wrong the moment the batch is done. The next batch starts from zero.

## The Idea

**SubStrata is not a classifier. It's a closed loop that makes its own classification errors smaller over time, using a self-updating memory graph instead of model retraining.**

The core loop:

```
Classify batch → Score against ground truth → Identify error patterns →
Extract reusable heuristics → Store in graph memory → Retrieve relevant
heuristics before the next classification → repeat
```

Every time the system gets something wrong, it doesn't just log the mistake — it analyzes *why*, writes a plain-language heuristic, and stores it in a graph structured by similarity and class relationships. Before classifying the next tile, it queries that graph for relevant past errors and injects only the heuristics that actually apply — not a flat list of everything it's ever learned, but a targeted retrieval over its own failure history.

This is **memory-driven adaptation**, not fine-tuning. The model's weights never change. What changes is the system's accumulated, structured experience — the same way a researcher gets better at a domain by remembering which approaches worked, not by rewiring their brain.

## The Demo: Proving It Actually Learns

This is the most important part of the project, and the one thing the live demo has to nail. **Self-improvement claims are worthless unless they're shown happening, live, in front of judges.** The demo is structured around one explicit before/after moment, not a general walkthrough of the architecture:

1. **Batch 1** — run a batch of tiles containing a specific, recurring confusion pair (e.g. dense residential vs. medium residential). Show the live error rate on that pair. No heuristics exist yet.
2. **The loop runs** — Strategist Agent analyzes the errors from Batch 1, extracts a heuristic in plain English, and writes it to the MongoDB Atlas memory graph. Show this heuristic on screen, in the judges' own words, not just a confidence number.
3. **Batch 2** — a held-out batch with the *same* confusion pair. The Classifier Agent retrieves the relevant heuristic before classifying. Show the error rate on that specific pair dropping, live, side by side with Batch 1.
4. **The graph**: one simple chart, error rate on the target confusion pair, batch over batch, trending down. This is the single visual that makes "self-improving" provable rather than asserted.

Everything else in the README — the graph structure, the two-agent architecture, the persistence layer — exists in service of making this four-step moment real and demonstrable. If a teammate is ever unsure what to prioritize building next, the answer is: whatever gets this sequence working end-to-end first.

## Why a Graph, Not a Flat List

A flat list of heuristics doesn't scale and doesn't discriminate — an unrelated rule about freeway/overpass confusion can get injected into a dense/medium-residential tile and actively hurt accuracy. Our graph structure fixes this:

- **Nodes** are either `ErrorPattern`s (a specific recurring confusion, e.g. "dense residential → medium residential due to gradual density transitions") or `Heuristic`s (the extracted, actionable instruction derived from one or more error patterns)
- **Edges** capture relationships: similarity between error patterns, which heuristics were derived from which errors, and class hierarchy (e.g. dense, medium, and sparse residential are all `is_a` residential)
- **Retrieval is similarity-based**: before classifying a new tile, we embed its visual context and pull only the nearest-neighbor heuristics — precise, not exhaustive
- **Conflict resolution**: when retrieval surfaces multiple heuristics for one tile, they're ranked by `confidence_weight` and only the top-k are injected into the classification prompt. The model itself reconciles any remaining tension between injected heuristics at inference time — we don't try to pre-resolve conflicts in the retrieval layer.

This is **not** a static-corpus RAG system. There is no fixed knowledge base. The graph is entirely self-generated from the system's own evaluation history and evolves with every batch — retrieval over a system's own evolving failure memory, not retrieval over a fixed document store.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   PERCEPTION     │     │     MEMORY        │     │   ORCHESTRATION      │
│  & EVALUATION    │     │  (Graph Memory)   │     │  & PERSISTENCE       │
│                  │     │                   │     │                      │
│ • UC Merced tiles│────▶│ • MongoDB Atlas   │◀───▶│ • Antigravity env    │
│ • Gemini 3.5     │     │   (nodes/edges as │     │   (Interactions API) │
│   multimodal     │     │   documents)      │     │ • Session/run state  │
│   classification │     │ • ErrorPattern &  │     │ • Loop orchestration │
│ • Ground-truth    │     │   Heuristic docs  │     │ • Frontend + charts  │
│   scoring         │     │ • Atlas Vector    │     │                      │
│                  │     │   Search for       │     │                      │
│                  │     │   similarity        │     │                      │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
```

### Two Cooperating Gemini Agents

SubStrata runs **two distinct, persistent Managed Agents** via the Gemini 3.5 Interactions API (Antigravity), each holding its own environment state and handing off to the other across the loop:

- **Classifier Agent** — receives a batch of tiles plus any retrieved heuristics, performs the multimodal classification, and returns predictions with reasoning traces
- **Strategist Agent** — receives the scored predictions, analyzes confusion patterns, extracts new heuristics, and updates the memory graph in MongoDB Atlas

Framing this as two cooperating agents rather than one model making two kinds of calls is a deliberate architectural choice: persistent, stateful hand-off between agents is harder to build correctly than a single agent looping internally, and it's a more faithful use of what Managed Agents is actually for.

### Why Gemini 3.5 / Managed Agents (Interactions API)

The session state for this project — which heuristics are active, the running accuracy history, the batch-by-batch error rates — lives inside a **persistent Antigravity environment** via the Interactions API, rather than a local database. The environment ID is passed on every follow-up call so the agent's accumulated experience genuinely persists in a hosted, stateful runtime. This isn't a decorative integration — stateful persistence across iterative calls is exactly the problem Managed Agents solves, and it's the backbone of how this system "remembers" across the whole run.

### Why MongoDB Atlas (Graph Memory Storage)

The `ErrorPattern` and `Heuristic` nodes are stored as documents in **MongoDB Atlas**, with **Atlas Vector Search** powering the embedding-based similarity retrieval — instead of an in-memory graph that disappears the moment the process restarts. This matters for the core claim of the project: a system that "remembers" should still remember after a restart, between sessions, even after the hackathon ends. Atlas Vector Search replaces hand-rolled nearest-neighbor logic with a production-grade vector index, so retrieving the most relevant past errors/heuristics for a new tile is a native query, not custom infrastructure we had to build from scratch. The graph's relational structure (similarity edges, `derived_from` links, `is_a` class hierarchy) is modeled directly in the document schema and traversed at query time.

## Data Schemas

**Prediction Record**
```json
{
  "tile_id": "string",
  "batch_id": "string",
  "true_label": "string",
  "predicted_label": "string",
  "confidence": 0.0,
  "correct": true,
  "model_reasoning": "string",
  "retrieved_heuristic_ids": ["..."],
  "timestamp": "ISO8601"
}
```

**Graph Node — ErrorPattern**
```json
{
  "node_id": "string",
  "type": "error_pattern",
  "confusion_pair": ["true_label", "predicted_label"],
  "description": "string",
  "embedding": [0.0],
  "supporting_tile_ids": ["..."],
  "frequency": 0,
  "created_at": "ISO8601",
  "last_updated": "ISO8601"
}
```

**Graph Node — Heuristic**
```json
{
  "node_id": "string",
  "type": "heuristic",
  "text": "string",
  "applies_to_confusion_pairs": [["true_label", "predicted_label"]],
  "embedding": [0.0],
  "derived_from_error_nodes": ["..."],
  "confidence_weight": 1.0,
  "times_applied": 0,
  "times_helped": 0,
  "created_at": "ISO8601"
}
```

**Session / Run Record**
```json
{
  "session_id": "string",
  "antigravity_environment_id": "string",
  "current_batch_number": 0,
  "batches": [
    {
      "batch_number": 0,
      "overall_accuracy": 0.0,
      "per_confusion_pair_error_rate": {"denseresidential_mediumresidential": 0.0},
      "active_heuristic_ids": ["..."]
    }
  ]
}
```

## Dataset

[UC Merced Land Use Dataset](http://weegee.vision.ucmerced.edu/datasets/landuse.html) — 21 land-use classes, 100 images each (2,100 total), 256×256 1ft-resolution aerial imagery. Small enough to download and run end-to-end within a hackathon timeframe, while reliably surfacing genuine, repeatable confusion patterns — published benchmarks consistently show persistent confusion between visually and semantically related classes (most notably dense/medium/sparse residential, distinguished only by building density and spacing) even with strong modern vision models. This matters directly for our demo: a system can't show "self-improvement" if the underlying classifier is already near-perfect with nothing left to learn from.

For the live demo, we deliberately focus batches on the residential-density cluster (`denseresidential`, `mediumresidential`, `sparseresidential`, `buildings`) rather than running across all 21 classes — this guarantees a real, well-documented confusion pattern to demonstrate the loop on, rather than hoping for enough errors to emerge by chance.

**Note on the evaluation signal:** for this build, "expert correction" is simulated via UC Merced's held-out ground-truth labels rather than a live human-in-the-loop. The architecture is designed to accept real expert feedback as a drop-in replacement for the ground-truth check in a production setting.

## Tech Stack

- **Classification:** Gemini 3.5 (multimodal)
- **Memory graph:** MongoDB Atlas (document storage for `ErrorPattern`/`Heuristic` nodes) + Atlas Vector Search (embedding-based similarity retrieval), with Gemini embeddings
- **Persistence/state:** Google Interactions API — Managed Agents (Antigravity)
- **Dataset:** UC Merced Land Use Dataset
- **Frontend:** [fill in — e.g. React/Next.js, Streamlit excluded per hackathon rules]

## Team

- **Engineer 1** — Perception & Evaluation (classification, scoring)
- **Engineer 2** — Memory & Graph Structure
- **Engineer 3** — Orchestration, Persistence (Antigravity/Interactions API) & Frontend

## What's Next

The loop demonstrated here — classify, evaluate, extract, persist, retrieve — is domain-agnostic. The same architecture applies anywhere expert correction is the bottleneck on AI adoption: medical imaging triage, manufacturing defect detection, or any classification task where the cost of human review is high and failure patterns repeat. Memory-driven adaptation offers a path to systems that keep improving in production without the cost or latency of retraining.

---

