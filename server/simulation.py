from __future__ import annotations

import json
from math import cos, hypot, isfinite, radians, sin, sqrt
from typing import Any

import numpy as np
from openai import AsyncOpenAI

from . import config


SCENARIO_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "supported": {"type": "boolean"},
        "explanation": {"type": "string"},
        "scenario": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "actor_id": {"type": ["string", "null"]},
                "speed_scale": {"type": "number"},
                "start_time_shift_s": {"type": "number"},
                "heading_change_deg": {"type": "number"},
                "brake_at_s": {"type": ["number", "null"]},
                "gravity_mps2": {"type": "number"},
                "friction_coefficient": {"type": "number"},
                "obstacles_removed": {"type": "boolean"},
                "obstacle_id": {"type": ["string", "null"]},
            },
            "required": ["actor_id", "speed_scale", "start_time_shift_s", "heading_change_deg", "brake_at_s", "gravity_mps2", "friction_coefficient", "obstacles_removed", "obstacle_id"],
        },
    },
    "required": ["supported", "explanation", "scenario"],
}


def default_scenario(analysis: dict[str, Any]) -> dict[str, Any]:
    actors = analysis.get("tracking", {}).get("actors", [])
    primary = next((actor for actor in actors if not actor.get("is_static_obstacle") and len(actor.get("observations", [])) >= 3), None)
    return {
        "actor_id": primary.get("id") if primary else None,
        "speed_scale": 1.0,
        "start_time_shift_s": 0.0,
        "heading_change_deg": 0.0,
        "brake_at_s": None,
        "gravity_mps2": 9.81,
        "friction_coefficient": 0.7,
        "obstacles_removed": False,
        "obstacle_id": None,
    }


