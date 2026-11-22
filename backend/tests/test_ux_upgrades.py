"""Tests for smart captions, overlay builder, recap stats, ZIP export, music/weather tools and sync status."""
from __future__ import annotations

import io
import time
import zipfile
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from backend.app import captions, main, state_sync
from backend.app.providers.base import Provider
from backend.app.providers.live import LiveProvider
from backend.app.providers.live_common import parse_overlay


def _make_provider(tmp_path, uid: str = "ux_uid1") -> LiveProvider:
    p = LiveProvider(tmp_path / f"sess_{uid}")
    p.client.session.uid = uid
    p.client.session.id_token = "tok_valid"
    p.client.session.expires_at = 9999999999999
    return p


def test_sanitize_overlay_meta_and_overlay_builder_roundtrip(isolated_data, tmp_path):
    # SSRF URLs in music metadata must be stripped; allowed Apple/iTunes hosts kept
    meta = captions.sanitize_overlay_meta({
        "colors": ["#FF5F6D", "not-a-color", "#FFC371"],
        "textColor": "#FFFFFF",
        "rating": 4.4,
        "music": {
            "title": "Blue",
            "artist": "Yung Kai",
            "artwork": "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg",
            "previewUrl": "https://evil.example/steal.mp3",
            "appleMusicUrl": "https://music.apple.com/vn/album/blue/123",
        },
        "weather": {"symbol": "cloud.rain.fill"},
    })
    assert meta["colors"] == ["#FF5F6D", "#FFC371"]
    assert meta["rating"] == 4.5
    assert meta["music"]["artwork"].startswith("https://is1-ssl.mzstatic.com/")
    assert "previewUrl" not in meta["music"]
    assert meta["music"]["link"].startswith("https://music.apple.com/")
    assert meta["weather"]["symbol"] == "cloud.rain.fill"

    p = _make_provider(tmp_path)
    try:
        # Music overlay round-trip through patched builder & parse_overlay
        p._overlay_ctx.meta = {
            "music": {
                "title": "Blue",
                "artist": "Yung Kai",
                "artwork": "https://is1-ssl.mzstatic.com/image/thumb/cover.jpg",
                "previewUrl": "https://audio-ssl.itunes.apple.com/preview.m4a",
                "link": "https://music.apple.com/vn/album/blue/123",
            },
            "colors": ["#1C1C1E", "#2C2C2E"],
            "textColor": "#FFFFFF",
        }
        ov_music = p.client.moments.build_overlay(text="", note_type="music")
        parsed = parse_overlay({"overlays": [ov_music]})
        assert parsed["type"] == "music"
        assert parsed["text"] == "Blue – Yung Kai"
        assert parsed["icon"]["kind"] == "image"
        assert parsed["music"]["preview"] == "https://audio-ssl.itunes.apple.com/preview.m4a"

        # Review overlay round-trip
        p._overlay_ctx.meta = {"rating": 5}
        ov_rev = p.client.moments.build_overlay(text="Ngon xỉu", note_type="review")
        parsed_rev = parse_overlay({"overlays": [ov_rev]})
        assert parsed_rev["type"] == "review"
        assert parsed_rev["rating"] == 5
        assert parsed_rev["icon"]["value"] == "star.fill"

        # Weather overlay round-trip
        p._overlay_ctx.meta = {"weather": {"symbol": "cloud.rain.fill"}}
        ov_w = p.client.moments.build_overlay(text="26°C · Có mưa", note_type="weather")
        parsed_w = parse_overlay({"overlays": [ov_w]})
        assert parsed_w["type"] == "weather"
        assert parsed_w["icon"]["value"] == "cloud.rain.fill"
    finally:
        p._overlay_ctx.meta = None
        p.logout()


def test_stats_streaks_monthly_top_friends_and_on_this_day(isolated_data, tmp_path):
    p = _make_provider(tmp_path, uid="me_stats")
    try:
        p._sync = lambda force=False: None
        p._me = {"uid": "me_stats", "firstName": "Huy", "lastName": "", "name": "Huy", "username": "huy", "avatar": None}
        p._me_at = 9999999999.0
        p._users = lambda uids: {
            "me_stats": p._me,
            "f1": {"uid": "f1", "firstName": "An", "lastName": "", "name": "An", "username": "an", "avatar": None},
            "f2": {"uid": "f2", "firstName": "Bình", "lastName": "", "name": "Bình", "username": "binh", "avatar": None},
        }
        now = datetime.now(timezone.utc)
        d0 = int(now.timestamp() * 1000)
        d1 = int((now - timedelta(days=1)).timestamp() * 1000)
        d2 = int((now - timedelta(days=2)).timestamp() * 1000)
        last_year = int(now.replace(year=now.year - 1).timestamp() * 1000)

        p.store.upsert({"id": "m0", "owner": "me_stats", "image": "https://cdn.locketcamera.com/0.webp", "video": None, "createdAt": d0})
        p.store.upsert({"id": "m1", "owner": "me_stats", "image": "https://cdn.locketcamera.com/1.webp", "video": "https://cdn.locketcamera.com/1.mp4", "createdAt": d1})
        p.store.upsert({"id": "m2", "owner": "me_stats", "image": "https://cdn.locketcamera.com/2.webp", "video": None, "createdAt": d2})
        p.store.upsert({"id": "m3", "owner": "f1", "image": "https://cdn.locketcamera.com/3.webp", "video": None, "createdAt": last_year})
        p.store.upsert({"id": "m4", "owner": "f2", "image": "https://cdn.locketcamera.com/4.webp", "video": None, "createdAt": d1})
        p._comments["m0"] = [{"id": "c1", "sender": "f1", "peer": "f1", "cid": "cid1", "text": "nice", "createdAt": d0, "reactions": []}]

        st = p.stats(tz_minutes=0)
        assert st["total"] == 5
        assert st["photos"] == 4 and st["videos"] == 1
        assert st["mineCount"] == 3 and st["friendsCount"] == 2
        assert st["myStreak"] == 3 and st["myLongestStreak"] == 3
        assert len(st["monthly"]) == 12
        assert st["topFriends"][0]["user"]["uid"] == "f1"
        assert st["onThisDayKind"] == "year"
        assert [m["id"] for m in st["onThisDay"]] == ["m3"]
    finally:
        p.logout()


