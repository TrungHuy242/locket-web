"""Live provider: talks to Locket through the vendored `locketlam` SDK.

Firebase tokens never leave this process. They live in a per-session folder under
backend/data/sessions and the browser only ever holds an opaque HttpOnly cookie.

Domain methods are split across focused mixins:
  - live_common.py        constants, timestamp / overlay / text normalization
  - live_moments.py       feed sync, memories, posting, comments, activity
  - live_notifications.py notification aggregation and read markers
  - live_friends.py       relationships, friend profiles, lookup
  - live_chat.py          conversations, paged chat history, realtime WS target
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

import requests

from .. import config, state_sync
from ..account_cache import AccountCache, get_account_cache
from ..history import MomentStore, get_moment_store
from ..notifications import NotificationState
from .base import AuthExpired, Provider, ProviderError, display_name
from .live_chat import ChatMixin
from .live_common import (
    FIRESTORE,
    LABELS,
    LOGIN_ERRORS,
    OWNER_IN_URL,
    PROFILE_TTL,
    STORAGE,
    THUMB_NAME,
    proxied,
    to_ms,
)
from .live_friends import FriendsMixin
from .live_moments import MomentsMixin
from .live_notifications import NotificationsMixin

config.ensure_sdk_path()
from locketlam import AuthenticationError, LocketAPIError, LocketClient  # noqa: E402

log = logging.getLogger(__name__)

# The SDK uses urllib without timeouts; make sure a stalled upstream cannot hang a worker.
socket.setdefaulttimeout(30)

__all__ = [
    "FIRESTORE",
    "LABELS",
    "LOGIN_ERRORS",
    "OWNER_IN_URL",
    "PROFILE_TTL",
    "STORAGE",
    "THUMB_NAME",
    "LiveProvider",
    "proxied",
    "to_ms",
]


class LiveProvider(MomentsMixin, NotificationsMixin, FriendsMixin, ChatMixin, Provider):
    mode = "live"
    ME_TTL = 120

    def __init__(self, session_dir: Path):
        self.session_dir = Path(session_dir)
        self.session_dir.mkdir(parents=True, exist_ok=True)
        self.client = LocketClient(session_path=str(self.session_dir / "session.json"))
        self._lock = threading.RLock()
        self._state_lock = threading.RLock()
        self._profiles: dict = {}
        self._me: Optional[dict] = None
        self._me_at = 0.0
        self._conv_by_peer: dict = {}
        self._pool = ThreadPoolExecutor(max_workers=8)
        # one keep-alive connection pool for Firestore: a fresh TLS handshake per call costs ~1.5s
        self._http = requests.Session()
        self._http.mount("https://", requests.adapters.HTTPAdapter(pool_connections=4, pool_maxsize=12))
        self._store: Optional[MomentStore] = None
        self._account_cache: Optional[AccountCache] = None
        self._cache_loaded = False
        self._friends_cache: Optional[tuple[float, dict]] = None
        self._convs_cache: Optional[tuple[float, list]] = None
        self._feed_lock = threading.Lock()
        self._sync_warnings: set = set()
        self._full_synced = False
        self._syncing = False
        self._sync_error: Optional[str] = None
        self._chat_full_done = False
        self._conv_updated: dict[str, int] = {}
        self._comments: dict = {}          # moment id -> chat messages written about it
        self._comments_at: dict = {}       # conversation id -> when its comments were last refreshed
        self._profiles_dirty_at = 0.0
        self._overlay_ctx = threading.local()
        self._patch_session_safety()
        self._patch_overlay_builder()
        self._full_at = self._delta_at = self._chat_at = 0.0
        self._notif_state: Optional[NotificationState] = None
        self._notif_cache: Optional[dict] = None
        self._notif_lock = threading.Lock()
        self._notif_pool = ThreadPoolExecutor(max_workers=3)

    # ---------------------------------------------------------------- SDK patches
    def _patch_session_safety(self) -> None:
        """Serialize SDK token refresh and make session.json writes atomic across worker threads."""
        session = self.client.session
        orig_get = session.get_valid_token

        def safe_get_valid_token() -> str:
            with self._lock:
                return orig_get()

        def atomic_save() -> None:
            if not session.session_path:
                return
            with self._lock:
                data = {
                    "uid": session.uid,
                    "email": session.email,
                    "idToken": session.id_token,
                    "refreshToken": session.refresh_token,
                    "expiresAt": session.expires_at,
                    "device": session.device.to_dict(),
                }
                target = Path(session.session_path)
                tmp = target.with_name(f"{target.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp")
                try:
                    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
                    os.replace(tmp, target)
                except BaseException:
                    try:
                        tmp.unlink(missing_ok=True)
                    except OSError:
                        pass
                    raise
            state_sync.mark_dirty()

        session.get_valid_token = safe_get_valid_token
        session.save = atomic_save

    def _patch_overlay_builder(self) -> None:
        """Enrich SDK overlays for smart captions (time, music, review, location, weather, custom colors)
        without modifying the vendored SDK."""
        build = self.client.moments.build_overlay

        def patched(*args, **kwargs):
            overlay = build(*args, **kwargs)
            meta = getattr(self._overlay_ctx, "meta", None) or {}
            oid = overlay.get("overlay_id")
            data = overlay.setdefault("data", {})
            bg = data.setdefault("background", {"material_blur": "regular", "colors": []})

            if oid == "caption:time":
                data["payload"] = {"date": time.time()}
                data["icon"] = {"type": "sf_symbol", "data": "clock.fill", "color": "#FFFFFFCC"}
                bg["material_blur"] = "regular"
                bg.setdefault("colors", [])
                data["text_color"] = "#FFFFFFE6"
                overlay["alt_text"] = data.get("text") or ""
            elif oid == "caption:music":
                music = meta.get("music") or {}
                title = music.get("title") or data.get("text") or ""
                artist = music.get("artist") or ""
                if not data.get("text"):
                    data["text"] = f"{title} – {artist}" if title and artist else (title or artist)
                payload = {"song_title": title, "artist": artist}
                if music.get("previewUrl"):
                    payload["preview_url"] = music["previewUrl"]
                if music.get("link"):
                    key = "spotify_url" if "spotify.com" in music["link"] else "apple_music_url"
                    payload[key] = music["link"]
                data["type"] = "music"
                data["payload"] = payload
                if music.get("artwork"):
                    data["icon"] = {"type": "image", "data": music["artwork"]}
                else:
                    data["icon"] = {"type": "sf_symbol", "data": "music.note", "color": "#FFFFFFCC"}
                overlay["alt_text"] = data.get("text") or title
            elif oid == "caption:review":
                rating = meta.get("rating")
                data["type"] = "review"
                data["icon"] = {"type": "sf_symbol", "data": "star.fill", "color": "#FFC629"}
                if isinstance(rating, (int, float)):
                    data["payload"] = {"rating": rating}
                overlay["alt_text"] = f"★ {rating} {data.get('text') or ''}".strip() if rating else (data.get("text") or "")
            elif oid == "caption:location":
                data["type"] = "location"
                data["icon"] = {"type": "sf_symbol", "data": "location.fill", "color": "#FFFFFFCC"}
                overlay["alt_text"] = data.get("text") or ""
            elif oid == "caption:weather":
                sym = (meta.get("weather") or {}).get("symbol") or "sun.max.fill"
                data["type"] = "weather"
                data["icon"] = {"type": "sf_symbol", "data": sym, "color": "#FFFFFFCC"}
                overlay["alt_text"] = data.get("text") or ""

            if meta.get("colors"):
                bg["colors"] = list(meta["colors"])
                bg["material_blur"] = "regular"
            if meta.get("textColor"):
                data["text_color"] = meta["textColor"]
            return overlay

        self.client.moments.build_overlay = patched

        # the SDK re-encodes every upload to WebP q85; the server already sends a high-quality WebP,
        # so pass those through instead of compressing them a second time
        convert = self.client.moments._convert_to_webp

        def keep_webp(image_data: bytes, quality: int = 85) -> bytes:
            if isinstance(image_data, (bytes, bytearray)) and image_data[:4] == b"RIFF" and image_data[8:12] == b"WEBP":
                return bytes(image_data)
            return convert(image_data, quality)

        self.client.moments._convert_to_webp = keep_webp

    # ---------------------------------------------------------------- helpers
    @property
    def uid(self) -> str:
        return self.client.session.uid

    @property
    def store(self) -> MomentStore:
        with self._lock:
            if self._store is None:
                self._store = get_moment_store(self.uid)
        self._ensure_cache_loaded()
        return self._store

    def _ensure_cache_loaded(self) -> None:
        if self._cache_loaded or not self.uid:
            return
        with self._lock:
            if self._cache_loaded or not self.uid:
                return
            if self._account_cache is None:
                self._account_cache = get_account_cache(self.uid)
            profiles, conv_updated, chat_full_done, comments = self._account_cache.snapshot()
            with self._state_lock:
                for uid, item in profiles.items():
                    self._profiles.setdefault(uid, item)
                for cid, ts in conv_updated.items():
                    self._conv_updated.setdefault(cid, ts)
                if chat_full_done and not self._chat_full_done:
                    self._chat_full_done = True
                for mid, rows in comments.items():
                    self._comments.setdefault(mid, rows)
            self._cache_loaded = True

    def _persist_cache(self, *, profiles: bool = False, chat: bool = False) -> None:
        if not self.uid:
            return
        self._ensure_cache_loaded()
        if self._account_cache is None:
            return
        with self._state_lock:
            prof_snap = dict(self._profiles) if profiles else None
            conv_snap = dict(self._conv_updated) if chat else None
            done_snap = self._chat_full_done if chat else None
            comm_snap = {k: list(v) for k, v in self._comments.items()} if chat else None
        try:
            self._account_cache.save(
                profiles=prof_snap,
                conv_updated=conv_snap,
                chat_full_done=done_snap,
                comments=comm_snap,
            )
        except OSError as exc:
            log.debug("Account cache save failed: %s", exc)

    def is_authenticated(self) -> bool:
        return self.client.is_authenticated()

    def _token(self) -> str:
        with self._lock:
            try:
                return self.client.session.get_valid_token()
            except AuthenticationError as exc:
                raise AuthExpired() from exc
            except requests.RequestException as exc:
                raise ProviderError("Không kết nối được máy chủ Locket.", 502) from exc

    def _api(self, endpoint: str, payload: Optional[dict] = None) -> dict:
        self._token()
        res = self.client.post_api(endpoint, payload or {})
        if not isinstance(res, dict):
            return {"data": res}
        status = res.get("status")
        if isinstance(status, dict):  # google.rpc style error body
            status = status.get("code")
        failed = res.get("error") or res.get("errors") or (isinstance(status, int) and status not in (200, 304))
        if failed and "data" not in res:
            detail = res.get("error") or res.get("errors") or res.get("message") or f"HTTP {status}"
            if isinstance(detail, (dict, list)):
                detail = json.dumps(detail, ensure_ascii=False)[:200]
            # The token was validated a moment ago, so a 401 here is Locket refusing this particular
            # call (seen on deleteMomentV2), not an expired session: never sign the user out for it.
            code = status if isinstance(status, int) and 400 <= status < 600 and status != 401 else 502
            raise ProviderError(f"Locket từ chối yêu cầu ({endpoint}): {detail}", code)
        return res

    def _firestore_list(self, path: str, page_size: int = 300, order_by: Optional[str] = None, max_docs: int = 600,
                        mask: Optional[tuple] = None) -> list:
        token = self._token()
        docs: list = []
        page_token = None
        params_base = {"pageSize": page_size}
        if order_by:
            params_base["orderBy"] = order_by
        if mask:
            params_base["mask.fieldPaths"] = list(mask)
        while len(docs) < max_docs:
            params = dict(params_base)
            params["pageSize"] = min(page_size, max_docs - len(docs))
            if page_token:
                params["pageToken"] = page_token
            try:
                res = self._http.get(f"{FIRESTORE}/{path}", params=params,
                                   headers={"Authorization": f"Bearer {token}"}, timeout=20)
            except requests.RequestException as exc:
                raise ProviderError("Không kết nối được máy chủ Locket.", 502) from exc
            if res.status_code == 401:
                raise AuthExpired()
            if res.status_code != 200:
                if order_by and not docs:
                    return self._firestore_list(path, page_size=page_size, order_by=None, max_docs=max_docs, mask=mask)
                raise ProviderError(f"Locket từ chối truy vấn dữ liệu ({path.split('/')[-1]}, HTTP {res.status_code}).", 502)
            body = res.json()
            docs.extend(body.get("documents", []))
            page_token = body.get("nextPageToken")
            if not page_token:
                break
        return docs

    def _user_from_profile(self, profile: dict, uid: Optional[str] = None) -> dict:
        profile = profile or {}
        if isinstance(profile.get("user"), dict):
            profile = profile["user"]
        first = profile.get("first_name") or ""
        last = profile.get("last_name") or ""
        username = profile.get("username") or ""
        return {
            "uid": profile.get("uid") or uid or "",
            "firstName": first,
            "lastName": last,
            "name": display_name(first, last, username),
            "username": username,
            "avatar": proxied(profile.get("profile_picture_url")),
        }

    def _user(self, uid: str) -> dict:
        if not uid:
            return self._user_from_profile({}, "")
        self._ensure_cache_loaded()
        with self._state_lock:
            if uid == self.uid and self._me:
                return self._me
            hit = self._profiles.get(uid)
            if hit and time.time() - hit[0] < PROFILE_TTL:
                return hit[1]
        try:
            res = self._api("fetchUserV2", {"user_uid": uid})
            user = self._user_from_profile(res.get("data", res), uid)
        except AuthExpired:
            raise
        except ProviderError:
            if hit:
                return hit[1]
            user = self._user_from_profile({}, uid)
        now = time.time()
        should_save = False
        with self._state_lock:
            self._profiles[uid] = (now, user)
            if now - self._profiles_dirty_at > 30:
                self._profiles_dirty_at = now
                should_save = True
        if should_save:
            self._persist_cache(profiles=True)
        return user

    def _users(self, uids) -> dict:
        self._ensure_cache_loaded()
        unique = [u for u in dict.fromkeys(uids) if u]
        if not unique:
            return {}
        now = time.time()
        result: dict = {}
        missing: list = []
        with self._state_lock:
            for u in unique:
                if u == self.uid and self._me:
                    result[u] = self._me
                    continue
                hit = self._profiles.get(u)
                if hit and now - hit[0] < PROFILE_TTL:
                    result[u] = hit[1]
                else:
                    missing.append(u)
        if missing:
            self._token()
            fetched = dict(zip(missing, self._pool.map(self._user, missing)))
            result.update(fetched)
            self._persist_cache(profiles=True)
        return result

    # ---------------------------------------------------------------- account
    def login(self, email: str, password: str) -> dict:
        try:
            self.client.login(email, password)
        except AuthenticationError as exc:
            raw = str(exc)
            for code, friendly in LOGIN_ERRORS.items():
                if code in raw:
                    raise ProviderError(friendly, 401) from exc
            raise ProviderError("Đăng nhập thất bại. Kiểm tra lại email và mật khẩu.", 401) from exc
        except (requests.RequestException, ValueError, KeyError) as exc:
            err = ProviderError("Không kết nối được máy chủ Locket. Kiểm tra mạng rồi thử lại.", 502)
            err.unavailable = True
            raise err from exc
        return self.me(refresh=True)

    def me(self, refresh: bool = False) -> dict:
        # re-read after ME_TTL so a name / avatar changed in the iPhone app shows up here too
        with self._state_lock:
            if self._me and not refresh and time.time() - self._me_at < self.ME_TTL:
                return self._me
            fallback = self._me
        self._token()
        try:
            profile = self.client.user.get_profile()
        except AuthenticationError as exc:
            raise AuthExpired() from exc
        except (requests.RequestException, LocketAPIError):
            if fallback:
                return fallback              # Locket unreachable: keep serving the last known profile
            raise ProviderError("Không kết nối được máy chủ Locket.", 502)
        if not isinstance(profile, dict):
            profile = {}
        user = self._user_from_profile(profile, self.uid)
        user["email"] = profile.get("email") or self.client.session.email
        user["birthdate"] = profile.get("birthdate")
        with self._state_lock:
            self._me = user
            self._me_at = time.time()
        return user

    def update_name(self, first_name: str, last_name: str) -> dict:
        self._api("changeProfileInfo", {"first_name": first_name, "last_name": last_name})
        return self.me(refresh=True)

    def update_avatar(self, image: bytes) -> dict:
        self._token()
        try:
            res = self.client.user.update_avatar(image)
        except Exception as exc:
            raise ProviderError("Không cập nhật được ảnh đại diện.", 502) from exc
        if res.get("status") != 200:
            raise ProviderError("Không cập nhật được ảnh đại diện.", 502)
        return self.me(refresh=True)

    def set_notifications(self, enabled: bool) -> dict:
        self._api("setClientData", {"client_data": {
            "ios_version": f"{self.client.device.app_version}.{self.client.device.build_number}",
            "push_notifications_enabled": bool(enabled),
        }})
        return {"enabled": bool(enabled)}

    def close(self) -> None:
        """Release worker pools and HTTP connections while keeping session.json on disk."""
        self._pool.shutdown(wait=False)
        self._notif_pool.shutdown(wait=False)
        try:
            self._http.close()
        except Exception as exc:
            log.debug("HTTP session close error: %s", exc)

    def logout(self) -> None:
        self.close()
        shutil.rmtree(self.session_dir, ignore_errors=True)
