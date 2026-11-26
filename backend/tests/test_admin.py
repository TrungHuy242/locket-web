"""Comprehensive tests for Owner Admin Dashboard (Auth, Telemetry, Users/Ban/Kick, Invites, Branding/Flags, Ops/CSV/HF-Sync)."""
from __future__ import annotations

import os
import time
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import admin_routes, config, main
from backend.app.admin_store import admin_store
from backend.app.providers.base import Provider
from backend.app.providers.live import LiveProvider
from backend.app.state_sync import HFStateSync

HEADERS = {"X-Locket-Client": "web"}


class _MockUserProvider(Provider):
    def __init__(self, uid: str, email: str, name: str = "User", username: str = "user"):
        self.uid = uid
        self._me = {
            "uid": uid,
            "email": email,
            "name": name,
            "firstName": name,
            "lastName": "",
            "username": username,
            "avatar": None,
        }

    def me(self, refresh: bool = False) -> dict:
        return dict(self._me)

    def feed(self, before=None, limit: int = 30, refresh: bool = False) -> dict:
        return {"moments": [], "nextCursor": None, "total": 0, "syncing": False, "syncError": None, "warnings": []}

    def conversations(self) -> list:
        return []

    def send_message(self, peer_uid: str, text: str, moment_id=None) -> dict:
        return {"id": "msg1", "text": text}

    def update_birthdate(self, birthdate: str) -> dict:
        self._me["birthdate"] = birthdate
        return dict(self._me)

    def change_password(self, new_password: str) -> dict:
        return {"ok": True}

    def send_password_reset(self, email=None) -> dict:
        return {"ok": True, "email": email or self._me["email"]}

    def logout(self) -> None:
        pass


def _reset_admin_limits():
    with admin_routes._admin_attempts_lock:
        admin_routes._admin_attempts.clear()
    with admin_routes._gate_attempts_lock:
        admin_routes._gate_attempts.clear()
    with main._attempts_lock:
        main._attempts.clear()


def _unlock_secret_portal(client: TestClient, slug: str, password: str) -> None:
    r_gate = client.get(f"/p/{slug}", follow_redirects=False)
    assert r_gate.status_code == 302
    assert r_gate.headers["location"] == "/?_gate=1"
    r_login = client.post("/api/admin/auth/login", json={"password": password}, headers=HEADERS)
    assert r_login.status_code == 200


def _make_disk_session(sid: str, uid: str, email: str, *, expires_at: int = 9999999999999, refresh_token: str = "ref"):
    folder = main.store.folder(sid)
    prov = LiveProvider(folder)
    prov.client.session.uid = uid
    prov.client.session.email = email
    prov.client.session.id_token = "tok-" + uid
    prov.client.session.refresh_token = refresh_token
    prov.client.session.expires_at = expires_at
    prov.client.session.save()
    main.store.register(sid, prov)
    return prov, folder


