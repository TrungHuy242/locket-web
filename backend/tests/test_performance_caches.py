"""Tests for Phase 2 backend performance caches: persistent account cache, non-blocking notifications, TTL caches."""
from __future__ import annotations

import threading
import time

from backend.app import account_cache
from backend.app.providers.live import LiveProvider


def _make_provider(tmp_path, uid: str = "perf_uid1", folder_name: str = "sess1") -> LiveProvider:
    p = LiveProvider(tmp_path / folder_name)
    p.client.session.uid = uid
    p.client.session.id_token = "tok_valid"
    p.client.session.expires_at = 9999999999999
    return p


def test_account_cache_persists_profiles_and_chat_state_across_restart(isolated_data, tmp_path):
    p1 = _make_provider(tmp_path, uid="uid_persist", folder_name="sess_p1")
    try:
        api_calls = []

        def fake_api(endpoint, payload=None):
            api_calls.append((endpoint, payload))
            return {"data": {"uid": "friend1", "first_name": "Lan", "last_name": "Anh", "username": "lananh"}}

        def fake_fs_list(path, **kw):
            if path.endswith("/conversations"):
                return [{
                    "name": "projects/p/documents/users/uid_persist/conversations/c1",
                    "fields": {
                        "members": {"arrayValue": {"values": [{"stringValue": "uid_persist"}, {"stringValue": "friend1"}]}},
                        "last_updated": {"timestampValue": "2026-11-20T10:00:00Z"},
                    },
                }]
            return [{
                "name": "p/messages/msg1",
                "fields": {
                    "reply_moment": {"stringValue": "mom1"},
                    "thumbnail_url": {"stringValue": "https://firebasestorage.googleapis.com/v0/b/locket-img/o/users%2Ffriend1%2Fmoments%2Fthumbnails%2Fmom1.webp"},
                    "created_at": {"timestampValue": "2026-11-20T10:00:00Z"},
                    "body": {"stringValue": "xinh qua"},
                    "sender": {"stringValue": "friend1"},
                },
            }]

        p1._api = fake_api
        p1._firestore_list = fake_fs_list

        users = p1._users(["friend1"])
        assert users["friend1"]["name"] == "Lan Anh"
        assert len(api_calls) == 1

        p1._sync_chat_moments()
        assert p1._chat_full_done is True
        assert "mom1" in p1._comments
        assert p1._account_cache.path.exists()
    finally:
        p1.close()

    # Simulate cold process restart: clear in-memory singletons and construct a new LiveProvider
    with account_cache._caches_guard:
        account_cache._caches.clear()

    p2 = _make_provider(tmp_path, uid="uid_persist", folder_name="sess_p2")
    try:
        p2_api_calls = []
        p2_msg_fetches = []

        def fail_if_profile_fetched(endpoint, payload=None):
            p2_api_calls.append(endpoint)
            raise AssertionError(f"Should have hit persistent profile cache, not called {endpoint}")

        def fake_fs_list_2(path, **kw):
            if path.endswith("/conversations"):
                return [{
                    "name": "projects/p/documents/users/uid_persist/conversations/c1",
                    "fields": {
                        "members": {"arrayValue": {"values": [{"stringValue": "uid_persist"}, {"stringValue": "friend1"}]}},
                        "last_updated": {"timestampValue": "2026-11-20T10:00:00Z"},
                    },
                }]
            p2_msg_fetches.append(path)
            return []

        p2._api = fail_if_profile_fetched
        p2._firestore_list = fake_fs_list_2
        p2._message_page = lambda *a, **kw: p2_msg_fetches.append("inc") or []

        # Profiles warm-loaded from cache.json -> 0 fetchUserV2 calls
        users2 = p2._users(["friend1"])
        assert users2["friend1"]["name"] == "Lan Anh"
        assert p2_api_calls == []

        # Chat state warm-loaded from cache.json -> 0 message scans on unchanged conversations
        p2._sync_chat_moments()
        assert p2_msg_fetches == []
        assert p2._chat_full_done is True
        assert p2._comments["mom1"][0]["text"] == "xinh qua"
    finally:
        p2.logout()


