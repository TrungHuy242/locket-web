"""Tests for MomentStore persistence, pagination, precedence and thread-safety."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from backend.app.history import MomentStore, get_moment_store


def _entry(mid: str, created_at: int, owner: str = "u1", approx: bool = False, caption: str = "") -> dict:
    return {
        "id": mid,
        "owner": owner,
        "image": f"https://cdn.locketcamera.com/{mid}.webp",
        "video": None,
        "overlay": {"text": caption} if caption else None,
        "createdAt": created_at,
        "approx": approx,
    }


def test_exact_wins_over_approx_and_earliest_approx_kept(isolated_data):
    store = MomentStore("u1")
    assert store.upsert(_entry("m1", 5000, approx=True)) is True
    # Older chat message referencing the same moment pulls approx createdAt earlier
    assert store.upsert(_entry("m1", 3000, approx=True)) is False
    assert store.get("m1")["createdAt"] == 3000
    assert not store.has_exact("m1")

    # Later chat message does not move approx forward
    store.upsert(_entry("m1", 7000, approx=True))
    assert store.get("m1")["createdAt"] == 3000

    # Exact feed entry overrides approx entry completely
    store.upsert(_entry("m1", 4000, approx=False, caption="hello"))
    assert store.has_exact("m1")
    assert store.get("m1")["createdAt"] == 4000
    assert store.get("m1")["overlay"]["text"] == "hello"

    # Subsequent approx entry cannot overwrite exact entry
    store.upsert(_entry("m1", 1000, approx=True))
    assert store.has_exact("m1")
    assert store.get("m1")["createdAt"] == 4000


def test_cursor_pagination_and_remove_clears_reactions(isolated_data):
    store = MomentStore("u2")
    for i in range(1, 8):
        store.upsert(_entry(f"m{i}", created_at=i * 1000))
    store.add_sent_reaction("m7", "🔥", 9000)

    page1, cursor1, total = store.page(before=None, limit=3)
    assert total == 7
    assert [m["id"] for m in page1] == ["m7", "m6", "m5"]
    assert cursor1 == "5000_m5"

    page2, cursor2, _ = store.page(before=cursor1, limit=3)
    assert [m["id"] for m in page2] == ["m4", "m3", "m2"]
    assert cursor2 == "2000_m2"

    page3, cursor3, _ = store.page(before=cursor2, limit=3)
    assert [m["id"] for m in page3] == ["m1"]
    assert cursor3 is None

    store.remove("m7")
    assert store.get("m7") is None
    assert store.get_sent_reactions("m7") == []


def test_shared_store_singleton_and_concurrent_atomic_saves(isolated_data):
    s1 = get_moment_store("shared_uid")
    s2 = get_moment_store("shared_uid")
    assert s1 is s2

    def worker(i: int):
        s1.upsert(_entry(f"m{i}", created_at=1000 + i, owner="shared_uid"))
        s1.add_sent_reaction(f"m{i}", "💛", 2000 + i)
        s1.save()

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(worker, range(50)))

    assert len(s1.all()) == 50
    assert list(s1.path.parent.glob("*.tmp")) == []

    # Reload from disk into a fresh MomentStore instance
    reloaded = MomentStore("shared_uid")
    assert len(reloaded.all()) == 50
    assert len(reloaded.get_sent_reactions("m25")) == 1
