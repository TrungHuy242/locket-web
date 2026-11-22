"""Locket web backend: a thin, credential-holding API in front of the locketlam SDK."""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import io
import json
import logging
import os
import tempfile
import threading
import time
import weakref
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool
from starlette.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from . import cache as disk_cache
from . import captions, config, state_sync, video
from .providers.base import AuthExpired, Provider, ProviderError
from .providers.live import LiveProvider
from .sessions import store

config.configure_logging()
log = logging.getLogger(__name__)


def _has_h2() -> bool:
    return importlib.util.find_spec("h2") is not None


_HTTP2 = _has_h2()
_media_clients: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
_thumb_sems: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
_thumb_locks: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()


def _get_media_client() -> httpx.AsyncClient:
    """Shared async HTTP/2 keep-alive client per event loop for streaming Locket media."""
    loop = asyncio.get_running_loop()
    client = _media_clients.get(loop)
    if client is None or client.is_closed:
        client = httpx.AsyncClient(
            http2=_HTTP2,
            follow_redirects=False,
            timeout=httpx.Timeout(20.0, connect=10.0),
            limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
        )
        _media_clients[loop] = client
    return client


async def _close_media_client() -> None:
    loop = asyncio.get_running_loop()
    client = _media_clients.pop(loop, None)
    if client is not None and not client.is_closed:
        await client.aclose()


class _SelectiveGZipMiddleware:
    """Compress JSON/text responses while skipping binary media proxy streams."""

    def __init__(self, app, minimum_size: int = 500):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path", "") != "/api/media":
            await self.gzip(scope, receive, send)
            return
        await self.app(scope, receive, send)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    await run_in_threadpool(state_sync.start)
    try:
        yield
    finally:
        await _close_media_client()
        await run_in_threadpool(state_sync.stop)


app = FastAPI(title="Locket Web", docs_url=None, redoc_url=None, openapi_url=None, lifespan=_lifespan)
app.add_middleware(_SelectiveGZipMiddleware, minimum_size=500)


# --------------------------------------------------------------------------- plumbing
@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        # Cookies are SameSite=Strict; the custom header adds a second CSRF barrier,
        # since a cross-site form cannot set it.
        if request.headers.get("x-locket-client") != "web":
            return JSONResponse({"error": "Yêu cầu không hợp lệ."}, status_code=403)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
        "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    )
    path = request.url.path
    if path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    elif path.startswith("/assets/"):
        # Vite file names carry a content hash: cache them for good (the service worker precaches them too)
        response.headers.setdefault("Cache-Control", "public, max-age=31536000, immutable")
    elif path.startswith(("/icons/", "/splash/", "/booth/")):
        response.headers.setdefault("Cache-Control", "public, max-age=86400")
    else:
        # index.html, sw.js and the manifest must be revalidated so updates reach installed apps
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError):
    if exc.status >= 500:
        log.warning("Provider error %s on %s %s: %s", exc.status, request.method, request.url.path, exc.message)
    body = {"error": exc.message}
    if getattr(exc, "unavailable", False):
        body["unavailable"] = True
    response = JSONResponse(body, status_code=exc.status)
    if isinstance(exc, AuthExpired):
        store.destroy(request.cookies.get(config.COOKIE_NAME))
        response.delete_cookie(config.COOKIE_NAME, path="/")
    return response


def current(request: Request) -> Provider:
    provider = store.get(request.cookies.get(config.COOKIE_NAME))
    if provider is None:
        raise HTTPException(status_code=401, detail="Chưa đăng nhập")
    return provider


@app.exception_handler(HTTPException)
async def http_error_handler(request: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail if isinstance(exc.detail, str) else "Lỗi"}, status_code=exc.status_code)


def _set_cookie(response: Response, request: Request, sid: str) -> None:
    response.set_cookie(
        config.COOKIE_NAME, sid, max_age=config.SESSION_MAX_AGE, httponly=True, samesite="strict",
        secure=config.COOKIE_SECURE or request.url.scheme == "https", path="/",
    )


_attempts: dict = defaultdict(deque)
_attempts_lock = threading.Lock()


