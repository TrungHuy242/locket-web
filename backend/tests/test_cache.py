"""Tests for disk cache LRU touching and bounded directory pruning."""
from __future__ import annotations

import os
import time

from backend.app import cache


def test_prune_dir_evicts_oldest_and_preserves_temp_files(tmp_path):
    now = time.time()
    for i in range(10):
        f = tmp_path / f"item_{i}.webp"
        f.write_bytes(b"a" * 1000)
        os.utime(f, (now - (10 - i) * 120, now - (10 - i) * 120))

    # Temp files must never be removed by cache pruning
    tmp_file = tmp_path / "active.tmp999"
    src_file = tmp_path / "converting.src"
    tmp_file.write_bytes(b"t" * 5000)
    src_file.write_bytes(b"s" * 5000)
    os.utime(tmp_file, (now - 999999, now - 999999))
    os.utime(src_file, (now - 999999, now - 999999))

    # Touch the oldest file (item_0) so it becomes the most recently used
    cache.touch_if_old(tmp_path / "item_0.webp", min_age_sec=60)

    deleted, freed = cache.prune_dir(tmp_path, max_bytes=6000, target_ratio=0.8)
    assert deleted == 6
    assert freed == 6000
    assert (tmp_path / "item_0.webp").exists()
    assert not (tmp_path / "item_1.webp").exists()
    assert (tmp_path / "item_9.webp").exists()
    assert tmp_file.exists() and src_file.exists()


def test_prune_dir_noop_when_under_limit(tmp_path):
    (tmp_path / "a.webp").write_bytes(b"x" * 500)
    deleted, freed = cache.prune_dir(tmp_path, max_bytes=2000)
    assert (deleted, freed) == (0, 0)
    assert (tmp_path / "a.webp").exists()
