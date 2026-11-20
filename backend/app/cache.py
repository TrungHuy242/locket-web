"""Disk cache maintenance: lightweight LRU touch and size-bounded background pruning."""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

log = logging.getLogger(__name__)

_state_guard = threading.Lock()
_last_prune: dict[Path, float] = {}
_running: set[Path] = set()


def _is_temp_name(name: str) -> bool:
    return ".tmp" in name or name.endswith(".src")


def touch_if_old(path: Path, min_age_sec: int = 3600) -> None:
    """Refresh mtime occasionally on cache hits so pruning behaves like LRU without constant writes."""
    try:
        st = path.stat()
        now = time.time()
        if now - st.st_mtime >= min_age_sec:
            os.utime(path, (now, now))
    except OSError:
        pass


def prune_dir(folder: Path, max_bytes: int, target_ratio: float = 0.8) -> tuple[int, int]:
    """Delete oldest cached files in `folder` until total size <= `max_bytes * target_ratio`.

    Returns `(deleted_files, freed_bytes)`. Temporary files (`*.tmp*`, `*.src`) are left untouched.
    """
    if max_bytes <= 0 or not folder.exists():
        return 0, 0
    entries: list[tuple[float, int, str]] = []
    total = 0
    try:
        with os.scandir(folder) as it:
            for entry in it:
                if _is_temp_name(entry.name):
                    continue
                try:
                    if not entry.is_file(follow_symlinks=False):
                        continue
                    st = entry.stat(follow_symlinks=False)
                except OSError:
                    continue
                total += st.st_size
                entries.append((st.st_mtime, st.st_size, entry.path))
    except OSError as exc:
        log.warning("Could not scan cache dir %s: %s", folder, exc)
        return 0, 0

    if total <= max_bytes:
        return 0, 0

    goal = int(max_bytes * max(0.1, min(target_ratio, 0.95)))
    entries.sort(key=lambda row: row[0])  # oldest first
    deleted = 0
    freed = 0
    for _, size, file_path in entries:
        if total <= goal:
            break
        try:
            os.remove(file_path)
            total -= size
            freed += size
            deleted += 1
        except OSError:
            continue
    if deleted:
        log.info("Pruned %d cached files (%.1f MB) in %s", deleted, freed / (1024 * 1024), folder.name)
    return deleted, freed


def schedule_prune(folder: Path, max_bytes: int, cooldown: float = 60.0) -> None:
    """Run `prune_dir` in a background daemon thread at most once every `cooldown` seconds per folder."""
    if max_bytes <= 0:
        return
    key = folder.resolve()
    now = time.monotonic()
    with _state_guard:
        if key in _running or now - _last_prune.get(key, 0.0) < cooldown:
            return
        _running.add(key)

    def _run() -> None:
        try:
            prune_dir(key, max_bytes)
        except Exception:
            log.exception("Cache prune failed for %s", key)
        finally:
            with _state_guard:
                _last_prune[key] = time.monotonic()
                _running.discard(key)

    threading.Thread(target=_run, name=f"cache-prune-{key.name}", daemon=True).start()
