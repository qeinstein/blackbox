import json
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from server import api, config, store


@pytest.fixture
def local_client(tmp_path, monkeypatch) -> Iterator[TestClient]:
    monkeypatch.setattr(store, "DATABASE_PATH", tmp_path / "blackbox-test.sqlite3")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(config, "MODEL_API_KEY", "")
    store.initialize_store()
    with TestClient(api.app) as client:
        yield client


def test_status_reports_configuration_without_key_value(local_client):
    response = local_client.get("/api/status")
    assert response.status_code == 200
    assert response.json()["ready"] is False
    assert "test-key-not-a-real-secret" not in response.text
    assert response.json()["models"] == {"scene_analysis": config.MUSE_MODEL, "video_segmentation": config.SAM_MODEL}


def test_upload_requires_meta_key_and_accepts_only_supported_video(local_client, monkeypatch):
    missing_key = local_client.post("/api/cases", files={"file": ("clip.mp4", b"video", "video/mp4")})
    assert missing_key.status_code == 503
    assert "MODEL_API_KEY" in missing_key.json()["detail"]
    monkeypatch.setattr(config, "MODEL_API_KEY", "test-key")
    unsupported = local_client.post("/api/cases", files={"file": ("clip.webm", b"video", "video/webm")})
    assert unsupported.status_code == 415


def test_local_health_and_connection_test_without_key(local_client):
    assert local_client.get("/api/health").json() == {"status": "ok"}
    response = local_client.post("/api/status/test")
    assert response.status_code == 503


def test_meta_connection_test_with_stubbed_sdk(local_client, monkeypatch):
    monkeypatch.setattr(config, "MODEL_API_KEY", "blackbox-test-key")

    class StubResponses:
        async def create(self, **kwargs):
            assert kwargs["model"] == config.MUSE_MODEL
            assert kwargs["input"] == "Reply with the single word READY."
            assert kwargs["store"] is False
            return SimpleNamespace(output_text="READY")

    class StubClient:
        def __init__(self, *, api_key, base_url, timeout):
            assert api_key == "blackbox-test-key"
            assert base_url == config.MODEL_API_BASE_URL
            self.responses = StubResponses()

        async def close(self):
            return None

    monkeypatch.setattr(api, "AsyncOpenAI", StubClient)
    response = local_client.post("/api/status/test")
    assert response.status_code == 200
    assert response.json() == {"connected": True, "model": config.MUSE_MODEL, "reply": "READY"}


def test_service_restart_marks_interrupted_jobs_retryable(local_client):
    store.create_case(
        {"id": "BB-RESTART", "title": "Restart test", "site": "Test", "created_at": store.now_iso(), "filename": "test.mp4", "media_path": str(config.UPLOAD_DIR / "test.mp4"), "media_type": "video/mp4", "duration_s": 2, "width": 100, "height": 50, "fps": 10},
        {"id": "job-restart", "case_id": "BB-RESTART", "status": "running", "stage": "segmentation", "progress": 42, "message": "Working", "updated_at": store.now_iso()},
    )
    store.initialize_store()
    case = store.get_case("BB-RESTART")
    assert case is not None
    assert case["analysis_status"] == "failed"
    assert "interrupted" in case["analysis_message"]


