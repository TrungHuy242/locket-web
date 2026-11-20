"""Tests for LiveProvider normalization, incremental chat sync, memories, friends and safety."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.app.providers.base import ProviderError
from backend.app.providers.live import LiveProvider
from backend.app.providers.live_common import fold_text, parse_overlay, proxied, public_overlay, to_ms


def _make_provider(tmp_path, uid: str = "meuid1") -> LiveProvider:
    p = LiveProvider(tmp_path / f"sess_{uid}")
    p.client.session.uid = uid
    p.client.session.id_token = "tok_valid"
    p.client.session.expires_at = 9999999999999
    return p


def test_common_helpers_timestamp_overlay_and_fold():
    assert to_ms(None) == 0
    assert to_ms(1700000000) == 1700000000000
    assert to_ms(1700000000123) == 1700000000123
    assert to_ms({"_seconds": 1700000000, "_nanoseconds": 500_000_000}) == 1700000000500
    assert to_ms("2026-11-20T10:00:00.123456789Z") > 0
    assert fold_text("Tuấn Kiệt Đỗ") == "tuan kiet do"
    assert proxied(None) is None
    assert proxied("https://cdn.locketcamera.com/a.webp").startswith("/api/media?u=")

    raw = {
        "overlays": [{
            "overlay_id": "caption:music",
            "overlay_type": "caption",
            "data": {
                "type": "music",
                "text": "Song",
                "icon": {"type": "image", "data": "https://i.scdn.co/art.jpg"},
                "background": {"colors": ["#111111"], "image": {"source": "url", "data": "https://cdn.locketcamera.com/bg.jpg"}},
                "payload": {
                    "song_title": "Blue",
                    "artist": "Yung Kai",
                    "preview_url": "https://p.scdn.co/preview.mp3",
                    "spotify_url": "https://evil.example/phish",
                },
            },
        }]
    }
    ov = parse_overlay(raw)
    pub = public_overlay(ov)
    assert pub["icon"]["value"].startswith("/api/media?u=")
    assert pub["bgImage"].startswith("/api/media?u=")
    assert pub["music"]["preview"].startswith("/api/media?u=")
    assert pub["music"]["link"] is None  # non-Spotify/Apple Music URL stripped


def test_incremental_chat_sync_and_deleted_moment(isolated_data, tmp_path):
    p = _make_provider(tmp_path)
    try:
        calls = {"full": [], "inc": []}
        conv_ts = {"c1": "2026-11-20T10:00:00Z", "c2": "2026-11-20T09:00:00Z"}

        def fake_fs_list(path, **kw):
            if path.endswith("/conversations"):
                return [
                    {
                        "name": f"projects/p/documents/users/meuid1/conversations/{cid}",
                        "fields": {
                            "members": {"arrayValue": {"values": [{"stringValue": "meuid1"}, {"stringValue": f"peer{cid}"}]}},
                            "last_updated": {"timestampValue": ts},
                        },
                    }
                    for cid, ts in conv_ts.items()
                ]
            calls["full"].append(path)
            if "c1" in path:
                return [{
                    "name": "p/messages/msg1",
                    "fields": {
                        "reply_moment": {"stringValue": "mom1"},
                        "thumbnail_url": {"stringValue": "https://firebasestorage.googleapis.com/v0/b/locket-img/o/users%2Fpeerc1%2Fmoments%2Fthumbnails%2Fmom1.webp"},
                        "created_at": {"timestampValue": "2026-11-20T10:00:00Z"},
                        "body": {"stringValue": "first comment"},
                        "sender": {"stringValue": "peerc1"},
                    },
                }]
            return []

        inc_payload = {
            "c2": [{
                "name": "p/messages/msg2",
                "fields": {
                    "reply_moment": {"stringValue": "mom2"},
                    "thumbnail_url": {"stringValue": "https://firebasestorage.googleapis.com/v0/b/locket-img/o/users%2Fpeerc2%2Fmoments%2Fthumbnails%2Fmom2.webp"},
                    "created_at": {"timestampValue": "2026-11-20T11:00:00Z"},
                    "body": {"stringValue": "second"},
                    "sender": {"stringValue": "peerc2"},
                },
            }],
            "c1": [{
                "name": "p/messages/msg3",
                "fields": {
                    "reply_moment": {"stringValue": "mom1"},
                    "thumbnail_url": {"stringValue": "https://firebasestorage.googleapis.com/v0/b/locket-img/o/users%2Fpeerc1%2Fmoments%2Fthumbnails%2Fmom1.webp"},
                    "created_at": {"timestampValue": "2026-11-20T12:00:00Z"},
                    "deleted_moment": {"booleanValue": True},
                    "body": {"stringValue": ""},
                    "sender": {"stringValue": "peerc1"},
                },
            }],
        }

        def fake_msg_page(cid, before_ms, limit):
            calls["inc"].append(cid)
            return inc_payload.get(cid, [])

        p._firestore_list = fake_fs_list
        p._message_page = fake_msg_page

        # Pass 1: full scan
        p._sync_chat_moments()
        assert len(calls["full"]) == 2 and calls["inc"] == []
        assert p.store.get("mom1") is not None

        # Pass 2: unchanged last_updated -> zero message fetches
        calls["full"].clear()
        p._sync_chat_moments()
        assert calls["full"] == [] and calls["inc"] == []

        # Pass 3: c2 changes -> incremental scan only on c2
        conv_ts["c2"] = "2026-11-20T11:00:00Z"
        p._sync_chat_moments()
        assert calls["full"] == [] and calls["inc"] == ["c2"]
        assert p.store.get("mom2") is not None

        # Pass 4: c1 reports deleted_moment -> mom1 removed from store
        calls["inc"].clear()
        conv_ts["c1"] = "2026-11-20T12:00:00Z"
        p._sync_chat_moments()
        assert calls["inc"] == ["c1"]
        assert p.store.get("mom1") is None
    finally:
        p.logout()


def test_memories_accent_insensitive_search_and_facets(isolated_data, tmp_path):
    p = _make_provider(tmp_path)
    try:
        p._sync = lambda force=False: None
        p._me = {"uid": "meuid1", "firstName": "Huy", "lastName": "Nguyễn", "name": "Huy Nguyễn", "username": "huy", "avatar": None}
        p._me_at = 9999999999.0
        p._users = lambda uids: {
            "meuid1": p._me,
            "friend1": {"uid": "friend1", "firstName": "Tuấn", "lastName": "Kiệt", "name": "Tuấn Kiệt", "username": "tkiet", "avatar": None},
        }
        p.store.upsert({"id": "m1", "owner": "friend1", "image": "https://cdn.locketcamera.com/1.webp", "video": None,
                        "overlay": {"text": "Cà phê sáng"}, "createdAt": 1735732800000, "approx": False})  # 2025-01-01
        p.store.upsert({"id": "m2", "owner": "meuid1", "image": "https://cdn.locketcamera.com/2.webp",
                        "video": "https://cdn.locketcamera.com/2.mp4",
                        "overlay": {"text": "Đi biển"}, "createdAt": 1767268800000, "approx": False})  # 2026-01-01

        res = p.memories(q="ca phe tuan")
        assert res["total"] == 1
        assert res["moments"][0]["id"] == "m1"
        assert res["facets"]["kinds"] == {"all": 1, "photo": 1, "video": 0}
        assert res["facets"]["years"][0]["year"] == 2025
    finally:
        p.logout()


def test_friend_profile_does_not_fetch_all_friends_and_react_message_api_first(isolated_data, tmp_path):
    p = _make_provider(tmp_path)
    try:
        p._me = {"uid": "meuid1", "firstName": "Me", "lastName": "", "name": "Me", "username": "me", "avatar": None}
        p._me_at = 9999999999.0
        p.friends = lambda: (_ for _ in ()).throw(AssertionError("friend_profile must not call self.friends()"))
        p._api = lambda endpoint, payload=None: {"data": {"uid": "f1", "first_name": "An", "last_name": "Lê", "username": "anle"}}
        p._relation_docs = lambda col: [("f1", 1700000000000)] if col == "friends" else []

        prof = p.friend_profile("f1")
        assert prof["relation"] == "friend"
        assert prof["since"] == 1700000000000
        assert prof["inviteLink"] == "https://locket.cam/anle"

        # react_message must NOT mutate local comment cache when API fails
        p._comments["mom1"] = [{"id": "msg1", "reactions": []}]

        def fail_api(endpoint, payload=None):
            raise ProviderError("upstream down", 502)

        p._api = fail_api
        with pytest.raises(ProviderError):
            p.react_message("cid1", "msg1", "❤️")
        assert p._comments["mom1"][0]["reactions"] == []
    finally:
        p.logout()


def test_session_atomic_save_and_close_preserves_session_file(isolated_data, tmp_path):
    p = _make_provider(tmp_path)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: p.client.session.save(), range(25)))

    sess_file = p.session_dir / "session.json"
    assert sess_file.exists()
    assert list(p.session_dir.glob("*.tmp")) == []

    p.close()
    assert p._pool._shutdown and p._notif_pool._shutdown
    assert sess_file.exists()

    p.logout()
    assert not p.session_dir.exists()