def test_stealth_admin_hides_existence_and_secret_portal_flow(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PATH", "cua-sau-bi-mat-9284")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "OwnerSecret!2026")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"boss@example.com"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset())

    c = TestClient(main.app)

    # Public /api/site-config never reveals whether admin exists
    site_cfg = c.get("/api/site-config").json()
    assert "adminConfigured" not in site_cfg

    # All unauthenticated probes return 404 Not Found (stealth — never 403/401!)
    assert c.get("/api/admin/overview").status_code == 404
    assert c.get("/api/admin/users").status_code == 404
    assert c.get("/api/admin/auth/status").status_code == 404
    assert c.post("/api/admin/auth/login", json={"password": "OwnerSecret!2026"}, headers=HEADERS).status_code == 404
    assert c.get("/p/admin", follow_redirects=False).status_code == 404
    assert c.get("/p/wrong-secret-path", follow_redirects=False).status_code == 404

    # Missing CSRF header still blocked on mutation
    assert c.post("/api/admin/auth/login", json={"password": "OwnerSecret!2026"}).status_code == 403

    # Opening the exact secret portal path sets lk_gate and redirects to /?_gate=1
    r_gate = c.get("/p/cua-sau-bi-mat-9284", follow_redirects=False)
    assert r_gate.status_code == 302
    assert r_gate.headers["location"] == "/?_gate=1"
    assert config.ADMIN_GATE_COOKIE in r_gate.cookies

    # With lk_gate cookie, status responds 200 (not signed in yet)
    st = c.get("/api/admin/auth/status").json()
    assert st["isAdmin"] is False
    assert st["passwordEnabled"] is True

    # Wrong password -> 401
    bad = c.post("/api/admin/auth/login", json={"password": "wrong"}, headers=HEADERS)
    assert bad.status_code == 401

    # Correct password -> sets HttpOnly lk_admin cookie & grants access
    ok = c.post("/api/admin/auth/login", json={"password": "OwnerSecret!2026"}, headers=HEADERS)
    assert ok.status_code == 200
    assert ok.json()["isAdmin"] is True
    assert config.ADMIN_COOKIE_NAME in ok.cookies

    st2 = c.get("/api/admin/auth/status").json()
    assert st2["isAdmin"] is True
    assert st2["via"] == "password"
    assert c.get("/api/admin/overview").status_code == 200

    # Logout drops admin + gate cookies -> reverts to stealth 404
    out = c.post("/api/admin/auth/logout", headers=HEADERS)
    assert out.status_code == 200
    assert c.get("/api/admin/overview").status_code == 404
    assert c.get("/api/admin/auth/status").status_code == 404


def test_secret_portal_disabled_without_min_length_path(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PATH", "admin")  # too short (< 8 chars) -> disabled
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "StrongPass!99")
    c = TestClient(main.app)
    assert c.get("/p/admin", follow_redirects=False).status_code == 404
    assert c.post("/api/admin/auth/login", json={"password": "StrongPass!99"}, headers=HEADERS).status_code == 404


def test_admin_password_rate_limit(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PATH", "secret-door-7788")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "RightPass123")
    c = TestClient(main.app)
    assert c.get("/p/secret-door-7788", follow_redirects=False).status_code == 302
    for _ in range(6):
        r = c.post("/api/admin/auth/login", json={"password": "nope"}, headers=HEADERS)
        assert r.status_code == 401
    r7 = c.post("/api/admin/auth/login", json={"password": "RightPass123"}, headers=HEADERS)
    assert r7.status_code == 429
    _reset_admin_limits()


def test_admin_via_locket_identity_and_non_admin_stealth_404(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"owner@locket.vn"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset())
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "")
    monkeypatch.setattr(config, "ADMIN_PATH", "")

    boss_prov = _MockUserProvider("uid_boss", "owner@locket.vn", "Huy", "trunghuy")
    guest_prov = _MockUserProvider("uid_guest", "guest@locket.vn", "Khach", "khach")
    monkeypatch.setattr(main.store, "get", lambda sid: boss_prov if sid == "b" * 40 else (guest_prov if sid == "g" * 40 else None))

    c_boss = TestClient(main.app, cookies={config.COOKIE_NAME: "b" * 40})
    s_boss = c_boss.get("/api/session").json()
    assert s_boss["authenticated"] is True
    assert s_boss["isAdmin"] is True
    assert c_boss.get("/api/admin/overview").status_code == 200

    # Regular user never even sees `isAdmin` key in /api/session and gets 404 on /api/admin/*
    c_guest = TestClient(main.app, cookies={config.COOKIE_NAME: "g" * 40})
    s_guest = c_guest.get("/api/session").json()
    assert s_guest["authenticated"] is True
    assert "isAdmin" not in s_guest
    assert c_guest.get("/api/admin/overview").status_code == 404
    assert c_guest.get("/api/admin/auth/status").status_code == 404


def test_telemetry_overview_and_csv_exports(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PATH", "portal-telemetry-1")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "pw123")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset())
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset())

    admin_store.record_login({"uid": "u1", "name": "=EvilName", "username": "alice"}, email="alice@example.com", ip="1.2.3.4")
    admin_store.record_login({"uid": "u2", "name": "Bob", "username": "bob"}, email="bob@example.com", ip="1.2.3.5")
    admin_store.record_event("u1", "photo")
    admin_store.record_event("u1", "photobooth")
    admin_store.record_event("u2", "video")
    admin_store.record_event("u2", "message")
    admin_store.record_event("u1", "weather")
    admin_store.record_event("u1", "music")
    admin_store.record_event("u1", "places")
    admin_store.record_event("u1", "export")
    admin_store.record_request("GET", "/api/tools/weather", 502, 120.5, detail="Weather provider down")
    assert admin_store.flush() is True

    c = TestClient(main.app)
    _unlock_secret_portal(c, "portal-telemetry-1", "pw123")

    ov = c.get("/api/admin/overview").json()
    assert ov["kpi"]["totalUsers"] == 2
    assert ov["kpi"]["onlineNow"] == 2
    assert ov["kpi"]["dau"] == 2
    assert ov["kpi"]["wau"] == 2
    assert ov["kpi"]["mau"] == 2
    assert ov["kpi"]["newToday"] == 2
    assert ov["totals"]["moments"] == 2
    assert ov["totals"]["photos"] == 1
    assert ov["totals"]["videos"] == 1
    assert ov["totals"]["photobooth"] == 1
    assert ov["totals"]["messages"] == 1
    assert ov["totals"]["weather"] == 1
    assert ov["totals"]["music"] == 1
    assert ov["totals"]["places"] == 1
    assert ov["totals"]["exports"] == 1
    assert len(ov["series30"]) == 30
    assert ov["health"]["errors5xx"] >= 1

    # Users search & filter
    u_all = c.get("/api/admin/users").json()
    assert u_all["total"] == 2
    u_bob = c.get("/api/admin/users", params={"q": "bob"}).json()
    assert u_bob["filtered"] == 1 and u_bob["users"][0]["uid"] == "u2"
    u_on = c.get("/api/admin/users", params={"filter": "online"}).json()
    assert u_on["filtered"] == 2

    # Logs include recent 5xx error
    logs = c.get("/api/admin/logs").json()
    assert any(e["path"] == "/api/tools/weather" and e["status"] == 502 for e in logs["errors"])

    # CSV exports include BOM and escape formula injection (=EvilName -> '=EvilName)
    csv_u = c.get("/api/admin/export/users.csv")
    assert csv_u.status_code == 200
    assert "text/csv" in csv_u.headers["content-type"]
    text_u = csv_u.content.decode("utf-8")
    assert text_u.startswith("\ufeff")
    assert "'=EvilName" in text_u

    csv_m = c.get("/api/admin/export/metrics.csv")
    assert csv_m.status_code == 200
    assert csv_m.content.decode("utf-8").startswith("\ufeffNgày,DAU")


def test_ban_unban_kick_and_kick_all(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PATH", "portal-ban-test-1")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "adminpass")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"boss@example.com"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset({"uid_boss"}))

    # Clear live store items
    with main.store._lock:
        main.store._items.clear()

    sid_boss = main.store.new_id()
    sid_u1 = main.store.new_id()
    sid_u2 = main.store.new_id()
    _, f_boss = _make_disk_session(sid_boss, "uid_boss", "boss@example.com")
    _, f_u1 = _make_disk_session(sid_u1, "uid_u1", "u1@example.com")
    _, f_u2 = _make_disk_session(sid_u2, "uid_u2", "u2@example.com")

    admin_store.record_login({"uid": "uid_u1", "name": "User 1", "username": "u1"}, email="u1@example.com")
    admin_store.record_login({"uid": "uid_u2", "name": "User 2", "username": "u2"}, email="u2@example.com")

    c = TestClient(main.app)
    _unlock_secret_portal(c, "portal-ban-test-1", "adminpass")

    # Cannot ban an admin
    assert c.post("/api/admin/users/uid_boss/ban", json={"reason": "test"}, headers=HEADERS).status_code == 400

    # Ban u1 -> immediately destroys u1 session folder
    r_ban = c.post("/api/admin/users/uid_u1/ban", json={"reason": "Spam"}, headers=HEADERS)
    assert r_ban.status_code == 200
    assert r_ban.json()["revokedSessions"] == 1
    assert not f_u1.exists()
    assert f_u2.exists() and f_boss.exists()

    # Banned user (fresh browser, no lk_admin cookie) cannot log back in
    def fake_login(self, email, password):
        return {"uid": "uid_u1", "name": "User 1", "username": "u1", "email": email}

    monkeypatch.setattr(LiveProvider, "login", fake_login)
    anon = TestClient(main.app)
    r_login = anon.post("/api/auth/login", json={"email": "u1@example.com", "password": "pw"}, headers=HEADERS)
    assert r_login.status_code == 403
    assert "Spam" in r_login.json()["error"]

    # Unban restores login
    assert c.post("/api/admin/users/uid_u1/unban", headers=HEADERS).status_code == 200
    r_login_ok = anon.post("/api/auth/login", json={"email": "u1@example.com", "password": "pw"}, headers=HEADERS)
    assert r_login_ok.status_code == 200

    # Kick-all signs out u1 & u2 while preserving boss session
    r_kick_all = c.post("/api/admin/sessions/kick-all", headers=HEADERS)
    assert r_kick_all.status_code == 200
    assert r_kick_all.json()["revokedSessions"] >= 1
    assert f_boss.exists()
    assert not f_u2.exists()


def test_invite_only_whitelist_codes_and_max_users(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PATH", "portal-invite-123")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "pw")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"boss@example.com"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset())

    c = TestClient(main.app)
    _unlock_secret_portal(c, "portal-invite-123", "pw")

    # Enable Invite-Only + whitelist friend@example.com + maxUsers=2
    r_acc = c.put(
        "/api/admin/access",
        json={"inviteOnly": True, "maxUsers": 2, "whitelist": ["friend@example.com"]},
        headers=HEADERS,
    )
    assert r_acc.status_code == 200
    assert c.get("/api/site-config").json()["inviteOnly"] is True

    # Create 1-use invite code
    inv = c.post("/api/admin/invites", json={"label": "VIP", "maxUses": 1, "expiresDays": 7}, headers=HEADERS).json()["invite"]
    code = inv["code"]
    assert code.startswith("LCK-")

    # Stub Firebase login
    def fake_login(self, email, password):
        uid = "uid_" + email.split("@")[0]
        self.client.session.uid = uid
        self.client.session.email = email
        return {"uid": uid, "name": uid, "username": uid, "email": email}

    monkeypatch.setattr(LiveProvider, "login", fake_login)

    # Uninvited stranger without code -> 403
    anon = TestClient(main.app)
    r1 = anon.post("/api/auth/login", json={"email": "stranger@example.com", "password": "pw"}, headers=HEADERS)
    assert r1.status_code == 403

    # Stranger with wrong code -> 403
    r2 = anon.post("/api/auth/login", json={"email": "stranger@example.com", "password": "pw", "inviteCode": "LCK-WRONG"}, headers=HEADERS)
    assert r2.status_code == 403

    # Whitelisted friend without code -> 200 (user #1)
    r3 = anon.post("/api/auth/login", json={"email": "friend@example.com", "password": "pw"}, headers=HEADERS)
    assert r3.status_code == 200

    # Stranger with valid 1-use code -> 200 (user #2, consumes code)
    r4 = anon.post("/api/auth/login", json={"email": "vip@example.com", "password": "pw", "inviteCode": code}, headers=HEADERS)
    assert r4.status_code == 200

    # Second use of exhausted code OR maxUsers cap -> 403
    r5 = anon.post("/api/auth/login", json={"email": "third@example.com", "password": "pw", "inviteCode": code}, headers=HEADERS)
    assert r5.status_code == 403

    # Existing invited user can log in again without re-entering code!
    r6 = anon.post("/api/auth/login", json={"email": "vip@example.com", "password": "pw"}, headers=HEADERS)
    assert r6.status_code == 200

    # Revoke code
    assert c.delete(f"/api/admin/invites/{code}", headers=HEADERS).json()["removed"] is True


def test_branding_maintenance_and_feature_flags(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "pw")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"boss@example.com"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset())

    boss_prov = _MockUserProvider("uid_boss", "boss@example.com", "Boss", "boss")
    guest_prov = _MockUserProvider("uid_guest", "guest@example.com", "Guest", "guest")
    monkeypatch.setattr(main.store, "get", lambda sid: boss_prov if sid == "b" * 40 else (guest_prov if sid == "g" * 40 else None))

    c_admin = TestClient(main.app, cookies={config.COOKIE_NAME: "b" * 40})
    c_guest = TestClient(main.app, cookies={config.COOKIE_NAME: "g" * 40})

    # Update live branding + announcement + disable chat & smartCaptions + sanitize unsafe link & bad color
    upd = c_admin.put(
        "/api/admin/config",
        json={
            "appName": "Huy's Locket",
            "tagline": "Góc nhỏ của Huy",
            "accentColor": "#ff6b9d",
            "announcement": {
                "enabled": True,
                "type": "update",
                "text": "Chào mừng bản mới!",
                "link": "javascript:alert(1)",
            },
            "features": {"chat": False, "smartCaptions": False},
        },
        headers=HEADERS,
    )
    assert upd.status_code == 200
    pub = c_guest.get("/api/site-config").json()
    assert pub["appName"] == "Huy's Locket"
    assert pub["accentColor"] == "#ff6b9d"
    assert pub["announcement"]["enabled"] is True
    assert pub["announcement"]["link"] == ""  # javascript: stripped!
    assert pub["features"]["chat"] is False

    # Guest blocked from disabled chat & tools; Admin can still access
    assert c_guest.get("/api/conversations").status_code == 403
    assert c_guest.get("/api/tools/music/trending").status_code == 403
    assert c_admin.get("/api/conversations").status_code == 200

    # Enable Maintenance Mode -> Guest gets 503 on API, Admin continues working
    c_admin.put("/api/admin/config", json={"maintenance": {"enabled": True, "message": "Đang nâng cấp server"}}, headers=HEADERS)
    r_m = c_guest.get("/api/feed")
    assert r_m.status_code == 503
    assert "nâng cấp" in r_m.json()["error"]
    assert c_admin.get("/api/feed").status_code == 200


def test_ops_clear_cache_prune_sessions_and_hf_sync_includes_admin(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PATH", "portal-ops-test-9")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "pw")

    # Create dummy cache files
    (config.THUMBS_DIR / "a.webp").write_bytes(b"x" * 1024)
    (config.VIDEO_CACHE_DIR / "v.mp4").write_bytes(b"y" * 2048)

    # Create a broken expired session dir older than 60s
    bad_dir = config.SESSIONS_DIR / "dead00001111"
    bad_dir.mkdir(parents=True, exist_ok=True)
    (bad_dir / "session.json").write_text('{"uid":"x","expiresAt":1}', encoding="utf-8")
    old_ts = time.time() - 300
    os.utime(bad_dir, (old_ts, old_ts))

    c = TestClient(main.app)
    _unlock_secret_portal(c, "portal-ops-test-9", "pw")

    # Update site_config so admin/site_config.json exists on disk
    c.put("/api/admin/config", json={"appName": "Huy Studio"}, headers=HEADERS)

    # Clear cache
    cl = c.post("/api/admin/ops/clear-cache", json={"target": "all"}, headers=HEADERS).json()
    assert cl["deletedFiles"] == 2
    assert cl["freedBytes"] == 3072
    assert not (config.THUMBS_DIR / "a.webp").exists()

    # Prune sessions
    pr = c.post("/api/admin/ops/prune-sessions", headers=HEADERS).json()
    assert pr["removed"] == 1
    assert not bad_dir.exists()

    # Verify HFStateSync encrypts & restores admin/ files too!
    remote_store: dict[str, bytes] = {}

    class _FakeRepoInfo:
        private = True

    class _FakeApi:
        def repo_info(self, **kw):
            return _FakeRepoInfo()

        def create_commit(self, repo_id, operations, commit_message, repo_type=None, **kw):
            for op in operations:
                if hasattr(op, "path_or_fileobj"):
                    data = op.path_or_fileobj if isinstance(op.path_or_fileobj, bytes) else Path(op.path_or_fileobj).read_bytes()
                    remote_store[op.path_in_repo] = data
                else:
                    remote_store.pop(op.path_in_repo, None)

    def fake_snapshot_download(repo_id, repo_type, token, local_dir, allow_patterns, **kw):
        assert "admin/**" in allow_patterns
        root = Path(local_dir)
        for rel, payload in remote_store.items():
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        return str(root)

    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "snapshot_download", fake_snapshot_download)

    sync = HFStateSync(repo_id="user/locket-data", token="hf_tok", backup_key="key123")
    assert sync.start(api=_FakeApi()) is True
    assert sync.flush() is True
    assert "admin/site_config.json.enc" in remote_store
    assert b"Huy Studio" not in remote_store["admin/site_config.json.enc"]

    # Wipe local admin/site_config.json and verify restore brings it back!
    cfg_file = config.ADMIN_DIR / "site_config.json"
    cfg_file.unlink()
    assert not cfg_file.exists()

    sync2 = HFStateSync(repo_id="user/locket-data", token="hf_tok", backup_key="key123")
    assert sync2.start(api=_FakeApi()) is True
    assert cfg_file.exists()
    assert "Huy Studio" in cfg_file.read_text(encoding="utf-8")


def test_admin_v2_user_drawer_notes_whitelist_sort_and_diagnostics(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PATH", "portal-v2-check-99")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "v2pass")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"boss@example.com"}))

    admin_store.record_login({"uid": "u_a", "name": "An", "username": "an"}, email="an@example.com")
    admin_store.record_login({"uid": "u_b", "name": "Binh", "username": "binh"}, email="binh@example.com")
    admin_store.record_event("u_b", "photo")
    admin_store.record_event("u_b", "photo")
    admin_store.record_event("u_b", "photobooth")

    c = TestClient(main.app)
    _unlock_secret_portal(c, "portal-v2-check-99", "v2pass")

    # Overview includes v2 fields: yesterday, topUsers, siteState, security, disk file counts
    ov = c.get("/api/admin/overview").json()
    assert "yesterday" in ov
    assert ov["topUsers"][0]["uid"] == "u_b"
    assert ov["siteState"]["maintenanceEnabled"] is False
    assert ov["security"]["stealth404"] is True
    assert ov["security"]["secretPortalEnabled"] is True
    assert "thumbsFiles" in ov["health"]["disk"]

    # Sort by moments puts u_b first
    sorted_u = c.get("/api/admin/users", params={"sort": "moments"}).json()
    assert sorted_u["users"][0]["uid"] == "u_b"

    # Save admin note & verify searchable + returned in user detail
    r_note = c.put("/api/admin/users/u_a/note", json={"note": "Bạn cùng lớp ĐH"}, headers=HEADERS)
    assert r_note.status_code == 200
    assert r_note.json()["note"] == "Bạn cùng lớp ĐH"
    det = c.get("/api/admin/users/u_a").json()
    assert det["note"] == "Bạn cùng lớp ĐH"
    assert c.get("/api/admin/users", params={"q": "cùng lớp"}).json()["filtered"] == 1

    # 1-tap toggle whitelist on user
    r_wl_on = c.post("/api/admin/users/u_a/whitelist", json={"enabled": True}, headers=HEADERS)
    assert r_wl_on.status_code == 200
    assert r_wl_on.json()["whitelisted"] is True
    wl_list = c.get("/api/admin/users", params={"filter": "whitelist"}).json()
    assert wl_list["filtered"] == 1 and wl_list["users"][0]["uid"] == "u_a"

    r_wl_off = c.post("/api/admin/users/u_a/whitelist", json={"enabled": False}, headers=HEADERS)
    assert r_wl_off.json()["whitelisted"] is False

    # Diagnostics probe (stub external tools for fast offline test)
    from backend.app import tools as tools_mod

    async def _fake_weather(q=""):
        return {"city": "Hà Nội", "temp": 26, "condition": "Nắng nhẹ"}

    async def _fake_music(limit=3):
        return [{"id": "1", "title": "Song"}]

    async def _fake_places(q):
        return [{"name": "Hồ Hoàn Kiếm"}]

    monkeypatch.setattr(tools_mod, "lookup_weather", _fake_weather)
    monkeypatch.setattr(tools_mod, "trending_music", _fake_music)
    monkeypatch.setattr(tools_mod, "search_places", _fake_places)

    diag = c.post("/api/admin/ops/diagnostics", headers=HEADERS)
    assert diag.status_code == 200
    checks = {ch["key"]: ch for ch in diag.json()["checks"]}
    assert checks["weather"]["ok"] is True
    assert checks["music"]["ok"] is True
    assert checks["places"]["ok"] is True


def test_locket_gold_vip_feedback_inbox_and_account_mutations(isolated_data, monkeypatch):
    _reset_admin_limits()
    with main._fb_lock:
        main._fb_attempts.clear()
    monkeypatch.setattr(config, "ADMIN_PATH", "portal-gold-vip-88")
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "goldpass")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"owner@example.com"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset({"uid_owner"}))

    # Register a regular user session and an owner session
    sid_user = main.store.new_id()
    main.store.register(sid_user, _MockUserProvider("uid_member", "member@example.com", "Minh", "minh24"))
    sid_owner = main.store.new_id()
    main.store.register(sid_owner, _MockUserProvider("uid_owner", "owner@example.com", "Huy", "trunghuy"))

    user_client = TestClient(main.app)
    user_client.cookies.set(config.COOKIE_NAME, sid_user)

    owner_client = TestClient(main.app)
    owner_client.cookies.set(config.COOKIE_NAME, sid_owner)

    # 1. Regular user defaults to non-Gold; Owner automatically has Gold
    s_user = user_client.get("/api/session").json()
    assert s_user["authenticated"] is True
    assert s_user["user"]["gold"]["active"] is False
    assert "isAdmin" not in s_user

    s_owner = owner_client.get("/api/session").json()
    assert s_owner["user"]["gold"]["active"] is True
    assert s_owner["isAdmin"] is True

    # 2. Regular user probing Admin Gold / Feedback routes gets Stealth 404
    assert user_client.get("/api/admin/feedback").status_code == 404
    assert user_client.post("/api/admin/users/uid_member/gold", json={"enabled": True}, headers=HEADERS).status_code == 404

    # 3. Regular user updates birthdate, changes password, and submits a Locket Gold request + bug report
    r_bd_bad = user_client.patch("/api/me/birthdate", json={"birthdate": "2099-99-99"}, headers=HEADERS)
    assert r_bd_bad.status_code == 422

    r_bd_ok = user_client.patch("/api/me/birthdate", json={"birthdate": "2004-08-15"}, headers=HEADERS)
    assert r_bd_ok.status_code == 200
    assert r_bd_ok.json()["birthdate"] == "2004-08-15"

    assert user_client.post("/api/me/password", json={"newPassword": "newsecurepassword"}, headers=HEADERS).status_code == 200
    assert user_client.post("/api/me/password-reset", headers=HEADERS).status_code == 200

    r_fb1 = user_client.post(
        "/api/feedback",
        json={
            "category": "gold_request",
            "title": "Xin mở khóa Locket Gold",
            "message": "Admin cấp Gold cho mình dùng chủ đề máy ảnh nhé!",
            "meta": {"platform": "iPhone", "appIcon": "classic"},
        },
        headers=HEADERS,
    )
    assert r_fb1.status_code == 200
    fb1_id = r_fb1.json()["id"]

    r_fb2 = user_client.post(
        "/api/feedback",
        json={"category": "bug", "title": "Lỗi nhỏ", "message": "Kiểm tra hộp thư báo lỗi"},
        headers=HEADERS,
    )
    assert r_fb2.status_code == 200
    fb2_id = r_fb2.json()["id"]

    # 4. Owner sees openFeedback=2 in Overview and manages Feedback + grants Locket Gold VIP
    ov = owner_client.get("/api/admin/overview").json()
    assert ov["kpi"]["openFeedback"] == 2
    assert ov["kpi"]["goldUsers"] == 0

    fb_gold = owner_client.get("/api/admin/feedback", params={"category": "gold_request"}).json()
    assert fb_gold["counts"]["gold_request"] == 1
    assert fb_gold["items"][0]["id"] == fb1_id
    assert fb_gold["items"][0]["isGold"] is False

    # Grant Gold VIP to uid_member
    r_grant = owner_client.post(
        "/api/admin/users/uid_member/gold",
        json={"enabled": True, "note": "Bạn thân VIP"},
        headers=HEADERS,
    )
    assert r_grant.status_code == 200
    assert r_grant.json()["isGold"] is True

    # Regular user immediately receives Gold VIP on /api/me and /api/session!
    me_after = user_client.get("/api/me").json()
    assert me_after["gold"]["active"] is True
    assert me_after["gold"]["tier"] == "vip"

    # Filter users by gold
    gold_users = owner_client.get("/api/admin/users", params={"filter": "gold"}).json()
    assert any(u["uid"] == "uid_member" and u["isGold"] is True for u in gold_users["users"])

    # Resolve Gold request & delete bug report
    r_patch = owner_client.patch(
        f"/api/admin/feedback/{fb1_id}",
        json={"status": "resolved", "adminNote": "Đã duyệt VIP"},
        headers=HEADERS,
    )
    assert r_patch.status_code == 200
    assert r_patch.json()["item"]["status"] == "resolved"
    assert r_patch.json()["item"]["isGold"] is True

    assert owner_client.delete(f"/api/admin/feedback/{fb2_id}", headers=HEADERS).status_code == 200
    ov2 = owner_client.get("/api/admin/overview").json()
    assert ov2["kpi"]["openFeedback"] == 0
    assert ov2["kpi"]["goldUsers"] == 1

    # Revoke Gold VIP -> user reverts to free
    owner_client.post("/api/admin/users/uid_member/gold", json={"enabled": False}, headers=HEADERS)
    assert user_client.get("/api/session").json()["user"]["gold"]["active"] is False


