from types import SimpleNamespace

import pytest

from server.meta_pipeline import inspect_video


class FakeCapture:
    def __init__(self, *, width=640, height=360, fps=10, reported_frames=100, decoded_frames=None, opened=True):
        self.width, self.height, self.fps = width, height, fps
        self.reported_frames = reported_frames
        self.decoded_frames = reported_frames if decoded_frames is None else decoded_frames
        self.index = 0
        self.opened = opened
        self.released = False

    def isOpened(self):
        return self.opened

    def get(self, prop):
        import cv2
        return {
            cv2.CAP_PROP_FPS: self.fps,
            cv2.CAP_PROP_FRAME_COUNT: self.reported_frames,
            cv2.CAP_PROP_FRAME_WIDTH: self.width,
            cv2.CAP_PROP_FRAME_HEIGHT: self.height,
        }[prop]

    def read(self):
        if self.index >= self.decoded_frames:
            return False, None
        self.index += 1
        return True, SimpleNamespace(shape=(self.height, self.width, 3))

    def release(self):
        self.released = True


def test_video_metadata_accepts_limit_and_decodes_all_frames(tmp_path, monkeypatch):
    capture = FakeCapture(reported_frames=150, fps=10)
    monkeypatch.setattr("server.meta_pipeline.cv2.VideoCapture", lambda _path: capture)
    metadata = inspect_video(tmp_path / "valid.mp4")
    assert metadata["duration_s"] == pytest.approx(15)
    assert metadata["frame_count"] == 150
    assert capture.released


@pytest.mark.parametrize("capture", [
    FakeCapture(reported_frames=151, fps=10),
    FakeCapture(reported_frames=100, fps=61),
    FakeCapture(width=1921, reported_frames=100),
    FakeCapture(width=1920, height=1200, reported_frames=100),
    FakeCapture(reported_frames=100, decoded_frames=90),
    FakeCapture(opened=False),
])
def test_video_metadata_rejects_unsupported_and_malformed_clips(tmp_path, monkeypatch, capture):
    monkeypatch.setattr("server.meta_pipeline.cv2.VideoCapture", lambda _path: capture)
    with pytest.raises(ValueError):
        inspect_video(tmp_path / "invalid.mp4")
    assert capture.released

