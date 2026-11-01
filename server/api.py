from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from openai import AsyncOpenAI, APIConnectionError, APIStatusError, AuthenticationError

from . import config, store
from .meta_pipeline import analyze_video, inspect_video
from .physics import reproject_track_analysis
from .simulation import interpret_and_simulate

app = FastAPI(title="BLACKBOX video-to-3D service", version="0.3.0")
store.initialize_store()


class CalibrationPayload(BaseModel):
    corners: list[tuple[float, float]] = Field(min_length=4, max_length=4)
    width_m: float = Field(gt=0, le=500)
    length_m: float = Field(gt=0, le=1000)


class SimulationPayload(BaseModel):
    prompt: str = Field(min_length=2, max_length=500)
    current_state: dict[str, Any] | None = None


def _public_case(case: dict[str, Any]) -> dict[str, Any]:
    date = case["created_at"][:10]
    try:
        display_date = datetime.fromisoformat(case["created_at"]).strftime("%d %b %Y")
    except ValueError:
        display_date = date
    return {
        "id": case["id"], "title": case["title"], "site": case["site"],
        "date": display_date, "created_at": case["created_at"],
        "category": "Video scene", "status": case.get("analysis_status", "queued"),
        "analysis_status": case.get("analysis_status"), "analysis_stage": case.get("analysis_stage"),
        "analysis_progress": case.get("analysis_progress"), "analysis_message": case.get("analysis_message"),
        "analysis_error": case.get("analysis_error"), "analysis": case.get("analysis"),
        "videoName": case["filename"], "videoUrl": f"/api/cases/{case['id']}/video",
        "duration_s": case["duration_s"], "width": case["width"], "height": case["height"], "fps": case["fps"],
    }


async def _run_analysis(case_id: str, job_id: str, path: Path, metadata: dict[str, Any]) -> None:
    async def progress(percent: int, stage: str, message: str) -> None:
        store.update_job(job_id, status="running", stage=stage, progress=percent, message=message)

    try:
        result = await analyze_video(path, metadata, progress)
        store.update_job(job_id, status="completed", stage="complete", progress=100, message="Scene reconstruction complete. Review detected tracks and scale.", result=result)
    except Exception as exc:
        message = str(exc).strip() or "Analysis failed. Check the local server log and retry."
        store.update_job(job_id, status="failed", stage="failed", progress=100, message="Analysis could not be completed.", error=message[:700])


@app.get("/api/status")
def status() -> dict[str, Any]:
    return {
        "service": "BLACKBOX local analysis service",
        "ready": bool(config.MODEL_API_KEY),
        "meta_key_configured": bool(config.MODEL_API_KEY),
        "models": {"scene_analysis": config.MUSE_MODEL, "video_segmentation": config.SAM_MODEL},
        "limits": {
            "max_upload_bytes": config.MAX_UPLOAD_BYTES,
            "max_clip_seconds": config.MAX_CLIP_SECONDS,
            "max_video_dimension": config.MAX_VIDEO_DIMENSION,
            "max_video_pixels": config.MAX_VIDEO_PIXELS,
            "max_video_fps": config.MAX_VIDEO_FPS,
            "accepted_formats": ["mp4", "mov"],
        },
        "setup": "Add MODEL_API_KEY to the project .env file and save; the development API reloads automatically." if not config.MODEL_API_KEY else None,
    }


@app.post("/api/status/test")
async def test_meta_connection() -> dict[str, Any]:
    if not config.MODEL_API_KEY:
        raise HTTPException(status_code=503, detail="Add MODEL_API_KEY to .env and restart BLACKBOX before testing the Meta connection.")
    client = AsyncOpenAI(api_key=config.MODEL_API_KEY, base_url=config.MODEL_API_BASE_URL, timeout=45)
    try:
        response = await client.responses.create(
            model=config.MUSE_MODEL,
            input="Reply with the single word READY.",
            max_output_tokens=8,
            store=False,
        )
        text = getattr(response, "output_text", "") or ""
        return {"connected": True, "model": config.MUSE_MODEL, "reply": text.strip()[:32]}
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail="Meta rejected MODEL_API_KEY. Check it in .env and restart the server.") from exc
    except APIStatusError as exc:
        detail = "Meta Model API rate or usage limit reached." if exc.status_code == 429 else f"Meta Model API returned HTTP {exc.status_code}. Check model access."
        raise HTTPException(status_code=502, detail=detail) from exc
    except APIConnectionError as exc:
        raise HTTPException(status_code=502, detail="Could not connect to Meta Model API. Check internet connectivity.") from exc
    finally:
        await client.close()


@app.get("/api/cases")
def cases() -> list[dict[str, Any]]:
    return [_public_case(case) for case in store.list_cases()]


