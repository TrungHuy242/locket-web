"""Per-account read markers for the web's notification list.

Locket has no notification inbox API (its notifications are push messages sent to the phone), so the
list is assembled from real Locket data (reactions, replies, messages, friend requests). What Locket
does not store is which of those the user has already looked at on the web: that marker lives here,
next to the moment history, and never leaves the server.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time

from . import config, state_sync

MAX_IDS = 3000

_states: dict[str, "NotificationState"] = {}
_states_guard = threading.Lock()


def get_notification_state(uid: str) -> "NotificationState":
    """Return the process-wide NotificationState for an account so concurrent sessions stay in sync."""
    with _states_guard:
        state = _states.get(uid)
        if state is None:
            state = NotificationState(uid)
            _states[uid] = state
        return state


class NotificationState:
    def __init__(self, uid: str):
        folder = config.ACCOUNTS_DIR / hashlib.sha256(uid.encode()).hexdigest()[:32]
        folder.mkdir(parents=True, exist_ok=True)
        self.path = folder / "notifications.json"
        self._lock = threading.Lock()
        self.read_before = 0          # everything at or before this time (ms) counts as read
        self.read: dict = {}          # notification id -> its time (ms), read one by one
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            self.read_before = int(data.get("read_before") or 0)
            self.read = {str(k): int(v) for k, v in (data.get("read") or {}).items()}
        except (OSError, ValueError, TypeError, AttributeError):
            pass

    def is_read(self, item_id: str, created_at: int) -> bool:
        with self._lock:
            return created_at <= self.read_before or item_id in self.read

    def mark(self, items: list) -> None:
        """Mark (id, createdAt) pairs as read."""
        with self._lock:
            for item_id, created_at in items:
                if created_at > self.read_before:
                    self.read[item_id] = int(created_at)
            self._save()

    def mark_all(self, upto: int) -> None:
        with self._lock:
            self.read_before = max(self.read_before, int(upto))
            self.read = {k: v for k, v in self.read.items() if v > self.read_before}
            self._save()

    def _save(self) -> None:
        if len(self.read) > MAX_IDS:
            keep = sorted(self.read.items(), key=lambda kv: kv[1])[-MAX_IDS:]
            self.read = dict(keep)
        tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp")
        try:
            tmp.write_text(json.dumps({"read_before": self.read_before, "read": self.read}), encoding="utf-8")
            os.replace(tmp, self.path)
        except BaseException:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        state_sync.mark_dirty()
