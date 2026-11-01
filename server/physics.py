from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from math import hypot, isfinite
from typing import Any

import numpy as np
from meta_sam_parser import SegmentationBoxRecord, SegmentationMaskRecord, decode_mask_to_raster


def solve_homography(
    image_corners: Sequence[Sequence[float]],
    width_m: float,
    length_m: float,
) -> np.ndarray:
    """Map one model-identified planar quadrilateral onto metric coordinates."""
    if len(image_corners) != 4 or width_m <= 0 or length_m <= 0:
        raise ValueError("Calibration needs four image corners and positive dimensions.")
    source = np.asarray(image_corners, dtype=np.float64)
    if source.shape != (4, 2) or not np.isfinite(source).all():
        raise ValueError("Calibration corners must be four finite x/y points.")
    target = np.asarray(
        [[0, 0], [width_m, 0], [width_m, length_m], [0, length_m]],
        dtype=np.float64,
    )
    matrix: list[list[float]] = []
    rhs: list[float] = []
    for (x, y), (u, v) in zip(source, target, strict=True):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        rhs.extend([u, v])
    try:
        coefficients = np.linalg.solve(np.asarray(matrix), np.asarray(rhs))
    except np.linalg.LinAlgError as exc:
        raise ValueError("The proposed calibration area is degenerate.") from exc
    homography = np.append(coefficients, 1.0).reshape(3, 3)
    if not np.isfinite(homography).all() or np.linalg.cond(homography) > 1e12:
        raise ValueError("The proposed calibration is unstable.")
    return homography


def project_point(homography: np.ndarray, x: float, y: float) -> tuple[float, float]:
    projected = homography @ np.asarray([x, y, 1.0], dtype=np.float64)
    if abs(projected[2]) < 1e-10:
        raise ValueError("Point projects to infinity on the proposed ground plane.")
    ground_x, ground_y = projected[:2] / projected[2]
    return float(ground_x), float(ground_y)


def mask_ground_contact(record: SegmentationMaskRecord) -> tuple[float, float] | None:
    raster = np.frombuffer(decode_mask_to_raster(record.mask), dtype=np.uint8)
    if raster.size != record.mask.width * record.mask.height:
        return None
    mask = raster.reshape((record.mask.height, record.mask.width))
    rows, columns = np.nonzero(mask)
    if rows.size == 0:
        return None
    bottom = int(rows.max())
    bottom_columns = columns[rows == bottom]
    local_x = float(np.median(bottom_columns))
    local_y = float(bottom)
    return record.bounds.left + local_x, record.bounds.top + local_y


def smooth_observations(points: Sequence[dict[str, Any]], radius: int = 2) -> list[dict[str, Any]]:
    """Apply local quadratic smoothing without crossing missing-frame gaps."""
    if len(points) < 3:
        return [dict(point) for point in points]
    result: list[dict[str, Any]] = []
    for index, point in enumerate(points):
        frame = int(point.get("frame", index))
        neighborhood = [
            candidate for candidate in points[max(0, index - radius) : min(len(points), index + radius + 1)]
            if abs(int(candidate.get("frame", index)) - frame) <= radius
        ]
        item = dict(point)
        for field in ("pixel_x", "pixel_y", "x_m", "y_m"):
            usable = [candidate for candidate in neighborhood if candidate.get(field) is not None]
            if len(usable) < 3:
                continue
            times = np.asarray([float(candidate["time_s"]) - float(point["time_s"]) for candidate in usable])
            values = np.asarray([float(candidate[field]) for candidate in usable])
            degree = min(2, len(usable) - 1)
            design = np.column_stack([times**power for power in range(degree + 1)])
            fitted, *_ = np.linalg.lstsq(design, values, rcond=None)
            item[field] = float(fitted[0])
        result.append(item)
    return result


def _fit_residual(points: Sequence[dict[str, Any]], impact_time_s: float | None) -> float | None:
    usable = [
        point
        for point in points
        if point.get("x_m") is not None
        and point.get("y_m") is not None
        and (impact_time_s is None or point["time_s"] <= impact_time_s)
    ]
    if len(usable) < 3:
        return None
    times = np.asarray([point["time_s"] for point in usable], dtype=np.float64)
    times -= times[0]
    design = np.column_stack([np.ones_like(times), times, 0.5 * times * times])
    positions = np.asarray([[point["x_m"], point["y_m"]] for point in usable], dtype=np.float64)
    fitted, *_ = np.linalg.lstsq(design, positions, rcond=None)
    predicted = design @ fitted
    errors = np.linalg.norm(positions - predicted, axis=1)
    return float(np.mean(errors))


def _point_velocity(points: Sequence[dict[str, Any]], index: int) -> tuple[float, float] | None:
    if len(points) < 2:
        return None
    left = max(0, index - 1)
    right = min(len(points) - 1, index + 1)
    first = points[left]
    last = points[right]
    elapsed = float(last["time_s"] - first["time_s"])
    if elapsed <= 0 or first.get("x_m") is None or last.get("x_m") is None:
        return None
    return (
        (float(last["x_m"]) - float(first["x_m"])) / elapsed,
        (float(last["y_m"]) - float(first["y_m"])) / elapsed,
    )


