"""
FastAPI server for SubStrata.

Endpoints:
  GET  /session        — current Session/Run Record
  POST /run            — start a new orchestration run (async background task)
  GET  /stream         — SSE stream of live batch events
  DELETE /session      — wipe local session state (start fresh)
"""

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

import orchestrator
import persistence


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield  # nothing to set up/tear down at startup


app = FastAPI(title="SubStrata API", lifespan=lifespan)
Path("data/patches").mkdir(parents=True, exist_ok=True)
app.mount("/patches", StaticFiles(directory="data/patches"), name="patches")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Next.js dev server
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/session")
def get_session():
    session = persistence.load_session()
    if session is None:
        return Response(status_code=204)
    return session


@app.post("/run")
async def start_run(
    background_tasks: BackgroundTasks,
    num_batches: int = 5,
    batch_size: int = 20,
    dataset_dir: str = "data/eurosat",
):
    """
    Kicks off orchestrator.run_loop() as a background task.
    Returns immediately; clients follow progress via GET /stream.
    """
    background_tasks.add_task(
        orchestrator.run_loop, num_batches, batch_size, dataset_dir
    )
    return {"status": "started", "num_batches": num_batches, "batch_size": batch_size}


@app.post("/upload")
async def upload_dataset(files: list[UploadFile] = File(...)):
    """
    Stage uploaded image files into a fresh data/uploads/upload_<n>/ directory so
    the existing run loop can classify them (point /run's dataset_dir at the result).

    Only .jpg/.jpeg/.png files are saved; others are skipped. Uploaded images have
    no ground-truth labels, so scoring/true_label will be "unknown" (acceptable for v1).
    """
    uploads_root = Path("data/uploads")
    uploads_root.mkdir(parents=True, exist_ok=True)

    # Derive the next dir from the count of existing upload_* subdirs.
    existing = [d for d in uploads_root.glob("upload_*") if d.is_dir()]
    next_n = len(existing) + 1
    dataset_dir = uploads_root / f"upload_{next_n:03d}"
    dataset_dir.mkdir(parents=True, exist_ok=True)

    allowed = {".jpg", ".jpeg", ".png"}
    count = 0
    for upload in files:
        filename = upload.filename or ""
        if Path(filename).suffix.lower() not in allowed:
            continue
        contents = await upload.read()
        (dataset_dir / Path(filename).name).write_bytes(contents)
        count += 1

    return {"dataset_dir": str(dataset_dir), "count": count}


@app.delete("/session")
def clear_session():
    persistence.clear_session()
    return {"status": "cleared"}


@app.post("/correction")
async def submit_correction(tile_id: str, corrected_label: str):
    """Scientist submits a manual correction for a misclassified tile."""
    await orchestrator._broadcast({
        "type": "correction_applied",
        "tile_id": tile_id,
        "corrected_label": corrected_label,
        "timestamp": datetime.utcnow().isoformat(),
    })
    return {"status": "received", "tile_id": tile_id, "corrected_label": corrected_label}


@app.get("/arm")
def get_arm():
    """Current memory ablation arm: cold | knn | reflective."""
    import memory_graph
    return {"arm": memory_graph.get_active_arm()}


@app.post("/arm")
def set_arm(arm: str):
    """Switch the memory ablation arm before a run (drives the dashboard Memory toggle:
    'cold' = no memory, 'reflective' = graph memory). Invalid values are ignored."""
    import memory_graph
    try:
        memory_graph.set_active_arm(arm)
    except ValueError:
        pass
    return {"arm": memory_graph.get_active_arm()}


@app.get("/graph")
def get_graph():
    """Live memory-graph snapshot (class/error/heuristic nodes incl. heuristic text + edges)."""
    import memory_graph
    return memory_graph.export_graph()


@app.get("/stream")
async def stream_events():
    """
    Server-Sent Events endpoint. The frontend connects once and receives
    a JSON event object after each batch completes (and on session start/end).
    """
    q: asyncio.Queue = asyncio.Queue()
    orchestrator.add_subscriber(q)

    async def event_generator():
        try:
            # Send any existing session state immediately on connect
            session = persistence.load_session()
            if session:
                yield _sse({"type": "session_state", "session": session})

            while True:
                event = await q.get()
                yield _sse(event)
                if event.get("type") == "run_complete":
                    break
        finally:
            orchestrator.remove_subscriber(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"
