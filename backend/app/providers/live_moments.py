"""Moments, feed sync, memories search, comments and activity for LiveProvider."""
from __future__ import annotations

import logging
import re
import threading
import time
from typing import Optional
from urllib.parse import quote, unquote, urlparse

import requests

from .. import config
from ..video import normalize_for_locket
from .base import AuthExpired, ProviderError
from .live_common import (
    OWNER_IN_URL,
    STORAGE,
    THUMB_NAME,
    fold_text,
    local_date,
    parse_overlay,
    proxied,
    public_overlay,
    to_ms,
)

config.ensure_sdk_path()
from locketlam import AuthenticationError, LocketAPIError, StorageUploadError  # noqa: E402

log = logging.getLogger(__name__)


class MomentsMixin:
    _overlay = staticmethod(parse_overlay)
    _public_overlay = staticmethod(public_overlay)
    _fold = staticmethod(fold_text)
    _local_date = staticmethod(local_date)

    def _entry(self, raw: dict, approx: bool = False) -> Optional[dict]:
        mid = raw.get("canonical_uid") or raw.get("moment_uid") or raw.get("id")
        owner = raw.get("user") or raw.get("user_uid") or ""
        if isinstance(owner, dict):
            owner = owner.get("uid") or ""
        image = raw.get("thumbnail_url") or raw.get("image_url")
        if not mid or not image:
            return None
        suggested = raw.get("suggested_reactions")
        return {"id": mid, "owner": owner, "image": image, "video": raw.get("video_url"),
                "overlay": self._overlay(raw), "createdAt": to_ms(raw.get("date") or raw.get("created_at")),
                "approx": approx,
                "suggested": [e for e in suggested if isinstance(e, str)][:4] if isinstance(suggested, list) else []}

    def _public(self, entry: dict, users: dict) -> dict:
        owner = entry.get("owner") or ""
        overlay = entry.get("overlay")
        with self._state_lock:
            comment_count = len(self._comments.get(entry["id"], ()))
        return {
            "id": entry["id"],
            "user": users.get(owner) or self._user_from_profile({}, owner),
            "image": proxied(entry["image"]),
            "video": proxied(entry.get("video")),
            "caption": (overlay or {}).get("text") or "",
            "overlay": self._public_overlay(overlay),
            "createdAt": entry.get("createdAt") or 0,
            "mine": owner == self.uid,
            "approxDate": bool(entry.get("approx")),
            # moments known only from chat: Locket never exposes their caption
            "captionKnown": not (entry.get("fromChat") or entry.get("approx")),
            "suggestedReactions": entry.get("suggested") or [],
            "commentCount": comment_count,
            "myReactions": [r["emoji"] for r in self.store.get_sent_reactions(entry["id"])],
        }

    def _latest(self, excluded=None, sync_token=None, tolerant=False):
        """One getLatestMomentV2 call -> (response, [raw moments])."""
        payload = {"should_count_missed_moments": True}
        if excluded:
            payload["excluded_users"] = list(excluded)
        if sync_token:
            payload["sync_token"] = sync_token
        if tolerant:
            self._token()
            res = self.client.post_api("getLatestMomentV2", payload)
            if not isinstance(res, dict) or res.get("status") not in (200, 304):
                return None, []
        else:
            res = self._api("getLatestMomentV2", payload)
        data = res.get("data") or []
        if isinstance(data, dict):
            data = data.get("moments") or []
        return res, [m for m in data if isinstance(m, dict) and m.get("canonical_uid")]

    @staticmethod
    def _owner_of(raw: dict) -> str:
        owner = raw.get("user") or ""
        return owner.get("uid", "") if isinstance(owner, dict) else owner

    def _sync_latest_full(self) -> None:
        """Latest moment of every author this account can see."""
        authors = set(self._uids_in("friends")) | self.store.owners() | {self.uid}
        authors.discard("")
        pending = set(authors)
        for _ in range(4):
            def fetch(author, known=frozenset(authors)):
                return author, self._latest(excluded=sorted(known - {author}))[1]
            discovered, retry = set(), set()
            for author, moments in self._pool.map(fetch, sorted(pending)):
                for raw in moments:
                    entry = self._entry(raw)
                    if entry:
                        self.store.upsert(entry)
                    owner = self._owner_of(raw)
                    if owner and owner not in authors:
                        discovered.add(owner)
                    if owner != author:
                        retry.add(author)
            if not discovered:
                break
            authors |= discovered
            pending = retry | discovered
        # People who are not in the friends list any more can still have a visible moment.
        for _ in range(12):
            _, moments = self._latest(excluded=sorted(authors))
            if not moments:
                break
            entry = self._entry(moments[0])
            if entry:
                self.store.upsert(entry)
            owner = self._owner_of(moments[0])
            if not owner or owner in authors:
                break
            authors.add(owner)
        res, _ = self._latest()
        self.store.set_token(res.get("sync_token"))

    def _sync_latest_delta(self) -> bool:
        """Cheap check with the sync token; walks down from the newest moment until a known one."""
        res, moments = self._latest(sync_token=self.store.sync_token, tolerant=True)
        if res is None:
            return False                      # token rejected: caller falls back to a full sync
        if res.get("status") == 304 or not moments:
            return True
        excluded = []
        for _ in range(40):
            known = False
            for raw in moments:
                known = known or self.store.has_exact(raw["canonical_uid"])
                entry = self._entry(raw)
                if entry:
                    self.store.upsert(entry)
                owner = self._owner_of(raw)
                if owner and owner not in excluded:
                    excluded.append(owner)
            if known or not excluded:
                break
            _, moments = self._latest(excluded=excluded)
            if not moments:
                break
        fresh, _ = self._latest()
        self.store.set_token(fresh.get("sync_token"))
        return True

    def _scan_conv_incremental(self, cid: str, since_ms: int) -> list:
        """Read only messages newer than `since_ms` (with a 2-minute overlap for clock skew)."""
        cutoff = max(0, since_ms - 120_000)
        docs: list = []
        before: Optional[int] = None
        for _ in range(20):
            page = self._message_page(cid, before, 100)
            if not page:
                break
            docs.extend(page)
            oldest = min((to_ms(d.get("fields", {}).get("created_at", {}).get("timestampValue")) for d in page), default=0)
            if len(page) < 100 or not oldest or oldest <= cutoff:
                break
            before = oldest
        return docs

    def _sync_chat_moments(self) -> None:
        """Every chat message references the moment it replies to: record those moments too.

        The first scan reads all conversations in full so historical moments and comments are recovered;
        later scans check each conversation's `last_updated` timestamp and only pull new pages from
        conversations that actually changed.
        """
        with self._state_lock:
            self._sync_warnings.discard("chat")
            full_mode = not self._chat_full_done
            prev_updated = dict(self._conv_updated)

        docs = self._firestore_list(
            f"users/{self.uid}/conversations",
            mask=("members", "last_updated", "latest_message"),
        )
        cids = []
        peers: dict[str, str] = {}
        conv_updated: dict[str, int] = {}
        for d in docs:
            name = d.get("name")
            if not name:
                continue
            cid = name.rsplit("/", 1)[-1]
            cids.append(cid)
            f = d.get("fields", {})
            members = [v.get("stringValue") for v in f.get("members", {}).get("arrayValue", {}).get("values", [])]
            peers[cid] = next((m for m in members if m and m != self.uid), "")
            latest = f.get("latest_message", {}).get("mapValue", {}).get("fields", {})
            conv_updated[cid] = max(
                to_ms(f.get("last_updated", {}).get("timestampValue")),
                to_ms(latest.get("created_at", {}).get("timestampValue")),
            )

        if full_mode:
            targets = [(cid, True, 0) for cid in cids]
        else:
            targets = []
            for cid in cids:
                prev_ms = prev_updated.get(cid)
                cur_ms = conv_updated.get(cid, 0)
                if prev_ms is None:
                    targets.append((cid, True, 0))
                elif cur_ms == 0 or cur_ms > prev_ms:
                    targets.append((cid, False, prev_ms))

        if not targets:
            return

        def scan(target):
            cid, is_full, since_ms = target
            try:
                if is_full:
                    msgs = self._firestore_list(
                        f"conversations/{cid}/messages", page_size=300, max_docs=200000,
                        mask=("reply_moment", "thumbnail_url", "created_at", "deleted_moment", "body", "sender", "reactions"))
                else:
                    msgs = self._scan_conv_incremental(cid, since_ms)
                return cid, is_full, msgs, True
            except AuthExpired:
                raise
            except ProviderError:
                with self._state_lock:
                    self._sync_warnings.add("chat")
                return cid, is_full, [], False

        found: dict = {}
        full_comments: dict = {}
        had_failure = False
        now = time.time()
        scanned_results = list(self._pool.map(scan, targets))

        for cid, is_full, messages, ok in scanned_results:
            if not ok:
                had_failure = True
                continue
            conv_fresh_comments: dict = {}
            window_start = None
            for doc in messages:
                f = doc.get("fields", {})
                at = to_ms(f.get("created_at", {}).get("timestampValue"))
                if at and (window_start is None or at < window_start):
                    window_start = at
                mid = f.get("reply_moment", {}).get("stringValue")
                thumb = f.get("thumbnail_url", {}).get("stringValue")
                body = f.get("body", {}).get("stringValue", "").replace("\u200b", "").strip()
                if mid and body:
                    row = self._comment_row(cid, peers.get(cid, ""), doc)
                    if full_mode:
                        full_comments.setdefault(mid, []).append(row)
                    else:
                        conv_fresh_comments.setdefault(mid, []).append(row)
                if not mid or not thumb:
                    continue
                if f.get("deleted_moment", {}).get("booleanValue"):
                    found[mid] = None
                    continue
                if mid in found and found[mid] is None:
                    continue
                match = OWNER_IN_URL.search(thumb)
                prev = found.get(mid)
                if prev is None or (at and at < prev["createdAt"]):
                    found[mid] = {"id": mid, "owner": match.group(1) if match else "", "image": thumb, "video": None,
                                  "overlay": None, "createdAt": at, "approx": True, "fromChat": True}

            if not full_mode:
                with self._state_lock:
                    if is_full:
                        touched = set(conv_fresh_comments) | {mid for mid, rows in self._comments.items() if any(r.get("cid") == cid for r in rows)}
                        for mid in touched:
                            kept = [r for r in self._comments.get(mid, []) if r.get("cid") != cid]
                            rows = kept + conv_fresh_comments.get(mid, [])
                            rows.sort(key=lambda r: r["createdAt"])
                            if rows:
                                self._comments[mid] = rows
                            else:
                                self._comments.pop(mid, None)
                    elif messages and window_start is not None:
                        touched = set(conv_fresh_comments) | {mid for mid, rows in self._comments.items() if any(r.get("cid") == cid for r in rows)}
                        for mid in touched:
                            kept = [r for r in self._comments.get(mid, []) if r.get("cid") != cid or r["createdAt"] < window_start]
                            rows = kept + conv_fresh_comments.get(mid, [])
                            rows.sort(key=lambda r: r["createdAt"])
                            if rows:
                                self._comments[mid] = rows
                            else:
                                self._comments.pop(mid, None)
                    self._comments_at[cid] = now
                    self._conv_updated[cid] = conv_updated.get(cid, 0)

        for mid, entry in found.items():
            if entry is None:
                self.store.remove(mid)
            elif entry["owner"]:
                self.store.upsert(entry)

        if full_mode:
            for rows in full_comments.values():
                rows.sort(key=lambda c: c["createdAt"])
            with self._state_lock:
                self._comments = full_comments
                for cid, _, _, ok in scanned_results:
                    if ok:
                        self._comments_at[cid] = now
                        self._conv_updated[cid] = conv_updated.get(cid, 0)
                if not had_failure:
                    self._chat_full_done = True

    # --- own moments: recover video + exact time from Firebase Storage ---------------
    @staticmethod
    def _storage_object(url: str):
        m = re.match(r"/v0/b/([^/]+)/o/(.+)", urlparse(url or "").path)
        return (m.group(1), unquote(m.group(2))) if m else (None, None)

    def _storage_meta(self, bucket: str, name: str) -> Optional[dict]:
        """Metadata of a Storage object, None if it does not exist or is not ours to read."""
        res = self._http.get(f"{STORAGE}/{bucket}/o/{quote(name, safe='')}",
                             headers={"Authorization": f"Firebase {self._token()}"}, timeout=15)
        if res.status_code == 200:
            return res.json()
        if res.status_code in (403, 404):
            return None
        raise ProviderError(f"Firebase Storage trả lỗi HTTP {res.status_code}.", 502)

    def _unchecked_own(self) -> list:
        return [m for m in self.store.all()
                if m.get("owner") == self.uid and not m.get("storageChecked")]

    def _enrich_own(self) -> None:
        todo = self._unchecked_own()
        if not todo:
            return

        def work(entry):
            bucket, name = self._storage_object(entry.get("image"))
            match = THUMB_NAME.match(name or "")
            if bucket != "locket-img" or not match:
                return entry["id"], {"storageChecked": True}
            try:
                fields = {"storageChecked": True}
                thumb = self._storage_meta(bucket, name)
                if thumb and thumb.get("timeCreated") and entry.get("approx"):
                    fields.update(createdAt=to_ms(thumb["timeCreated"]), approx=False, fromChat=True)
                if not entry.get("video"):
                    vname = f"{match.group(1)}/videos/{match.group(2)}.mp4"
                    meta = self._storage_meta("locket-video", vname)
                    token = ((meta or {}).get("downloadTokens") or "").split(",")[0]
                    if token and str(meta.get("contentType", "")).startswith("video/"):
                        fields["video"] = f"{STORAGE}/locket-video/o/{quote(vname, safe='')}?alt=media&token={token}"
                return entry["id"], fields
            except (ProviderError, requests.RequestException):
                return entry["id"], None          # transient: try again on the next sync

        failed = 0
        for mid, fields in self._pool.map(work, todo):
            if fields is None:
                failed += 1
            else:
                self.store.patch(mid, **fields)
        with self._state_lock:
            if failed:
                self._sync_warnings.add("storage")
            else:
                self._sync_warnings.discard("storage")
        self.store.save()

    def _import_own_posts(self) -> None:
        # moments posted from this web app are remembered by the SDK next to the session file
        for item in self.client.moments._load_history():
            entry = self._entry({**item, "user": self.uid})
            if entry and not self.store.has_exact(entry["id"]):
                if item.get("caption"):
                    entry["overlay"] = {"text": item["caption"], "icon": None, "colors": [],
                                        "textColor": "#FFFFFF", "type": "standard"}
                self.store.upsert(entry)

    def _background(self, full: bool, chat: bool) -> None:
        """Slow parts of the sync run behind the response; the feed reports `syncing` meanwhile."""
        def run():
            try:
                if full:
                    self._sync_latest_full()
                if chat:
                    self._sync_chat_moments()
                self._enrich_own()
                self.store.save()
                with self._state_lock:
                    self._sync_error = None
            except ProviderError as exc:
                log.warning("Background sync failed: %s", exc.message)
                with self._state_lock:
                    self._sync_error = exc.message
                    self._full_synced = self._full_synced and not full
                    self._chat_at = 0.0
            except Exception:
                log.exception("Unexpected error during background sync")
                with self._state_lock:
                    self._sync_error = "Đồng bộ lịch sử từ Locket thất bại."
                    self._full_synced = self._full_synced and not full
                    self._chat_at = 0.0
            finally:
                with self._state_lock:
                    self._syncing = False

        with self._state_lock:
            self._syncing = True
        threading.Thread(target=run, name="locket-sync", daemon=True).start()

    def _sync(self, force: bool = False) -> None:
        with self._state_lock:
            if self._syncing:
                return
            full_synced = self._full_synced
            full_at = self._full_at
            chat_at = self._chat_at
            delta_at = self._delta_at
        now = time.time()
        need_full = not full_synced or (force and now - full_at > 45)
        need_chat = now - chat_at > 300 or (force and now - chat_at > 45)
        if need_full:
            self._import_own_posts()
            if self.store.has_any():
                # Returning account: serve the stored history now and refresh behind it.
                with self._state_lock:
                    self._full_synced, self._full_at, self._delta_at = True, now, now
                    if need_chat:
                        self._chat_at = now
                self._background(full=True, chat=need_chat)
                return
            self._sync_latest_full()
            with self._state_lock:
                self._full_synced, self._full_at, self._delta_at = True, now, now
        elif now - delta_at > 6:
            if not self._sync_latest_delta():
                self._sync_latest_full()
                with self._state_lock:
                    self._full_at = now
            with self._state_lock:
                self._delta_at = now
        if need_chat:
            with self._state_lock:
                self._chat_at = now
            self._background(full=False, chat=True)
        elif self._unchecked_own():
            self._background(full=False, chat=False)
        self.store.save()

    def feed(self, before: Optional[str] = None, limit: int = 30, refresh: bool = False) -> dict:
        with self._feed_lock:
            if before is None:
                self._sync(force=refresh)
            chunk, cursor, total = self.store.page(before, limit)
        users = self._users([m["owner"] for m in chunk] + [self.uid])
        users[self.uid] = self.me()
        with self._state_lock:
            syncing = self._syncing
            sync_error = self._sync_error
            warnings = sorted(self._sync_warnings)
        return {
            "moments": [self._public(m, users) for m in chunk],
            "nextCursor": cursor,
            "total": total,
            "syncing": syncing,
            "syncError": sync_error,
            "warnings": warnings,
        }

    # --- memories: the whole synced history, filtered and searched on the server ---
    def memories(self, before: Optional[str] = None, limit: int = 60, kind: str = "all", author: Optional[str] = None,
                 q: str = "", year: Optional[int] = None, month: Optional[int] = None, tz_minutes: int = 0) -> dict:
        with self._feed_lock:
            if before is None:
                self._sync()
            items = self.store.all()
        users = self._users([m["owner"] for m in items] + [self.uid])
        users[self.uid] = self.me()
        author = self.uid if author == "me" else author
        terms = self._fold(q).split()

        def text_of(m):
            o = m.get("overlay") or {}
            music = o.get("music") or {}
            u = users.get(m["owner"]) or {}
            return self._fold(" ".join(filter(None, [o.get("text"), music.get("title"), music.get("artist"),
                                                     u.get("name"), u.get("username"), "ban" if m["owner"] == self.uid else ""])))

        # Apply the text query once instead of re-folding every moment in each facet pass.
        pool = [m for m in items if all(t in text_of(m) for t in terms)] if terms else items

        def keep(m, skip=()):
            if "kind" not in skip and kind == "video" and not m.get("video"):
                return False
            if "kind" not in skip and kind == "photo" and m.get("video"):
                return False
            if "author" not in skip and author and m["owner"] != author:
                return False
            if "period" not in skip and year:
                d = self._local_date(m.get("createdAt"), tz_minutes)
                if d.year != year or (month and d.month != month):
                    return False
            return True

        matched = [m for m in pool if keep(m)]
        chunk, cursor, total = self.store.page(before, limit, items=matched)

        # facets: each one counts what the OTHER filters leave, so every option shows how many it would give
        years: dict = {}
        for m in (x for x in pool if keep(x, skip=("period",))):
            d = self._local_date(m.get("createdAt"), tz_minutes)
            entry = years.setdefault(d.year, {"year": d.year, "count": 0, "months": {}})
            entry["count"] += 1
            entry["months"][d.month] = entry["months"].get(d.month, 0) + 1
        authors: dict = {}
        for m in (x for x in pool if keep(x, skip=("author",))):
            authors[m["owner"]] = authors.get(m["owner"], 0) + 1
        kinds = {"all": 0, "photo": 0, "video": 0}
        for m in (x for x in pool if keep(x, skip=("kind",))):
            kinds["all"] += 1
            kinds["video" if m.get("video") else "photo"] += 1

        with self._state_lock:
            syncing = self._syncing

        return {
            "moments": [self._public(m, users) for m in chunk],
            "nextCursor": cursor,
            "total": total,
            "historyTotal": len(items),
            "syncing": syncing,
            "facets": {
                "years": [{"year": y["year"], "count": y["count"],
                           "months": [{"month": k, "count": v} for k, v in sorted(y["months"].items(), reverse=True)]}
                          for y in sorted(years.values(), key=lambda y: -y["year"])],
                "authors": sorted(({"user": users.get(uid) or self._user_from_profile({}, uid), "count": n, "mine": uid == self.uid}
                                   for uid, n in authors.items()), key=lambda a: (not a["mine"], -a["count"])),
                "kinds": kinds,
            },
        }

    def post_moment(self, image, video, caption, preset, recipients, private: bool = False,
                    mirror_video: bool = False, video_start: float = 0.0, video_length: float = 0.0) -> dict:
        self._token()
        if video:
            # browsers record WebM/MP4 in any shape; Locket stores square MP4 under 6 MB
            video = normalize_for_locket(video, mirror=mirror_video, start=video_start, length=video_length)
        # private = Locket's "sent to self only": nobody else receives the moment
        kwargs = {"caption": caption or "", "recipients": None if private else (recipients or None),
                  "is_private": bool(private)}
        if preset and preset != "standard":
            kwargs["note_type"] = preset
        try:
            res = self.client.moments.post(image=image or None, video=video or None, **kwargs)
        except (StorageUploadError, LocketAPIError) as exc:
            raise ProviderError(f"Đăng khoảnh khắc thất bại: {exc}", 502) from exc
        except AuthenticationError as exc:
            raise AuthExpired() from exc
        except requests.RequestException as exc:
            raise ProviderError("Không kết nối được máy chủ Locket.", 502) from exc
        mid = (res or {}).get("canonical_uid") or (res or {}).get("id")
        history = self.client.moments._load_history()
        item = next((h for h in history if (h.get("canonical_uid") or h.get("moment_uid")) == mid), None)
        if not item:
            raise ProviderError("Locket không trả về khoảnh khắc vừa đăng.", 502)
        entry = self._entry({**item, "user": self.uid, "created_at": int(time.time() * 1000)})
        if caption or preset:
            overlay = self.client.moments.build_overlay(text=caption or "", note_type=preset or "standard")
            entry["overlay"] = self._overlay({"overlays": [overlay]})
        self.store.upsert(entry)
        self.store.save()
        return self._public(entry, {self.uid: self.me()})

    def delete_moment(self, moment_id: str) -> None:
        # Locket answers 401 "Malformed request" unless owner_uid is present (the SDK's own payload
        # lacks it). Verified against the live API: this shape returns {"data": [moment_id]}.
        entry = self.store.get(moment_id)
        if entry and entry.get("owner") and entry["owner"] != self.uid:
            raise ProviderError("Bạn chỉ xóa được khoảnh khắc của mình.", 403)
        self._api("deleteMomentV2", {"moment_uid": moment_id, "owner_uid": self.uid, "delete_globally": True})
        history = [h for h in self.client.moments._load_history()
                   if (h.get("canonical_uid") or h.get("moment_uid")) != moment_id]
        self.client.moments._save_history(history)
        self.store.remove(moment_id)
        self.store.save()

    def react(self, moment_id: str, emoji: str) -> dict:
        """Send a reaction. Locket has no way to take a reaction back (no such endpoint exists)."""
        self._api("reactToMoment", {
            "moment_uid": moment_id, "reaction": emoji, "from_memory": False,
            "intensity": {"@type": "type.googleapis.com/google.protobuf.Int64Value", "value": "0"},
        })
        now = int(time.time() * 1000)
        self.store.add_sent_reaction(moment_id, emoji, now)
        self.store.save()
        return {"myReactions": [r["emoji"] for r in self.store.get_sent_reactions(moment_id)]}

    def mark_viewed(self, moment_id: str) -> None:
        self._api("markMomentAsViewed", {"moment_uid": moment_id})

    def _comment_row(self, cid: str, peer: str, doc: dict) -> dict:
        f = doc.get("fields", {})
        reactions = []
        for r in f.get("reactions", {}).get("arrayValue", {}).get("values", []):
            rf = r.get("mapValue", {}).get("fields", {})
            emoji = rf.get("emoji", {}).get("stringValue")
            if emoji:
                reactions.append({"sender": rf.get("sender", {}).get("stringValue", ""), "emoji": emoji,
                                  "createdAt": to_ms(rf.get("created_at", {}).get("timestampValue"))})
        return {"id": doc["name"].rsplit("/", 1)[-1], "sender": f.get("sender", {}).get("stringValue", ""),
                "peer": peer, "cid": cid, "text": f.get("body", {}).get("stringValue", "").replace("\u200b", "").strip(),
                "createdAt": to_ms(f.get("created_at", {}).get("timestampValue")), "reactions": reactions}

    def _refresh_comments(self, moment_id: str) -> None:
        """Re-read the newest messages of the conversations that can hold comments on this moment, so
        replies written in the iPhone app (or unsent there) show up without waiting for the 5-minute scan."""
        entry = self.store.get(moment_id) or {}
        owner = entry.get("owner")
        if owner and owner != self.uid:
            cid = self._conversation_id(owner)
            targets = [(cid, owner)] if cid else []
        else:
            with self._state_lock:
                has_convs = bool(self._conv_by_peer)
            if not has_convs:
                self.conversations()
            with self._state_lock:
                targets = [(cid, peer) for peer, cid in self._conv_by_peer.items()]
        now = time.time()
        with self._state_lock:
            targets = [(cid, peer) for cid, peer in targets if now - self._comments_at.get(cid, 0) > 3]

        def fetch(target):
            cid, peer = target
            docs = self._firestore_list(f"conversations/{cid}/messages", page_size=150, max_docs=150,
                                        order_by="created_at desc",
                                        mask=("reply_moment", "created_at", "body", "sender", "reactions"))
            return cid, peer, docs

        for cid, peer, docs in self._pool.map(fetch, targets):
            if not docs:
                with self._state_lock:
                    self._comments_at[cid] = now
                continue
            window_start = min(to_ms(d.get("fields", {}).get("created_at", {}).get("timestampValue")) for d in docs)
            fresh: dict = {}
            for d in docs:
                mid = d.get("fields", {}).get("reply_moment", {}).get("stringValue")
                row = self._comment_row(cid, peer, d)
                if mid and row["text"]:
                    fresh.setdefault(mid, []).append(row)
            # inside the window the server is the truth (new, unsent and re-reacted messages); older rows stay
            with self._state_lock:
                self._comments_at[cid] = now
                touched = set(fresh) | {mid for mid, rows in self._comments.items() if any(r.get("cid") == cid for r in rows)}
                for mid in touched:
                    kept = [r for r in self._comments.get(mid, []) if r.get("cid") != cid or r["createdAt"] < window_start]
                    rows = kept + fresh.get(mid, [])
                    rows.sort(key=lambda r: r["createdAt"])
                    if rows:
                        self._comments[mid] = rows
                    else:
                        self._comments.pop(mid, None)

    def comments(self, moment_id: str) -> dict:
        """Chat messages that reply to this moment (Locket has no public comments: replies go to chat)."""
        try:
            self._refresh_comments(moment_id)
        except AuthExpired:
            raise
        except ProviderError:
            pass                                   # serve what the last full scan found
        with self._state_lock:
            rows = [dict(r, reactions=list(r.get("reactions", []))) for r in self._comments.get(moment_id, ())]
        uids = [r["sender"] for r in rows] + [r["peer"] for r in rows] + [x["sender"] for r in rows for x in r.get("reactions", [])]
        users = self._users(uids)
        users[self.uid] = self.me()
        person = lambda uid: users.get(uid) or self._user_from_profile({}, uid)  # noqa: E731
        return {"comments": [{
            "id": r["id"], "conversationId": r.get("cid"), "text": r["text"], "createdAt": r["createdAt"],
            "mine": r["sender"] == self.uid, "user": person(r["sender"]), "peer": person(r["peer"]),
            "reactions": [{"user": person(x["sender"]), "emoji": x["emoji"], "mine": x["sender"] == self.uid}
                          for x in r.get("reactions", [])],
        } for r in rows]}

    def add_comment(self, moment_id: str, text: str, to: Optional[str] = None) -> dict:
        """Reply to a moment. On a friend's moment it goes to the author; on my own moment to `to`."""
        entry = self.store.get(moment_id) or {}
        owner = entry.get("owner")
        target = owner if owner and owner != self.uid else to
        if not target or target == self.uid:
            raise ProviderError("Chọn người bạn muốn trả lời bình luận.", 422)
        self.send_message(target, text, moment_id)
        with self._state_lock:
            self._comments_at.clear()              # force a re-read so the real message id comes back
        return self.comments(moment_id)

    def activity(self, moment_id: str) -> dict:
        """Who viewed and who reacted to one of MY moments (only the owner may read these)."""
        res = self._api("getMomentViews", {"moment_uid": moment_id})
        data = res.get("data") if isinstance(res.get("data"), dict) else {}
        views = []
        for v in data.get("moment_views") or []:
            uid = v.get("user") or v.get("uid") if isinstance(v, dict) else None
            if isinstance(uid, dict):
                uid = uid.get("uid")
            if uid and uid != self.uid:
                views.append((uid, to_ms(v.get("viewed_at") or v.get("date"))))
        reactions = []
        for doc in self._firestore_list(f"moments/{moment_id}/reactions", page_size=200, max_docs=2000):
            f = doc.get("fields", {})
            uid = f.get("user", {}).get("stringValue")
            emoji = f.get("string", {}).get("stringValue")
            if uid and emoji:
                reactions.append((uid, emoji, to_ms(f.get("created_at", {}).get("timestampValue"))))
        reactions.sort(key=lambda r: r[2], reverse=True)
        users = self._users([u for u, _ in views] + [u for u, _, _ in reactions])
        person = lambda uid: users.get(uid) or self._user_from_profile({}, uid)  # noqa: E731
        by_user: dict = {}
        for uid, emoji, _ in sorted(reactions, key=lambda r: r[2]):
            by_user[uid] = by_user.get(uid, "") + emoji
        summary: dict = {}
        for _, emoji, _ in reactions:
            summary[emoji] = summary.get(emoji, 0) + 1
        views.sort(key=lambda v: v[1], reverse=True)
        return {
            "count": int(data.get("count") or len(views)),
            "viewers": [{"user": person(uid), "viewedAt": at, "emoji": by_user.get(uid, "")} for uid, at in views],
            "reactions": [{"user": person(uid), "emoji": emoji, "createdAt": at} for uid, emoji, at in reactions],
            "summary": [{"emoji": e, "count": n} for e, n in sorted(summary.items(), key=lambda kv: -kv[1])],
        }

    def moment(self, moment_id: str) -> dict:
        """One moment from the synced history (notifications open it directly)."""
        entry = self.store.get(moment_id)
        if not entry:
            raise ProviderError("Không tìm thấy khoảnh khắc này trong lịch sử đã đồng bộ.", 404)
        users = self._users([entry.get("owner") or ""])
        if entry.get("owner") == self.uid:
            users[self.uid] = self.me()
        return self._public(entry, users)