def _throttle(request: Request, limit: int = 8, window: int = 300) -> None:
    key = request.client.host if request.client else "?"
    now = time.time()
    with _attempts_lock:
        if len(_attempts) > 2000:
            stale = [k for k, q in _attempts.items() if not q or now - q[-1] > window]
            for k in stale:
                _attempts.pop(k, None)
        bucket = _attempts[key]
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="Bạn thử đăng nhập quá nhiều lần. Đợi vài phút rồi thử lại.")
        bucket.append(now)


def _read_upload(upload: UploadFile, limit: int) -> bytes:
    data = upload.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail="Tệp quá lớn.")
    return data


def _save_upload_temp(upload: UploadFile, limit: int, prefix: str = "locket-upload-") -> Path:
    """Stream a large upload to a temporary file in 256 KB chunks instead of buffering it in RAM."""
    fd, raw_path = tempfile.mkstemp(prefix=prefix)
    path = Path(raw_path)
    total = 0
    try:
        with os.fdopen(fd, "wb") as fh:
            while True:
                chunk = upload.file.read(256 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > limit:
                    raise HTTPException(status_code=413, detail="Tệp quá lớn.")
                fh.write(chunk)
    except BaseException:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    return path


def _clean_image(data: bytes, max_side: int = 1440, fmt: str = "JPEG") -> bytes:
    """Decode, fix orientation, drop metadata (EXIF/GPS) and re-encode before anything is uploaded."""
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Ảnh không hợp lệ.") from exc
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    out = io.BytesIO()
    if fmt == "WEBP":
        img.save(out, "WEBP", quality=90, method=6)   # what Locket stores; encoded once, at a high quality
    else:
        img.save(out, "JPEG", quality=90)
    return out.getvalue()


# --------------------------------------------------------------------------- auth
class LoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


@app.get("/api/session")
def get_session(request: Request):
    provider = store.get(request.cookies.get(config.COOKIE_NAME))
    if provider is None:
        return {"authenticated": False}
    return {"authenticated": True, "user": provider.me()}


@app.post("/api/auth/login")
def login(body: LoginBody, request: Request, response: Response):
    _throttle(request)
    store.destroy(request.cookies.get(config.COOKIE_NAME))
    sid = store.new_id()
    provider = LiveProvider(store.folder(sid))
    try:
        user = provider.login(body.email.strip(), body.password)
    except Exception:
        provider.logout()
        raise
    store.register(sid, provider)
    _set_cookie(response, request, sid)
    return {"authenticated": True, "user": user}


@app.post("/api/auth/logout")
def logout(request: Request, response: Response):
    store.destroy(request.cookies.get(config.COOKIE_NAME))
    response.delete_cookie(config.COOKIE_NAME, path="/")
    # drop friends' photos / videos that /api/media let the browser cache privately on this device
    response.headers["Clear-Site-Data"] = '"cache"'
    return {"ok": True}


# --------------------------------------------------------------------------- account
class NameBody(BaseModel):
    firstName: str = Field(min_length=1, max_length=40)
    lastName: str = Field(default="", max_length=40)


class ToggleBody(BaseModel):
    enabled: bool


@app.get("/api/me")
def me(p: Provider = Depends(current)):
    return p.me(refresh=True)


@app.patch("/api/me")
def update_me(body: NameBody, p: Provider = Depends(current)):
    return p.update_name(body.firstName.strip(), body.lastName.strip())


@app.post("/api/me/avatar")
def update_avatar(image: UploadFile = File(...), p: Provider = Depends(current)):
    return p.update_avatar(_clean_image(_read_upload(image, config.MAX_IMAGE_BYTES), 720))


@app.post("/api/me/notifications")
def notifications(body: ToggleBody, p: Provider = Depends(current)):
    return p.set_notifications(body.enabled)


# --------------------------------------------------------------------------- moments
class ReactBody(BaseModel):
    emoji: str = Field(min_length=1, max_length=32)


@app.get("/api/captions")
def get_captions(p: Provider = Depends(current)):
    return {"presets": captions.presets()}


@app.get("/api/feed")
def feed(
    before: Optional[str] = Query(default=None, max_length=80),
    limit: int = Query(default=30, ge=1, le=60),
    refresh: bool = False,
    p: Provider = Depends(current),
):
    """One page of the moment history, newest first. `before` is the cursor returned by the previous page."""
    return p.feed(before=before, limit=limit, refresh=refresh)


@app.get("/api/memories")
def memories(
    before: Optional[str] = Query(default=None, max_length=80),
    limit: int = Query(default=60, ge=1, le=120),
    kind: str = Query(default="all", pattern="^(all|photo|video)$"),
    author: Optional[str] = Query(default=None, max_length=64),
    q: str = Query(default="", max_length=100),
    year: Optional[int] = Query(default=None, ge=2000, le=2100),
    month: Optional[int] = Query(default=None, ge=1, le=12),
    tz: int = Query(default=0, ge=-840, le=840, description="browser UTC offset in minutes"),
    p: Provider = Depends(current),
):
    """The whole synced history, newest first, filtered by type / author / period / text, with facet counts."""
    return p.memories(before=before, limit=limit, kind=kind, author=author or None, q=q.strip(),
                      year=year, month=month if year else None, tz_minutes=tz)


@app.post("/api/moments")
def post_moment(
    image: Optional[UploadFile] = File(None),
    video: Optional[UploadFile] = File(None),
    caption: str = Form(""),
    preset: str = Form(""),
    recipients: str = Form("[]"),
    private: bool = Form(False),
    video_mirror: bool = Form(False),
    video_start: float = Form(0.0, ge=0, le=36000),
    video_length: float = Form(0.0, ge=0, le=60),
    p: Provider = Depends(current),
):
    try:
        targets = json.loads(recipients or "[]")
        assert isinstance(targets, list) and all(isinstance(t, str) and len(t) < 64 for t in targets)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Danh sách người nhận không hợp lệ.") from exc
    if preset and not captions.is_valid(preset):
        raise HTTPException(status_code=422, detail="Kiểu chú thích không hợp lệ.")
    # Locket's own photos are 1020x1020 WebP
    if image is None and video is None:
        raise HTTPException(status_code=422, detail="Chưa có ảnh hoặc video để đăng.")
    # a library clip the browser cannot decode comes without a still: the SDK extracts one from the video
    image_bytes = _clean_image(_read_upload(image, config.MAX_IMAGE_BYTES), 1020, "WEBP") if image is not None else None
    video_path = _save_upload_temp(video, config.MAX_VIDEO_BYTES, prefix="locket-vid-up-") if video is not None else None
    try:
        return p.post_moment(image_bytes, video_path, caption.strip()[:300], preset or None,
                             [] if private else targets[:200], private=private, mirror_video=video_mirror,
                             video_start=video_start, video_length=video_length)
    finally:
        if video_path is not None:
            try:
                video_path.unlink(missing_ok=True)
            except OSError:
                pass


@app.delete("/api/moments/{moment_id}")
def delete_moment(moment_id: str, p: Provider = Depends(current)):
    p.delete_moment(moment_id)
    return {"ok": True}


@app.post("/api/moments/{moment_id}/react")
def react(moment_id: str, body: ReactBody, p: Provider = Depends(current)):
    return {"ok": True, **(p.react(moment_id, body.emoji) or {})}


@app.post("/api/moments/{moment_id}/view")
def view(moment_id: str, p: Provider = Depends(current)):
    p.mark_viewed(moment_id)
    return {"ok": True}


@app.get("/api/moments/{moment_id}")
def moment(moment_id: str, p: Provider = Depends(current)):
    return p.moment(moment_id)


@app.get("/api/moments/{moment_id}/activity")
def activity(moment_id: str, p: Provider = Depends(current)):
    return p.activity(moment_id)


@app.get("/api/moments/{moment_id}/comments")
def comments(moment_id: str, p: Provider = Depends(current)):
    return p.comments(moment_id)


class CommentBody(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    to: Optional[str] = Field(default=None, max_length=64)


@app.post("/api/moments/{moment_id}/comments")
def add_comment(moment_id: str, body: CommentBody, p: Provider = Depends(current)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Bình luận trống.")
    return p.add_comment(moment_id, text, body.to)


# --------------------------------------------------------------------------- friends
class UidBody(BaseModel):
    uid: str = Field(min_length=1, max_length=64)


@app.get("/api/friends")
def friends(p: Provider = Depends(current)):
    return p.friends()


@app.get("/api/friends/lookup")
def lookup(username: str = Query(min_length=1, max_length=64), p: Provider = Depends(current)):
    cleaned = username.strip().lstrip("@").rsplit("/", 1)[-1]
    if not cleaned or not all(ch.isalnum() or ch in "._-" for ch in cleaned):
        raise HTTPException(status_code=422, detail="Tên người dùng không hợp lệ.")
    user = p.lookup(cleaned)
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng này.")
    return user


@app.post("/api/friends/requests")
def send_request(body: UidBody, p: Provider = Depends(current)):
    p.send_request(body.uid)
    return {"ok": True}


@app.post("/api/friends/{uid}/accept")
def accept(uid: str, p: Provider = Depends(current)):
    p.accept_request(uid)
    return {"ok": True}


@app.delete("/api/friends/{uid}")
def remove_friend(uid: str, p: Provider = Depends(current)):
    p.remove_friend(uid)
    return {"ok": True}


@app.post("/api/friends/{uid}/block")
def block(uid: str, p: Provider = Depends(current)):
    p.block(uid)
    return {"ok": True}


@app.post("/api/friends/{uid}/unblock")
def unblock(uid: str, p: Provider = Depends(current)):
    p.unblock(uid)
    return {"ok": True}


@app.post("/api/friends/{uid}/decline")
def decline(uid: str, p: Provider = Depends(current)):
    p.delete_request(uid, "incoming")
    return {"ok": True}


@app.post("/api/friends/{uid}/cancel")
def cancel(uid: str, p: Provider = Depends(current)):
    p.delete_request(uid, "outgoing")
    return {"ok": True}


@app.get("/api/friends/{uid}/profile")
def friend_profile(uid: str, p: Provider = Depends(current)):
    if not uid.isalnum() or len(uid) > 64:
        raise HTTPException(status_code=422, detail="Mã người dùng không hợp lệ.")
    return p.friend_profile(uid)


# --------------------------------------------------------------------------- chat
class MessageBody(BaseModel):
    text: str = Field(default="", max_length=1000)
    momentId: Optional[str] = Field(default=None, max_length=64)


class ReadBody(BaseModel):
    conversationId: Optional[str] = Field(default=None, max_length=64)
    receipt: bool = True


class MessageReactBody(BaseModel):
    emoji: Optional[str] = Field(default=None, max_length=32)


class NotifReadBody(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=500)
    all: bool = False


@app.get("/api/notifications")
def notifications_list(refresh: bool = False, p: Provider = Depends(current)):
    """Notifications assembled from real Locket events (Locket has no inbox API of its own)."""
    return p.notifications(refresh=refresh)


@app.post("/api/notifications/read")
def notifications_read(body: NotifReadBody, p: Provider = Depends(current)):
    return p.mark_notifications(body.ids, everything=body.all)


@app.get("/api/conversations")
def conversations(p: Provider = Depends(current)):
    return {"conversations": p.conversations()}


@app.get("/api/chats/{peer_uid}")
def messages(peer_uid: str, limit: int = Query(default=50, ge=1, le=200), before: Optional[int] = Query(default=None, ge=0),
             p: Provider = Depends(current)):
    """Messages with one friend, oldest -> newest. `before` (ms, from `nextBefore`) pages back through history."""
    return p.messages(peer_uid, limit=limit, before=before)


@app.websocket("/api/chats/{peer_uid}/live")
async def chat_live(ws: WebSocket, peer_uid: str):
    """Relay of Locket's realtime chat socket. The browser cannot attach the Firebase token to a WebSocket
    (and must never see it), so the server opens the upstream connection and forwards every event."""
    origin = urlparse(ws.headers.get("origin") or "")
    if origin.netloc and origin.netloc != ws.headers.get("host"):
        await ws.close(code=4403)                      # cross-site socket: refuse
        return
    provider = store.get(ws.cookies.get(config.COOKIE_NAME))
    if provider is None or not hasattr(provider, "realtime_target"):
        await ws.close(code=4401)
        return
    import websockets
    try:
        url, headers = await run_in_threadpool(provider.realtime_target, peer_uid)
    except ProviderError:
        await ws.close(code=4401)
        return
    await ws.accept()
    try:
        async with websockets.connect(url, additional_headers=headers, open_timeout=15, ping_interval=25) as upstream:
            await ws.send_json({"type": "ready"})

            async def pump_up():
                async for raw in upstream:
                    try:
                        data = json.loads(raw)
                    except (TypeError, ValueError):
                        data = None
                    await ws.send_json({"type": "event", "data": data})

            async def pump_down():
                while True:
                    msg = await ws.receive_text()      # the browser only sends keep-alives
                    if msg == "ping":
                        await ws.send_json({"type": "pong"})

            done, pending = await asyncio.wait([asyncio.create_task(pump_up()), asyncio.create_task(pump_down())],
                                               return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            for task in done:
                if task.exception() and not isinstance(task.exception(), WebSocketDisconnect):
                    raise task.exception()
            if any(isinstance(t.exception(), WebSocketDisconnect) for t in done):
                return                                 # the browser left: nothing more to do
    except WebSocketDisconnect:
        return
    except Exception as exc:                           # upstream refused or dropped
        log.warning("Realtime chat relay dropped (%s): %s", type(exc).__name__, exc)
        try:
            await ws.send_json({"type": "error", "message": f"Mất kết nối thời gian thực với Locket ({type(exc).__name__})."})
        except Exception:
            pass
    try:
        await ws.close(code=1011)
    except Exception:
        pass


@app.post("/api/chats/{peer_uid}")
def send_message(peer_uid: str, body: MessageBody, p: Provider = Depends(current)):
    text = body.text.strip()
    if not text and not body.momentId:
        raise HTTPException(status_code=422, detail="Tin nhắn trống.")
    return p.send_message(peer_uid, text, body.momentId)


@app.post("/api/chats/{peer_uid}/read")
def mark_read(peer_uid: str, body: ReadBody, p: Provider = Depends(current)):
    p.mark_read(peer_uid, body.conversationId, body.receipt)
    return {"ok": True}


@app.put("/api/conversations/{conversation_id}/messages/{message_id}/reaction")
def react_message(conversation_id: str, message_id: str, body: MessageReactBody, p: Provider = Depends(current)):
    p.react_message(conversation_id, message_id, body.emoji)
    return {"ok": True}


@app.delete("/api/conversations/{conversation_id}/messages/{message_id}")
def delete_message(conversation_id: str, message_id: str, p: Provider = Depends(current)):
    p.delete_message(conversation_id, message_id)
    return {"ok": True}


# --------------------------------------------------------------------------- media
def _host_allowed(host: str) -> bool:
    host = (host or "").lower()
    return host in config.MEDIA_HOST_ALLOWLIST or host.endswith(config.MEDIA_HOST_SUFFIX_ALLOWLIST)


THUMB_WIDTHS = (128, 360)
THUMB_CACHE_HEADER = "private, max-age=2592000, immutable"
MEDIA_CACHE_HEADER = "private, max-age=2592000, immutable"


def _encode_thumb(raw: bytes, width: int, cache: Path) -> bytes:
    """Decode and save a fast-encoded WebP thumbnail (method=0 is ~6-8x faster on shared vCPUs)."""
    tmp = cache.with_suffix(".tmp%d" % (time.time_ns() % 100000))
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        img.thumbnail((width, width), Image.Resampling.BILINEAR)
        img.save(tmp, "WEBP", quality=78, method=0)
        tmp.replace(cache)
        disk_cache.schedule_prune(config.THUMBS_DIR, config.THUMBS_MAX_BYTES)
        return cache.read_bytes()
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        raise HTTPException(status_code=415, detail="Định dạng ảnh không được hỗ trợ.") from exc


async def _thumbnail(url: str, width: int) -> Response:
    """Downscaled copy for grids and avatars, cached on disk with per-key dedupe and CPU throttling."""
    key = f"{hashlib.sha256(url.encode()).hexdigest()[:40]}_{width}"
    cache = config.THUMBS_DIR / f"{key}.webp"
    if cache.exists():
        disk_cache.touch_if_old(cache)
        data = await run_in_threadpool(cache.read_bytes)
        return Response(data, media_type="image/webp", headers={"Cache-Control": THUMB_CACHE_HEADER})

    loop = asyncio.get_running_loop()
    locks = _thumb_locks.setdefault(loop, {})
    slot = locks.get(key)
    if slot is None:
        slot = [asyncio.Lock(), 0]
        locks[key] = slot
    slot[1] += 1
    try:
        async with slot[0]:
            if cache.exists():
                disk_cache.touch_if_old(cache)
                data = await run_in_threadpool(cache.read_bytes)
                return Response(data, media_type="image/webp", headers={"Cache-Control": THUMB_CACHE_HEADER})

            client = _get_media_client()
            try:
                async with client.stream("GET", url) as upstream:
                    if upstream.status_code != 200 or not upstream.headers.get("content-type", "").startswith("image/"):
                        raise HTTPException(status_code=404, detail="Không tải được media.")
                    if "svg" in upstream.headers.get("content-type", "").lower():
                        raise HTTPException(status_code=415, detail="Định dạng ảnh không được hỗ trợ.")
                    buf = bytearray()
                    async for chunk in upstream.aiter_bytes(64 * 1024):
                        buf.extend(chunk)
                        if len(buf) > config.MAX_IMAGE_BYTES:
                            raise HTTPException(status_code=413, detail="Ảnh quá lớn.")
                    raw = bytes(buf)
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail="Không tải được media.") from exc

            sem = _thumb_sems.get(loop)
            if sem is None:
                sem = asyncio.Semaphore(2)
                _thumb_sems[loop] = sem
            async with sem:
                data = await run_in_threadpool(_encode_thumb, raw, width, cache)
            return Response(data, media_type="image/webp", headers={"Cache-Control": THUMB_CACHE_HEADER})
    finally:
        slot[1] -= 1
        if slot[1] <= 0 and locks.get(key) is slot:
            locks.pop(key, None)


@app.get("/api/media")
async def media(request: Request, u: str = Query(max_length=2000), w: Optional[int] = Query(default=None),
                v: Optional[str] = Query(default=None, max_length=8), p: Provider = Depends(current)):
    """Streams Locket media asynchronously through an HTTP/2 keep-alive pool."""
    parsed = urlparse(u)
    if parsed.scheme != "https" or not _host_allowed(parsed.hostname or "") or parsed.port not in (None, 443):
        raise HTTPException(status_code=400, detail="Nguồn media không được phép.")
    if w in THUMB_WIDTHS:
        return await _thumbnail(u, w)
    if v == "h264":
        # Locket clips are HEVC; this serves a cached H.264 copy (FileResponse handles Range requests)
        path = await run_in_threadpool(video.h264_copy, u)
        return FileResponse(path, media_type="video/mp4", headers={"Cache-Control": THUMB_CACHE_HEADER})
    headers = {}
    if request.headers.get("range"):
        headers["Range"] = request.headers["range"]
    client = _get_media_client()
    try:
        req = client.build_request("GET", u, headers=headers)
        upstream = await client.send(req, stream=True)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Không tải được media.") from exc
    if upstream.status_code not in (200, 206):
        await upstream.aclose()
        raise HTTPException(status_code=404, detail="Không tải được media.")
    content_type = upstream.headers.get("content-type", "application/octet-stream")
    # SVG can carry script and would be served from this origin: never proxy it
    if not content_type.startswith(("image/", "video/", "audio/")) or "svg" in content_type.lower():
        await upstream.aclose()
        raise HTTPException(status_code=415, detail="Định dạng media không được hỗ trợ.")
    out_headers = {"Cache-Control": MEDIA_CACHE_HEADER, "Accept-Ranges": "bytes"}
    for name in ("Content-Length", "Content-Range"):
        val = upstream.headers.get(name)
        if val:
            out_headers[name] = val

    async def _stream():
        try:
            async for chunk in upstream.aiter_bytes(64 * 1024):
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(_stream(), status_code=upstream.status_code,
                             media_type=content_type, headers=out_headers)


@app.get("/api/health")
def health():
    return {"ok": True}


if not config._flag("LOCKET_SKIP_FRONTEND", False):
    if not (config.FRONTEND_DIR / "index.html").exists():
        raise RuntimeError("Chưa build giao diện React. Chạy: cd frontend && npm install && npm run build")
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR), html=True), name="frontend")
