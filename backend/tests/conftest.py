"""Pytest fixtures and isolated temporary data directory for backend tests.

Sets LOCKET_DATA_DIR before any `backend.app` module is imported so tests never touch
real user sessions, synced history or caches under `backend/data/`.
"""
from __future__ import annotations

import atexit
import os
import shutil
import tempfile
from pathlib import Path

import pytest

_TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="locket-pytest-data-"))
os.environ["LOCKET_DATA_DIR"] = str(_TEST_DATA_DIR)
os.environ["LOCKET_SKIP_FRONTEND"] = "1"
os.environ["LOCKET_LOG_LEVEL"] = "WARNING"


def _cleanup_data_dir() -> None:
    shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)


atexit.register(_cleanup_data_dir)


@pytest.fixture()
def isolated_data(monkeypatch, tmp_path):
    """Redirect config directories to a per-test tmp_path and clear in-memory registries."""
    from backend.app import account_cache, admin_store, config, history, notifications

    for name in ("SESSIONS_DIR", "ACCOUNTS_DIR", "THUMBS_DIR", "VIDEO_CACHE_DIR", "ADMIN_DIR"):
        sub = tmp_path / name.lower()
        sub.mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(config, name, sub)
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(history, "_stores", {})
    monkeypatch.setattr(notifications, "_states", {})
    monkeypatch.setattr(account_cache, "_caches", {})
    admin_store.admin_store.reset_in_memory()
    return tmp_path
