"""API security, CSRF, rate-limit, media proxy SSRF and session eviction tests."""
from __future__ import annotations

import io
import time

from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.providers.base import Provider
from backend.app.providers.live import LiveProvider
from backend.app.sessions import SessionStore

client = TestClient(main.app)


class _DummyProvider(Provider):
    def me(self, refresh: bool = False) -> dict:
        return {"uid": "u1", "firstName": "Test", "lastName": "", "name": "Test", "username": "test", "avatar": None}


def test_health_and_security_headers():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"ok": True}
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Referrer-Policy"] == "no-referrer"
    assert res.headers["Cache-Control"] == "no-store"
    assert "default-src 'self'" in res.headers["Content-Security-Policy"]


def test_csrf_header_enforced_on_mutations():
    res = client.post("/api/auth/logout")
    assert res.status_code == 403

    ok = client.post("/api/auth/logout", headers={"X-Locket-Client": "web"})
    assert ok.status_code == 200
    assert ok.headers.get("Clear-Site-Data") == '"cache"'


def test_unauthenticated_endpoints_return_401():
    assert client.get("/api/session").json() == {"authenticated": False}
    assert client.get("/api/feed").status_code == 401
    assert client.get("/api/media?u=https://cdn.locketcamera.com/x.webp").status_code == 401


def test_login_rate_limiter_returns_429(monkeypatch):
    with main._attempts_lock:
        main._attempts.clear()

    def fake_login(self, email, password):
        from backend.app.providers.base import ProviderError
        raise ProviderError("Sai mật khẩu", 401)

    monkeypatch.setattr(LiveProvider, "login", fake_login)
    headers = {"X-Locket-Client": "web"}
    for _ in range(8):
        r = client.post("/api/auth/login", json={"email": "a@b.com", "password": "bad"}, headers=headers)
        assert r.status_code == 401
    r9 = client.post("/api/auth/login", json={"email": "a@b.com", "password": "bad"}, headers=headers)
    assert r9.status_code == 429
    with main._attempts_lock:
        main._attempts.clear()


def test_media_proxy_blocks_ssrf_and_svg(monkeypatch):
    monkeypatch.setattr(main.store, "get", lambda sid: _DummyProvider())
    authed = TestClient(main.app, cookies={"lk_sid": "s" * 40})

    # HTTP (not HTTPS), disallowed host, non-443 port -> 400
    for bad_url in (
        "http://cdn.locketcamera.com/a.jpg",
        "https://169.254.169.254/latest/meta-data/",
        "https://evil.example/x.jpg",
        "https://cdn.locketcamera.com:8443/a.jpg",
    ):
        r = authed.get("/api/media", params={"u": bad_url})
        assert r.status_code == 400, bad_url

    # SVG content type from an allowed host must be rejected (XSS prevention)
    class _SvgResp:
        status_code = 200
        headers = {"Content-Type": "image/svg+xml"}
        closed = False

        def close(self):
            self.closed = True

    svg_resp = _SvgResp()
    monkeypatch.setattr(main.requests, "get", lambda *a, **kw: svg_resp)
    r = authed.get("/api/media", params={"u": "https://cdn.locketcamera.com/icon.svg"})
    assert r.status_code == 415
    assert svg_resp.closed is True


def test_save_upload_temp_streams_and_enforces_limit():
    ok = UploadFile(filename="clip.mp4", file=io.BytesIO(b"1234567890"))
    path = main._save_upload_temp(ok, limit=10, prefix="locket-pytest-")
    try:
        assert path.exists() and path.read_bytes() == b"1234567890"
    finally:
        path.unlink(missing_ok=True)

    too_big = UploadFile(filename="big.mp4", file=io.BytesIO(b"x" * 25))
    try:
        main._save_upload_temp(too_big, limit=10, prefix="locket-pytest-")
        raise AssertionError("Expected HTTPException 413")
    except HTTPException as exc:
        assert exc.status_code == 413


def test_session_store_evicts_idle_and_restores_from_disk(isolated_data):
    st = SessionStore()
    sid = st.new_id()
    folder = st.folder(sid)
    prov = LiveProvider(folder)
    prov.client.session.uid = "user99"
    prov.client.session.id_token = "tok99"
    prov.client.session.expires_at = 9999999999999
    prov.client.session.save()
    st.register(sid, prov)

    # Simulate idle expiry
    st._items[sid][1] = time.monotonic() - 999999
    st._last_evict = 0.0
    assert st.get("z" * 40) is None
    assert sid not in st._items
    assert prov._pool._shutdown and prov._notif_pool._shutdown
    assert (folder / "session.json").exists()

    # Returning request transparently restores from session.json
    restored = st.get(sid)
    assert restored is not None and restored is not prov and restored.uid == "user99"
    st.destroy(sid)
    assert not folder.exists()