def _actor_kinematics(
    actor_points: Sequence[dict[str, Any]],
    impact_time_s: float | None,
    mass_kg: float,
) -> dict[str, Any]:
    speeds: list[tuple[float, float]] = []
    measured_points = [
        point for point in actor_points
        if impact_time_s is None or float(point["time_s"]) <= impact_time_s
    ]
    for index, point in enumerate(measured_points):
        velocity = _point_velocity(measured_points, index)
        if velocity is not None:
            speeds.append((float(point["time_s"]), hypot(*velocity)))
    if speeds:
        impact_near = min(speeds, key=lambda sample: abs(sample[0] - impact_time_s))[1] if impact_time_s is not None and speeds else None
        first_observed_speed = speeds[0][1]
        braking_onset = None
        if impact_time_s is not None:
            for index in range(1, len(speeds)):
                previous_time, previous_speed = speeds[index - 1]
                timestamp, speed = speeds[index]
                delta = timestamp - previous_time
                if delta > 0 and (previous_speed - speed) / delta >= 1.0:
                    braking_onset = previous_time
                    break
    else:
        first_observed_speed = None
        impact_near = None
        braking_onset = None
    return {
        "first_observed_speed_mps": float(first_observed_speed) if first_observed_speed is not None else None,
        "first_observed_speed_mph": float(first_observed_speed * 2.236936) if first_observed_speed is not None else None,
        "speed_near_impact_mps": float(impact_near) if impact_near is not None else None,
        "speed_near_impact_mph": float(impact_near * 2.236936) if impact_near is not None else None,
        "braking_onset_candidate_s": braking_onset,
        "mass_kg_assumed": float(mass_kg),
        "trajectory_fit_residual_m": _fit_residual(actor_points, impact_time_s),
    }


def build_actor_tracks(
    results: Iterable[tuple[str, Any]],
    fps: float,
    homography: np.ndarray | None,
    actor_hypotheses: Sequence[dict[str, Any]],
    impact_time_s: float | None,
) -> dict[str, Any]:
    """Turn SAM boxes/masks into smoothed ground-contact trajectories."""
    records_by_actor: dict[str, dict[int, dict[str, Any]]] = defaultdict(dict)
    prompts: dict[str, str] = {}
    for concept, result in results:
        for record in result.records:
            if isinstance(record, SegmentationBoxRecord) and record.frame is not None:
                actor_id = f"{concept}:{record.object_id}"
                prompts[actor_id] = concept
                observation = records_by_actor[actor_id].setdefault(record.frame.frame_index, {})
                observation.update(
                    {
                        "frame": record.frame.frame_index,
                        "left": record.left,
                        "top": record.top,
                        "right": record.right,
                        "bottom": record.bottom,
                        "confidence": record.confidence,
                    }
                )
            elif isinstance(record, SegmentationMaskRecord) and record.frame is not None:
                actor_id = f"{concept}:{record.object_id}"
                prompts[actor_id] = concept
                observation = records_by_actor[actor_id].setdefault(record.frame.frame_index, {})
                contact = mask_ground_contact(record)
                if contact is not None:
                    observation["pixel_x"], observation["pixel_y"] = contact
                    observation["contact_method"] = "mask_lower_boundary"
    actors: list[dict[str, Any]] = []
    residuals: list[float] = []
    safe_fps = fps if isfinite(fps) and fps > 0 else 30.0
    for actor_id, by_frame in sorted(records_by_actor.items()):
        observations: list[dict[str, Any]] = []
        for frame, observation in sorted(by_frame.items()):
            box = observation
            pixel_x = float(observation.get("pixel_x", (box.get("left", 0) + box.get("right", 0)) / 2))
            pixel_y = float(observation.get("pixel_y", box.get("bottom", 0)))
            item: dict[str, Any] = {
                "frame": int(frame),
                "time_s": float(frame / safe_fps),
                "pixel_x": pixel_x,
                "pixel_y": pixel_y,
                "box": {key: round(float(observation[key]), 2) for key in ("left", "top", "right", "bottom") if key in observation},
                "confidence": observation.get("confidence"),
                "contact_method": observation.get("contact_method", "box_lower_center"),
            }
            if homography is not None:
                try:
                    item["x_m"], item["y_m"] = project_point(homography, pixel_x, pixel_y)
                    if "left" in observation and "right" in observation:
                        left_point = project_point(homography, float(observation["left"]), float(observation.get("bottom", pixel_y)))
                        right_point = project_point(homography, float(observation["right"]), float(observation.get("bottom", pixel_y)))
                        item["footprint_width_m"] = float(hypot(right_point[0] - left_point[0], right_point[1] - left_point[1]))
                except ValueError:
                    item["x_m"] = item["y_m"] = None
                    item["footprint_width_m"] = None
            else:
                item["x_m"] = item["y_m"] = None
                item["footprint_width_m"] = None
            observations.append(item)
        observations = smooth_observations(observations)
        concept = prompts[actor_id]
        def matches(entry: dict[str, Any]) -> bool:
            label = str(entry.get("class_name", "")).lower()
            role = str(entry.get("role", "")).lower()
            if concept == "vehicle":
                return "vehicle" in label or any(name in label for name in ("car", "truck", "bus", "van", "forklift", "motorcycle"))
            if concept == "pedestrian":
                return any(name in label for name in ("pedestrian", "person", "cyclist", "worker")) or "pedestrian" in role
            if concept == "stationary obstruction":
                return "obstruction" in role or "obstacle" in label
            return concept in label
        hypothesis = next((entry for entry in actor_hypotheses if matches(entry)), {})
        mass_kg = float(hypothesis.get("mass_kg", 1500) or 1500)
        if concept == "stationary obstruction":
            mass_kg = 0.0
        kinematics = _actor_kinematics(observations, impact_time_s, mass_kg)
        if kinematics["trajectory_fit_residual_m"] is not None:
            residuals.append(kinematics["trajectory_fit_residual_m"])
        actors.append(
            {
                "id": actor_id,
                "concept": concept,
                "class_name": hypothesis.get("class_name") or concept,
                "role": hypothesis.get("role", "static obstacle" if concept == "stationary obstruction" else "moving"),
                "is_static_obstacle": concept == "stationary obstruction",
                "mass_kg_assumed": mass_kg,
                "observations": observations,
                "kinematics": kinematics,
            }
        )
    return {
        "actors": actors,
        "mean_fit_residual_m": float(np.mean(residuals)) if residuals else None,
        "fit_model": "least-squares planar constant-acceleration fit",
        "fit_note": "Fit residuals describe this model's agreement with detected ground-contact points; they are not a verification score.",
    }


