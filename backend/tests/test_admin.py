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

    def logout(self) -> None:
        pass


def _reset_admin_limits():
    with admin_routes._admin_attempts_lock:
        admin_routes._admin_attempts.clear()
    with main._attempts_lock:
        main._attempts.clear()


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


def test_admin_auth_guards_and_password_flow(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "OwnerSecret!2026")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"boss@example.com"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset())

    c = TestClient(main.app)

    # Unauthenticated cannot access admin endpoints
    assert c.get("/api/admin/overview").status_code == 403
    assert c.get("/api/admin/users").status_code == 403
    assert c.post("/api/admin/auth/login", json={"password": "OwnerSecret!2026"}).status_code == 403  # missing CSRF

    # Status shows configured but not signed in
    st = c.get("/api/admin/auth/status").json()
    assert st["isAdmin"] is False
    assert st["configured"] is True
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

    # Logout drops admin cookie
    out = c.post("/api/admin/auth/logout", headers=HEADERS)
    assert out.status_code == 200
    assert c.get("/api/admin/overview").status_code == 403


def test_admin_password_rate_limit(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "RightPass123")
    c = TestClient(main.app)
    for _ in range(6):
        r = c.post("/api/admin/auth/login", json={"password": "nope"}, headers=HEADERS)
        assert r.status_code == 401
    r7 = c.post("/api/admin/auth/login", json={"password": "RightPass123"}, headers=HEADERS)
    assert r7.status_code == 429
    _reset_admin_limits()


def test_admin_via_locket_identity_and_non_admin_denied(isolated_data, monkeypatch):
    _reset_admin_limits()
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"owner@locket.vn"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset())
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "")

    boss_prov = _MockUserProvider("uid_boss", "owner@locket.vn", "Huy", "trunghuy")
    guest_prov = _MockUserProvider("uid_guest", "guest@locket.vn", "Khach", "khach")
    monkeypatch.setattr(main.store, "get", lambda sid: boss_prov if sid == "b" * 40 else (guest_prov if sid == "g" * 40 else None))

    c_boss = TestClient(main.app, cookies={config.COOKIE_NAME: "b" * 40})
    s_boss = c_boss.get("/api/session").json()
    assert s_boss["authenticated"] is True
    assert s_boss["isAdmin"] is True
    assert c_boss.get("/api/admin/overview").status_code == 200

    c_guest = TestClient(main.app, cookies={config.COOKIE_NAME: "g" * 40})
    s_guest = c_guest.get("/api/session").json()
    assert s_guest["authenticated"] is True
    assert s_guest["isAdmin"] is False
    assert c_guest.get("/api/admin/overview").status_code == 403


def test_telemetry_overview_and_csv_exports(isolated_data, monkeypatch):
    _reset_admin_limits()
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
    assert c.post("/api/admin/auth/login", json={"password": "pw123"}, headers=HEADERS).status_code == 200

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
    assert c.post("/api/admin/auth/login", json={"password": "adminpass"}, headers=HEADERS).status_code == 200

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
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "pw")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"boss@example.com"}))
    monkeypatch.setattr(config, "ADMIN_UIDS", frozenset())

    c = TestClient(main.app)
    assert c.post("/api/admin/auth/login", json={"password": "pw"}, headers=HEADERS).status_code == 200

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
    assert c.post("/api/admin/auth/login", json={"password": "pw"}, headers=HEADERS).status_code == 200

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
