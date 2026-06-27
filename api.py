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

from fastapi import BackgroundTasks, FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import orchestrator
import persistence


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield  # nothing to set up/tear down at startup


app = FastAPI(title="SubStrata API", lifespan=lifespan)

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


@app.delete("/session")
def clear_session():
    persistence.clear_session()
    return {"status": "cleared"}


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
