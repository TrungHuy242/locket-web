"""Owner Admin API routes & public site configuration endpoint."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import config, state_sync, tools
from .admin_store import admin_store
from .sessions import provider_identity, store

router = APIRouter()

_FALLBACK_SECRET = secrets.token_bytes(32)
_admin_attempts: dict[str, deque[float]] = defaultdict(deque)
_admin_attempts_lock = threading.Lock()
_gate_attempts: dict[str, deque[float]] = defaultdict(deque)
_gate_attempts_lock = threading.Lock()


def _signing_key(purpose: str = "cookie") -> bytes:
    seed = f"{config.ADMIN_PATH}:{config.ADMIN_PASSWORD}:{config.BACKUP_KEY}".strip(":")
    if seed:
        return hashlib.sha256(f"locket-admin-{purpose}-v1:{seed}".encode("utf-8")).digest()
    return hashlib.sha256(purpose.encode("utf-8") + _FALLBACK_SECRET).digest()


def _sign_token(ttl_sec: int, *, purpose: str) -> str:
    exp = int(time.time()) + max(60, int(ttl_sec))
    nonce = secrets.token_urlsafe(12)
    payload = f"{exp}.{nonce}"
    sig = hmac.new(_signing_key(purpose), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def _verify_token(token: Optional[str], *, purpose: str) -> bool:
    if not token:
        return False
    parts = token.split(".")
    if len(parts) != 3:
        return False
    exp_s, nonce, sig = parts
    try:
        exp = int(exp_s)
    except ValueError:
        return False
    if exp < int(time.time()):
        return False
    payload = f"{exp_s}.{nonce}"
    expected = hmac.new(_signing_key(purpose), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected)


def _sign_admin_token(ttl_sec: int = config.ADMIN_COOKIE_MAX_AGE) -> str:
    return _sign_token(ttl_sec, purpose="cookie")


def _verify_admin_token(token: Optional[str]) -> bool:
    if not config.has_secret_admin_portal():
        return False
    return _verify_token(token, purpose="cookie")


def _sign_gate_token(ttl_sec: int = config.ADMIN_GATE_MAX_AGE) -> str:
    return _sign_token(ttl_sec, purpose="gate")


def _verify_gate_token(token: Optional[str]) -> bool:
    if not config.has_secret_admin_portal():
        return False
    return _verify_token(token, purpose="gate")


def _throttle_gate(request: Request, limit: int = 10, window: int = 600) -> bool:
    """Return False when caller exceeded secret-path probes (silent 404 to prevent discovery)."""
    key = request.client.host if request.client else "?"
    now = time.time()
    with _gate_attempts_lock:
        if len(_gate_attempts) > 1000:
            stale = [k for k, q in _gate_attempts.items() if not q or now - q[-1] > window]
            for k in stale:
                _gate_attempts.pop(k, None)
        bucket = _gate_attempts[key]
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
    return True


def _throttle_admin_login(request: Request, limit: int = 6, window: int = 300) -> None:
    key = request.client.host if request.client else "?"
    now = time.time()
    with _admin_attempts_lock:
        if len(_admin_attempts) > 1000:
            stale = [k for k, q in _admin_attempts.items() if not q or now - q[-1] > window]
            for k in stale:
                _admin_attempts.pop(k, None)
        bucket = _admin_attempts[key]
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="Thử mật khẩu quá nhiều lần. Vui lòng đợi vài phút.")
        bucket.append(now)


def is_request_admin(request: Request) -> tuple[bool, str]:
    """Return `(is_admin, actor_label)` by checking standalone `lk_admin` cookie or Locket admin session."""
    if _verify_admin_token(request.cookies.get(config.ADMIN_COOKIE_NAME)):
        return True, "password"
    sid = request.cookies.get(config.COOKIE_NAME)
    if sid:
        prov = store.get(sid)
        if prov is not None:
            uid, email = provider_identity(prov)
            if not uid and hasattr(prov, "me"):
                try:
                    info = prov.me() or {}
                    uid = str(info.get("uid") or "")
                    email = email or str(info.get("email") or "")
                except Exception:
                    pass
            if config.is_admin_identity(uid, email):
                return True, f"locket:{email or uid}"
    return False, ""


def require_admin(request: Request) -> str:
    """Stealth guard: unauthorized callers receive 404 Not Found so /api/admin/* is undiscoverable."""
    ok, actor = is_request_admin(request)
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy.")
    return actor


# ------------------------------------------------------------------ public site config
@router.get("/api/site-config")
def get_public_site_config():
    """Public live branding, announcement banner, maintenance state and feature flags."""
    return admin_store.get_public_site_config()


# ------------------------------------------------------------------ stealth secret portal door
@router.get("/p/{secret_path}")
def secret_admin_portal(secret_path: str, request: Request):
    """Hidden emergency portal door. Only active when BOTH LOCKET_ADMIN_PATH (>=8 chars) and
    LOCKET_ADMIN_PASSWORD are set. Any wrong slug or disabled state returns an indistinguishable 404."""
    if not _throttle_gate(request):
        raise HTTPException(status_code=404, detail="Không tìm thấy.")
    if not config.has_secret_admin_portal():
        raise HTTPException(status_code=404, detail="Không tìm thấy.")
    if not hmac.compare_digest(secret_path.strip(), config.ADMIN_PATH):
        raise HTTPException(status_code=404, detail="Không tìm thấy.")
    resp = RedirectResponse(url="/?_gate=1", status_code=302)
    resp.headers["Cache-Control"] = "no-store"
    resp.set_cookie(
        config.ADMIN_GATE_COOKIE,
        _sign_gate_token(),
        max_age=config.ADMIN_GATE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE or request.url.scheme == "https",
        path="/",
    )
    return resp


# ------------------------------------------------------------------ admin auth
class AdminLoginBody(BaseModel):
    password: str = Field(min_length=1, max_length=256)


@router.get("/api/admin/auth/status")
def admin_auth_status(request: Request):
    ok, via = is_request_admin(request)
    has_gate = _verify_gate_token(request.cookies.get(config.ADMIN_GATE_COOKIE))
    if not ok and not has_gate:
        raise HTTPException(status_code=404, detail="Không tìm thấy.")
    return {
        "isAdmin": ok,
        "via": via if ok else None,
        "passwordEnabled": bool(has_gate and config.has_secret_admin_portal()),
    }


@router.post("/api/admin/auth/login")
def admin_login(body: AdminLoginBody, request: Request, response: Response):
    if not config.has_secret_admin_portal():
        raise HTTPException(status_code=404, detail="Không tìm thấy.")
    if not _verify_gate_token(request.cookies.get(config.ADMIN_GATE_COOKIE)):
        raise HTTPException(status_code=404, detail="Không tìm thấy.")
    _throttle_admin_login(request)
    if not hmac.compare_digest(body.password.strip(), config.ADMIN_PASSWORD):
        raise HTTPException(status_code=401, detail="Mật khẩu không đúng.")
    token = _sign_admin_token()
    response.set_cookie(
        config.ADMIN_COOKIE_NAME,
        token,
        max_age=config.ADMIN_COOKIE_MAX_AGE,
        httponly=True,
        samesite="strict",
        secure=config.COOKIE_SECURE or request.url.scheme == "https",
        path="/",
    )
    response.delete_cookie(config.ADMIN_GATE_COOKIE, path="/")
    admin_store.append_audit("password", "admin.login", detail=f"ip={request.client.host if request.client else '?'}")
    return {"ok": True, "isAdmin": True, "via": "password"}


@router.post("/api/admin/auth/logout")
def admin_logout(request: Request, response: Response):
    response.delete_cookie(config.ADMIN_COOKIE_NAME, path="/")
    response.delete_cookie(config.ADMIN_GATE_COOKIE, path="/")
    return {"ok": True}


# ------------------------------------------------------------------ analytics & overview
@router.get("/api/admin/overview")
def admin_overview(_actor: str = Depends(require_admin)):
    sessions_summary = store.active_summary()
    hf_status = state_sync.status()
    return admin_store.overview(sessions_summary, hf_status)


# ------------------------------------------------------------------ users & sessions
class BanBody(BaseModel):
    reason: str = Field(default="", max_length=200)


class NoteBody(BaseModel):
    note: str = Field(default="", max_length=300)


class WhitelistToggleBody(BaseModel):
    enabled: bool


@router.get("/api/admin/users")
def admin_users(
    q: str = Query(default="", max_length=100),
    filter: str = Query(default="all", pattern="^(all|online|today|whitelist|banned)$"),
    sort: str = Query(default="recent", pattern="^(recent|moments|sessions|newest)$"),
    _actor: str = Depends(require_admin),
):
    sessions_summary = store.active_summary()
    return admin_store.list_users(sessions_summary, q=q, filt=filter, sort=sort)


@router.get("/api/admin/users/{uid}")
def admin_user_detail(uid: str, _actor: str = Depends(require_admin)):
    detail = admin_store.get_user_detail(uid, store.active_summary())
    if detail is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")
    return detail


@router.put("/api/admin/users/{uid}/note")
def admin_user_note(uid: str, body: NoteBody, actor: str = Depends(require_admin)):
    saved = admin_store.set_user_note(uid, body.note, actor=actor)
    return {"ok": True, "note": saved}


@router.post("/api/admin/users/{uid}/whitelist")
def admin_user_whitelist(uid: str, body: WhitelistToggleBody, actor: str = Depends(require_admin)):
    detail = admin_store.get_user_detail(uid, store.active_summary())
    email = (detail or {}).get("email") or ""
    res = admin_store.set_user_whitelist(uid, body.enabled, actor=actor, email=email)
    return {"ok": True, **res}


@router.post("/api/admin/users/{uid}/ban")
def admin_ban_user(uid: str, body: BanBody, actor: str = Depends(require_admin)):
    # Never allow accidentally banning a configured admin identity
    existing = admin_store.list_users(store.active_summary())["users"]
    match = next((u for u in existing if u["uid"] == uid), None)
    if config.is_admin_identity(uid, (match or {}).get("email")):
        raise HTTPException(status_code=400, detail="Không thể chặn tài khoản quản trị viên.")
    entry = admin_store.ban_user(uid, body.reason, actor=actor)
    revoked = store.revoke_uid(uid)
    return {"ok": True, "ban": entry, "revokedSessions": revoked}


@router.post("/api/admin/users/{uid}/unban")
def admin_unban_user(uid: str, actor: str = Depends(require_admin)):
    removed = admin_store.unban_user(uid, actor=actor)
    return {"ok": True, "removed": removed}


@router.post("/api/admin/users/{uid}/kick")
def admin_kick_user(uid: str, actor: str = Depends(require_admin)):
    revoked = store.revoke_uid(uid)
    admin_store.append_audit(actor, "user.kick", target=uid, detail=f"revoked={revoked}")
    return {"ok": True, "revokedSessions": revoked}


@router.post("/api/admin/sessions/kick-all")
def admin_kick_all_sessions(request: Request, actor: str = Depends(require_admin)):
    keep_uids: set[str] = set(config.ADMIN_UIDS)
    keep_emails: set[str] = set(config.ADMIN_EMAILS)
    sid = request.cookies.get(config.COOKIE_NAME)
    if sid:
        prov = store.get(sid)
        uid, email = provider_identity(prov)
        if uid:
            keep_uids.add(uid)
        if email:
            keep_emails.add(email.lower())
    revoked = store.revoke_all_except(keep_uids=keep_uids, keep_emails=keep_emails)
    admin_store.append_audit(actor, "sessions.kick_all", detail=f"revoked={revoked}")
    return {"ok": True, "revokedSessions": revoked}


# ------------------------------------------------------------------ branding, maintenance & feature flags
@router.get("/api/admin/config")
def admin_get_config(_actor: str = Depends(require_admin)):
    return admin_store.get_site_config()


@router.put("/api/admin/config")
def admin_put_config(patch: dict, actor: str = Depends(require_admin)):
    return admin_store.update_site_config(patch, actor=actor)


# ------------------------------------------------------------------ access & invites
class InviteCreateBody(BaseModel):
    label: str = Field(default="", max_length=60)
    maxUses: int = Field(default=5, ge=0, le=10000)
    expiresDays: int = Field(default=0, ge=0, le=365)


@router.get("/api/admin/access")
def admin_get_access(_actor: str = Depends(require_admin)):
    return admin_store.get_access()


@router.put("/api/admin/access")
def admin_put_access(patch: dict, actor: str = Depends(require_admin)):
    return admin_store.update_access(patch, actor=actor)


@router.post("/api/admin/invites")
def admin_create_invite(body: InviteCreateBody, actor: str = Depends(require_admin)):
    inv = admin_store.create_invite(label=body.label, max_uses=body.maxUses, expires_days=body.expiresDays, actor=actor)
    return {"ok": True, "invite": inv}


@router.delete("/api/admin/invites/{code}")
def admin_revoke_invite(code: str, actor: str = Depends(require_admin)):
    removed = admin_store.revoke_invite(code, actor=actor)
    return {"ok": True, "removed": removed}


# ------------------------------------------------------------------ ops, logs & CSV exports
class ClearCacheBody(BaseModel):
    target: Literal["thumbs", "videos", "all"] = "all"


def _clear_dir(root: Path) -> tuple[int, int]:
    deleted = 0
    freed = 0
    if not root.exists():
        return 0, 0
    for p in list(root.iterdir()):
        if not p.is_file() or ".tmp" in p.name:
            continue
        try:
            sz = p.stat().st_size
            p.unlink(missing_ok=True)
            deleted += 1
            freed += sz
        except OSError:
            pass
    return deleted, freed


@router.post("/api/admin/ops/clear-cache")
async def admin_clear_cache(body: ClearCacheBody, actor: str = Depends(require_admin)):
    def _run():
        files = 0
        freed = 0
        if body.target in ("thumbs", "all"):
            d, b = _clear_dir(config.THUMBS_DIR)
            files += d
            freed += b
        if body.target in ("videos", "all"):
            d, b = _clear_dir(config.VIDEO_CACHE_DIR)
            files += d
            freed += b
        return files, freed

    deleted_files, freed_bytes = await run_in_threadpool(_run)
    admin_store.append_audit(actor, "ops.clear_cache", target=body.target, detail=f"files={deleted_files}, bytes={freed_bytes}")
    return {"ok": True, "deletedFiles": deleted_files, "freedBytes": freed_bytes, "status": state_sync.status()}


@router.post("/api/admin/ops/prune-sessions")
async def admin_prune_sessions(actor: str = Depends(require_admin)):
    removed = await run_in_threadpool(store.prune_expired)
    admin_store.append_audit(actor, "ops.prune_sessions", detail=f"removed={removed}")
    return {"ok": True, "removed": removed}


@router.post("/api/admin/ops/sync-now")
async def admin_sync_now(actor: str = Depends(require_admin)):
    await run_in_threadpool(admin_store.flush)
    synced = await run_in_threadpool(state_sync.flush)
    admin_store.append_audit(actor, "ops.sync_now", detail=f"synced={bool(synced)}")
    return {"ok": True, "synced": bool(synced), "status": state_sync.status()}


@router.post("/api/admin/ops/diagnostics")
async def admin_diagnostics(actor: str = Depends(require_admin)):
    """Probe external integrations (Weather, Music, Places, HF Backup) concurrently and report health + latency."""

    async def _probe(key: str, label: str, coro):
        t0 = time.perf_counter()
        try:
            res = await asyncio.wait_for(coro, timeout=8.0)
            ms = round((time.perf_counter() - t0) * 1000.0)
            return {"key": key, "label": label, "ok": True, "ms": ms, "detail": res}
        except Exception as exc:
            ms = round((time.perf_counter() - t0) * 1000.0)
            return {"key": key, "label": label, "ok": False, "ms": ms, "detail": str(exc)[:140] or type(exc).__name__}

    async def _check_weather():
        w = await tools.lookup_weather(q="Hà Nội")
        return f"{w.get('city', 'Hà Nội')} · {w.get('temp', '?')}°C ({w.get('condition', '')})"

    async def _check_music():
        tracks = await tools.trending_music(3)
        if not tracks:
            raise RuntimeError("Không trả về danh sách bài hát")
        return f"Sẵn sàng ({len(tracks)} bài thịnh hành)"

    async def _check_places():
        places = await tools.search_places("Hồ Hoàn Kiếm")
        if not places:
            raise RuntimeError("Không tìm thấy địa điểm mẫu")
        return f"Sẵn sàng ({len(places)} gợi ý)"

    hf = state_sync.status()
    hf_check = {
        "key": "hf",
        "label": "Sao lưu Hugging Face",
        "ok": bool(hf.get("enabled") and not hf.get("lastError")),
        "ms": 0,
        "detail": (
            f"Đang bật{' · Mã hóa AES' if hf.get('encrypted') else ''} · {hf.get('syncedFiles', 0)} tệp"
            if hf.get("enabled") and not hf.get("lastError")
            else (hf.get("lastError") or "Chưa cấu hình HF Dataset (chỉ lưu cục bộ)")
        ),
    }

    probes = await asyncio.gather(
        _probe("weather", "Dịch vụ Thời tiết", _check_weather()),
        _probe("music", "Kho Nhạc thịnh hành", _check_music()),
        _probe("places", "Tìm kiếm Địa điểm", _check_places()),
    )
    checks = [hf_check, *probes]
    admin_store.append_audit(
        actor,
        "ops.diagnostics",
        detail=f"ok={sum(1 for c in checks if c['ok'])}/{len(checks)}",
    )
    return {"checkedAt": int(time.time() * 1000), "checks": checks}


@router.get("/api/admin/logs")
def admin_logs(_actor: str = Depends(require_admin)):
    return admin_store.recent_logs()


@router.get("/api/admin/export/users.csv")
def admin_export_users(_actor: str = Depends(require_admin)):
    csv_text = admin_store.export_users_csv(store.active_summary())
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="locket-users-{stamp}.csv"'},
    )


@router.get("/api/admin/export/metrics.csv")
def admin_export_metrics(_actor: str = Depends(require_admin)):
    csv_text = admin_store.export_metrics_csv()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=csv_text.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="locket-metrics-{stamp}.csv"'},
    )
