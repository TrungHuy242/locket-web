"""Server-side sessions.

The browser holds only a random opaque id in an HttpOnly cookie. Everything sensitive
(Firebase idToken / refreshToken, device fingerprint) stays in the per-session folder on
the server and is never serialized into an API response.
"""
from __future__ import annotations

import hashlib
import json
import logging
import secrets
import shutil
import threading
import time
from pathlib import Path
from typing import Optional

from . import config, state_sync
from .providers.live import LiveProvider

log = logging.getLogger(__name__)


def _dir_for(sid: str) -> Path:
    # Hash the id so a directory listing of the data folder cannot be replayed as a cookie.
    return config.SESSIONS_DIR / hashlib.sha256(sid.encode()).hexdigest()[:40]


def provider_identity(provider) -> tuple[str, str]:
    """Return non-sensitive (uid, email) from a live or mock provider without making network calls."""
    if provider is None:
        return "", ""
    uid = ""
    email = ""
    client = getattr(provider, "client", None)
    session = getattr(client, "session", None)
    if session is not None:
        uid = str(getattr(session, "uid", "") or "").strip()
        email = str(getattr(session, "email", "") or "").strip()
    if not uid:
        me_cached = getattr(provider, "_me", None)
        if isinstance(me_cached, dict):
            uid = str(me_cached.get("uid") or "").strip()
            email = email or str(me_cached.get("email") or "").strip()
    if not uid:
        raw_uid = getattr(provider, "uid", "")
        if isinstance(raw_uid, str):
            uid = raw_uid.strip()
    return uid, email


def _read_session_meta(folder: Path) -> Optional[dict]:
    path = folder / "session.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return None
        return data
    except Exception:
        return None


