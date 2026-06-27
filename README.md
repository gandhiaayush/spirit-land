# SubStrata 🛰️

**A self-improving land-cover classification agent that gets less wrong over time — through memory, not retraining.**

---

## The Problem

Land-cover data — captured by satellites, citizen science, and remote sensing programs at agencies like NASA and ESA — has to be manually classified by domain experts: road, grass, tree, water, shrubland, and so on. This labeling work is slow, repetitive, and the same confusion patterns (e.g. shrubland mistaken for forest in low-contrast imagery) recur across batches without the classification system ever learning from its own mistakes.

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

## Why a Graph, Not a Flat List

A flat list of heuristics doesn't scale and doesn't discriminate — an unrelated rule about urban/water confusion can get injected into a forest/shrubland tile and actively hurt accuracy. Our graph structure fixes this:

- **Nodes** are either `ErrorPattern`s (a specific recurring confusion, e.g. "shrubland → forest in low-contrast tiles") or `Heuristic`s (the extracted, actionable instruction derived from one or more error patterns)
- **Edges** capture relationships: similarity between error patterns, which heuristics were derived from which errors, and class hierarchy (e.g. shrubland and forest are both `is_a` vegetation)
- **Retrieval is similarity-based**: before classifying a new tile, we embed its visual context and pull only the nearest-neighbor heuristics — precise, not exhaustive

This is **not** a static-corpus RAG system. There is no fixed knowledge base. The graph is entirely self-generated from the system's own evaluation history and evolves with every batch — retrieval over a system's own evolving failure memory, not retrieval over a fixed document store.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   PERCEPTION     │     │     MEMORY        │     │   ORCHESTRATION      │
│  & EVALUATION    │     │  (Graph Memory)   │     │  & PERSISTENCE       │
│                  │     │                   │     │                      │
│ • EuroSAT tiles  │────▶│ • MongoDB Atlas   │◀───▶│ • Antigravity env    │
│ • Gemini 3.5     │     │   (nodes/edges as │     │   (Interactions API) │
│   multimodal     │     │   documents)      │     │ • Session/run state  │
│   classification │     │ • ErrorPattern &  │     │ • Loop orchestration │
│ • Ground-truth    │     │   Heuristic docs  │     │ • Frontend + charts  │
│   scoring         │     │ • Atlas Vector    │     │                      │
│                  │     │   Search for       │     │                      │
│                  │     │   similarity        │     │                      │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
```

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
      "per_confusion_pair_error_rate": {"shrubland_forest": 0.0},
      "active_heuristic_ids": ["..."]
    }
  ]
}
```

## Dataset

[EuroSAT](https://github.com/phelber/EuroSAT) — Sentinel-2 satellite imagery, 10 land-cover classes, small enough to run end-to-end within a hackathon timeframe while still surfacing genuine, repeatable confusion patterns.

**Note on the evaluation signal:** for this build, "expert correction" is simulated via EuroSAT's held-out ground-truth labels rather than a live human-in-the-loop. The architecture is designed to accept real expert feedback as a drop-in replacement for the ground-truth check in a production setting.

## Tech Stack

- **Classification:** Gemini 3.5 (multimodal)
- **Memory graph:** MongoDB Atlas (document storage for `ErrorPattern`/`Heuristic` nodes) + Atlas Vector Search (embedding-based similarity retrieval), with Gemini embeddings
- **Persistence/state:** Google Interactions API — Managed Agents (Antigravity)
- **Dataset:** EuroSAT
- **Frontend:** [fill in — e.g. React/Next.js, Streamlit excluded per hackathon rules]

## Team

- **Engineer 1** — Perception & Evaluation (classification, scoring)
- **Engineer 2** — Memory & Graph Structure
- **Engineer 3** — Orchestration, Persistence (Antigravity/Interactions API) & Frontend

## What's Next

The loop demonstrated here — classify, evaluate, extract, persist, retrieve — is domain-agnostic. The same architecture applies anywhere expert correction is the bottleneck on AI adoption: medical imaging triage, manufacturing defect detection, or any classification task where the cost of human review is high and failure patterns repeat. Memory-driven adaptation offers a path to systems that keep improving in production without the cost or latency of retraining.

---