def stopping_distance_m(speed_mph: float, reaction_s: float, friction: float) -> dict[str, float]:
    if speed_mph < 0 or reaction_s < 0 or not 0 < friction <= 1.5:
        raise ValueError("Speed, reaction time, and friction must be within physical ranges.")
    speed_mps = speed_mph * 0.44704
    reaction_distance = speed_mps * reaction_s
    braking_distance = speed_mps * speed_mps / (2 * friction * 9.81)
    return {
        "reaction_distance_m": reaction_distance,
        "braking_distance_m": braking_distance,
        "total_distance_m": reaction_distance + braking_distance,
    }


def reproject_track_analysis(
    analysis: dict[str, Any],
    image_corners: Sequence[Sequence[float]],
    width_m: float,
    length_m: float,
) -> dict[str, Any]:
    """Apply analyst-entered planar calibration to saved pixel tracks."""
    matrix = solve_homography(image_corners, width_m, length_m)
    impact_time = analysis.get("hypothesis", {}).get("impact_time_s")
    residuals: list[float] = []
    tracks = analysis["tracking"]
    for actor in tracks.get("actors", []):
        observations = actor.get("observations", [])
        for point in observations:
            point["x_m"], point["y_m"] = project_point(matrix, float(point["pixel_x"]), float(point["pixel_y"]))
        observations = smooth_observations(observations)
        actor["observations"] = observations
        mass = float(actor.get("mass_kg_assumed", 1500) or 0)
        actor["kinematics"] = _actor_kinematics(observations, impact_time, mass)
        residual = actor["kinematics"].get("trajectory_fit_residual_m")
        if residual is not None:
            residuals.append(residual)
    tracks["mean_fit_residual_m"] = float(np.mean(residuals)) if residuals else None
    calibration = analysis["hypothesis"]["calibration"]
    calibration.update({
        "available": True,
        "source": "Analyst-specified planar rectangle",
        "reviewed_by_user": True,
        "evidence": "Corner positions and dimensions were entered in the BLACKBOX review workspace.",
        "confidence": None,
        "width_m": float(width_m),
        "length_m": float(length_m),
        "image_corners": [[float(value) for value in point] for point in image_corners],
        "review_required": True,
        "status": "analyst-entered calibration; verify the reference dimensions and ground plane",
    })
    analysis["provenance"]["metric_scale_available"] = True
    analysis["provenance"]["classification"] = "model-assisted track estimate with analyst-entered scale; independent review required"
    analysis["provenance"]["deterministic_claim"] = "Track speeds and residuals are deterministic calculations from the detected points and analyst-entered planar scale; detection and input measurement error remain."
    if tracks.get("fit_note", "").startswith("Metric speeds are unavailable"):
        tracks["fit_note"] = "Metric scale was entered by an analyst and still requires independent verification. " + tracks["fit_note"].split("Pixel tracks are observations only. ", 1)[-1]
    return analysis
