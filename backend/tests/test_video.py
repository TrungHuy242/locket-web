"""Tests for video normalization (bytes & Path) and H.264 cache lock cleanup."""
from __future__ import annotations

import pytest

from backend.app import video
from backend.app.providers.base import ProviderError


def test_normalize_passthrough_without_ffmpeg_for_bytes_and_path(monkeypatch, tmp_path):
    monkeypatch.setattr(video, "ffmpeg_path", lambda: None)
    fake_mp4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 100

    assert video.normalize_for_locket(fake_mp4) == fake_mp4

    mp4_path = tmp_path / "clip.mp4"
    mp4_path.write_bytes(fake_mp4)
    assert video.normalize_for_locket(mp4_path) == fake_mp4

    # Mirror requested without ffmpeg -> 501
    with pytest.raises(ProviderError) as exc:
        video.normalize_for_locket(mp4_path, mirror=True)
    assert exc.value.status == 501


def test_normalize_rejects_invalid_video_path_and_bytes(tmp_path):
    bad_path = tmp_path / "bad.bin"
    bad_path.write_bytes(b"definitely-not-a-video")

    with pytest.raises(ProviderError) as exc:
        video.normalize_for_locket(bad_path)
    assert exc.value.status == 422

    with pytest.raises(ProviderError) as exc2:
        video.normalize_for_locket(b"definitely-not-a-video")
    assert exc2.value.status == 422


def test_h264_copy_cleans_up_per_key_lock_on_error(isolated_data, monkeypatch):
    monkeypatch.setattr(video, "ffmpeg_path", lambda: "ffmpeg")

    class _BadResponse:
        status_code = 404
        headers = {}

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    monkeypatch.setattr(video.requests, "get", lambda *a, **kw: _BadResponse())

    with pytest.raises(ProviderError) as exc:
        video.h264_copy("https://firebasestorage.googleapis.com/v0/b/locket-video/o/test.mp4")
    assert exc.value.status == 404
    assert video._locks == {}