class SessionStore:
    def __init__(self):
        # sid -> [LiveProvider, last_seen_monotonic]
        self._items: dict[str, list] = {}
        self._lock = threading.Lock()
        self._last_evict = 0.0

    def _restore(self, sid: str) -> Optional[LiveProvider]:
        folder = _dir_for(sid)
        if not (folder / "session.json").exists():
            return None
        provider = LiveProvider(folder)
        if provider.is_authenticated():
            return provider
        provider.close()
        return None

    def _evict_idle_locked(self, now: float) -> list[LiveProvider]:
        if now - self._last_evict < 300:
            return []
        self._last_evict = now
        cutoff = now - config.SESSION_IDLE_SECONDS
        stale = [sid for sid, (_, seen) in self._items.items() if seen < cutoff]
        evicted = [self._items.pop(sid)[0] for sid in stale]
        return evicted

    def get(self, sid: Optional[str]) -> Optional[LiveProvider]:
        if not sid or len(sid) < 30 or len(sid) > 128:
            return None
        now = time.monotonic()
        with self._lock:
            evicted = self._evict_idle_locked(now)
            slot = self._items.get(sid)
            if slot is not None:
                slot[1] = now
                provider = slot[0]
            else:
                provider = self._restore(sid)
                if provider is not None:
                    self._items[sid] = [provider, now]
        for old in evicted:
            try:
                old.close()
            except Exception as exc:
                log.warning("Failed closing idle session provider: %s", exc)
        if evicted:
            log.info("Evicted %d idle session provider(s) from memory", len(evicted))
        return provider

    def new_id(self) -> str:
        return secrets.token_urlsafe(40)

    def folder(self, sid: str) -> Path:
        folder = _dir_for(sid)
        folder.mkdir(parents=True, exist_ok=True)
        return folder

    def register(self, sid: str, provider: LiveProvider) -> None:
        with self._lock:
            self._items[sid] = [provider, time.monotonic()]
        state_sync.mark_dirty(urgent=True)

    def destroy(self, sid: Optional[str]) -> None:
        if not sid:
            return
        with self._lock:
            slot = self._items.pop(sid, None)
        provider = slot[0] if slot is not None else None
        if provider is not None:
            try:
                provider.logout()
            except Exception as exc:
                log.warning("Provider logout cleanup failed: %s", exc)
        if 30 <= len(sid) <= 128:
            shutil.rmtree(_dir_for(sid), ignore_errors=True)
        state_sync.mark_dirty(urgent=True)

    def active_summary(self) -> list[dict]:
        """List active in-memory and persisted sessions with non-sensitive metadata only."""
        now_ms = int(time.time() * 1000)
        now_mono = time.monotonic()
        by_hash: dict[str, dict] = {}

        with self._lock:
            items_snap = [(sid, slot[0], slot[1]) for sid, slot in self._items.items()]

        for sid, prov, seen_mono in items_snap:
            h = _dir_for(sid).name
            uid, email = provider_identity(prov)
            age_ms = max(0, int((now_mono - seen_mono) * 1000))
            by_hash[h] = {
                "sidHash": h[:12],
                "uid": uid,
                "email": email,
                "inMemory": True,
                "lastSeenMs": max(0, now_ms - age_ms),
                "expiresAt": 0,
            }

        root = config.SESSIONS_DIR
        if root.exists():
            for folder in root.iterdir():
                if not folder.is_dir() or folder.name.startswith("."):
                    continue
                meta = _read_session_meta(folder)
                if not meta:
                    continue
                h = folder.name
                uid = str(meta.get("uid") or "").strip()
                email = str(meta.get("email") or "").strip()
                expires_at = int(meta.get("expiresAt") or 0)
                if h in by_hash:
                    if not by_hash[h]["uid"]:
                        by_hash[h]["uid"] = uid
                    if not by_hash[h]["email"]:
                        by_hash[h]["email"] = email
                    by_hash[h]["expiresAt"] = expires_at
                else:
                    try:
                        mtime_ms = int((folder / "session.json").stat().st_mtime * 1000)
                    except OSError:
                        mtime_ms = 0
                    by_hash[h] = {
                        "sidHash": h[:12],
                        "uid": uid,
                        "email": email,
                        "inMemory": False,
                        "lastSeenMs": mtime_ms,
                        "expiresAt": expires_at,
                    }

        return sorted(by_hash.values(), key=lambda x: (x["inMemory"], x["lastSeenMs"]), reverse=True)

    def revoke_uid(self, uid: str) -> int:
        """Immediately sign out and delete every in-memory & persisted session belonging to `uid`."""
        target = (uid or "").strip()
        if not target:
            return 0
        revoked_hashes: set[str] = set()
        providers_to_close: list[LiveProvider] = []

        with self._lock:
            matched_sids = []
            for sid, (prov, _) in self._items.items():
                p_uid, _ = provider_identity(prov)
                if p_uid == target:
                    matched_sids.append(sid)
            for sid in matched_sids:
                slot = self._items.pop(sid, None)
                if slot is not None:
                    providers_to_close.append(slot[0])
                    revoked_hashes.add(_dir_for(sid).name)

        for prov in providers_to_close:
            try:
                prov.logout()
            except Exception as exc:
                log.warning("Revoke logout failed for uid=%s: %s", target, exc)

        root = config.SESSIONS_DIR
        if root.exists():
            for folder in list(root.iterdir()):
                if not folder.is_dir():
                    continue
                if folder.name in revoked_hashes:
                    shutil.rmtree(folder, ignore_errors=True)
                    continue
                meta = _read_session_meta(folder)
                if meta and str(meta.get("uid") or "").strip() == target:
                    shutil.rmtree(folder, ignore_errors=True)
                    revoked_hashes.add(folder.name)

        if revoked_hashes:
            state_sync.mark_dirty(urgent=True)
        return len(revoked_hashes)

    def revoke_all_except(self, keep_uids: set[str] | None = None, keep_emails: set[str] | None = None) -> int:
        """Sign out every session except protected admin accounts / specified identities."""
        keep_u = {u.strip() for u in (keep_uids or set()) if u}
        keep_e = {e.strip().lower() for e in (keep_emails or set()) if e}

        def _is_kept(uid: str, email: str) -> bool:
            if uid and uid in keep_u:
                return True
            if email and email.lower() in keep_e:
                return True
            return config.is_admin_identity(uid, email)

        revoked_hashes: set[str] = set()
        providers_to_close: list[LiveProvider] = []

        with self._lock:
            to_pop = []
            for sid, (prov, _) in self._items.items():
                uid, email = provider_identity(prov)
                if not _is_kept(uid, email):
                    to_pop.append(sid)
            for sid in to_pop:
                slot = self._items.pop(sid, None)
                if slot is not None:
                    providers_to_close.append(slot[0])
                    revoked_hashes.add(_dir_for(sid).name)

        for prov in providers_to_close:
            try:
                prov.logout()
            except Exception as exc:
                log.warning("Kick-all logout cleanup failed: %s", exc)

        root = config.SESSIONS_DIR
        if root.exists():
            for folder in list(root.iterdir()):
                if not folder.is_dir():
                    continue
                if folder.name in revoked_hashes:
                    shutil.rmtree(folder, ignore_errors=True)
                    continue
                meta = _read_session_meta(folder)
                if not meta:
                    continue
                uid = str(meta.get("uid") or "").strip()
                email = str(meta.get("email") or "").strip()
                if not _is_kept(uid, email):
                    shutil.rmtree(folder, ignore_errors=True)
                    revoked_hashes.add(folder.name)

        if revoked_hashes:
            state_sync.mark_dirty(urgent=True)
        return len(revoked_hashes)

    def prune_expired(self) -> int:
        """Remove broken or unrefreshable expired session folders from disk."""
        root = config.SESSIONS_DIR
        if not root.exists():
            return 0
        now_sec = time.time()
        now_ms = int(now_sec * 1000)
        removed = 0

        with self._lock:
            active_hashes = {_dir_for(sid).name for sid in self._items}

        for folder in list(root.iterdir()):
            if not folder.is_dir() or folder.name.startswith("."):
                continue
            if folder.name in active_hashes:
                continue
            try:
                if now_sec - folder.stat().st_mtime < 60:
                    continue
            except OSError:
                continue
            meta = _read_session_meta(folder)
            should_remove = False
            if meta is None:
                should_remove = True
            else:
                has_token = bool(meta.get("idToken") or meta.get("refreshToken"))
                expires_at = int(meta.get("expiresAt") or 0)
                if not has_token:
                    should_remove = True
                elif expires_at and expires_at < now_ms and not meta.get("refreshToken"):
                    should_remove = True
            if should_remove:
                shutil.rmtree(folder, ignore_errors=True)
                removed += 1

        if removed:
            state_sync.mark_dirty(urgent=True)
        return removed


store = SessionStore()
