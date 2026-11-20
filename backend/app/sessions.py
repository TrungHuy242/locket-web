"""Server-side sessions.

The browser holds only a random opaque id in an HttpOnly cookie. Everything sensitive
(Firebase idToken / refreshToken, device fingerprint) stays in the per-session folder on
the server and is never serialized into an API response.
"""
from __future__ import annotations

import hashlib
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


store = SessionStore()
