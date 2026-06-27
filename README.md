# SubStrata 🛰️

**A self-improving land-cover classification agent that gets less wrong over time — through memory, not retraining.**

---

## The Problem

Land-cover data — captured by satellites and remote-sensing programs at agencies like NASA and ESA — has to be classified into categories: water, trees, shrub, grass, crops, built-up, bare ground. This labeling is slow, repetitive, and the *same* confusion patterns recur batch after batch (e.g. low trees mistaken for tall shrub, or shrub mistaken for grass, because vegetation height and texture grade smoothly into one another) without the classification system ever learning from its own mistakes.

Most AI classification tools don't fix this. They run inference, produce labels, and forget everything about *why* they were wrong the moment the batch is done. The next batch starts from zero. The standard remedy — collect corrections, batch them, fine-tune, redeploy — costs weeks, a GPU bill, and an ML team, and the model still can't tell you *why* it improved.

## The Idea

**Most systems learn by retraining. SubStrata learns by remembering.**

It's a closed loop that makes its own classification errors smaller over time, using a self-updating memory graph instead of changing a single model weight.

The core loop:

```
Classify batch → Score against ground truth → Identify error patterns →
Extract reusable heuristics → Store in graph memory → Retrieve relevant
heuristics before the next classification → repeat
```

Every time the system gets something wrong, it doesn't just log the mistake — it analyzes *why*, writes a plain-language heuristic, and stores it in a graph structured by similarity and class relationships. Before classifying the next patch, it queries that graph for relevant past errors and injects only the heuristics that actually apply — not a flat list of everything it's ever learned, but a targeted retrieval over its own failure history.

This is **memory-driven adaptation**, not fine-tuning. The model's weights never change. What changes is the system's accumulated, structured experience — the same way a researcher gets better at a domain by remembering which approaches worked, not by rewiring their brain. And because the memory is plain English, every improvement is auditable: you can *read* the lesson that fixed the error.

## The Task: Patch-Grid Classification, Rendered as Segmentation

We classify **real satellite scenes**, not curated single-label thumbnails. A scene is tiled into an N×N **grid of patches**; each patch is classified by Gemini into one land-cover class and rendered as a colored cell, so the output looks like a segmentation map of real geography.

The trick that keeps the whole thesis scorable: each patch gets **one** ground-truth label = the **majority class** of its pixels, read from a wall-to-wall label raster (Google Dynamic World). So it *looks* like segmentation on screen but *scores* like classification underneath — which means a clean, per-class error rate that can provably go down. (We deliberately do **not** stake the demo on per-pixel masks: Gemini can render a pretty mask layer, but that layer is **non-load-bearing** — scoring always runs on patch labels.)

## The Demo: Proving It Actually Learns

This is the most important part of the project, and the one thing the live demo has to nail. **Self-improvement claims are worthless unless they're shown happening, live, in front of judges.** The demo is built around explicit before/after moments, not a walkthrough of the architecture:

1. **Batch 1 — the error appears.** Run a batch of patches containing a specific, recurring confusion pair (e.g. **trees vs. shrub**). Show the live error rate on that pair. No heuristics exist yet.
2. **The loop runs — a lesson is written.** The Strategist Agent analyzes Batch 1's errors, extracts a heuristic *in plain English*, and writes it to the memory graph. Show this heuristic on screen, in the judges' own words, not just a confidence number.
3. **Batch 2 — the same error shrinks.** A held-out batch with the *same* confusion pair. The Classifier Agent retrieves the heuristic before classifying. Show the error rate on that pair dropping, live, side by side with Batch 1.
4. **The transfer beat (the crown jewel) — a lesson it was never taught.** A later batch contains a **never-seen** confusion pair from the same family (e.g. **shrub vs. grass**). The system made *no* errors on this pair to learn from — yet because the Batch-1 heuristic was written at the `vegetation` parent and retrieval walks the `is_a` edge, the lesson **transfers** and the never-seen pair improves too. The line for the judges: *"It never made this mistake to learn from. It generalized the lesson sideways through the class hierarchy. That's not retrieval — retrieval had nothing to retrieve. That's transfer."*
5. **The ablation (the proof).** The same patch stream run through three memory backends, side by side, so the result survives a skeptic:
   - **(a) Cold** — Gemini, no memory. The floor.
   - **(b) Raw retrieval** — k-NN over stored labeled exemplars. Improves, but it's just lookup — and it **fails the transfer beat** (nothing similar to retrieve).
   - **(c) Reflective + graph** — our plain-English heuristics with `is_a` inheritance. Should beat (b), and is the *only* arm that fixes the never-seen pair.
6. **The chart.** Error rate on the target confusion pairs, batch over batch, trending down — with arm (c) below (b) below (a). This single visual is what makes "self-improving" provable rather than asserted.

If a teammate is ever unsure what to prioritize, the answer is: whatever gets this sequence working end-to-end first.

## Why a Graph, Not a Flat List

