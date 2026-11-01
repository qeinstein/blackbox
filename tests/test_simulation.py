import asyncio
import json
from types import SimpleNamespace

import pytest

from server.simulation import default_scenario, interpret_and_simulate, simulate_scene, validate_scenario


def metric_scene(duration=2.0, fps=10.0):
    times = [index / fps for index in range(int(duration * fps) + 1)]
    return {
        "metadata": {"duration_s": duration, "fps": fps},
        "provenance": {"metric_scale_available": True},
        "tracking": {"actors": [{
            "id": "car-1", "class_name": "car", "mass_kg_assumed": 1500,
            "observations": [{"time_s": time_s, "x_m": time_s, "y_m": 0.0} for time_s in times],
        }]},
    }


def test_deterministic_scene_recomputes_speed_and_braking():
    analysis = metric_scene()
    baseline = default_scenario(analysis)
    original = simulate_scene(analysis, baseline)
    assert original["fit_residual_m"] == pytest.approx(0)
    assert original["actors"][0]["samples"][-1]["x_m"] == pytest.approx(2.0)

    slower = validate_scenario({**baseline, "speed_scale": 0.5}, analysis)
    changed = simulate_scene(analysis, slower)
    assert changed["actors"][0]["samples"][-1]["x_m"] == pytest.approx(1.0)

    braking = validate_scenario({**baseline, "brake_at_s": 0.5}, analysis)
    braked = simulate_scene(analysis, braking)
    assert next(sample for sample in braked["actors"][0]["samples"] if sample["time_s"] == 0.7)["speed_mps"] == pytest.approx(0)


def test_simulation_refuses_unscaled_or_bad_fit_scene():
    analysis = metric_scene()
    baseline = default_scenario(analysis)
    analysis["provenance"]["metric_scale_available"] = False
    with pytest.raises(ValueError, match="metric ground-plane scale"):
        simulate_scene(analysis, baseline)

    analysis = metric_scene()
    analysis["tracking"]["actors"][0]["observations"][4]["y_m"] = 8.0
    with pytest.raises(ValueError, match="misses the observed paths"):
        simulate_scene(analysis, default_scenario(analysis))


def test_scenario_rejects_unknown_actors_and_out_of_range_values():
    analysis = metric_scene()
    baseline = default_scenario(analysis)
    with pytest.raises(ValueError, match="tracked moving object"):
        validate_scenario({**baseline, "actor_id": "unknown"}, analysis)
    with pytest.raises(ValueError, match="speed scale"):
        validate_scenario({**baseline, "speed_scale": 20}, analysis)


def test_meta_interprets_parameters_but_engine_computes_result():
    analysis = metric_scene()
    scenario = {**default_scenario(analysis), "speed_scale": 0.5}

    class Responses:
        async def create(self, **kwargs):
            assert kwargs["store"] is False
            assert kwargs["text"]["format"]["strict"] is True
            return SimpleNamespace(output_text=json.dumps({
                "supported": True,
                "explanation": "Reduced the selected object's initial speed by half.",
                "scenario": scenario,
            }))

    result = asyncio.run(interpret_and_simulate(SimpleNamespace(responses=Responses()), analysis, "Make it slower", None))
    assert result["supported"] is True
    assert result["scenario"]["speed_scale"] == 0.5
    assert result["simulation"]["actors"][0]["samples"][-1]["x_m"] == pytest.approx(1.0)