@app.post("/api/cases", status_code=202)
async def create_case(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(""),
    site: str = Form(""),
) -> dict[str, Any]:
    if not config.MODEL_API_KEY:
        raise HTTPException(status_code=503, detail="Add MODEL_API_KEY to .env and restart BLACKBOX before analyzing a video.")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".mov"}:
        raise HTTPException(status_code=415, detail="Use a decodable MP4 or MOV video encoded with H.264, H.265, or MPEG-4.")
    media_types = {".mp4": {"video/mp4", "application/octet-stream"}, ".mov": {"video/quicktime", "video/mp4", "application/octet-stream"}}
    if file.content_type and file.content_type not in media_types[suffix]:
        raise HTTPException(status_code=415, detail="The uploaded file type does not match its MP4 or MOV extension.")
    case_id = f"BB-{uuid4().hex[:8].upper()}"
    job_id = uuid4().hex
    safe_name = Path(file.filename or f"incident{suffix}").name[:180]
    destination = config.UPLOAD_DIR / f"{case_id}{suffix}"
    size = 0
    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > config.MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"Video is larger than {config.MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
                output.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="The uploaded video is empty.")
        try:
            metadata = await asyncio.to_thread(inspect_video, destination)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        now = store.now_iso()
        case = {
            "id": case_id, "title": (title.strip() or Path(safe_name).stem)[:120],
            "site": (site.strip() or "Site not specified")[:180], "created_at": now,
            "filename": safe_name, "media_path": str(destination),
            "media_type": file.content_type or "video/mp4", **metadata,
        }
        store.create_case(case, {
            "id": job_id, "case_id": case_id, "status": "queued", "stage": "queued",
            "progress": 0, "message": "Video uploaded; scene reconstruction is queued.", "updated_at": now,
        })
        background_tasks.add_task(_run_analysis, case_id, job_id, destination, metadata)
        return _public_case(store.get_case(case_id) or case)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


@app.get("/api/cases/{case_id}")
def case_detail(case_id: str) -> dict[str, Any]:
    case = store.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found.")
    return _public_case(case)


@app.post("/api/cases/{case_id}/reanalyze", status_code=202)
def reanalyze_case(case_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if not config.MODEL_API_KEY:
        raise HTTPException(status_code=503, detail="Add MODEL_API_KEY to .env and restart BLACKBOX before retrying analysis.")
    case = store.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found.")
    path = Path(case["media_path"])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The local video file is missing. Upload it again to retry.")
    job_id = uuid4().hex
    now = store.now_iso()
    store.create_job({
        "id": job_id, "case_id": case_id, "status": "queued", "stage": "queued",
        "progress": 0, "message": "Analysis retry is queued.", "updated_at": now,
    })
    metadata = {key: case[key] for key in ("duration_s", "width", "height", "fps")}
    background_tasks.add_task(_run_analysis, case_id, job_id, path, metadata)
    return {"job_id": job_id, "status": "queued"}


@app.post("/api/cases/{case_id}/calibration")
def set_case_calibration(case_id: str, payload: CalibrationPayload) -> dict[str, Any]:
    case = store.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found.")
    analysis = case.get("analysis")
    if not analysis or case.get("analysis_status") != "completed":
        raise HTTPException(status_code=409, detail="Wait for video analysis to finish before setting calibration.")
    if analysis.get("hypothesis", {}).get("stationary_camera") is not True:
        raise HTTPException(status_code=409, detail="This version can only apply a fixed-camera ground-plane calibration. Camera motion must be independently stabilized first.")
    corners = [[float(x), float(y)] for x, y in payload.corners]
    if any(x < 0 or x >= case["width"] or y < 0 or y >= case["height"] for x, y in corners):
        raise HTTPException(status_code=422, detail="Each calibration corner must lie within the source video frame.")
    try:
        result = reproject_track_analysis(analysis, corners, payload.width_m, payload.length_m)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    store.update_job(case["job_id"], result=result)
    updated = store.get_case(case_id)
    return _public_case(updated) if updated else {"detail": "Case not found."}


@app.post("/api/cases/{case_id}/simulate")
async def simulate_counterfactual(case_id: str, payload: SimulationPayload) -> dict[str, Any]:
    if not config.MODEL_API_KEY:
        raise HTTPException(status_code=503, detail="Add MODEL_API_KEY to .env before asking BLACKBOX to interpret a simulation request.")
    case = store.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Scene not found.")
    analysis = case.get("analysis")
    if not analysis or case.get("analysis_status") != "completed":
        raise HTTPException(status_code=409, detail="Wait for scene reconstruction to finish before simulating a change.")
    if not analysis.get("provenance", {}).get("metric_scale_available"):
        raise HTTPException(status_code=409, detail="Add a measured ground-plane scale in Reconstruction before running a physics simulation.")
    if not analysis.get("hypothesis", {}).get("calibration", {}).get("reviewed_by_user"):
        raise HTTPException(status_code=409, detail="Review the ground-plane corners and enter a known real-world measurement in Reconstruction before simulating.")
    client = AsyncOpenAI(api_key=config.MODEL_API_KEY, base_url=config.MODEL_API_BASE_URL, timeout=90)
    try:
        return await interpret_and_simulate(client, analysis, payload.prompt, payload.current_state)
    except AuthenticationError as exc:
        raise HTTPException(status_code=401, detail="Meta rejected MODEL_API_KEY. Check the key in .env and retry.") from exc
    except APIStatusError as exc:
        detail = "Meta Model API rate or usage limit reached." if exc.status_code == 429 else f"Muse Spark returned HTTP {exc.status_code}. Check model access and retry."
        raise HTTPException(status_code=502, detail=detail) from exc
    except APIConnectionError as exc:
        raise HTTPException(status_code=502, detail="Could not connect to Muse Spark. Check internet access and retry.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        await client.close()


@app.get("/api/jobs/{job_id}")
def job_detail(job_id: str) -> dict[str, Any]:
    job = store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found.")
    return job


@app.get("/api/cases/{case_id}/video")
def case_video(case_id: str) -> FileResponse:
    case = store.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found.")
    path = Path(case["media_path"]).resolve()
    if path.parent != config.UPLOAD_DIR.resolve() or not path.is_file():
        raise HTTPException(status_code=404, detail="Video file not found.")
    return FileResponse(path, media_type=case["media_type"], filename=case["filename"], content_disposition_type="inline")


@app.delete("/api/cases/{case_id}", status_code=204)
def remove_case(case_id: str) -> None:
    case = store.delete_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found.")
    Path(case["media_path"]).unlink(missing_ok=True)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
