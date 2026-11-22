"""Friends, requests, blocks and friend profile lookups for LiveProvider."""
from __future__ import annotations

import time
from typing import Optional

from .base import ProviderError
from .live_common import to_ms


class FriendsMixin:
    FRIENDS_TTL = 30

    def _invalidate_friends(self) -> None:
        with self._state_lock:
            self._friends_cache = None

    def _uids_in(self, collection: str) -> list:
        docs = self._firestore_list(f"users/{self.uid}/{collection}")
        return [d["name"].rsplit("/", 1)[-1] for d in docs if d.get("name")]

    def _relation_docs(self, collection: str) -> list:
        """(uid, timestamp ms) for each doc of one of my relationship collections."""
        out = []
        for d in self._firestore_list(f"users/{self.uid}/{collection}"):
            f = d.get("fields", {})
            stamp = next((v.get("timestampValue") for _, v in f.items() if "timestampValue" in v), None)
            out.append((d["name"].rsplit("/", 1)[-1], to_ms(stamp)))
        return out

    def friends(self, force: bool = False) -> dict:
        """Friends, requests and blocked users, read straight from my Locket relationship collections."""
        if not force:
            with self._state_lock:
                hit = self._friends_cache
            if hit and time.time() - hit[0] < self.FRIENDS_TTL:
                return hit[1]
        self._token()
        cols = ("friends", "incoming_friend_requests", "outgoing_friend_requests", "blocked_users")
        groups = dict(zip(cols, self._pool.map(self._relation_docs, cols)))
        users = self._users([uid for rows in groups.values() for uid, _ in rows])

        def people(col):
            return [{**users[uid], "since": at} for uid, at in groups[col]]

        result = {
            "friends": sorted(people("friends"), key=lambda u: u["name"].lower()),
            "incoming": sorted(people("incoming_friend_requests"), key=lambda u: -u["since"]),
            "outgoing": sorted(people("outgoing_friend_requests"), key=lambda u: -u["since"]),
            "blocked": sorted(people("blocked_users"), key=lambda u: u["name"].lower()),
        }
        with self._state_lock:
            self._friends_cache = (time.time(), result)
        return result

    def friend_profile(self, uid: str) -> dict:
        """Everything Locket lets me know about one person, plus what my synced history holds of them."""
        res = self._api("fetchUserV2", {"user_uid": uid})
        raw = res.get("data", res) if isinstance(res, dict) else {}
        user = self._user_from_profile(raw, uid)
        with self._state_lock:
            self._profiles[uid] = (time.time(), user)
        relation, since = "none", 0
        if uid == self.uid:
            relation = "self"
        else:
            # Read only the relationship ids (without fetching every friend's profile)
            cols = (("friends", "friend"), ("incoming_friend_requests", "incoming"),
                    ("outgoing_friend_requests", "outgoing"), ("blocked_users", "blocked"))
            groups = dict(zip((c for c, _ in cols), self._pool.map(self._relation_docs, (c for c, _ in cols))))
            for col, name in cols:
                hit = next((at for u_id, at in groups[col] if u_id == uid), None)
                if hit is not None:
                    relation, since = name, hit or 0
                    break
        theirs = [m for m in self.store.all() if m.get("owner") == uid]
        theirs.sort(key=lambda m: m.get("createdAt") or 0, reverse=True)
        users = {uid: user, self.uid: self.me()}
        with self._state_lock:
            comments = sum(len(self._comments.get(m["id"], ())) for m in theirs)
        return {
            "user": {**user, "badge": raw.get("badge") if isinstance(raw, dict) else None,
                     "temp": bool(raw.get("temp")) if isinstance(raw, dict) else False},
            "relation": relation,
            "since": since,                     # Locket's shared_history_on / request time
            "stats": {
                "moments": len(theirs),
                "videos": sum(1 for m in theirs if m.get("video")),
                "first": theirs[-1].get("createdAt") if theirs else 0,
                "last": theirs[0].get("createdAt") if theirs else 0,
                "reactionsSent": sum(len(self.store.get_sent_reactions(m["id"])) for m in theirs),
                "comments": comments,
            },
            "recent": [self._public(m, users) for m in theirs[:12]],
            "inviteLink": f"https://locket.cam/{user['username']}" if user.get("username") else None,
        }

    def lookup(self, username: str) -> Optional[dict]:
        self._token()
        try:
            profile = self.client.user.get_profile_by_username(username)
        except Exception:
            return None
        if not isinstance(profile, dict) or not profile.get("uid"):
            return None
        user = self._user_from_profile(profile)
        with self._state_lock:
            self._profiles[user["uid"]] = (time.time(), user)
        return user

    def send_request(self, uid: str) -> None:
        self._token()
        res = self.client.friends.send_request(uid)
        if not isinstance(res, dict):
            raise ProviderError("Không gửi được lời mời kết bạn.", 502)
        err = res.get("error") or res.get("errors")
        if isinstance(err, dict) and err.get("status") == "UNAUTHENTICATED":
            # Every other call with the same token succeeds; Locket refuses this one from outside its app
            # (most likely its App Check device attestation). Not something to work around.
            raise ProviderError("Locket không cho gửi lời mời kết bạn từ web (máy chủ trả UNAUTHENTICATED). "
                                "Hãy gửi lời mời trong ứng dụng Locket, hoặc gửi liên kết mời của bạn cho người đó.", 403)
        if err:
            raise ProviderError(f"Không gửi được lời mời kết bạn: {err}", 502)
        self._invalidate_friends()

    def accept_request(self, uid: str) -> None:
        self._api("acceptFriendRequest", {
            "user_uid": uid, "during_signup": False,
            "ios_version": f"{self.client.device.app_version}.{self.client.device.build_number}",
        })
        self._invalidate_friends()

    def delete_request(self, uid: str, direction: str) -> None:
        """Decline an incoming request or withdraw one I sent (Locket's deleteFriendRequest)."""
        self._api("deleteFriendRequest", {"user_uid": uid, "direction": direction})
        self._invalidate_friends()

    def remove_friend(self, uid: str) -> None:
        self._api("removeFriend", {"user_uid": uid})
        self._invalidate_friends()

    def block(self, uid: str) -> None:
        self._api("blockFriend", {"user_uid": uid})
        self._invalidate_friends()

    def unblock(self, uid: str) -> None:
        self._api("unblockUser", {"user_uid": uid})
        self._invalidate_friends()
