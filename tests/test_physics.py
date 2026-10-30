from types import SimpleNamespace

import pytest
from meta_sam_parser import FrameReference, SegmentationBoxRecord, SegmentationMaskBounds, SegmentationMaskRecord, SegmentationMaskIdentity, SegmentationMask

from server.physics import (
    build_actor_tracks,
    mask_ground_contact,
    project_point,
    reproject_track_analysis,
    smooth_observations,
    solve_homography,
    stopping_distance_m,
)


def test_homography_maps_rectangle_to_measured_plane():
    transform = solve_homography([[0, 0], [100, 0], [100, 50], [0, 50]], 10, 5)
    assert project_point(transform, 50, 25) == pytest.approx((5, 2.5))


def test_homography_rejects_degenerate_geometry():
    with pytest.raises(ValueError, match="degenerate|unstable"):
        solve_homography([[0, 0], [10, 0], [20, 0], [30, 0]], 4, 8)


def test_ground_contact_uses_lowest_mask_row(monkeypatch):
    record = SegmentationMaskRecord(
        order=0,
        object_id="a",
        identity=SegmentationMaskIdentity(media="video", frame_index=0, object_id="a"),
        revision=0,
        mask=SegmentationMask(encoding="lossless", payload="~test", width=4, height=3),
        bounds=SegmentationMaskBounds(left=20, top=30, right=24, bottom=33),
        frame=FrameReference(frame_index=0),
    )
    monkeypatch.setattr("server.physics.decode_mask_to_raster", lambda _mask: bytes([0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0]))
    assert mask_ground_contact(record) == pytest.approx((21, 32))


def test_local_quadratic_smoothing_preserves_linear_motion_and_gaps():
    points = [{"frame": frame, "time_s": frame / 10, "pixel_x": frame * 2.0, "pixel_y": frame * -1.0, "x_m": frame * 0.2, "y_m": frame * -0.1} for frame in range(6)]
    smoothed = smooth_observations(points)
    assert [point["pixel_x"] for point in smoothed] == pytest.approx([point["pixel_x"] for point in points])
    gapped = [points[0], points[-1]]
    assert smooth_observations(gapped) == gapped


def test_tracks_compute_metric_speed_from_box_ground_contact():
    records = [
        SegmentationBoxRecord(order=index, object_id="car-1", left=frame * 10, top=0, right=frame * 10 + 4, bottom=10, frame=FrameReference(frame_index=frame), confidence=0.9)
        for index, frame in enumerate(range(4))
    ]
    transform = solve_homography([[0, 0], [100, 0], [100, 20], [0, 20]], 10, 2)
    tracks = build_actor_tracks(
        [("vehicle", SimpleNamespace(records=records))], 10, transform,
        [{"class_name": "car", "role": "moving vehicle", "mass_kg": 1400}], None,
    )
    actor = tracks["actors"][0]
    assert actor["class_name"] == "car"
    assert actor["kinematics"]["first_observed_speed_mps"] == pytest.approx(10.0)
    assert actor["observations"][0]["y_m"] == pytest.approx(1.0)


def test_analyst_calibration_reprojects_tracks_and_updates_provenance():
    result = {
        "hypothesis": {"impact_time_s": None, "calibration": {"available": False}},
        "tracking": {"actors": [{"role": "moving", "mass_kg_assumed": 1500, "observations": [
            {"frame": frame, "time_s": frame / 10, "pixel_x": frame * 10, "pixel_y": 25, "x_m": None, "y_m": None}
            for frame in range(4)
        ]}], "mean_fit_residual_m": None, "fit_note": "Metric speeds are unavailable. Pixel tracks are observations only. Existing fit note."},
        "provenance": {"metric_scale_available": False, "classification": "estimate", "deterministic_claim": "old", "not_a_finding": "not a verdict"},
    }
    calibrated = reproject_track_analysis(result, [[0, 0], [100, 0], [100, 50], [0, 50]], 10, 5)
    assert calibrated["tracking"]["actors"][0]["kinematics"]["first_observed_speed_mps"] == pytest.approx(10)
    assert calibrated["provenance"]["metric_scale_available"] is True
    assert calibrated["hypothesis"]["calibration"]["review_required"] is True


def test_stopping_distance_calculation_and_bounds():
    values = stopping_distance_m(0, 1.5, 0.72)
    assert values == {"reaction_distance_m": 0, "braking_distance_m": 0, "total_distance_m": 0}
    with pytest.raises(ValueError):
        stopping_distance_m(30, 1.5, 0)