def test_notifications_initial_request_is_non_blocking(isolated_data, tmp_path):
    p = _make_provider(tmp_path, uid="uid_notif", folder_name="sess_notif")
    gate = threading.Event()
    done = threading.Event()
    try:
        p._profiles["f1"] = (time.time(), {"uid": "f1", "firstName": "An", "lastName": "", "name": "An", "username": "an", "avatar": None})

        def slow_collect():
            gate.wait(timeout=5)
            try:
                return {
                    "items": [{"id": "request:f1:1700000000000", "type": "friend_request", "createdAt": 1700000000000, "uid": "f1"}],
                    "warnings": [],
                    "at": time.time(),
                }
            finally:
                done.set()

        p._collect_notifications = slow_collect

        t0 = time.monotonic()
        first = p.notifications(refresh=False)
        elapsed = time.monotonic() - t0
        assert elapsed < 0.5
        assert first["loading"] is True
        assert first["notifications"] == []
        assert first["unread"] == 0

        gate.set()
        assert done.wait(timeout=3)
        # Allow the worker thread a moment to assign _notif_cache and release lock
        for _ in range(50):
            if p._notif_cache is not None:
                break
            time.sleep(0.01)

        second = p.notifications(refresh=False)
        assert second["loading"] is False
        assert len(second["notifications"]) == 1
        assert second["notifications"][0]["user"]["name"] == "An"
        assert second["unread"] == 1
    finally:
        gate.set()
        p.logout()


def test_friends_and_conversations_ttl_caches_and_invalidation(isolated_data, tmp_path):
    p = _make_provider(tmp_path, uid="uid_ttl", folder_name="sess_ttl")
    try:
        p._profiles["f1"] = (time.time(), {"uid": "f1", "firstName": "Minh", "lastName": "", "name": "Minh", "username": "minh", "avatar": None})
        rel_calls = 0
        conv_calls = 0

        def fake_relation_docs(col):
            nonlocal rel_calls
            rel_calls += 1
            return [("f1", 1700000000000)] if col == "friends" else []

        def fake_fs_list(path, **kw):
            nonlocal conv_calls
            if path.endswith("/conversations"):
                conv_calls += 1
                return [{
                    "name": "projects/p/documents/users/uid_ttl/conversations/c1",
                    "fields": {
                        "members": {"arrayValue": {"values": [{"stringValue": "uid_ttl"}, {"stringValue": "f1"}]}},
                        "last_updated": {"timestampValue": "2026-11-20T10:00:00Z"},
                        "is_read": {"booleanValue": True},
                    },
                }]
            return []

        p._relation_docs = fake_relation_docs
        p._firestore_list = fake_fs_list
        p._api = lambda endpoint, payload=None: {"ok": True}
        p.client.chat.send_message = lambda peer_uid, text=None, moment_uid=None: {"data": {"uid": "msg_new"}}

        # Friends: 1st call queries 4 collections, 2nd call hits 30s TTL cache
        f_first = p.friends()
        assert len(f_first["friends"]) == 1
        assert rel_calls == 4
        f_second = p.friends()
        assert f_second is f_first
        assert rel_calls == 4

        # Mutation invalidates friends cache
        p.remove_friend("f1")
        p.friends()
        assert rel_calls == 8

        # Conversations: 1st call queries Firestore, 2nd hits 10s TTL cache
        c_first = p.conversations()
        assert len(c_first) == 1
        assert conv_calls == 1
        c_second = p.conversations()
        assert c_second is c_first
        assert conv_calls == 1

        # Sending a message invalidates conversations cache
        p.send_message("f1", "hi", None)
        p.conversations()
        assert conv_calls == 2
    finally:
        p.logout()


def test_me_warm_cache_across_restart_and_upstream_error_fallback(isolated_data, tmp_path):
    p1 = _make_provider(tmp_path, uid="uid_me_warm", folder_name="sess_me1")
    try:
        p1.client.user.get_profile = lambda: {"uid": "uid_me_warm", "first_name": "Huy", "last_name": "Trung", "username": "trunghuy"}
        u1 = p1.me(refresh=True)
        assert u1["name"] == "Huy Trung"
    finally:
        p1.close()

    with account_cache._caches_guard:
        account_cache._caches.clear()

    p2 = _make_provider(tmp_path, uid="uid_me_warm", folder_name="sess_me2")
    try:
        p2.client.user.get_profile = lambda: (_ for _ in ()).throw(AssertionError("Warm cache should serve me() without calling get_profile"))
        u2 = p2.me(refresh=False)
        assert u2["name"] == "Huy Trung"

        # If refresh=True gets an upstream error dict from SDK, keep fallback instead of wiping profile
        p2.client.user.get_profile = lambda: {"error": "connection reset"}
        u3 = p2.me(refresh=True)
        assert u3["name"] == "Huy Trung"
    finally:
        p2.logout()
