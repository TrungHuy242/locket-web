"""Conversations, paged chat history, read receipts and realtime WS target for LiveProvider."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

import requests

from .base import AuthExpired, ProviderError
from .live_common import FIRESTORE, OWNER_IN_URL, proxied, to_ms


class ChatMixin:
    def conversations(self) -> list:
        # Read Firestore directly (with pagination) instead of the SDK helper, which only
        # returns the first page and swallows errors into an empty list.
        raw = []
        for doc in self._firestore_list(f"users/{self.uid}/conversations"):
            f = doc.get("fields", {})
            members = [v.get("stringValue") for v in f.get("members", {}).get("arrayValue", {}).get("values", [])]
            latest = f.get("latest_message", {}).get("mapValue", {}).get("fields", {})
            raw.append({
                "conversation_id": doc["name"].rsplit("/", 1)[-1],
                "peer_uid": next((m for m in members if m and m != self.uid), None),
                "unread_count": int(f.get("unread_count", {}).get("integerValue", 0) or 0),
                "is_read": f.get("is_read", {}).get("booleanValue", True),
                "last_read_at": f.get("last_read_at", {}).get("timestampValue"),
                "latest_message": {
                    "text": latest.get("body", {}).get("stringValue"),
                    "sender_uid": latest.get("sender", {}).get("stringValue"),
                    "timestamp": latest.get("created_at", {}).get("timestampValue") or f.get("last_updated", {}).get("timestampValue"),
                },
            })
        users = self._users([c.get("peer_uid") for c in raw])
        out = []
        conv_map = {}
        for c in raw:
            peer = c.get("peer_uid")
            if not peer:
                continue
            conv_map[peer] = c["conversation_id"]
            latest = c.get("latest_message") or {}
            out.append({
                "id": c["conversation_id"],
                "peer": users[peer],
                "unread": int(c.get("unread_count") or 0) or (0 if c.get("is_read", True) else 1),
                "lastText": (latest.get("text") or "").replace("\u200b", "").strip(),
                "lastMine": latest.get("sender_uid") == self.uid,
                "lastAt": to_ms(latest.get("timestamp")),
                "lastReadAt": to_ms(c.get("last_read_at")),
            })
        with self._state_lock:
            self._conv_by_peer.update(conv_map)
        out.sort(key=lambda c: c["lastAt"], reverse=True)
        return out

    def _conversation_id(self, peer_uid: str) -> Optional[str]:
        with self._state_lock:
            cid = self._conv_by_peer.get(peer_uid)
        if cid is None:
            self.conversations()
            with self._state_lock:
                cid = self._conv_by_peer.get(peer_uid)
        return cid

    def _message_page(self, cid: str, before_ms: Optional[int], limit: int) -> list:
        """One page of a conversation, newest first, strictly older than `before_ms` (Firestore runQuery cursor)."""
        query = {"from": [{"collectionId": "messages"}], "limit": limit,
                 "orderBy": [{"field": {"fieldPath": "created_at"}, "direction": "DESCENDING"}]}
        if before_ms:
            stamp = datetime.fromtimestamp(before_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
            query["where"] = {"fieldFilter": {"field": {"fieldPath": "created_at"}, "op": "LESS_THAN",
                                              "value": {"timestampValue": stamp}}}
        try:
            res = self._http.post(f"{FIRESTORE}/conversations/{cid}:runQuery", json={"structuredQuery": query},
                                  headers={"Authorization": f"Bearer {self._token()}"}, timeout=20)
        except requests.RequestException as exc:
            raise ProviderError("Không kết nối được máy chủ Locket.", 502) from exc
        if res.status_code == 401:
            raise AuthExpired()
        if res.status_code != 200:
            raise ProviderError(f"Locket từ chối đọc tin nhắn (HTTP {res.status_code}).", 502)
        return [row["document"] for row in res.json() if isinstance(row, dict) and row.get("document")]

    def _chat_moment(self, moment_id: Optional[str], thumb: Optional[str]) -> Optional[dict]:
        """The moment a message points at; video / owner / caption come from the synced history when known."""
        if not thumb and not moment_id:
            return None
        entry = self.store.get(moment_id) if moment_id else None
        owner = (entry or {}).get("owner")
        if not owner and thumb:
            match = OWNER_IN_URL.search(thumb)
            owner = match.group(1) if match else None
        return {
            "id": moment_id,
            "image": proxied((entry or {}).get("image") or thumb),
            "video": proxied((entry or {}).get("video")),
            "caption": ((entry or {}).get("overlay") or {}).get("text") or "",
            "createdAt": (entry or {}).get("createdAt") or 0,
            "mine": owner == self.uid,
        }

    def messages(self, peer_uid: str, limit: int = 50, before: Optional[int] = None) -> dict:
        """A page of messages with one friend, oldest -> newest. Pass `before` (ms) to page back in time."""
        cid = self._conversation_id(peer_uid)
        peer = self._user(peer_uid)
        if not cid:
            return {"conversationId": None, "peer": peer, "messages": [], "peerReadAt": 0, "peerDeliveredAt": 0,
                    "hasMore": False, "nextBefore": None}
        receipt_job = self._pool.submit(self._receipts, cid)
        docs = self._message_page(cid, before, limit)
        messages = []
        for doc in docs:
            f = doc.get("fields", {})
            sender = f.get("sender", {}).get("stringValue", "")
            reactions = [r.get("mapValue", {}).get("fields", {}).get("emoji", {}).get("stringValue")
                         for r in f.get("reactions", {}).get("arrayValue", {}).get("values", [])]
            messages.append({
                "id": doc["name"].rsplit("/", 1)[-1],
                "conversationId": cid,
                "mine": sender == self.uid,
                "text": f.get("body", {}).get("stringValue", "").replace("\u200b", "").strip(),
                "createdAt": to_ms(f.get("created_at", {}).get("timestampValue")),
                "reaction": next((r for r in reactions if r), None),
                "moment": None if f.get("deleted_moment", {}).get("booleanValue") else self._chat_moment(
                    f.get("reply_moment", {}).get("stringValue"), f.get("thumbnail_url", {}).get("stringValue")),
                "momentDeleted": bool(f.get("deleted_moment", {}).get("booleanValue")),
            })
        messages.sort(key=lambda m: m["createdAt"])
        read_at, delivered_at = receipt_job.result()
        has_more = len(docs) >= limit
        return {"conversationId": cid, "peer": peer, "messages": messages,
                "peerReadAt": read_at, "peerDeliveredAt": delivered_at, "hasMore": has_more,
                "nextBefore": messages[0]["createdAt"] if has_more and messages else None}

    def realtime_target(self, peer_uid: str):
        """Upstream URL + headers of Locket's chat WebSocket. Used only by the server-side relay:
        the token never reaches the browser."""
        token = self._token()
        url = f"wss://api.locketcamera.com/wss_v2/chat?otherUserId={quote(peer_uid, safe='')}&userId={quote(self.uid, safe='')}"
        headers = {"Authorization": f"Bearer {token}", "User-Agent": self.client.device.user_agent,
                   "x-ios-bundle-identifier": self.client.device.bundle_id}
        return url, headers

    def _receipts(self, cid: str):
        """Read / delivered timestamps of the other person, kept on my copy of the conversation document."""
        try:
            res = self._http.get(f"{FIRESTORE}/users/{self.uid}/conversations/{cid}",
                               headers={"Authorization": f"Bearer {self._token()}"}, timeout=10)
            if res.status_code != 200:
                return 0, 0
            f = res.json().get("fields", {})
            read = (f.get("other_last_read_message_created_at") or f.get("other_last_read_at") or {}).get("timestampValue")
            delivered = (f.get("other_last_delivered_message_created_at") or f.get("other_last_delivered_at") or {}).get("timestampValue")
            return to_ms(read), to_ms(delivered)
        except (requests.RequestException, ValueError):
            return 0, 0

    def send_message(self, peer_uid: str, text: str, moment_id: Optional[str]) -> dict:
        self._token()
        res = self.client.chat.send_message(peer_uid, text=text or None, moment_uid=moment_id)
        if not isinstance(res, dict) or res.get("error") or res.get("errors"):
            raise ProviderError("Không gửi được tin nhắn.", 502)
        cid = res.get("conversation_uid")
        with self._state_lock:
            if cid:
                self._conv_by_peer[peer_uid] = cid
            resolved_cid = cid or self._conv_by_peer.get(peer_uid)
            if moment_id and text:
                self._comments.setdefault(moment_id, []).append({
                    "id": res.get("message_uid") or res.get("msg_id") or res.get("client_token") or "", "sender": self.uid,
                    "peer": peer_uid, "cid": resolved_cid, "text": text,
                    "createdAt": int(time.time() * 1000), "reactions": []})
        return {
            "id": res.get("message_uid") or res.get("msg_id") or res.get("client_token"),
            "conversationId": resolved_cid,
            "mine": True, "text": text or "", "createdAt": int(time.time() * 1000),
            "reaction": None, "moment": None,
        }

    def mark_read(self, peer_uid, conversation_id, receipt) -> None:
        payload = {"send_read_receipt": bool(receipt), "other_user_id": peer_uid}
        with self._state_lock:
            cid = conversation_id or self._conv_by_peer.get(peer_uid)
        if cid:
            payload["conversation_uid"] = cid
        self._api("markAsRead", payload)

    def react_message(self, conversation_id, message_id, emoji) -> None:
        payload = {"conversation_id": conversation_id, "message_id": message_id}
        if emoji:
            self._api("sendChatMessageReaction", {**payload, "emoji": emoji})
        else:
            self._api("removeChatMessageReaction", payload)
        with self._state_lock:
            for rows in self._comments.values():
                for row in rows:
                    if row.get("id") == message_id:
                        row["reactions"] = [r for r in row.get("reactions", []) if r.get("sender") != self.uid]
                        if emoji:
                            row["reactions"].append({"sender": self.uid, "emoji": emoji, "createdAt": int(time.time() * 1000)})

    def delete_message(self, conversation_id, message_id) -> None:
        self._api("deleteChatMessage", {"conversation_uid": conversation_id, "message_uid": message_id})
        with self._state_lock:
            for mid, rows in list(self._comments.items()):
                self._comments[mid] = [r for r in rows if r.get("id") != message_id]
