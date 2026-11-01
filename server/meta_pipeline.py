from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Awaitable, Callable

import cv2
from meta_sam_parser import parse_responses_stream, video_segmentation_format
from openai import AsyncOpenAI, APIConnectionError, APIStatusError, AuthenticationError

from . import config
from .physics import build_actor_tracks, solve_homography

Progress = Callable[[int, str, str], Awaitable[None]]

SCENE_SCHEMA: dict[str, Any] = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "scene_type": {"type": "string"},
        "stationary_camera": {"type": "boolean"},
        "summary": {"type": "string"},
        "impact_time_s": {"type": ["number", "null"]},
        "impact_confidence": {"type": "number"},
        "calibration": {
            "type": "object", "additionalProperties": False,
            "properties": {
                "available": {"type": "boolean"},
                "source": {"type": "string"},
                "evidence": {"type": "string"},
                "confidence": {"type": "number"},
                "width_m": {"type": ["number", "null"]},
                "length_m": {"type": ["number", "null"]},
                "image_corners": {"type": ["array", "null"], "items": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, "minItems": 4, "maxItems": 4},
            },
            "required": ["available", "source", "evidence", "confidence", "width_m", "length_m", "image_corners"],
        },
        "actors": {
            "type": "array", "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "class_name": {"type": "string"},
                    "role": {"type": "string"},
                    "mass_kg": {"type": ["number", "null"]},
                    "confidence": {"type": "number"},
                }, "required": ["class_name", "role", "mass_kg", "confidence"],
            },
        },
        "obstacles": {"type": "array", "items": {"type": "string"}},
        "limitations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["scene_type", "stationary_camera", "summary", "impact_time_s", "impact_confidence", "calibration", "actors", "obstacles", "limitations"],
}


def inspect_video(path: Path) -> dict[str, Any]:
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise ValueError("The uploaded video could not be decoded. Use a standard MP4 or MOV file.")
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        ok, frame = capture.read()
        if not ok or frame is None or width <= 0 or height <= 0 or count <= 0 or fps <= 0:
            raise ValueError("The uploaded video has incomplete or unsupported video metadata.")
        duration = count / fps
        if duration > config.MAX_CLIP_SECONDS:
            raise ValueError(f"Clip is {duration:.1f} seconds; the current limit is {config.MAX_CLIP_SECONDS} seconds.")
        if max(width, height) > config.MAX_VIDEO_DIMENSION or width * height > config.MAX_VIDEO_PIXELS:
            raise ValueError(f"Video resolution exceeds the supported {config.MAX_VIDEO_DIMENSION}px dimension and {config.MAX_VIDEO_PIXELS // 1_000_000} MP limits.")
        if fps > config.MAX_VIDEO_FPS:
            raise ValueError(f"Video frame rate is {fps:.1f} FPS; the current limit is {config.MAX_VIDEO_FPS:g} FPS.")

        # Decode the complete, bounded clip before it is accepted. This catches truncated
        # or malformed files before they reach the hosted video models.
        decoded_frames = 1
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame is None or frame.shape[1] != width or frame.shape[0] != height:
                raise ValueError("The uploaded video has inconsistent or malformed frame dimensions.")
            decoded_frames += 1
        if decoded_frames < count - 1:
            raise ValueError("The uploaded video is truncated or could not be decoded through its final frame.")
        duration = decoded_frames / fps
        if duration > config.MAX_CLIP_SECONDS:
            raise ValueError(f"Clip is {duration:.1f} seconds; the current limit is {config.MAX_CLIP_SECONDS} seconds.")
        return {"fps": fps, "frame_count": decoded_frames, "width": width, "height": height, "duration_s": duration}
    finally:
        capture.release()


def _response_text(response: Any) -> str:
    value = getattr(response, "output_text", None)
    if value:
        return value
    for item in getattr(response, "output", []):
        for content in getattr(item, "content", []):
            if getattr(content, "text", None):
                return content.text
    raise ValueError("Meta Muse Spark returned no structured scene analysis.")


