"""Tests for NotificationState read markers, pruning and concurrent atomic saves."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from backend.app import notifications
from backend.app.notifications import NotificationState, get_notification_state


def test_mark_individual_and_mark_all(isolated_data):
    st = NotificationState("u1")
    assert not st.is_read("a", 1000)

    st.mark([("a", 1000), ("b", 2000)])
    assert st.is_read("a", 1000)
    assert st.is_read("b", 2000)
    assert not st.is_read("c", 2500)

    st.mark_all(1500)
    assert st.is_read("old", 1200)
    assert st.is_read("a", 1000)
    assert st.is_read("b", 2000)
    assert not st.is_read("c", 2500)

    reloaded = NotificationState("u1")
    assert reloaded.read_before == 1500
    assert "a" not in reloaded.read   # covered by read_before
    assert "b" in reloaded.read


def test_max_ids_trimming_and_concurrent_saves(isolated_data, monkeypatch):
    monkeypatch.setattr(notifications, "MAX_IDS", 20)
    s1 = get_notification_state("u_concurrent")
    s2 = get_notification_state("u_concurrent")
    assert s1 is s2

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda i: s1.mark([(f"n{i}", 1000 + i)]), range(45)))

    assert len(s1.read) <= 20
    assert s1.is_read("n44", 1044)
    assert list(s1.path.parent.glob("*.tmp")) == []