def test_mocked_upload_analysis_retrieval_calibration_and_deletion(local_client, monkeypatch):
    monkeypatch.setattr(config, "MODEL_API_KEY", "test-key-not-a-real-secret")
    monkeypatch.setattr(api, "inspect_video", lambda _path: {"fps": 10.0, "frame_count": 40, "width": 101, "height": 51, "duration_s": 4.0})

    async def fake_analysis(_path, metadata, progress):
        await progress(70, "kinematics", "Mock track calculations complete")
        return {
            "engine": {"muse_model": "muse-spark-1.3", "segmentation_model": "sam-3.1"},
            "metadata": metadata,
            "hypothesis": {"scene_type": "road", "stationary_camera": True, "summary": "Mock test scene", "impact_time_s": None, "calibration": {"available": False, "source": "", "evidence": "", "confidence": 0.0, "review_required": True}, "obstacles": [], "limitations": []},
            "tracking": {"actors": [{"id": "vehicle:1", "concept": "vehicle", "class_name": "car", "role": "moving", "mass_kg_assumed": 1500, "observations": [
                {"frame": frame, "time_s": frame / 10, "pixel_x": frame * 10, "pixel_y": 25, "x_m": None, "y_m": None}
                for frame in range(4)
            ], "kinematics": {"first_observed_speed_mph": None, "speed_near_impact_mph": None, "braking_onset_candidate_s": None, "trajectory_fit_residual_m": None}}], "mean_fit_residual_m": None, "fit_model": "test", "fit_note": "pixel tracks"},
            "provenance": {"classification": "test estimate", "metric_scale_available": False, "deterministic_claim": "test", "not_a_finding": "not a verdict"},
        }

    monkeypatch.setattr(api, "analyze_video", fake_analysis)
    uploaded = local_client.post(
        "/api/cases",
        data={"title": "Intersection test", "site": "North approach"},
        files={"file": ("intersection.mp4", b"fake video content", "video/mp4")},
    )
    assert uploaded.status_code == 202
    case_id = uploaded.json()["id"]
    detail = local_client.get(f"/api/cases/{case_id}")
    assert detail.status_code == 200
    assert detail.json()["analysis_status"] == "completed"
    assert detail.json()["analysis"]["tracking"]["actors"][0]["class_name"] == "car"
    assert local_client.get(detail.json()["videoUrl"]).content == b"fake video content"

    calibrated = local_client.post(
        f"/api/cases/{case_id}/calibration",
        json={"corners": [[0, 0], [100, 0], [100, 50], [0, 50]], "width_m": 10, "length_m": 5},
    )
    assert calibrated.status_code == 200
    assert calibrated.json()["analysis"]["provenance"]["metric_scale_available"] is True
    assert calibrated.json()["analysis"]["tracking"]["actors"][0]["kinematics"]["first_observed_speed_mph"] == pytest.approx(22.36936)

    class SimulationResponses:
        async def create(self, **kwargs):
            assert kwargs["model"] == config.MUSE_MODEL
            assert kwargs["store"] is False
            return SimpleNamespace(output_text=json.dumps({
                "supported": True,
                "explanation": "Initial speed reduced by half.",
                "scenario": {
                    "actor_id": "vehicle:1", "speed_scale": 0.5, "start_time_shift_s": 0,
                    "heading_change_deg": 0, "brake_at_s": None, "gravity_mps2": 9.81,
                    "friction_coefficient": 0.7, "obstacles_removed": False, "obstacle_id": None,
                },
            }))

    class SimulationClient:
        def __init__(self, **_kwargs):
            self.responses = SimulationResponses()

        async def close(self):
            return None

    monkeypatch.setattr(api, "AsyncOpenAI", SimulationClient)
    simulated = local_client.post(
        f"/api/cases/{case_id}/simulate",
        json={"prompt": "Make this car slower", "current_state": {
            "actor_id": "vehicle:1", "speed_scale": 1, "start_time_shift_s": 0,
            "heading_change_deg": 0, "brake_at_s": None, "gravity_mps2": 9.81,
            "friction_coefficient": 0.7, "obstacles_removed": False, "obstacle_id": None,
        }},
    )
    assert simulated.status_code == 200, simulated.text
    assert simulated.json()["scenario"]["speed_scale"] == 0.5
    assert simulated.json()["simulation"]["actors"][0]["samples"][-1]["x_m"] == pytest.approx(20.0)

    removed = local_client.delete(f"/api/cases/{case_id}")
    assert removed.status_code == 204
    assert local_client.get(f"/api/cases/{case_id}").status_code == 404
