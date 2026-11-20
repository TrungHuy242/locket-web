"""Notification aggregation (reactions, replies, messages, friend events) for LiveProvider."""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

from ..notifications import NotificationState, get_notification_state
from .base import AuthExpired, ProviderError
from .live_common import LABELS, proxied, to_ms

log = logging.getLogger(__name__)


class NotificationsMixin:
    # Locket has no notification inbox API: on the iPhone, notifications are push messages. The list is
    # assembled from the same real events those pushes announce - reactions on my moments, replies to my
    # moments, messages, reactions to my messages, friend requests / new friends.
    NOTIF_DAYS = 30
    NOTIF_TTL = 90

    @property
    def notif_state(self) -> NotificationState:
        with self._lock:
            if self._notif_state is None:
                self._notif_state = get_notification_state(self.uid)
            return self._notif_state

    def _notif_reactions(self, since_ms: int):
        own = [e for e in self.store.all()
               if e.get("owner") == self.uid and (e.get("createdAt") or 0) >= since_ms and not e.get("approx")]
        own.sort(key=lambda e: -(e.get("createdAt") or 0))

        def fetch(entry):
            try:
                return entry, self._firestore_list(f"moments/{entry['id']}/reactions", page_size=200, max_docs=400)
            except AuthExpired:
                raise
            except ProviderError:
                return entry, None

        items, failed = [], 0
        for entry, docs in self._pool.map(fetch, own[:24]):
            if docs is None:
                failed += 1
                continue
            by_user: dict = {}
            for d in docs:
                f = d.get("fields", {})
                uid = f.get("user", {}).get("stringValue")
                emoji = f.get("string", {}).get("stringValue")
                at = to_ms(f.get("created_at", {}).get("timestampValue"))
                if uid and emoji and uid != self.uid:
                    by_user.setdefault(uid, []).append((at, emoji))
            for uid, rows in by_user.items():
                rows.sort()
                at = rows[-1][0] or entry.get("createdAt") or 0
                items.append({"id": f"reaction:{entry['id']}:{uid}:{at}", "type": "reaction", "createdAt": at,
                              "uid": uid, "emoji": "".join(e for _, e in rows)[-12:], "count": len(rows),
                              "momentId": entry["id"]})
        return items, failed

    def _notif_messages(self, convs: list, since_ms: int):
        def fetch(conv):
            try:
                return conv, self._message_page(conv["id"], None, 40)
            except AuthExpired:
                raise
            except ProviderError:
                return conv, None

        items, failed = [], 0
        for conv, docs in self._pool.map(fetch, convs):
            if docs is None:
                failed += 1
                continue
            peer = conv["peer"]["uid"]
            last_read = conv.get("lastReadAt") or 0
            chat = None
            for d in docs:                                     # newest first
                f = d.get("fields", {})
                msg_id = d["name"].rsplit("/", 1)[-1]
                sender = f.get("sender", {}).get("stringValue", "")
                at = to_ms(f.get("created_at", {}).get("timestampValue"))
                text = f.get("body", {}).get("stringValue", "").replace("\u200b", "").strip()
                if sender == self.uid:
                    for r in f.get("reactions", {}).get("arrayValue", {}).get("values", []):
                        rf = r.get("mapValue", {}).get("fields", {})
                        who = rf.get("sender", {}).get("stringValue")
                        emoji = rf.get("emoji", {}).get("stringValue")
                        r_at = to_ms(rf.get("created_at", {}).get("timestampValue")) or at
                        if who and who != self.uid and emoji and r_at >= since_ms:
                            items.append({"id": f"mreact:{msg_id}:{who}:{r_at}", "type": "message_reaction",
                                          "createdAt": r_at, "uid": who, "emoji": emoji, "text": text,
                                          "peer": peer, "conversationId": conv["id"]})
                    continue
                if at < since_ms or sender != peer:
                    continue
                deleted = bool(f.get("deleted_moment", {}).get("booleanValue"))
                moment = None if deleted else self._chat_moment(
                    f.get("reply_moment", {}).get("stringValue"), f.get("thumbnail_url", {}).get("stringValue"))
                if moment and moment["mine"] and text:
                    items.append({"id": f"comment:{msg_id}", "type": "comment", "createdAt": at, "uid": peer,
                                  "text": text, "momentId": moment["id"], "momentImage": moment["image"],
                                  "peer": peer, "conversationId": conv["id"], "locketRead": at <= last_read})
                elif chat is None:
                    chat = {"id": f"message:{msg_id}", "type": "message", "createdAt": at, "uid": peer,
                            "text": text, "count": conv.get("unread") or 0, "peer": peer,
                            "conversationId": conv["id"], "locketRead": at <= last_read,
                            "momentImage": (moment or {}).get("image")}
            if chat:
                items.append(chat)
        return items, failed

    def _notif_friends(self, since_ms: int):
        cols = ("friends", "incoming_friend_requests")
        friends, incoming = self._pool.map(self._relation_docs, cols)
        items = [{"id": f"request:{uid}:{at}", "type": "friend_request", "createdAt": at, "uid": uid}
                 for uid, at in incoming]
        items += [{"id": f"friend:{uid}:{at}", "type": "friend_added", "createdAt": at, "uid": uid}
                  for uid, at in friends if at and at >= since_ms]
        return items

    def _collect_notifications(self) -> dict:
        since = int((time.time() - self.NOTIF_DAYS * 86400) * 1000)
        convs = self.conversations()
        # the three sources run on their own executor: each of them fans out on self._pool, and nesting
        # those waits inside self._pool could exhaust it
        jobs = {"reactions": self._notif_pool.submit(self._notif_reactions, since),
                "messages": self._notif_pool.submit(self._notif_messages, convs, since),
                "friends": self._notif_pool.submit(self._notif_friends, since)}
        items, warnings = [], []
        for name, job in jobs.items():
            try:
                result = job.result()
            except AuthExpired:
                raise
            except ProviderError as exc:
                warnings.append(f"Không đọc được {LABELS[name]}: {exc.message}")
                continue
            if name == "friends":
                items += result
                continue
            rows, failed = result
            items += rows
            if failed:
                warnings.append(f"Locket từ chối đọc {failed} nguồn {LABELS[name]}.")
        items.sort(key=lambda n: n["createdAt"], reverse=True)
        return {"items": items[:120], "warnings": warnings, "at": time.time()}

    def notifications(self, refresh: bool = False) -> dict:
        cached = self._notif_cache
        if refresh or not cached:
            with self._notif_lock:
                if refresh or not self._notif_cache:
                    self._notif_cache = self._collect_notifications()
                cached = self._notif_cache
        elif time.time() - cached["at"] > self.NOTIF_TTL and self._notif_lock.acquire(blocking=False):
            # stale: answer at once with the last list and rebuild it in the background (~10 s of reads)
            def rebuild():
                try:
                    self._notif_cache = self._collect_notifications()
                except Exception as exc:       # keep the old list; the next poll tries again
                    log.warning("Notification background rebuild failed: %s", exc)
                finally:
                    self._notif_lock.release()
            threading.Thread(target=rebuild, name="notif-rebuild", daemon=True).start()
        state = self.notif_state
        users = self._users([n["uid"] for n in cached["items"]])
        out, unread = [], 0
        for n in cached["items"]:
            # replies and messages already read in the Locket app (on any device) are read here too
            is_unread = not state.is_read(n["id"], n["createdAt"]) and not n.get("locketRead")
            unread += is_unread
            entry = self.store.get(n.get("momentId")) if n.get("momentId") else None
            image = proxied(entry["image"]) if entry else n.get("momentImage")
            out.append({
                "id": n["id"], "type": n["type"], "createdAt": n["createdAt"], "unread": is_unread,
                "user": users.get(n["uid"]) or self._user_from_profile({}, n["uid"]),
                "emoji": n.get("emoji"), "text": n.get("text") or "", "count": n.get("count") or 0,
                "momentId": n.get("momentId"), "momentImage": image,
                "momentVideo": bool(entry and entry.get("video")),
                "peer": n.get("peer"), "conversationId": n.get("conversationId"),
            })
        return {"notifications": out, "unread": unread, "warnings": cached["warnings"],
                "updatedAt": int(cached["at"] * 1000), "windowDays": self.NOTIF_DAYS}

    def mark_notifications(self, ids: Optional[list] = None, everything: bool = False) -> dict:
        cached = self._notif_cache
        if not cached:
            with self._notif_lock:
                if not self._notif_cache:
                    self._notif_cache = self._collect_notifications()
                cached = self._notif_cache
        if everything:
            newest = max([n["createdAt"] for n in cached["items"]] + [int(time.time() * 1000)])
            self.notif_state.mark_all(newest)
        else:
            known = {n["id"]: n["createdAt"] for n in cached["items"]}
            self.notif_state.mark([(i, known[i]) for i in ids or [] if i in known])
        return self.notifications()