def test_memories_export_zip_tools_and_sync_endpoints(isolated_data, monkeypatch):
    class _ExportProvider(Provider):
        def me(self, refresh: bool = False) -> dict:
            return {"uid": "u1", "firstName": "T", "lastName": "", "name": "T", "username": "t", "avatar": None}

        def export_targets(self, moment_ids: list) -> list:
            return [
                {"id": "momA", "url": "https://cdn.locketcamera.com/a.webp", "is_video": False, "createdAt": 1700000000000},
                {"id": "momBad", "url": "https://evil.example/x.jpg", "is_video": False, "createdAt": 1700000000000},
            ]

    monkeypatch.setattr(main.store, "get", lambda sid: _ExportProvider())

    class _FakeResp:
        def __init__(self, status_code=200, headers=None, body=b"", json_data=None):
            self.status_code = status_code
            self.headers = headers or {}
            self._body = body
            self._json = json_data

        def raise_for_status(self):
            if self.status_code >= 400:
                raise RuntimeError("http error")

        def json(self):
            return self._json

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aiter_bytes(self, chunk_size=65536):
            yield self._body

    class _FakeClient:
        def stream(self, method, url):
            return _FakeResp(200, {"content-type": "image/webp"}, b"RIFF1234WEBPVP8 data")

        async def get(self, url, params=None, timeout=10.0):
            if "itunes.apple.com" in url:
                return _FakeResp(200, json_data={
                    "results": [{
                        "trackId": 42,
                        "trackName": "Blue",
                        "artistName": "Yung Kai",
                        "artworkUrl100": "https://is1-ssl.mzstatic.com/100x100bb.jpg",
                        "previewUrl": "https://audio-ssl.itunes.apple.com/sample.m4a",
                        "trackViewUrl": "https://music.apple.com/song/42",
                    }]
                })
            if "geocoding-api.open-meteo.com" in url:
                return _FakeResp(200, json_data={"results": [{"name": "Hà Nội", "latitude": 21.02, "longitude": 105.83}]})
            if "api.open-meteo.com" in url:
                return _FakeResp(200, json_data={"current": {"temperature_2m": 28.4, "weather_code": 0, "is_day": 1}})
            raise AssertionError(f"Unexpected URL {url}")

    monkeypatch.setattr(main, "_get_media_client", lambda: _FakeClient())
    authed = TestClient(main.app, cookies={"lk_sid": "s" * 40})
    headers = {"X-Locket-Client": "web"}

    # ZIP export skips disallowed hosts and packs allowed images without gzipping the zip
    r_zip = authed.post("/api/memories/export", json={"ids": ["momA", "momBad"]}, headers={**headers, "Accept-Encoding": "gzip"})
    assert r_zip.status_code == 200
    assert r_zip.headers["content-type"] == "application/zip"
    assert "content-encoding" not in r_zip.headers
    with zipfile.ZipFile(io.BytesIO(r_zip.content)) as zf:
        names = zf.namelist()
        assert len(names) == 1 and names[0].endswith("momA.webp")
        assert zf.read(names[0]) == b"RIFF1234WEBPVP8 data"

    # Music search tool
    r_music = authed.get("/api/tools/music", params={"q": "blue"})
    assert r_music.status_code == 200
    tracks = r_music.json()["tracks"]
    assert len(tracks) == 1
    assert tracks[0]["title"] == "Blue"
    assert tracks[0]["artworkProxy"].startswith("/api/media?u=")
    assert tracks[0]["previewProxy"].startswith("/api/media?u=")

    # Weather tool
    r_w = authed.get("/api/tools/weather", params={"q": "Ha Noi"})
    assert r_w.status_code == 200
    w = r_w.json()
    assert w["temp"] == 28 and w["symbol"] == "sun.max.fill" and "Hà Nội" in w["text"]

    # Sync status + CSRF-protected sync now
    r_st = authed.get("/api/sync/status")
    assert r_st.status_code == 200
    st = r_st.json()
    assert "enabled" in st and "cacheBytes" in st
    assert authed.post("/api/sync/now").status_code == 403
    monkeypatch.setattr(state_sync, "flush", lambda: False)
    r_now = authed.post("/api/sync/now", headers=headers)
    assert r_now.status_code == 200 and r_now.json()["synced"] is False
    assert isinstance(time.time(), float)
