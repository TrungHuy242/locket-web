"""Per-account warm cache (friend profiles, chat scan cursors, comments), persisted on disk.

Stored next to `moments.json` under `backend/data/accounts/<hash>/cache.json`, so it is also
picked up automatically by `state_sync` on ephemeral PaaS containers. This avoids re-fetching
every friend's profile and re-scanning thousands of historical chat messages after restarts.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import Optional

from . import config, state_sync

MAX_PROFILES = 500
MAX_COMMENT_MOMENTS = 1500
PROFILE_DISK_MAX_AGE = 60 * 60 * 24 * 7  # keep cached profiles up to 7 days on disk

_caches: dict[str, "AccountCache"] = {}
_caches_guard = threading.Lock()


def get_account_cache(uid: str) -> "AccountCache":
    with _caches_guard:
        item = _caches.get(uid)
        if item is None:
            item = AccountCache(uid)
            _caches[uid] = item
        return item


class AccountCache:
    def __init__(self, uid: str):
        folder = config.ACCOUNTS_DIR / hashlib.sha256(uid.encode()).hexdigest()[:32]
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "cache.json"
        self._lock = threading.RLock()
        self.profiles: dict[str, tuple[float, dict]] = {}
        self.conv_updated: dict[str, int] = {}
        self.chat_full_done: bool = False
        self.comments: dict[str, list] = {}
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if not isinstance(data, dict):
            return
        cutoff = time.time() - PROFILE_DISK_MAX_AGE
        raw_profiles = data.get("profiles") or {}
        if isinstance(raw_profiles, dict):
            for uid, entry in raw_profiles.items():
                if isinstance(entry, dict) and isinstance(entry.get("user"), dict):
                    at = float(entry.get("at") or 0)
                    if at >= cutoff:
                        self.profiles[str(uid)] = (at, entry["user"])
        raw_conv = data.get("conv_updated") or {}
        if isinstance(raw_conv, dict):
            self.conv_updated = {str(k): int(v or 0) for k, v in raw_conv.items()}
        self.chat_full_done = bool(data.get("chat_full_done"))
        raw_comments = data.get("comments") or {}
        if isinstance(raw_comments, dict):
            self.comments = {str(k): list(v) for k, v in raw_comments.items() if isinstance(v, list)}

    def snapshot(self) -> tuple[dict[str, tuple[float, dict]], dict[str, int], bool, dict[str, list]]:
        with self._lock:
            return (
                dict(self.profiles),
                dict(self.conv_updated),
                self.chat_full_done,
                {k: list(v) for k, v in self.comments.items()},
            )

    def save(
        self,
        profiles: Optional[dict[str, tuple[float, dict]]] = None,
        conv_updated: Optional[dict[str, int]] = None,
        chat_full_done: Optional[bool] = None,
        comments: Optional[dict[str, list]] = None,
    ) -> None:
        with self._lock:
            if profiles is not None:
                # Keep newest MAX_PROFILES entries
                items = sorted(profiles.items(), key=lambda kv: kv[1][0], reverse=True)[:MAX_PROFILES]
                self.profiles = dict(items)
            if conv_updated is not None:
                self.conv_updated = {str(k): int(v or 0) for k, v in conv_updated.items()}
            if chat_full_done is not None:
                self.chat_full_done = bool(chat_full_done)
            if comments is not None:
                if len(comments) > MAX_COMMENT_MOMENTS:
                    keep = sorted(
                        comments.items(),
                        key=lambda kv: max((r.get("createdAt") or 0 for r in kv[1]), default=0),
                        reverse=True,
                    )[:MAX_COMMENT_MOMENTS]
                    self.comments = {k: list(v) for k, v in keep}
                else:
                    self.comments = {k: list(v) for k, v in comments.items()}

            payload = {
                "profiles": {uid: {"at": at, "user": user} for uid, (at, user) in self.profiles.items()},
                "conv_updated": self.conv_updated,
                "chat_full_done": self.chat_full_done,
                "comments": self.comments,
            }
            tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp")
            try:
                tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, self.path)
            except BaseException:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
                raise
        state_sync.mark_dirty()
