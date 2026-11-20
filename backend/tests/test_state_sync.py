"""Tests for HFStateSync (private dataset guard, encryption, restore, batched commits)."""
from __future__ import annotations

from pathlib import Path

import httpx
from huggingface_hub.errors import RepositoryNotFoundError

from backend.app import config, state_sync
from backend.app.state_sync import HFStateSync


class _FakeRepoInfo:
    def __init__(self, private: bool):
        self.private = private


class _FakeHfApi:
    def __init__(self, *, exists: bool = True, private: bool = True):
        self.exists = exists
        self.private = private
        self.created = []
        self.commits = []

    def repo_info(self, repo_id: str, repo_type: str = None, **kw):
        if not self.exists:
            resp = httpx.Response(404, request=httpx.Request("GET", "https://huggingface.co/api/datasets/test"))
            raise RepositoryNotFoundError("not found", response=resp)
        return _FakeRepoInfo(private=self.private)

    def create_repo(self, repo_id: str, repo_type: str = None, private: bool = False, exist_ok: bool = False, **kw):
        self.exists = True
        self.private = private
        self.created.append((repo_id, repo_type, private))

    def create_commit(self, repo_id: str, operations, commit_message: str, repo_type: str = None, **kw):
        self.commits.append((repo_id, repo_type, list(operations), commit_message))


def test_refuses_public_dataset(isolated_data):
    api = _FakeHfApi(exists=True, private=False)
    sync = HFStateSync(repo_id="user/public-ds", token="hf_test")
    assert sync.start(api=api) is False
    assert sync.enabled is False


def test_auto_creates_private_dataset_when_missing(isolated_data, monkeypatch):
    api = _FakeHfApi(exists=False, private=True)
    monkeypatch.setattr(HFStateSync, "_restore_from_remote", lambda self: None)

    sync = HFStateSync(repo_id="user/locket-data", token="hf_test")
    assert sync.start(api=api) is True
    assert sync.enabled is True
    assert api.created == [("user/locket-data", "dataset", True)]


def test_encrypted_flush_add_noop_update_delete_and_restore(isolated_data, monkeypatch, tmp_path):
    api = _FakeHfApi(exists=True, private=True)
    remote_store: dict[str, bytes] = {}

    def fake_commit(repo_id, operations, commit_message, repo_type=None, **kw):
        api.commits.append(list(operations))
        for op in operations:
            if hasattr(op, "path_or_fileobj"):
                data = op.path_or_fileobj if isinstance(op.path_or_fileobj, bytes) else Path(op.path_or_fileobj).read_bytes()
                remote_store[op.path_in_repo] = data
            else:
                remote_store.pop(op.path_in_repo, None)

    api.create_commit = fake_commit

    def fake_snapshot_download(repo_id, repo_type, token, local_dir, allow_patterns, **kw):
        root = Path(local_dir)
        for rel, payload in remote_store.items():
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        return str(root)

    import huggingface_hub
    monkeypatch.setattr(huggingface_hub, "snapshot_download", fake_snapshot_download)

    # 1. Start with encryption enabled
    sync = HFStateSync(repo_id="user/locket-data", token="hf_test", backup_key="super-secret-passphrase")
    assert sync.start(api=api) is True

    # Write local state files + a temp file (temp file must be ignored)
    sess_file = config.SESSIONS_DIR / "abc123" / "session.json"
    sess_file.parent.mkdir(parents=True, exist_ok=True)
    sess_file.write_text('{"idToken":"secret-firebase-token"}', encoding="utf-8")
    (sess_file.parent / "session.json.tmp1").write_text("ignore", encoding="utf-8")

    acc_file = config.ACCOUNTS_DIR / "acc1" / "moments.json"
    acc_file.parent.mkdir(parents=True, exist_ok=True)
    acc_file.write_text('{"moments":[{"id":"m1"}]}', encoding="utf-8")

    # Also write to thumbs/ - must NEVER be synced
    (config.THUMBS_DIR / "thumb.webp").write_bytes(b"img")

    # Flush pushes both files encrypted
    assert sync.flush() is True
    assert len(api.commits) == 1
    assert set(remote_store.keys()) == {"sessions/abc123/session.json.enc", "accounts/acc1/moments.json.enc"}
    assert b"secret-firebase-token" not in remote_store["sessions/abc123/session.json.enc"]

    # Second flush with no local changes -> 0 commits
    assert sync.flush() is False
    assert len(api.commits) == 1

    # Logout removes local session -> next flush deletes it from remote too
    sess_file.unlink()
    assert sync.flush() is True
    assert len(api.commits) == 2
    assert "sessions/abc123/session.json.enc" not in remote_store
    assert "accounts/acc1/moments.json.enc" in remote_store

    # 2. Simulate cold restart with empty local disk -> restore recovers decrypted accounts/moments.json
    acc_file.unlink()
    assert not acc_file.exists()

    sync2 = HFStateSync(repo_id="user/locket-data", token="hf_test", backup_key="super-secret-passphrase")
    assert sync2.start(api=api) is True
    assert acc_file.exists()
    assert acc_file.read_text(encoding="utf-8") == '{"moments":[{"id":"m1"}]}'
    # Restored state matches remote hash -> flush is a no-op
    assert sync2.flush() is False


def test_disabled_when_unconfigured(isolated_data):
    sync = HFStateSync(repo_id="", token="")
    assert sync.start() is False
    sync.mark_dirty(urgent=True)
    assert sync.flush() is False
    sync.stop()
    assert state_sync.syncer is not None