def validate_scenario(value: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    baseline = default_scenario(analysis)
    merged = {**baseline, **value}
    actors = analysis.get("tracking", {}).get("actors", [])
    actor_ids = {str(actor.get("id")) for actor in actors if not actor.get("is_static_obstacle")}
    actor_id = merged.get("actor_id")
    if actor_id not in actor_ids:
        raise ValueError("Choose one of the tracked moving objects before simulating a change.")
    for name, low, high in (
        ("speed_scale", 0.1, 2.0),
        ("start_time_shift_s", -5.0, 5.0),
        ("heading_change_deg", -90.0, 90.0),
        ("gravity_mps2", 0.1, 20.0),
        ("friction_coefficient", 0.02, 1.5),
    ):
        try:
            number = float(merged[name])
        except (TypeError, ValueError) as exc:
            raise ValueError(f"The proposed {name.replace('_', ' ')} is not a number.") from exc
        if not isfinite(number) or not low <= number <= high:
            raise ValueError(f"The proposed {name.replace('_', ' ')} must be between {low:g} and {high:g}.")
        merged[name] = number
    brake_at = merged.get("brake_at_s")
    if brake_at is not None:
        brake_at = float(brake_at)
        duration = float(analysis.get("metadata", {}).get("duration_s", 0))
        if not isfinite(brake_at) or not 0 <= brake_at <= duration:
            raise ValueError("The braking time must fall inside the uploaded clip.")
    merged["brake_at_s"] = brake_at
    if not isinstance(merged.get("obstacles_removed"), bool):
        raise ValueError("Obstacle removal must be a true or false value.")
    obstacle_ids = {str(actor.get("id")) for actor in actors if actor.get("is_static_obstacle")}
    obstacle_id = merged.get("obstacle_id")
    if obstacle_id is not None and obstacle_id not in obstacle_ids:
        raise ValueError("Choose a detected static object before removing it from the simulation.")
    if not merged["obstacles_removed"]:
        merged["obstacle_id"] = None
    elif obstacle_id is None and not obstacle_ids:
        raise ValueError("No detected static objects are available to remove.")
    return merged


def _actor_context(analysis: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for actor in analysis.get("tracking", {}).get("actors", []):
        kinematics = actor.get("kinematics", {})
        result.append({
            "id": actor.get("id"),
            "class": actor.get("class_name", actor.get("concept", "moving object")),
            "static_obstacle": bool(actor.get("is_static_obstacle")),
            "observations": len(actor.get("observations", [])),
            "initial_speed_mps": kinematics.get("first_observed_speed_mps"),
            "fit_residual_m": kinematics.get("trajectory_fit_residual_m"),
        })
    return result


async def interpret_request(
    client: AsyncOpenAI,
    analysis: dict[str, Any],
    prompt: str,
    current_scenario: dict[str, Any] | None,
) -> dict[str, Any]:
    current = validate_scenario(current_scenario or default_scenario(analysis), analysis)
    response = await client.responses.create(
        model=config.MUSE_MODEL,
        input=[{"role": "user", "content": [{"type": "input_text", "text": (
            "Translate the user's requested counterfactual into the provided scenario fields. "
            "You interpret instructions only; never predict the physical outcome. The deterministic simulation engine does that. "
            "Keep every unchanged field exactly as in current_scenario. Change only fields needed by the request. "
            "Select a tracked moving actor by its exact id. A speed change is a multiplier on that actor's first measured speed. "
            "Moving an object earlier means a negative start_time_shift_s. A different travel/collision approach angle is a heading_change_deg. "
            "To test braking, set brake_at_s to the clip time when braking begins; the engine applies friction-limited deceleration. "
            "A gravity change affects friction-limited braking on this ground-plane model, but does not create airborne motion. "
            "To remove one static obstruction, set obstacles_removed=true and obstacle_id to its exact detected id; use null id only if the user asks to remove every detected obstruction. "
            "If the request needs hidden geometry, a vertical jump/fall, precise collision deformation, an unknown object, or another unsupported effect, "
            "set supported=false and explain the missing evidence in plain language. Do not guess a physical outcome. "
            f"Current scenario: {json.dumps(current, separators=(',', ':'))}. "
            f"Metric scale available: {bool(analysis.get('provenance', {}).get('metric_scale_available'))}. "
            f"Detected actors: {json.dumps(_actor_context(analysis), separators=(',', ':'))}. "
            f"Clip duration: {analysis.get('metadata', {}).get('duration_s', 0)} seconds. "
            f"User request: {prompt[:500]}"
        )}]}],
        text={"format": {"type": "json_schema", "name": "blackbox_scenario_change", "strict": True, "schema": SCENARIO_SCHEMA}},
        max_output_tokens=700,
        store=False,
    )
    raw = getattr(response, "output_text", None)
    if not raw:
        raise ValueError("Muse Spark returned no scenario interpretation. Try rephrasing the request.")
    try:
        interpreted = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("Muse Spark returned an unreadable scenario. Try rephrasing the request.") from exc
    if not isinstance(interpreted, dict) or not isinstance(interpreted.get("supported"), bool):
        raise ValueError("Muse Spark returned an invalid scenario interpretation.")
    if not interpreted["supported"]:
        return {"supported": False, "explanation": str(interpreted.get("explanation", "This request is outside the supported simulation model."))[:600], "scenario": current, "simulation": None}
    scenario = validate_scenario(interpreted.get("scenario", {}), analysis)
    simulation = simulate_scene(analysis, scenario)
    return {
        "supported": True,
        "explanation": str(interpreted.get("explanation", "Scenario parameters updated."))[:600],
        "scenario": scenario,
        "simulation": simulation,
    }


def _fit_actor(actor: dict[str, Any]) -> dict[str, Any] | None:
    observations = [
        point for point in actor.get("observations", [])
        if point.get("x_m") is not None and point.get("y_m") is not None
    ]
    observations.sort(key=lambda point: float(point["time_s"]))
    if len(observations) < 3:
        return None
    times = np.asarray([float(point["time_s"]) for point in observations], dtype=np.float64)
    start = float(times[0])
    relative = times - start
    design = np.column_stack([np.ones_like(relative), relative, 0.5 * relative * relative])
    positions = np.asarray([[float(point["x_m"]), float(point["y_m"])] for point in observations], dtype=np.float64)
    coefficients, *_ = np.linalg.lstsq(design, positions, rcond=None)
    errors = positions - design @ coefficients
    residual = float(np.sqrt(np.mean(np.sum(errors * errors, axis=1))))
    return {
        "start_s": start,
        "position": coefficients[0].astype(np.float64),
        "velocity": coefficients[1].astype(np.float64),
        "acceleration": coefficients[2].astype(np.float64),
        "residual_m": residual,
    }


def _radius(actor: dict[str, Any]) -> float:
    name = str(actor.get("class_name", "")).lower()
    if actor.get("is_static_obstacle"):
        widths = [float(point.get("footprint_width_m")) for point in actor.get("observations", []) if point.get("footprint_width_m")]
        return max(0.35, min(3.0, float(np.median(widths)) * 0.65)) if widths else 0.9
    if any(word in name for word in ("pedestrian", "person", "worker", "athlete")):
        return 0.35
    if "forklift" in name:
        return 1.35
    if any(word in name for word in ("truck", "bus", "van")):
        return 3.6
    if any(word in name for word in ("vehicle", "car", "sedan", "motorcycle", "bicycle")):
        return 2.3
    return 0.65


def simulate_scene(analysis: dict[str, Any], scenario: dict[str, Any]) -> dict[str, Any]:
    if not analysis.get("provenance", {}).get("metric_scale_available"):
        raise ValueError("Physics simulation needs a measured or reviewed metric ground-plane scale. Add a known ground-plane measurement in Reconstruction first.")
    actors = analysis.get("tracking", {}).get("actors", [])
    duration = float(analysis.get("metadata", {}).get("duration_s", 0))
    fps = min(60.0, max(1.0, float(analysis.get("metadata", {}).get("fps", 30))))
    if not 0 < duration <= 15:
        raise ValueError("The clip duration is outside the supported simulation window.")

    moving = [actor for actor in actors if not actor.get("is_static_obstacle")]
    fits = {str(actor.get("id")): _fit_actor(actor) for actor in moving}
    fits = {actor_id: fit for actor_id, fit in fits.items() if fit is not None}
    if scenario["actor_id"] not in fits:
        raise ValueError("This object needs at least three metric ground-contact observations before it can be simulated.")
    fit_residuals = [float(fit["residual_m"]) for fit in fits.values()]
    maximum_residual = max(fit_residuals, default=0.0)
    if maximum_residual > 1.5:
        raise ValueError(f"The constant-acceleration model misses the observed paths by up to {maximum_residual:.2f} m. Refine tracking or calibration before simulating.")

    actor_by_id = {str(actor.get("id")): actor for actor in actors}
    obstacles = [actor for actor in actors if actor.get("is_static_obstacle") and actor.get("observations")]
    static_states = []
    for obstacle in obstacles:
        points = [point for point in obstacle["observations"] if point.get("x_m") is not None and point.get("y_m") is not None]
        if points:
            static_states.append({
                "id": str(obstacle["id"]),
                "class_name": obstacle.get("class_name", "static object"),
                "position": np.median([[float(point["x_m"]), float(point["y_m"])] for point in points], axis=0),
                "radius": _radius(obstacle),
            })

    dt = 1.0 / fps
    scenario_actor_id = scenario["actor_id"]
    actor_states: dict[str, dict[str, Any]] = {}
    spawn_times = {actor_id: fit["start_s"] + (float(scenario["start_time_shift_s"]) if actor_id == scenario_actor_id else 0.0) for actor_id, fit in fits.items()}
    simulation_start = min(0.0, min(spawn_times.values(), default=0.0))
    simulation_start = np.floor(simulation_start / dt) * dt
    step_count = int(np.ceil((duration - simulation_start) / dt))
    collided: set[tuple[str, str]] = set()
    collisions: list[dict[str, Any]] = []
    output_samples: dict[str, list[dict[str, float]]] = {actor_id: [] for actor_id in fits}
    friction_limit = float(scenario["friction_coefficient"]) * float(scenario["gravity_mps2"])
    heading = radians(float(scenario["heading_change_deg"]))
    rotation = np.asarray([[cos(heading), -sin(heading)], [sin(heading), cos(heading)]], dtype=np.float64)
    masses = {
        actor_id: max(1.0, float(actor_by_id[actor_id].get("mass_kg_assumed") or 1500.0))
        for actor_id in fits
    }
    for index in range(step_count + 1):
        time_s = simulation_start + index * dt
        if time_s > duration + dt * 0.01:
            break
        for actor_id, fit in fits.items():
            if actor_id in actor_states or time_s + 1e-9 < spawn_times[actor_id]:
                continue
            velocity = fit["velocity"].copy()
            acceleration = fit["acceleration"].copy()
            if actor_id == scenario_actor_id:
                velocity = rotation @ velocity * float(scenario["speed_scale"])
                acceleration = rotation @ acceleration
                shift = float(scenario["start_time_shift_s"])
                fit_position = fit["position"] + velocity * shift + 0.5 * acceleration * shift * shift
            else:
                fit_position = fit["position"]
            actor_states[actor_id] = {"position": fit_position.copy(), "velocity": velocity, "acceleration": acceleration}

        next_time = min(time_s + dt, duration)
        step = max(0.0, next_time - time_s)
        if step > 0:
            for actor_id, state in actor_states.items():
                active_step = step
                if time_s < spawn_times[actor_id]:
                    active_step = max(0.0, next_time - spawn_times[actor_id])
                if active_step <= 0:
                    continue
                acceleration = state["acceleration"].copy()
                magnitude = float(np.linalg.norm(acceleration))
                if magnitude > friction_limit and magnitude > 0:
                    acceleration *= friction_limit / magnitude
                if actor_id == scenario_actor_id and scenario["brake_at_s"] is not None and time_s >= float(scenario["brake_at_s"]):
                    speed = float(np.linalg.norm(state["velocity"]))
                    if speed > 1e-8:
                        direction = state["velocity"] / speed
                        next_speed = max(0.0, speed - friction_limit * active_step)
                        next_velocity = direction * next_speed
                        state["position"] += (state["velocity"] + next_velocity) * (0.5 * active_step)
                        state["velocity"] = next_velocity
                        continue
                    state["velocity"][:] = 0
                    continue
                next_velocity = state["velocity"] + acceleration * active_step
                state["position"] += (state["velocity"] + next_velocity) * (0.5 * active_step)
                state["velocity"] = next_velocity

            active_ids = [actor_id for actor_id in actor_states if time_s + 1e-9 >= spawn_times[actor_id]]
            for left_index, actor_a in enumerate(active_ids):
                state_a = actor_states[actor_a]
                for actor_b in active_ids[left_index + 1:]:
                    pair = tuple(sorted((actor_a, actor_b)))
                    if pair in collided:
                        continue
                    state_b = actor_states[actor_b]
                    delta = state_b["position"] - state_a["position"]
                    distance = float(np.linalg.norm(delta))
                    minimum = _radius(actor_by_id[actor_a]) + _radius(actor_by_id[actor_b])
                    if distance >= minimum:
                        continue
                    normal = delta / distance if distance > 1e-9 else np.asarray([1.0, 0.0])
                    relative_speed = float(np.dot(state_b["velocity"] - state_a["velocity"], normal))
                    if relative_speed < 0:
                        impulse = -(1.0 + 0.2) * relative_speed / (1.0 / masses[actor_a] + 1.0 / masses[actor_b])
                        state_a["velocity"] -= impulse / masses[actor_a] * normal
                        state_b["velocity"] += impulse / masses[actor_b] * normal
                    overlap = minimum - distance
                    state_a["position"] -= normal * overlap * 0.5
                    state_b["position"] += normal * overlap * 0.5
                    collided.add(pair)
                    collisions.append({"time_s": round(max(time_s, 0.0), 4), "actor_a": pair[0], "actor_b": pair[1]})

                if scenario["obstacles_removed"] and (scenario.get("obstacle_id") is None or scenario["obstacle_id"] == obstacle["id"]):
                    continue
                for obstacle in static_states:
                    pair = tuple(sorted((actor_a, obstacle["id"])))
                    if pair in collided:
                        continue
                    delta = obstacle["position"] - state_a["position"]
                    distance = float(np.linalg.norm(delta))
                    minimum = _radius(actor_by_id[actor_a]) + obstacle["radius"]
                    if distance >= minimum:
                        continue
                    normal = delta / distance if distance > 1e-9 else np.asarray([1.0, 0.0])
                    relative_speed = -float(np.dot(state_a["velocity"], normal))
                    if relative_speed < 0:
                        state_a["velocity"] += (1.0 + 0.2) * relative_speed * normal
                    state_a["position"] -= normal * (minimum - distance)
                    collided.add(pair)
                    collisions.append({"time_s": round(max(time_s, 0.0), 4), "actor_a": actor_a, "actor_b": obstacle["id"]})

        if next_time >= -dt * 0.01 and index < step_count:
            sample_time = max(0.0, next_time)
            for actor_id, state in actor_states.items():
                if next_time + 1e-9 < spawn_times[actor_id]:
                    continue
                speed = float(np.linalg.norm(state["velocity"]))
                output_samples[actor_id].append({
                    "time_s": round(sample_time, 5),
                    "x_m": float(state["position"][0]),
                    "y_m": float(state["position"][1]),
                    "vx_mps": float(state["velocity"][0]),
                    "vy_mps": float(state["velocity"][1]),
                    "speed_mps": speed,
                })

    assumptions = [
        "Motion is fitted as constant planar acceleration from observed metric ground-contact tracks.",
        "Objects remain on the ground plane; this model does not simulate airborne motion, deformable bodies, or detailed steering.",
        "Collision response uses circular footprints, assumed masses, and a restitution coefficient of 0.2.",
        "Vertical dimensions and static obstacle extents are estimated from object class, not recovered from the monocular video.",
        f"Maximum constant-acceleration fit residual across tracked moving objects: {maximum_residual:.3f} m.",
    ]
    if abs(float(scenario["start_time_shift_s"])) > 0.001:
        assumptions.append("The shifted actor path is extrapolated beyond its observed start time and is not verified by the source video.")
    if abs(float(scenario["heading_change_deg"])) > 0.001:
        assumptions.append("Heading change is applied instantly at the initial state; tire steering dynamics are not modeled.")
    if scenario["gravity_mps2"] != 9.81:
        assumptions.append("Gravity changes friction-limited ground acceleration only; no vertical trajectories are represented.")

    return {
        "model": "deterministic planar constant-acceleration simulation with friction-limited braking and circular collision proxies",
        "time_step_s": dt,
        "fit_residual_m": maximum_residual,
        "actors": [
            {
                "id": actor_id,
                "class_name": actor_by_id[actor_id].get("class_name", actor_by_id[actor_id].get("concept", "moving object")),
                "is_static_obstacle": False,
                "samples": output_samples[actor_id],
            }
            for actor_id in output_samples
        ],
        "obstacles_removed": bool(scenario["obstacles_removed"]),
        "removed_obstacle_id": scenario.get("obstacle_id"),
        "gravity_mps2": float(scenario["gravity_mps2"]),
        "friction_coefficient": float(scenario["friction_coefficient"]),
        "collisions": collisions,
        "assumptions": assumptions,
        "classification": "simulated outcome under stated assumptions; not measured video data",
    }


async def interpret_and_simulate(
    client: AsyncOpenAI,
    analysis: dict[str, Any],
    prompt: str,
    current_scenario: dict[str, Any] | None,
) -> dict[str, Any]:
    result = await interpret_request(client, analysis, prompt, current_scenario)
    if not result["supported"]:
        return result
    return result