A flat vector store retrieves heuristics by *similarity to past errors*. That's enough to re-apply a lesson to a patch that looks like one you've seen — but it cannot do the one thing that wins this demo: apply a lesson to a class you've **never** made a mistake on. Our graph fixes that with structure:

- **Nodes** are either `ErrorPattern`s (a specific recurring confusion, e.g. "trees → shrub due to low canopy height") or `Heuristic`s (the extracted, actionable instruction derived from one or more error patterns)
- **Edges** capture relationships: `similar_to` between error patterns, `derived_from` linking heuristics to the errors that produced them, and **`is_a` class hierarchy** (trees, shrub, grass, crops are all `is_a` `vegetation`)
- **Retrieval walks the hierarchy**: before classifying a patch, we embed its visual context, pull the nearest heuristics, **and walk `is_a` upward** to inherit parent-class heuristics — so a `vegetation`-level lesson reaches every vegetation subclass, including ones with zero prior errors. This is the behavior a flat vector store mathematically cannot reproduce, and it's the graph's reason to exist.
- **Conflict resolution**: when retrieval surfaces multiple heuristics, they're ranked by `confidence_weight` and only the top-k are injected. The model reconciles any remaining tension at inference time — we don't pre-resolve conflicts in the retrieval layer.

This is **not** a static-corpus RAG system. There is no fixed knowledge base. The graph is entirely self-generated from the system's own evaluation history and evolves with every batch — retrieval over a system's own evolving failure memory, not over a fixed document store.

## Architecture

```
┌──────────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐
│  PERCEPTION, DATA     │   │       MEMORY          │   │   ORCHESTRATION      │
│   & EVALUATION        │   │   (Graph Memory)      │   │  & PERSISTENCE       │
│                       │   │                       │   │                      │
│ • Dynamic World       │──▶│ • networkx in-memory  │◀─▶│ • Antigravity env    │
│   patches (S2 RGB +   │   │   graph (nodes+edges) │   │   (Interactions API) │
│   majority-vote label)│   │ • ErrorPattern &      │   │ • Session/run state  │
│ • Gemini 3.5          │   │   Heuristic nodes     │   │ • Loop orchestration │
│   multimodal classify │   │ • is_a hierarchy +    │   │ • Frontend: overlay, │
│ • Gemma summarizer    │   │   numpy cosine        │   │   charts, ablation   │
│   (retrieval key)     │   │   similarity          │   │                      │
│ • Ground-truth scoring│   │                       │   │                      │
└──────────────────────┘   └──────────────────────┘   └─────────────────────┘
```

### Two Cooperating Gemini Agents

SubStrata runs **two distinct, persistent Managed Agents** via the Gemini 3.5 Interactions API (Antigravity), each holding its own environment state and handing off to the other across the loop:

- **Classifier Agent** — receives a batch of patches plus any retrieved heuristics, performs the multimodal classification, and returns predictions with reasoning traces
- **Strategist Agent** — receives the scored predictions, analyzes confusion patterns, extracts new heuristics, and updates the memory graph. It is explicitly prompted to **abstract each heuristic to the right level of the class hierarchy** (e.g. attach a vegetation-height lesson to the `vegetation` node), which is what makes the transfer beat work.

Framing this as two cooperating agents rather than one model making two kinds of calls is a deliberate architectural choice: persistent, stateful hand-off between agents is harder to build correctly than a single agent looping internally, and it's a more faithful use of what Managed Agents is actually for.

### A Fast Gemma Summarizer on the Retrieval Path

Before retrieval, a lightweight **Gemma** pass summarizes each patch into its *discriminative features* — canopy height, texture coarseness, vegetation fraction, edge regularity — rather than a generic caption. That summary is what we embed to query the graph, so retrieval keys live in the same feature space as the heuristics. (Gemma on-device is also a bonus-tech checkbox for the Gemini prize.)

### Why Gemini 3.5 / Managed Agents (Interactions API)

The session state for this project — which heuristics are active, the running accuracy history, the batch-by-batch error rates — lives inside a **persistent Antigravity environment** via the Interactions API, rather than a local database. The environment ID is passed on every follow-up call so the agent's accumulated experience genuinely persists in a hosted, stateful runtime. This isn't a decorative integration — stateful persistence across iterative calls is exactly the problem Managed Agents solves.

### Why networkx In-Memory (+ Optional Antigravity Persistence)

The memory graph is built with **networkx** and queried with **numpy cosine** similarity over Gemini embeddings. At demo scale the graph holds tens of nodes, not millions — so a production vector database would be pure overhead, while `is_a` traversal (the behavior that actually wins) is a one-liner on a networkx graph. Durable persistence isn't lost: the session/run state already lives server-side in the Antigravity environment, and the graph can be dumped/reloaded alongside it. The retrieval/update interface is **storage-agnostic**, so this choice is entirely internal to the memory module and can be swapped for a database later without touching any other engineer's code.

## Data Schemas

**Class Hierarchy** (the `is_a` taxonomy the graph encodes)
```
land_cover
├── vegetation        → trees, shrub_and_scrub, grass, crops, flooded_vegetation
├── built             → built
├── bare              → bare
└── water             → water, snow_and_ice
# vegetation subclasses are ordered by canopy height / woodiness:
# trees > shrub_and_scrub > grass  — the basis for heuristic transfer
```

