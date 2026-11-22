"""Optional persistent state sync to a PRIVATE Hugging Face Dataset.

Free PaaS containers (such as Hugging Face Spaces CPU Basic) wipe their local disk whenever the
container sleeps or redeploys. When `LOCKET_HF_REPO` and `HF_TOKEN` are configured, this module
restores `sessions/` and `accounts/` on startup and commits debounced snapshots back to that
private dataset (plus a final flush on graceful shutdown), so users stay signed in and keep their
synced moment history across restarts.

Safety guarantees:
  * Never touches `thumbs/` or `videos/` (large caches stay ephemeral on local disk).
  * Refuses to upload if the target dataset is public (prevents leaking Firebase tokens).
  * Optionally encrypts every uploaded file with Fernet (AES-128-CBC + HMAC-SHA256) when
    `LOCKET_BACKUP_KEY` is provided.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from . import config

log = logging.getLogger(__name__)

SYNC_FOLDERS = ("sessions", "accounts")
ENC_SUFFIX = ".enc"
MAX_SYNC_FILE_BYTES = 20 * 1024 * 1024


def _build_fernet(secret: str):
    if not secret:
        return None
    from cryptography.fernet import Fernet

    digest = hashlib.sha256(b"locket-backup-v1:" + secret.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _is_syncable(path: Path) -> bool:
    name = path.name
    if ".tmp" in name or name.startswith("."):
        return False
    try:
        return path.is_file() and path.stat().st_size <= MAX_SYNC_FILE_BYTES
    except OSError:
        return False


class HFStateSync:
    def __init__(
        self,
        repo_id: Optional[str] = None,
        token: Optional[str] = None,
        backup_key: Optional[str] = None,
        debounce_sec: Optional[float] = None,
        urgent_sec: Optional[float] = None,
    ):
        self.repo_id = (repo_id if repo_id is not None else config.HF_REPO).strip()
        self.token = (token if token is not None else config.HF_TOKEN).strip()
        self.backup_key = (backup_key if backup_key is not None else config.BACKUP_KEY).strip()
        self.debounce_sec = float(debounce_sec if debounce_sec is not None else config.HF_SYNC_INTERVAL)
        self.urgent_sec = float(urgent_sec if urgent_sec is not None else config.HF_URGENT_DELAY)

        self.enabled = False
        self._api = None
        self._fernet = None
        self._lock = threading.RLock()
        self._sync_lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None
        self._due_at: Optional[float] = None
        self._dirty = False
        self._last_sync_at: int = 0
        self._last_restore_at: int = 0
        self._last_error: Optional[str] = None
        self._last_changes: int = 0
        # plain relative path (e.g. "sessions/abc/session.json") -> (repo_path, plain_sha256)
        self._pushed: dict[str, tuple[str, str]] = {}

    def _remote_path(self, rel: str) -> str:
        return f"{rel}{ENC_SUFFIX}" if self._fernet is not None else rel

    def _local_rel(self, repo_path: str) -> Optional[str]:
        if repo_path.endswith(ENC_SUFFIX):
            return repo_path[:-len(ENC_SUFFIX)]
        return repo_path

    def _scan_local(self) -> dict[str, tuple[Path, str]]:
        """Map relative POSIX paths under sessions/ and accounts/ to (Path, sha256)."""
        found: dict[str, tuple[Path, str]] = {}
        roots = {
            "sessions": config.SESSIONS_DIR,
            "accounts": config.ACCOUNTS_DIR,
        }
        for folder_name, root in roots.items():
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if not _is_syncable(path):
                    continue
                try:
                    rel = f"{folder_name}/{path.relative_to(root).as_posix()}"
                    digest = hashlib.sha256(path.read_bytes()).hexdigest()
                except OSError:
                    continue
                found[rel] = (path, digest)
        return found

    def _ensure_private_repo(self) -> bool:
        from huggingface_hub.errors import RepositoryNotFoundError

        try:
            info = self._api.repo_info(repo_id=self.repo_id, repo_type="dataset")
        except RepositoryNotFoundError:
            log.info("Creating private Hugging Face dataset %s for persistent state", self.repo_id)
            self._api.create_repo(repo_id=self.repo_id, repo_type="dataset", private=True, exist_ok=True)
            return True
        except Exception as exc:
            log.error("Cannot access Hugging Face dataset %s: %s", self.repo_id, exc)
            return False

        if not getattr(info, "private", False):
            log.error(
                "Refusing to sync sensitive Locket sessions to PUBLIC dataset '%s'. "
                "Make the dataset Private on Hugging Face and restart.",
                self.repo_id,
            )
            return False
        return True

    def _restore_from_remote(self) -> None:
        from huggingface_hub import snapshot_download

        tmp_dir = Path(tempfile.mkdtemp(prefix="locket-hf-restore-"))
        try:
            snap = Path(snapshot_download(
                repo_id=self.repo_id,
                repo_type="dataset",
                token=self.token,
                local_dir=str(tmp_dir),
                allow_patterns=["sessions/**", "accounts/**"],
            ))
            restored = 0
            pushed: dict[str, tuple[str, str]] = {}
            for folder_name, dest_root in (("sessions", config.SESSIONS_DIR), ("accounts", config.ACCOUNTS_DIR)):
                src_root = snap / folder_name
                if not src_root.exists():
                    continue
                for src in src_root.rglob("*"):
                    if not src.is_file():
                        continue
                    rel_in_folder = src.relative_to(src_root).as_posix()
                    repo_path = f"{folder_name}/{rel_in_folder}"
                    raw = src.read_bytes()
                    if repo_path.endswith(ENC_SUFFIX):
                        if self._fernet is None:
                            log.warning("Skipping encrypted backup file %s (LOCKET_BACKUP_KEY is not set)", repo_path)
                            continue
                        try:
                            plain = self._fernet.decrypt(raw)
                        except Exception as exc:
                            log.error("Failed decrypting %s (check LOCKET_BACKUP_KEY): %s", repo_path, exc)
                            continue
                        local_rel = rel_in_folder[:-len(ENC_SUFFIX)]
                    else:
                        plain = raw
                        local_rel = rel_in_folder
                    target = (dest_root / local_rel).resolve()
                    if dest_root.resolve() not in target.parents:
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    if not target.exists():
                        target.write_bytes(plain)
                        restored += 1
                    plain_rel = f"{folder_name}/{local_rel}"
                    pushed[plain_rel] = (repo_path, hashlib.sha256(plain).hexdigest())
            with self._lock:
                self._pushed = pushed
                self._last_restore_at = int(time.time() * 1000)
                self._last_error = None
            log.info("HF state sync ready (%s, restored %d file(s), encrypted=%s)",
                     self.repo_id, restored, bool(self._fernet))
        except Exception as exc:
            with self._lock:
                self._last_error = str(exc)[:200]
            log.warning("Initial restore from %s failed (continuing with local state): %s", self.repo_id, exc)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def start(self, api=None) -> bool:
        """Verify configuration, ensure dataset is private, and restore persisted state."""
        if not self.repo_id:
            return False
        if not self.token:
            log.warning("LOCKET_HF_REPO is set (%s) but HF_TOKEN is missing; state sync disabled.", self.repo_id)
            return False
        try:
            if api is None:
                from huggingface_hub import HfApi
                api = HfApi(token=self.token)
            self._api = api
            if self.backup_key:
                self._fernet = _build_fernet(self.backup_key)
        except Exception as exc:
            log.error("Failed initializing HF state sync dependencies: %s", exc)
            return False

        if not self._ensure_private_repo():
            return False
        self.enabled = True
        self._restore_from_remote()
        return True

    def mark_dirty(self, urgent: bool = False) -> None:
        """Schedule a debounced commit of local state changes."""
        if not self.enabled:
            return
        delay = self.urgent_sec if urgent else self.debounce_sec
        now = time.monotonic()
        target_due = now + delay
        with self._lock:
            self._dirty = True
            if self._timer is not None and self._due_at is not None and self._due_at <= target_due:
                return
            if self._timer is not None:
                self._timer.cancel()
            self._due_at = target_due
            self._timer = threading.Timer(delay, self._timer_fired)
            self._timer.daemon = True
            self._timer.name = "hf-state-sync"
            self._timer.start()

    def _timer_fired(self) -> None:
        with self._lock:
            self._timer = None
            self._due_at = None
        self.flush()

    def flush(self) -> bool:
        """Commit all added, changed or deleted state files in one atomic Hugging Face commit."""
        if not self.enabled or self._api is None:
            return False
        from huggingface_hub import CommitOperationAdd, CommitOperationDelete

        with self._sync_lock:
            with self._lock:
                self._dirty = False
                prev = dict(self._pushed)

            current = self._scan_local()
            operations = []
            next_pushed = dict(prev)

            # Additions & updates
            for rel, (path, digest) in sorted(current.items()):
                expected_repo_path = self._remote_path(rel)
                prev_entry = prev.get(rel)
                if prev_entry and prev_entry[0] == expected_repo_path and prev_entry[1] == digest:
                    continue
                try:
                    raw = path.read_bytes()
                except OSError:
                    continue
                payload = self._fernet.encrypt(raw) if self._fernet is not None else raw
                operations.append(CommitOperationAdd(path_in_repo=expected_repo_path, path_or_fileobj=payload))
                # If encryption mode switched, delete the old representation too
                if prev_entry and prev_entry[0] != expected_repo_path:
                    operations.append(CommitOperationDelete(path_in_repo=prev_entry[0]))
                next_pushed[rel] = (expected_repo_path, digest)

            # Deletions (e.g. logged-out sessions removed locally)
            for rel, (old_repo_path, _) in sorted(prev.items()):
                if rel not in current:
                    operations.append(CommitOperationDelete(path_in_repo=old_repo_path))
                    next_pushed.pop(rel, None)

            if not operations:
                return False

            try:
                self._api.create_commit(
                    repo_id=self.repo_id,
                    repo_type="dataset",
                    operations=operations,
                    commit_message=f"Sync Locket state ({len(operations)} change(s))",
                )
            except Exception as exc:
                log.warning("Failed pushing state snapshot to %s: %s", self.repo_id, exc)
                with self._lock:
                    self._dirty = True
                    self._last_error = str(exc)[:200]
                return False

            with self._lock:
                self._pushed = next_pushed
                self._last_sync_at = int(time.time() * 1000)
                self._last_changes = len(operations)
                self._last_error = None
            log.info("Synced %d state change(s) to private dataset %s", len(operations), self.repo_id)
            return True

    def status(self) -> dict:
        """Public non-sensitive backup and cache summary for the Settings UI."""
        with self._lock:
            snap = {
                "enabled": self.enabled,
                "repoId": self.repo_id if self.enabled else None,
                "encrypted": bool(self._fernet),
                "dirty": self._dirty,
                "lastSyncAt": self._last_sync_at,
                "lastRestoreAt": self._last_restore_at,
                "lastChanges": self._last_changes,
                "lastError": self._last_error,
                "syncedFiles": len(self._pushed),
            }
        thumb_bytes = 0
        video_bytes = 0
        for root, is_vid in ((config.THUMBS_DIR, False), (config.VIDEO_CACHE_DIR, True)):
            try:
                if root.exists():
                    total = sum(p.stat().st_size for p in root.iterdir() if p.is_file() and ".tmp" not in p.name)
                    if is_vid:
                        video_bytes = total
                    else:
                        thumb_bytes = total
            except OSError:
                pass
        snap["thumbCacheBytes"] = thumb_bytes
        snap["videoCacheBytes"] = video_bytes
        snap["cacheBytes"] = thumb_bytes + video_bytes
        return snap

    def stop(self) -> None:
        """Cancel pending timer and flush any unsaved state before process exit."""
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None
                self._due_at = None
            need_flush = self._dirty
        if self.enabled and need_flush:
            self.flush()


syncer = HFStateSync()


def start() -> bool:
    return syncer.start()


def mark_dirty(urgent: bool = False) -> None:
    syncer.mark_dirty(urgent=urgent)


def flush() -> bool:
    return syncer.flush()


def status() -> dict:
    return syncer.status()


def stop() -> None:
    syncer.stop()
