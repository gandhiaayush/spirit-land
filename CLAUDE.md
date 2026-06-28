# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

SubStrata — self-improving satellite land-cover classifier. Three engineers:
- **Engineer 1 (Neev):** `dataset.py`, `classifier.py` — GEE pipeline + Gemini classification + scoring
- **Engineer 2:** `memory_graph.py` — heuristic graph (in progress)
- **Engineer 3:** `orchestrator.py`, `api.py`, `frontend/` — integration layer (done, on main)

## Running the project

```bash
# Backend
uvicorn api:app --reload

# Frontend (separate terminal)
cd frontend && npm run dev

# Smoke test (Engineer 1)
GEMINI_API_KEY=<key> python3 smoke_test.py
```

Set `SUBSTRATA_STUB_MODE=false` to use real E1/E2 code instead of stubs.

## Required env vars

| Var | Purpose |
|-----|---------|
| `GEMINI_API_KEY` | Gemini 3.5 Flash + Gemma 4 via Generative Language API |
| `SUBSTRATA_STUB_MODE` | `true` (default) uses stubs; `false` uses real classifer/memory |
| `GCP_PROJECT` | Defaults to `ai-hack-sf26sfo-7095` |

Copy `.env.example` to `.env` to get started.

## Critical gotchas

**GEE auth:** Earth Engine authenticates via `gcloud auth print-access-token`, NOT application default credentials or service account keys. Org policy blocks SA key creation. `gcloud` must be on PATH and logged in with `gcloud auth login`.

**Python 3.9:** Use `Optional[List[str]]` from `typing` — NOT `list[str] | None` (Python 3.10+ syntax). Always import `from typing import Dict, List, Optional`.

**SDK:** Use `google-genai` (`from google import genai`). Do NOT use `google-generativeai` (deprecated) or `vertexai`.

**Gemini 3.5 Flash** is a thinking model — it emits `thought_signature` parts. Suppress at module level with:
```python
warnings.filterwarnings("ignore", message=".*thought_signature.*")
```

**GEE patch extraction:** Use `ee.data.computePixels()` with an explicit affine transform for a fixed 64×64 output. Do NOT use `sampleRectangle` (returns 1×1 with unbounded images) or `getThumbURL`. S2 reflectance normalization: clamp to [0, 0.3] then scale to [0, 255].

**`orchestrator.py` interface:** Imports module-level functions from `classifier.py` — `classify_batch(tile_paths: list, heuristics: list[dict])` and `score_batch(predictions: list[dict])`. Class-based API won't integrate.

## Branch conventions

Branch names follow `engineer-N/descriptive-name` (e.g. `engineer-1/perception-data-evaluation`). PRs target `main` on `gandhiaayush/spirit-land`.