**Prediction Record**
```json
{
  "patch_id": "string",
  "scene_id": "string",
  "grid_row": 0,
  "grid_col": 0,
  "patch_bbox": [0.0, 0.0, 0.0, 0.0],
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
  "confusion_pair": ["trees", "shrub_and_scrub"],
  "description": "string",
  "embedding": [0.0],
  "supporting_patch_ids": ["..."],
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
  "applies_to_class": "vegetation",
  "applies_to_confusion_pairs": [["trees", "shrub_and_scrub"]],
  "embedding": [0.0],
  "derived_from_error_nodes": ["..."],
  "confidence_weight": 1.0,
  "times_applied": 0,
  "times_helped": 0,
  "created_at": "ISO8601"
}
```

`applies_to_class` is the hierarchy node the heuristic inherits down from — retrieval walks `is_a` from a patch's class up to this node to find transferable lessons.

**Session / Run Record** *(unchanged — the frontend and persistence layer depend on these fields)*
```json
{
  "session_id": "string",
  "antigravity_environment_id": "string",
  "current_batch_number": 0,
  "batches": [
    {
      "batch_number": 0,
      "overall_accuracy": 0.0,
      "per_confusion_pair_error_rate": {"trees_shrub_and_scrub": 0.0},
      "active_heuristic_ids": ["..."]
    }
  ]
}
```

## Dataset

**[Google Dynamic World](https://dynamicworld.app/)** — a wall-to-wall, 10 m land-cover label raster (9 classes) derived from Sentinel-2, accessed via **Google Earth Engine**. For a chosen demo region, GEE gives us the co-registered Sentinel-2 RGB *and* the per-pixel label raster in one place. We tile the region into a patch grid, take each patch's **majority class** as its single ground-truth label, and export the patch RGB for Gemini to classify. `ee.Image.sampleRectangle` / `computePixels` pulls a few hundred patches fast — no slow export jobs.

We deliberately focus demo batches on the **vegetation cluster** (`trees`, `shrub_and_scrub`, `grass`, `crops`) — these classes grade into one another by canopy height and texture, producing genuine, repeatable confusion (a system can't show "self-improvement" if the classifier is already near-perfect), and their shared `vegetation` parent is what makes the `is_a` transfer beat possible.

- **No-GEE fallback:** ESA WorldCover GeoTIFF tiles (11 classes, 10 m), with Sentinel-2 RGB sourced and aligned separately.
- **Hybrid stretch:** if the vegetation transfer feels weak in testing, add a small UC Merced residential side-batch (dense/medium/sparse residential = three cleanly graded siblings) for the crispest possible transfer moment.

**Note on the evaluation signal:** "expert correction" is simulated via the held-out majority-vote labels rather than a live human-in-the-loop. The architecture accepts real expert feedback as a drop-in replacement for the ground-truth check in production.

## Tech Stack

- **Classification:** Gemini 3.5 (multimodal), via Managed Agents (Antigravity)
- **Summarizer:** Gemma (fast, discriminative-feature retrieval key)
- **Memory graph:** networkx in-memory + numpy cosine similarity, with Gemini embeddings
- **Persistence/state:** Google Interactions API — Managed Agents (Antigravity)
- **Dataset:** Google Dynamic World (via Earth Engine); ESA WorldCover fallback
- **Frontend:** Next.js / React (Streamlit excluded per hackathon rules)

## Team

Each engineer owns a module behind a frozen, storage-/dataset-agnostic interface, so all three integrate independently (the orchestrator's `STUB_MODE` keeps the loop green while halves are wired in).

- **Engineer 1 — Perception, Data & Evaluation** (`dataset.py`, `classifier.py`): Dynamic World → patch pipeline (tile, majority-vote labels, sample by class), Gemini multimodal classification with heuristic injection, ground-truth scoring.
- **Engineer 2 — Memory & Graph** (`memory_graph.py`): the networkx graph, reflective `update_graph` (parent-level heuristic extraction), hierarchy-walking `get_relevant_heuristics`, and the swappable raw-retrieval / flat-vector / `is_a`-graph backends that power the ablation.
- **Engineer 3 — Orchestration, Persistence & Frontend** (`orchestrator.py`, `persistence.py`, `api.py`, `frontend/`): the loop, Antigravity session persistence, the Gemma summarizer call, and the UI — patch-grid overlay, the transfer-beat panel, and the three-curve ablation view.

## What's Next

The loop demonstrated here — classify, evaluate, extract, persist, retrieve — is domain-agnostic. The same closed loop applies anywhere expert correction is the bottleneck on AI adoption and failure patterns repeat: **boundary-precise area accounting for carbon markets** (deforestation hectares), **flood-extent estimation for insurance**, medical imaging triage, or manufacturing defect detection. Memory-driven adaptation offers a path to systems that keep improving in production — auditable, and without the cost or latency of retraining.

---