def _validate_hypothesis(value: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    calibration = value.get("calibration") or {}
    confidence = float(calibration.get("confidence", 0))
    width = calibration.get("width_m")
    length = calibration.get("length_m")
    corners = calibration.get("image_corners")
    valid_scale = (
        value.get("stationary_camera") is True
        and calibration.get("available") is True and confidence >= 0.65
        and isinstance(width, (int, float)) and 1 <= width <= 100
        and isinstance(length, (int, float)) and 1 <= length <= 500
        and isinstance(corners, list) and len(corners) == 4
    )
    matrix = None
    if valid_scale:
        try:
            if any(not (0 <= float(point[0]) < metadata["width"] and 0 <= float(point[1]) < metadata["height"]) for point in corners):
                valid_scale = False
            else:
                matrix = solve_homography(corners, float(width), float(length))
        except (TypeError, ValueError, IndexError):
            valid_scale = False
    calibration["available"] = bool(valid_scale)
    calibration["review_required"] = True
    calibration["reviewed_by_user"] = False
    calibration["status"] = "model hypothesis; analyst review required" if valid_scale else "no defensible fixed-camera metric scale identified"
    value["calibration"] = calibration
    if value.get("impact_time_s") is not None:
        try:
            impact = float(value["impact_time_s"])
            if not 0 <= impact <= metadata["duration_s"]:
                value["impact_time_s"] = None
        except (TypeError, ValueError):
            value["impact_time_s"] = None
    value["actors"] = [
        {**actor, "mass_kg": actor.get("mass_kg") if isinstance(actor.get("mass_kg"), (int, float)) and 1 <= actor["mass_kg"] <= 100_000 else None}
        for actor in value.get("actors", [])
    ]
    return {"hypothesis": value, "homography": matrix}


def _segmentation_prompts(hypothesis: dict[str, Any]) -> list[tuple[str, str]]:
    """Request masks only for actor classes Muse Spark found in this scene."""
    actors = hypothesis.get("actors", [])
    classes = [
        (str(actor.get("class_name", "")).strip().lower(), str(actor.get("role", "")).strip().lower())
        for actor in actors
    ]
    prompts: list[tuple[str, str]] = []
    vehicle_terms = ("vehicle", "car", "truck", "bus", "van", "forklift", "motorcycle", "bicycle", "cyclist")
    people_terms = ("pedestrian", "person", "worker", "athlete", "human")
    seen: set[str] = set()
    for class_name, role in classes:
        if not class_name or any(word in role for word in ("static", "obstacle", "obstruction")):
            continue
        lowered = class_name.lower()
        if any(term in lowered for term in vehicle_terms):
            key, prompt = "vehicle", "vehicle"
        elif any(term in lowered for term in people_terms):
            key, prompt = "pedestrian", "person"
        else:
            key = prompt = class_name
        if key not in seen:
            prompts.append((key, prompt))
            seen.add(key)

    scene_type = str(hypothesis.get("scene_type", "")).lower()
    if not prompts:
        fallback = "vehicle" if any(term in scene_type for term in ("road", "traffic", "transport")) else "moving object"
        prompts.append((fallback, fallback))
    obstacle_names = [str(item).strip() for item in hypothesis.get("obstacles", []) if str(item).strip()]
    static_actors = [class_name for class_name, role in classes if class_name and any(word in role for word in ("static", "obstacle", "obstruction"))]
    if obstacle_names or static_actors:
        label = obstacle_names[0] if obstacle_names else static_actors[0]
        prompts.append(("stationary obstruction", label[:80]))
    return prompts[:6]


async def analyze_video(path: Path, metadata: dict[str, Any], progress: Progress) -> dict[str, Any]:
    """Run Meta scene reasoning + SAM video masks, then deterministic track math."""
    if not config.MODEL_API_KEY:
        raise RuntimeError("Add MODEL_API_KEY to the project .env file, then restart BLACKBOX.")
    client = AsyncOpenAI(api_key=config.MODEL_API_KEY, base_url=config.MODEL_API_BASE_URL, timeout=300)
    remote_file_id: str | None = None
    try:
        await progress(8, "upload", "Uploading clip to Meta Model API")
        with path.open("rb") as video:
            remote = await client.files.create(file=video, purpose="user_data")
        remote_file_id = remote.id
        await progress(20, "scene_analysis", "Muse Spark is identifying scene geometry and actors")
        response = await client.responses.create(
            model=config.MUSE_MODEL,
            input=[{"role": "user", "content": [
                {"type": "input_text", "text": (
                    "Analyze this short, fixed-camera video of a scene with objects moving on a visible ground plane. "
                    "It may show a road, workplace, sports, robotics, or another physical environment. "
                    "Return observable scene facts and clearly marked hypotheses in the required schema. "
                    "For metric calibration, only use a clearly identifiable standard marking/object; "
                    "if not confidently identified, set available=false and dimensions/corners null. "
                    "image_corners must be ordered top-left, top-right, bottom-right, bottom-left in source pixels, "
                    "and describe a single planar rectangle with stated real width/length. Do not invent dimensions, speeds, "
                    "hidden geometry, or object properties. Include only visible actors and obstacles. "
                    f"Video dimensions are {metadata['width']}x{metadata['height']}, {metadata['fps']:.3f} FPS, "
                    f"duration {metadata['duration_s']:.3f}s. impact_time_s is seconds from first frame or null."
                )},
                {"type": "input_file", "file_id": remote_file_id},
            ]}],
            text={"format": {"type": "json_schema", "name": "blackbox_scene_hypothesis", "strict": True, "schema": SCENE_SCHEMA}},
            store=False,
        )
        try:
            raw_hypothesis = json.loads(_response_text(response))
        except (json.JSONDecodeError, TypeError) as exc:
            raise RuntimeError("Muse Spark returned a scene analysis that could not be read. Retry the case.") from exc
        validated = _validate_hypothesis(raw_hypothesis, metadata)
        prompts = _segmentation_prompts(validated["hypothesis"])
        segmentation_results: list[tuple[str, Any]] = []
        await progress(35, "segmentation", f"SAM 3.1 is tracking {len(prompts)} identified object type(s)")
        for concept_index, (concept, prompt) in enumerate(prompts):
            raw_stream = await client.responses.create(
                model=config.SAM_MODEL,
                input=[{"role": "user", "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_video", "file_id": remote_file_id},
                ]}],
                stream=True,
                store=False,
            )
            parser = parse_responses_stream(raw_stream, video_segmentation_format())
            async with parser:
                async for _snapshot in parser:
                    pass
                result = await parser.final_result()
            if getattr(getattr(result, "outcome", None), "status", "completed") != "completed":
                raise RuntimeError(f"SAM 3.1 did not finish tracking {prompt}. Retry the scene.")
            fatal_diagnostics = [diagnostic for diagnostic in getattr(result, "diagnostics", ()) if str(getattr(diagnostic.severity, "value", diagnostic.severity)).lower() == "error"]
            if fatal_diagnostics:
                raise RuntimeError(f"SAM 3.1 could not parse the {prompt} segmentation output. Retry the scene.")
            segmentation_results.append((concept, result))
            percent = 35 + round((concept_index + 1) * 30 / len(prompts))
            await progress(percent, "segmentation", f"SAM 3.1 finished tracking {prompt}")

        await progress(72, "kinematics", "Converting contact points and calculating trajectory estimates")
        tracks = build_actor_tracks(
            segmentation_results, metadata["fps"], validated["homography"],
            validated["hypothesis"].get("actors", []), validated["hypothesis"].get("impact_time_s"),
        )
        calibration = validated["hypothesis"]["calibration"]
        if not calibration["available"]:
            tracks["fit_note"] = "Metric speeds are unavailable because the scale is not calibrated. Pixel tracks are observations only. " + tracks["fit_note"]
        await progress(92, "complete", "Analysis complete; review model hypotheses and calibration")
        return {
            "engine": {"muse_model": config.MUSE_MODEL, "segmentation_model": config.SAM_MODEL},
            "metadata": metadata,
            "hypothesis": validated["hypothesis"],
            "tracking": tracks,
            "provenance": {
                "classification": "automated model-assisted estimate; analyst review required",
                "metric_scale_available": bool(calibration["available"]),
                "deterministic_claim": "The reported trajectory calculations are deterministic given the detected points and calibration hypothesis; perception and calibration are model estimates.",
                "not_a_finding": "Scene geometry and physical properties are estimates. This pipeline does not recover hidden surfaces or verify real-world dimensions without calibration.",
            },
        }
    except AuthenticationError as exc:
        raise RuntimeError("Meta rejected MODEL_API_KEY. Check the key in .env and restart the server.") from exc
    except APIStatusError as exc:
        if exc.status_code == 429:
            raise RuntimeError("Meta Model API rate or usage limit reached. Check your Meta account and retry.") from exc
        raise RuntimeError(f"Meta Model API returned HTTP {exc.status_code}. Check model access and the uploaded clip, then retry.") from exc
    except APIConnectionError as exc:
        raise RuntimeError("Could not connect to the Meta Model API. Check your internet connection and retry.") from exc
    finally:
        if remote_file_id:
            try:
                await client.files.delete(remote_file_id)
            except Exception:
                pass
        await client.close()
