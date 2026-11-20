"""Per-account moment history, persisted on the server.

Locket's API only ever hands out the *latest* moment of each person, so - like the phone app,
which keeps its history on the device - every moment this account is allowed to see is recorded
here as it is synced. The file lives under backend/data/accounts and never leaves the server.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import Optional

from . import config, state_sync

_stores: dict[str, "MomentStore"] = {}
_stores_guard = threading.Lock()


def get_moment_store(uid: str) -> "MomentStore":
    """Return the process-wide MomentStore for an account so concurrent sessions share one lock."""
    with _stores_guard:
        store = _stores.get(uid)
        if store is None:
            store = MomentStore(uid)
            _stores[uid] = store
        return store


class MomentStore:
    def __init__(self, uid: str):
        folder = config.ACCOUNTS_DIR / hashlib.sha256(uid.encode()).hexdigest()[:32]
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "moments.json"
        self._lock = threading.RLock()
        self._dirty = False
        self.sync_token: Optional[str] = None
        self.items: dict = {}
        # reactions this account sent to friends' moments. Locket lets only a moment's owner read its
        # reactions, so the sender keeps its own record (like the iPhone app does on the device).
        self.sent_reactions: dict = {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self.sync_token = data.get("sync_token")
            self.sent_reactions = data.get("sent_reactions") or {}
            self.items = {m["id"]: m for m in data.get("moments", []) if m.get("id")}
        except (OSError, ValueError):
            pass

    def has_any(self) -> bool:
        with self._lock:
            return bool(self.items)

    def get(self, moment_id: str) -> Optional[dict]:
        with self._lock:
            item = self.items.get(moment_id)
            return dict(item) if item is not None else None

    def get_sent_reactions(self, moment_id: str) -> list:
        with self._lock:
            return list(self.sent_reactions.get(moment_id, ()))

    def has_exact(self, moment_id: str) -> bool:
        with self._lock:
            item = self.items.get(moment_id)
            return bool(item) and not item.get("approx")

    def upsert(self, entry: dict) -> bool:
        """Insert or refresh a moment. Exact data from the feed always wins over data inferred from chat."""
        with self._lock:
            current = self.items.get(entry["id"])
            if current is None:
                self.items[entry["id"]] = entry
                self._dirty = True
                return True
            if entry.get("approx"):
                if current.get("approx") and entry["createdAt"] and entry["createdAt"] < (current["createdAt"] or 1e18):
                    current["createdAt"] = entry["createdAt"]
                    self._dirty = True
                return False
            if current != entry:
                self.items[entry["id"]] = entry
                self._dirty = True
            return False

    def patch(self, moment_id: str, **fields) -> None:
        """Update some fields of a stored moment (used for data recovered from Storage metadata)."""
        with self._lock:
            item = self.items.get(moment_id)
            if item is None:
                return
            for key, value in fields.items():
                if item.get(key) != value:
                    item[key] = value
                    self._dirty = True

    def add_sent_reaction(self, moment_id: str, emoji: str, at: int) -> None:
        with self._lock:
            self.sent_reactions.setdefault(moment_id, []).append({"emoji": emoji, "at": at})
            self._dirty = True

    def remove(self, moment_id: str) -> None:
        with self._lock:
            removed_item = self.items.pop(moment_id, None) is not None
            removed_react = self.sent_reactions.pop(moment_id, None) is not None
            if removed_item or removed_react:
                self._dirty = True

    def set_token(self, token: Optional[str]) -> None:
        with self._lock:
            if token and token != self.sync_token:
                self.sync_token = token
                self._dirty = True

    def owners(self) -> set:
        with self._lock:
            return {m["owner"] for m in self.items.values() if m.get("owner")}

    def all(self) -> list:
        with self._lock:
            return list(self.items.values())

    def page(self, before: Optional[str], limit: int, items: Optional[list] = None):
        """Newest first. `before` is "<createdAt>_<id>" of the last item of the previous page.
        `items` pages a filtered subset instead of the whole history."""
        with self._lock:
            source = self.items.values() if items is None else items
            ordered = sorted(source, key=lambda m: (m.get("createdAt") or 0, m["id"]), reverse=True)
            total = len(self.items) if items is None else len(items)
        if before:
            stamp, _, mid = before.partition("_")
            try:
                edge = (int(stamp), mid)
            except ValueError:
                edge = None
            if edge:
                ordered = [m for m in ordered if ((m.get("createdAt") or 0), m["id"]) < edge]
        chunk = ordered[:limit]
        more = len(ordered) > limit
        cursor = f"{chunk[-1].get('createdAt') or 0}_{chunk[-1]['id']}" if chunk and more else None
        return chunk, cursor, total

    def save(self) -> None:
        with self._lock:
            if not self._dirty:
                return
            tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp")
            try:
                tmp.write_text(json.dumps({"sync_token": self.sync_token, "moments": list(self.items.values()),
                                           "sent_reactions": self.sent_reactions},
                                          ensure_ascii=False), encoding="utf-8")
                os.replace(tmp, self.path)
            except BaseException:
                try:
                    tmp.unlink(missing_ok=True)
                except OSError:
                    pass
                raise
            self._dirty = False
        state_sync.mark_dirty()
