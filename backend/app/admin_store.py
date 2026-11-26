"""Owner Admin persistence & live telemetry store.

Stores non-sensitive user analytics, daily metrics, live branding / feature-flag configuration,
access rules (ban / whitelist / invite codes), and audit logs inside `config.ADMIN_DIR`.
Because `"admin"` is part of `state_sync.SYNC_FOLDERS`, all files here are automatically
encrypted with Fernet AES and backed up to the private Hugging Face Dataset across container restarts.
"""
from __future__ import annotations

import copy
import csv
import io
import json
import logging
import os
import re
import secrets
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from . import config, state_sync

log = logging.getLogger(__name__)

VN_TZ = timezone(timedelta(hours=7))
ONLINE_WINDOW_SEC = 15 * 60
MAX_DAILY_RETENTION = 90
MAX_AUDIT_ENTRIES = 500
MAX_FEEDBACK_ENTRIES = 300
MAX_ERROR_ENTRIES = 100
MAX_LATENCY_SAMPLES = 250
STATS_FLUSH_DEBOUNCE_SEC = 25.0

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
VALID_ANNOUNCE_TYPES = ("info", "update", "warning", "maintenance")
VALID_FEEDBACK_CATEGORIES = ("bug", "suggestion", "feature", "gold_request")
VALID_FEEDBACK_STATUS = ("open", "resolved")
INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

DEFAULT_SITE_CONFIG: dict = {
    "appName": "Locket",
    "tagline": "Ảnh trực tiếp từ bạn bè, ngay trên màn hình chính",
    "accentColor": "#ffc629",
    "footerCredit": "Ứng dụng web không chính thức. Thông tin đăng nhập chỉ được gửi tới máy chủ của bạn và không lưu trên trình duyệt.",
    "announcement": {
        "enabled": False,
        "type": "info",
        "text": "",
        "link": "",
        "linkLabel": "",
    },
    "maintenance": {
        "enabled": False,
        "message": "Hệ thống đang bảo trì nâng cấp. Vui lòng quay lại sau ít phút nhé!",
    },
    "features": {
        "photobooth": True,
        "boothVideo": True,
        "smartCaptions": True,
        "cameraLooks": True,
        "zipExport": True,
        "chat": True,
    },
}

DEFAULT_ACCESS: dict = {
    "inviteOnly": False,
    "maxUsers": 0,
    "whitelist": [],
    "gold": {},
    "banned": {},
    "invites": [],
}

TOTAL_KEYS = ("logins", "moments", "photos", "videos", "photobooth", "messages", "weather", "music", "places", "exports")


def _today_key(ts: Optional[float] = None) -> str:
    dt = datetime.fromtimestamp(ts if ts is not None else time.time(), tz=VN_TZ)
    return dt.strftime("%Y-%m-%d")


def _date_keys(days: int) -> list[str]:
    now = datetime.now(tz=VN_TZ)
    return [(now - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days - 1, -1, -1)]


def _atomic_write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp")
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _read_json(path: Path, default):
    if not path.is_file():
        return copy.deepcopy(default)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data
    except Exception as exc:
        log.warning("Failed reading %s: %s", path.name, exc)
        return copy.deepcopy(default)


def _dir_stats(root: Path) -> tuple[int, int]:
    """Return `(total_bytes, file_count)` excluding temporary `.tmp` files."""
    if not root.exists():
        return 0, 0
    total = 0
    count = 0
    try:
        for p in root.rglob("*"):
            if p.is_file() and ".tmp" not in p.name:
                try:
                    total += p.stat().st_size
                    count += 1
                except OSError:
                    pass
    except OSError:
        pass
    return total, count


def _dir_bytes(root: Path) -> int:
    return _dir_stats(root)[0]


def _safe_link(url: str) -> str:
    u = (url or "").strip()[:300]
    if not u:
        return ""
    low = u.lower()
    if low.startswith(("https://", "http://", "/")):
        return u
    return ""


def _safe_csv_cell(val: object) -> str:
    s = "" if val is None else str(val)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def _merge_site_config(raw: object) -> dict:
    base = copy.deepcopy(DEFAULT_SITE_CONFIG)
    if not isinstance(raw, dict):
        return base
    if isinstance(raw.get("appName"), str) and raw["appName"].strip():
        base["appName"] = raw["appName"].strip()[:36]
    if isinstance(raw.get("tagline"), str):
        base["tagline"] = raw["tagline"].strip()[:140]
    if isinstance(raw.get("accentColor"), str) and HEX_COLOR_RE.match(raw["accentColor"].strip()):
        base["accentColor"] = raw["accentColor"].strip().lower()
    if isinstance(raw.get("footerCredit"), str):
        base["footerCredit"] = raw["footerCredit"].strip()[:240]
    ann = raw.get("announcement")
    if isinstance(ann, dict):
        base["announcement"]["enabled"] = bool(ann.get("enabled", False))
        atype = str(ann.get("type") or "info").strip().lower()
        base["announcement"]["type"] = atype if atype in VALID_ANNOUNCE_TYPES else "info"
        base["announcement"]["text"] = str(ann.get("text") or "").strip()[:240]
        base["announcement"]["link"] = _safe_link(str(ann.get("link") or ""))
        base["announcement"]["linkLabel"] = str(ann.get("linkLabel") or "").strip()[:40]
    mnt = raw.get("maintenance")
    if isinstance(mnt, dict):
        base["maintenance"]["enabled"] = bool(mnt.get("enabled", False))
        msg = str(mnt.get("message") or "").strip()[:260]
        if msg:
            base["maintenance"]["message"] = msg
    feats = raw.get("features")
    if isinstance(feats, dict):
        for k in list(base["features"].keys()):
            if k in feats:
                base["features"][k] = bool(feats[k])
    return base


def _merge_access(raw: object) -> dict:
    base = copy.deepcopy(DEFAULT_ACCESS)
    if not isinstance(raw, dict):
        return base
    base["inviteOnly"] = bool(raw.get("inviteOnly", False))
    try:
        base["maxUsers"] = max(0, min(100000, int(raw.get("maxUsers") or 0)))
    except (TypeError, ValueError):
        base["maxUsers"] = 0
    wl = raw.get("whitelist")
    if isinstance(wl, list):
        cleaned = []
        seen = set()
        for item in wl:
            s = str(item or "").strip()
            if not s or len(s) > 254:
                continue
            key = s.lower() if "@" in s else s
            if key not in seen:
                seen.add(key)
                cleaned.append(key)
        base["whitelist"] = cleaned[:1000]
    gold = raw.get("gold")
    if isinstance(gold, dict):
        out_g = {}
        for uid, info in gold.items():
            u = str(uid or "").strip()
            if not u or not isinstance(info, dict):
                continue
            out_g[u] = {
                "at": int(info.get("at") or 0),
                "since": str(info.get("since") or "").strip()[:12],
                "by": str(info.get("by") or "admin")[:80],
                "note": str(info.get("note") or "").strip()[:160],
                "email": str(info.get("email") or "").strip().lower()[:254],
            }
        base["gold"] = out_g
    banned = raw.get("banned")
    if isinstance(banned, dict):
        out_b = {}
        for uid, info in banned.items():
            u = str(uid or "").strip()
            if not u or not isinstance(info, dict):
                continue
            out_b[u] = {
                "reason": str(info.get("reason") or "").strip()[:200],
                "at": int(info.get("at") or 0),
                "by": str(info.get("by") or "admin")[:80],
                "name": str(info.get("name") or "")[:80],
                "username": str(info.get("username") or "")[:64],
                "email": str(info.get("email") or "").strip().lower()[:254],
            }
        base["banned"] = out_b
    invites = raw.get("invites")
    if isinstance(invites, list):
        out_inv = []
        for inv in invites[:200]:
            if not isinstance(inv, dict):
                continue
            code = str(inv.get("code") or "").strip().upper()
            if not code:
                continue
            out_inv.append({
                "code": code[:32],
                "label": str(inv.get("label") or "").strip()[:60],
                "maxUses": max(0, min(10000, int(inv.get("maxUses") or 0))),
                "uses": max(0, int(inv.get("uses") or 0)),
                "expiresAt": int(inv.get("expiresAt") or 0),
                "createdAt": int(inv.get("createdAt") or 0),
                "active": bool(inv.get("active", True)),
            })
        base["invites"] = out_inv
    return base


def _empty_day() -> dict:
    return {
        "activeUids": [],
        "logins": 0,
        "moments": 0,
        "photos": 0,
        "videos": 0,
        "photobooth": 0,
        "messages": 0,
        "weather": 0,
        "music": 0,
        "places": 0,
        "exports": 0,
    }


def _empty_metrics() -> dict:
    return {
        "daily": {},
        "totals": {k: 0 for k in TOTAL_KEYS},
    }


class AdminStore:
    def __init__(self):
        self._lock = threading.RLock()
        self._started_at = time.time()
        self._users: dict[str, dict] = {}
        self._metrics: dict = _empty_metrics()
        self._site_config: dict = copy.deepcopy(DEFAULT_SITE_CONFIG)
        self._access: dict = copy.deepcopy(DEFAULT_ACCESS)
        self._feedback: list[dict] = []
        self._audit: deque[dict] = deque(maxlen=MAX_AUDIT_ENTRIES)
        self._active_seen: dict[str, float] = {}
        self._latencies: deque[float] = deque(maxlen=MAX_LATENCY_SAMPLES)
        self._req_total = 0
        self._req_4xx = 0
        self._req_5xx = 0
        self._recent_errors: deque[dict] = deque(maxlen=MAX_ERROR_ENTRIES)
        self._dirty_stats = False
        self._flush_timer: Optional[threading.Timer] = None
        self.reload_from_disk()

    # ------------------------------------------------------------------ paths
    def _users_path(self) -> Path:
        return config.ADMIN_DIR / "users.json"

    def _metrics_path(self) -> Path:
        return config.ADMIN_DIR / "metrics.json"

    def _site_config_path(self) -> Path:
        return config.ADMIN_DIR / "site_config.json"

    def _access_path(self) -> Path:
        return config.ADMIN_DIR / "access.json"

    def _feedback_path(self) -> Path:
        return config.ADMIN_DIR / "feedback.json"

    def _audit_path(self) -> Path:
        return config.ADMIN_DIR / "audit.jsonl"

    # ------------------------------------------------------------------ lifecycle
    def reload_from_disk(self) -> None:
        with self._lock:
            config.ADMIN_DIR.mkdir(parents=True, exist_ok=True)
            raw_users = _read_json(self._users_path(), {})
            self._users = raw_users if isinstance(raw_users, dict) else {}

            raw_metrics = _read_json(self._metrics_path(), _empty_metrics())
            if isinstance(raw_metrics, dict):
                totals = {k: int((raw_metrics.get("totals") or {}).get(k) or 0) for k in TOTAL_KEYS}
                daily = raw_metrics.get("daily") if isinstance(raw_metrics.get("daily"), dict) else {}
                self._metrics = {"daily": daily, "totals": totals}
            else:
                self._metrics = _empty_metrics()

            self._site_config = _merge_site_config(_read_json(self._site_config_path(), DEFAULT_SITE_CONFIG))
            self._access = _merge_access(_read_json(self._access_path(), DEFAULT_ACCESS))

            raw_fb = _read_json(self._feedback_path(), [])
            self._feedback = [item for item in raw_fb if isinstance(item, dict) and item.get("id")][:MAX_FEEDBACK_ENTRIES] if isinstance(raw_fb, list) else []

            self._audit.clear()
            audit_p = self._audit_path()
            if audit_p.is_file():
                try:
                    lines = audit_p.read_text(encoding="utf-8").splitlines()
                    for line in lines[-MAX_AUDIT_ENTRIES:]:
                        if not line.strip():
                            continue
                        try:
                            entry = json.loads(line)
                            if isinstance(entry, dict):
                                self._audit.append(entry)
                        except ValueError:
                            pass
                except OSError:
                    pass

    def reset_in_memory(self) -> None:
        """Reset RAM counters & timers and reload from current config.ADMIN_DIR (for test isolation)."""
        with self._lock:
            if self._flush_timer is not None:
                self._flush_timer.cancel()
                self._flush_timer = None
            self._dirty_stats = False
            self._active_seen.clear()
            self._latencies.clear()
            self._recent_errors.clear()
            self._req_total = 0
            self._req_4xx = 0
            self._req_5xx = 0
            self._started_at = time.time()
            self.reload_from_disk()

    def _schedule_stats_flush_locked(self) -> None:
        self._dirty_stats = True
        if self._flush_timer is not None:
            return
        t = threading.Timer(STATS_FLUSH_DEBOUNCE_SEC, self._flush_timer_fired)
        t.daemon = True
        t.name = "admin-stats-flush"
        self._flush_timer = t
        t.start()

    def _flush_timer_fired(self) -> None:
        with self._lock:
            self._flush_timer = None
        self.flush()

    def flush(self) -> bool:
        with self._lock:
            if self._flush_timer is not None:
                self._flush_timer.cancel()
                self._flush_timer = None
            if not self._dirty_stats:
                return False
            users_snap = copy.deepcopy(self._users)
            metrics_snap = copy.deepcopy(self._metrics)
            self._dirty_stats = False
        try:
            _atomic_write_json(self._users_path(), users_snap)
            _atomic_write_json(self._metrics_path(), metrics_snap)
            state_sync.mark_dirty()
            return True
        except Exception as exc:
            log.warning("Failed flushing admin stats: %s", exc)
            with self._lock:
                self._dirty_stats = True
            return False

    def _save_site_config_locked(self) -> None:
        _atomic_write_json(self._site_config_path(), self._site_config)
        state_sync.mark_dirty(urgent=True)

    def _save_access_locked(self) -> None:
        _atomic_write_json(self._access_path(), self._access)
        state_sync.mark_dirty(urgent=True)

    def _save_audit_locked(self) -> None:
        path = self._audit_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp")
        text = "\n".join(json.dumps(e, ensure_ascii=False) for e in self._audit) + ("\n" if self._audit else "")
        try:
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, path)
        except BaseException:
            try:
                tmp.unlink(missing_ok=True)
            except OSError:
                pass
            raise
        state_sync.mark_dirty()

    def append_audit(self, actor: str, action: str, target: str = "", detail: str = "") -> dict:
        entry = {
            "at": int(time.time() * 1000),
            "actor": str(actor or "admin")[:80],
            "action": str(action or "")[:64],
            "target": str(target or "")[:80],
            "detail": str(detail or "")[:200],
        }
        with self._lock:
            self._audit.append(entry)
            try:
                self._save_audit_locked()
            except Exception as exc:
                log.warning("Failed saving audit log: %s", exc)
        return entry

    # ------------------------------------------------------------------ telemetry
    def _day_bucket_locked(self, day_key: Optional[str] = None) -> dict:
        key = day_key or _today_key()
        daily = self._metrics.setdefault("daily", {})
        bucket = daily.get(key)
        if not isinstance(bucket, dict):
            bucket = _empty_day()
            daily[key] = bucket
        # Prune old days beyond retention window
        if len(daily) > MAX_DAILY_RETENTION:
            keep = set(_date_keys(MAX_DAILY_RETENTION))
            for k in list(daily.keys()):
                if k not in keep:
                    daily.pop(k, None)
        return bucket

    def _ensure_user_locked(self, uid: str, user_info: Optional[dict] = None, email: str = "", now_ms: Optional[int] = None) -> dict:
        now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
        rec = self._users.get(uid)
        if not isinstance(rec, dict):
            rec = {
                "uid": uid,
                "email": "",
                "name": "",
                "firstName": "",
                "lastName": "",
                "username": "",
                "avatar": None,
                "firstSeen": now_ms,
                "lastSeen": now_ms,
                "logins": 0,
                "moments": 0,
                "photos": 0,
                "videos": 0,
                "photobooth": 0,
                "messages": 0,
                "tools": 0,
                "invited": False,
                "note": "",
                "lastIp": "",
            }
            self._users[uid] = rec
        if email:
            rec["email"] = email.strip().lower()[:254]
        if isinstance(user_info, dict):
            for k in ("name", "firstName", "lastName", "username"):
                val = user_info.get(k)
                if isinstance(val, str) and val.strip():
                    rec[k] = val.strip()[:80]
            if user_info.get("email") and not rec["email"]:
                rec["email"] = str(user_info["email"]).strip().lower()[:254]
            if "avatar" in user_info and user_info["avatar"]:
                rec["avatar"] = str(user_info["avatar"])[:600]
        rec["lastSeen"] = now_ms
        return rec

    def record_login(self, user: dict, email: str = "", ip: str = "", invited: bool = False) -> None:
        uid = str((user or {}).get("uid") or "").strip()
        if not uid:
            return
        now = time.time()
        now_ms = int(now * 1000)
        with self._lock:
            rec = self._ensure_user_locked(uid, user_info=user, email=email, now_ms=now_ms)
            rec["logins"] = int(rec.get("logins") or 0) + 1
            if ip:
                rec["lastIp"] = str(ip)[:64]
            if invited:
                rec["invited"] = True
            self._active_seen[uid] = now

            day = self._day_bucket_locked()
            day["logins"] = int(day.get("logins") or 0) + 1
            if uid not in day["activeUids"]:
                day["activeUids"].append(uid)
            self._metrics["totals"]["logins"] = int(self._metrics["totals"].get("logins") or 0) + 1
            self._schedule_stats_flush_locked()

    def touch_user(self, uid: Optional[str], user_info: Optional[dict] = None, email: str = "") -> None:
        u = (uid or "").strip()
        if not u:
            return
        now = time.time()
        now_ms = int(now * 1000)
        with self._lock:
            prev_seen = self._active_seen.get(u, 0.0)
            self._active_seen[u] = now
            rec = self._users.get(u)
            is_new = rec is None
            if is_new or user_info or (now - prev_seen >= 60):
                self._ensure_user_locked(u, user_info=user_info, email=email, now_ms=now_ms)
                day = self._day_bucket_locked()
                if u not in day["activeUids"]:
                    day["activeUids"].append(u)
                self._schedule_stats_flush_locked()

    def record_event(self, uid: Optional[str], kind: str) -> None:
        u = (uid or "").strip()
        now = time.time()
        with self._lock:
            day = self._day_bucket_locked()
            totals = self._metrics["totals"]
            rec = self._ensure_user_locked(u, now_ms=int(now * 1000)) if u else None
            if u:
                self._active_seen[u] = now
                if u not in day["activeUids"]:
                    day["activeUids"].append(u)

            if kind in ("photo", "video"):
                day["moments"] = int(day.get("moments") or 0) + 1
                totals["moments"] = int(totals.get("moments") or 0) + 1
                plural = "photos" if kind == "photo" else "videos"
                day[plural] = int(day.get(plural) or 0) + 1
                totals[plural] = int(totals.get(plural) or 0) + 1
                if rec is not None:
                    rec["moments"] = int(rec.get("moments") or 0) + 1
                    rec[plural] = int(rec.get(plural) or 0) + 1
            elif kind == "photobooth":
                day["photobooth"] = int(day.get("photobooth") or 0) + 1
                totals["photobooth"] = int(totals.get("photobooth") or 0) + 1
                if rec is not None:
                    rec["photobooth"] = int(rec.get("photobooth") or 0) + 1
            elif kind == "message":
                day["messages"] = int(day.get("messages") or 0) + 1
                totals["messages"] = int(totals.get("messages") or 0) + 1
                if rec is not None:
                    rec["messages"] = int(rec.get("messages") or 0) + 1
            elif kind in ("weather", "music", "places", "export"):
                key = "exports" if kind == "export" else kind
                day[key] = int(day.get(key) or 0) + 1
                totals[key] = int(totals.get(key) or 0) + 1
                if rec is not None:
                    rec["tools"] = int(rec.get("tools") or 0) + 1

            self._schedule_stats_flush_locked()

    def record_request(self, method: str, path: str, status: int, elapsed_ms: float, detail: str = "") -> None:
        with self._lock:
            self._req_total += 1
            if 400 <= status < 500:
                self._req_4xx += 1
            elif status >= 500:
                self._req_5xx += 1
                self._recent_errors.append({
                    "at": int(time.time() * 1000),
                    "method": method[:10],
                    "path": path[:160],
                    "status": int(status),
                    "detail": (detail or f"HTTP {status}")[:220],
                })
            # Skip binary streaming media proxy from JSON API latency stats
            if path != "/api/media" and path != "/api/memories/export":
                self._latencies.append(round(max(0.0, float(elapsed_ms)), 1))

    # ------------------------------------------------------------------ site config & feature flags
    def get_site_config(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._site_config)

    def get_public_site_config(self) -> dict:
        with self._lock:
            cfg = copy.deepcopy(self._site_config)
            cfg["inviteOnly"] = bool(self._access.get("inviteOnly", False))
            return cfg

    def is_maintenance(self) -> bool:
        with self._lock:
            return bool(self._site_config["maintenance"]["enabled"])

    def maintenance_message(self) -> str:
        with self._lock:
            return self._site_config["maintenance"]["message"]

    def feature_enabled(self, name: str) -> bool:
        with self._lock:
            return bool(self._site_config["features"].get(name, True))

    def update_site_config(self, patch: dict, actor: str) -> dict:
        with self._lock:
            cur = copy.deepcopy(self._site_config)
            if isinstance(patch, dict):
                for top in ("appName", "tagline", "accentColor", "footerCredit"):
                    if top in patch:
                        cur[top] = patch[top]
                if isinstance(patch.get("announcement"), dict):
                    cur["announcement"].update(patch["announcement"])
                if isinstance(patch.get("maintenance"), dict):
                    cur["maintenance"].update(patch["maintenance"])
                if isinstance(patch.get("features"), dict):
                    cur["features"].update(patch["features"])
            self._site_config = _merge_site_config(cur)
            self._save_site_config_locked()
            result = copy.deepcopy(self._site_config)
        self.append_audit(actor, "config.update", detail=f"appName={result['appName']}, maintenance={result['maintenance']['enabled']}")
        return result

    # ------------------------------------------------------------------ access control (ban / whitelist / invites)
    def get_access(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._access)

    def is_banned(self, uid: Optional[str] = None, email: Optional[str] = None) -> Optional[dict]:
        u = (uid or "").strip()
        e = (email or "").strip().lower()
        with self._lock:
            banned = self._access["banned"]
            if u and u in banned:
                return copy.deepcopy(banned[u])
            if e:
                for info in banned.values():
                    if info.get("email") and info["email"].lower() == e:
                        return copy.deepcopy(info)
            return None

    def check_pre_login(self, email: str, *, is_admin: bool) -> Optional[tuple[int, str]]:
        if is_admin:
            return None
        with self._lock:
            if self._site_config["maintenance"]["enabled"]:
                return 503, self._site_config["maintenance"]["message"]
        ban = self.is_banned(email=email)
        if ban:
            reason = f" Lý do: {ban['reason']}" if ban.get("reason") else ""
            return 403, f"Tài khoản này đã bị hạn chế truy cập.{reason}"
        return None

    def check_and_consume_login_access(
        self,
        uid: str,
        email: str,
        invite_code: str = "",
        *,
        is_admin: bool,
    ) -> tuple[Optional[tuple[int, str]], bool]:
        """Validate post-Firebase-auth access rules. Returns `(error_tuple_or_None, used_invite)`."""
        if is_admin:
            return None, False
        u = (uid or "").strip()
        e = (email or "").strip().lower()
        code = (invite_code or "").strip().upper()
        now_ms = int(time.time() * 1000)

        with self._lock:
            if self._site_config["maintenance"]["enabled"]:
                return (503, self._site_config["maintenance"]["message"]), False

            ban = self._access["banned"].get(u)
            if not ban and e:
                for info in self._access["banned"].values():
                    if info.get("email") and info["email"].lower() == e:
                        ban = info
                        break
            if ban:
                reason = f" Lý do: {ban['reason']}" if ban.get("reason") else ""
                return (403, f"Tài khoản này đã bị hạn chế truy cập.{reason}"), False

            existing = self._users.get(u)
            max_users = int(self._access.get("maxUsers") or 0)
            if max_users > 0 and existing is None and len(self._users) >= max_users:
                return (403, f"Ứng dụng đã đạt giới hạn {max_users} người dùng. Vui lòng liên hệ chủ sở hữu."), False

            if not self._access.get("inviteOnly"):
                return None, False

            # Invite-Only mode: allow if whitelisted, previously invited, or redeeming a valid invite code
            wl = set(self._access.get("whitelist") or [])
            if (u and u in wl) or (e and e in wl):
                return None, False
            if isinstance(existing, dict) and existing.get("invited"):
                return None, False

            if not code:
                return (
                    403,
                    "Ứng dụng đang bật chế độ riêng tư (chỉ người được mời). Hãy nhập Mã mời để đăng nhập.",
                ), False

            matched = None
            for inv in self._access["invites"]:
                if inv["code"].upper() == code:
                    matched = inv
                    break
            if not matched or not matched.get("active", True):
                return (403, "Mã mời không tồn tại hoặc đã bị thu hồi."), False
            if matched.get("expiresAt") and matched["expiresAt"] < now_ms:
                return (403, "Mã mời này đã hết hạn."), False
            if matched.get("maxUses") and matched["uses"] >= matched["maxUses"]:
                return (403, "Mã mời này đã hết lượt sử dụng."), False

            matched["uses"] = int(matched.get("uses") or 0) + 1
            self._save_access_locked()
            return None, True

    def ban_user(self, uid: str, reason: str, actor: str) -> dict:
        u = (uid or "").strip()
        if not u:
            raise ValueError("Thiếu UID người dùng.")
        with self._lock:
            rec = self._users.get(u) or {}
            entry = {
                "reason": (reason or "").strip()[:200],
                "at": int(time.time() * 1000),
                "by": str(actor or "admin")[:80],
                "name": str(rec.get("name") or "")[:80],
                "username": str(rec.get("username") or "")[:64],
                "email": str(rec.get("email") or "").strip().lower()[:254],
            }
            self._access["banned"][u] = entry
            self._save_access_locked()
        self.append_audit(actor, "user.ban", target=u, detail=entry["reason"] or "Không ghi lý do")
        return entry

    def unban_user(self, uid: str, actor: str) -> bool:
        u = (uid or "").strip()
        with self._lock:
            removed = self._access["banned"].pop(u, None) is not None
            if removed:
                self._save_access_locked()
        if removed:
            self.append_audit(actor, "user.unban", target=u)
        return removed

    def set_user_note(self, uid: str, note: str, actor: str) -> str:
        u = (uid or "").strip()
        if not u:
            raise ValueError("Thiếu UID người dùng.")
        cleaned = (note or "").strip()[:300]
        with self._lock:
            rec = self._ensure_user_locked(u)
            rec["note"] = cleaned
            users_snap = copy.deepcopy(self._users)
            metrics_snap = copy.deepcopy(self._metrics)
            self._dirty_stats = False
        _atomic_write_json(self._users_path(), users_snap)
        _atomic_write_json(self._metrics_path(), metrics_snap)
        state_sync.mark_dirty()
        self.append_audit(actor, "user.note", target=u, detail=cleaned[:120] or "(đã xóa ghi chú)")
        return cleaned

    def set_user_whitelist(self, uid: str, enabled: bool, actor: str, email: str = "") -> dict:
        u = (uid or "").strip()
        with self._lock:
            rec = self._users.get(u) or {}
            em = (email or rec.get("email") or "").strip().lower()
            wl = list(self._access.get("whitelist") or [])
            if enabled:
                key = em or u
                if key and key not in wl and u not in wl:
                    wl.append(key)
            else:
                wl = [item for item in wl if item != u and (not em or item.lower() != em)]
            self._access["whitelist"] = wl[:1000]
            self._save_access_locked()
            whitelisted = (u in self._access["whitelist"]) or (bool(em) and em in self._access["whitelist"])
        self.append_audit(actor, "access.whitelist", target=em or u, detail="added" if enabled else "removed")
        return {"whitelisted": whitelisted, "whitelistCount": len(self._access["whitelist"])}

    # ------------------------------------------------------------------ Locket Gold VIP & Feedback Inbox
    def _save_feedback_locked(self) -> None:
        _atomic_write_json(self._feedback_path(), self._feedback[:MAX_FEEDBACK_ENTRIES])
        state_sync.mark_dirty(urgent=True)

    def _gold_entry_locked(self, uid: Optional[str] = None, email: Optional[str] = None) -> Optional[dict]:
        u = (uid or "").strip()
        e = (email or "").strip().lower()
        gold_map = self._access.get("gold") or {}
        if u and u in gold_map:
            return gold_map[u]
        if e:
            for info in gold_map.values():
                if info.get("email") and info["email"].lower() == e:
                    return info
        return None

    def gold_info(self, uid: Optional[str] = None, email: Optional[str] = None, *, is_admin: bool = False) -> dict:
        u = (uid or "").strip()
        e = (email or "").strip().lower()
        with self._lock:
            entry = self._gold_entry_locked(u, e)
            if entry is not None:
                yr = entry.get("since") or (
                    str(datetime.fromtimestamp(entry["at"] / 1000.0, tz=VN_TZ).year) if entry.get("at") else str(datetime.now(tz=VN_TZ).year)
                )
                return {
                    "active": True,
                    "since": yr,
                    "grantedAt": int(entry.get("at") or 0),
                    "tier": "owner" if (is_admin or config.is_admin_identity(u, e)) else "vip",
                }
            if is_admin or config.is_admin_identity(u, e):
                return {
                    "active": True,
                    "since": str(datetime.now(tz=VN_TZ).year),
                    "grantedAt": 0,
                    "tier": "owner",
                }
        return {"active": False, "since": "", "grantedAt": 0, "tier": "free"}

    def set_user_gold(self, uid: str, enabled: bool, actor: str, email: str = "", note: str = "") -> dict:
        u = (uid or "").strip()
        if not u:
            raise ValueError("Thiếu UID người dùng.")
        now_ms = int(time.time() * 1000)
        year_str = str(datetime.now(tz=VN_TZ).year)
        with self._lock:
            rec = self._users.get(u) or {}
            em = (email or rec.get("email") or "").strip().lower()
            gold_map = self._access.setdefault("gold", {})
            if enabled:
                prev = gold_map.get(u) or {}
                gold_map[u] = {
                    "at": int(prev.get("at") or now_ms),
                    "since": str(prev.get("since") or year_str)[:12],
                    "by": str(actor or "admin")[:80],
                    "note": (note or prev.get("note") or "").strip()[:160],
                    "email": em[:254],
                }
            else:
                gold_map.pop(u, None)
                if em:
                    for k in [k for k, v in gold_map.items() if (v.get("email") or "").lower() == em]:
                        gold_map.pop(k, None)
            self._save_access_locked()
            info = self.gold_info(u, em)
            gold_count = len(self._access.get("gold") or {})
        self.append_audit(
            actor,
            "user.gold_grant" if enabled else "user.gold_revoke",
            target=em or u,
            detail=(note or "").strip()[:120] or ("Đã cấp Locket Gold VIP" if enabled else "Đã thu hồi Locket Gold"),
        )
        return {"isGold": info["active"], "goldSince": info["since"], "goldCount": gold_count}

    def submit_feedback(
        self,
        user: dict,
        category: str,
        message: str,
        title: str = "",
        meta: Optional[dict] = None,
    ) -> dict:
        cat = (category or "suggestion").strip().lower()
        if cat not in VALID_FEEDBACK_CATEGORIES:
            cat = "suggestion"
        msg = (message or "").strip()[:1500]
        if not msg:
            raise ValueError("Nội dung gửi không được để trống.")
        subj = (title or "").strip()[:120]
        uid = str((user or {}).get("uid") or "").strip()[:64]
        email = str((user or {}).get("email") or "").strip().lower()[:254]
        now_ms = int(time.time() * 1000)
        safe_meta = {}
        if isinstance(meta, dict):
            for k in ("platform", "appIcon", "cameraTheme", "screen", "appVersion"):
                if meta.get(k):
                    safe_meta[k] = str(meta[k]).strip()[:80]
        item = {
            "id": f"fb_{now_ms}_{secrets.token_hex(3)}",
            "uid": uid,
            "name": str((user or {}).get("name") or "")[:80],
            "username": str((user or {}).get("username") or "")[:64],
            "email": email,
            "avatar": str((user or {}).get("avatar") or "")[:600] if (user or {}).get("avatar") else None,
            "category": cat,
            "title": subj,
            "message": msg,
            "meta": safe_meta,
            "status": "open",
            "adminNote": "",
            "createdAt": now_ms,
            "updatedAt": now_ms,
        }
        with self._lock:
            self._feedback.insert(0, item)
            self._feedback = self._feedback[:MAX_FEEDBACK_ENTRIES]
            self._save_feedback_locked()
        return copy.deepcopy(item)

    def list_feedback(self, status: str = "all", category: str = "all", q: str = "") -> dict:
        with self._lock:
            raw_list = copy.deepcopy(self._feedback)
            rows = []
            for item in raw_list:
                ginfo = self.gold_info(item.get("uid"), item.get("email"))
                item["isGold"] = ginfo["active"]
                item["goldSince"] = ginfo["since"]
                rows.append(item)

        counts = {
            "all": len(rows),
            "open": sum(1 for r in rows if r.get("status") == "open"),
            "resolved": sum(1 for r in rows if r.get("status") == "resolved"),
            "gold_request": sum(1 for r in rows if r.get("category") == "gold_request"),
            "bug": sum(1 for r in rows if r.get("category") == "bug"),
            "suggestion": sum(1 for r in rows if r.get("category") in ("suggestion", "feature")),
        }
        if status in VALID_FEEDBACK_STATUS:
            rows = [r for r in rows if r.get("status") == status]
        if category == "gold_request":
            rows = [r for r in rows if r.get("category") == "gold_request"]
        elif category == "bug":
            rows = [r for r in rows if r.get("category") == "bug"]
        elif category == "suggestion":
            rows = [r for r in rows if r.get("category") in ("suggestion", "feature")]

        query = (q or "").strip().lower()
        if query:
            rows = [
                r for r in rows
                if query in (r.get("name") or "").lower()
                or query in (r.get("username") or "").lower()
                or query in (r.get("email") or "").lower()
                or query in (r.get("title") or "").lower()
                or query in (r.get("message") or "").lower()
                or query in (r.get("adminNote") or "").lower()
            ]
        return {"items": rows, "counts": counts}

    def update_feedback(
        self,
        fid: str,
        *,
        status: Optional[str] = None,
        admin_note: Optional[str] = None,
        actor: str = "admin",
    ) -> Optional[dict]:
        target = (fid or "").strip()
        if not target:
            return None
        updated = None
        with self._lock:
            for item in self._feedback:
                if item.get("id") == target:
                    if status in VALID_FEEDBACK_STATUS:
                        item["status"] = status
                    if admin_note is not None:
                        item["adminNote"] = str(admin_note).strip()[:300]
                    item["updatedAt"] = int(time.time() * 1000)
                    updated = copy.deepcopy(item)
                    ginfo = self.gold_info(updated.get("uid"), updated.get("email"))
                    updated["isGold"] = ginfo["active"]
                    updated["goldSince"] = ginfo["since"]
                    break
            if updated is not None:
                self._save_feedback_locked()
        if updated is not None:
            self.append_audit(actor, "feedback.update", target=target, detail=f"status={updated.get('status')}")
        return updated

    def delete_feedback(self, fid: str, actor: str = "admin") -> bool:
        target = (fid or "").strip()
        with self._lock:
            before = len(self._feedback)
            self._feedback = [item for item in self._feedback if item.get("id") != target]
            removed = len(self._feedback) < before
            if removed:
                self._save_feedback_locked()
        if removed:
            self.append_audit(actor, "feedback.delete", target=target)
        return removed

    def update_access(self, patch: dict, actor: str) -> dict:
        with self._lock:
            cur = copy.deepcopy(self._access)
            if isinstance(patch, dict):
                if "inviteOnly" in patch:
                    cur["inviteOnly"] = bool(patch["inviteOnly"])
                if "maxUsers" in patch:
                    cur["maxUsers"] = patch["maxUsers"]
                if "whitelist" in patch and isinstance(patch["whitelist"], list):
                    cur["whitelist"] = patch["whitelist"]
            self._access = _merge_access(cur)
            self._save_access_locked()
            res = copy.deepcopy(self._access)
        self.append_audit(
            actor,
            "access.update",
            detail=f"inviteOnly={res['inviteOnly']}, maxUsers={res['maxUsers']}, whitelist={len(res['whitelist'])}",
        )
        return res

    def create_invite(self, label: str = "", max_uses: int = 5, expires_days: int = 0, actor: str = "admin") -> dict:
        now_ms = int(time.time() * 1000)
        expires_at = now_ms + max(0, int(expires_days)) * 86400 * 1000 if expires_days and expires_days > 0 else 0
        with self._lock:
            existing_codes = {i["code"] for i in self._access["invites"]}
            code = ""
            for _ in range(20):
                rand = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(6))
                cand = f"LCK-{rand}"
                if cand not in existing_codes:
                    code = cand
                    break
            if not code:
                code = f"LCK-{secrets.token_hex(4).upper()}"
            inv = {
                "code": code,
                "label": (label or "").strip()[:60],
                "maxUses": max(0, min(10000, int(max_uses or 0))),
                "uses": 0,
                "expiresAt": expires_at,
                "createdAt": now_ms,
                "active": True,
            }
            self._access["invites"].insert(0, inv)
            self._access["invites"] = self._access["invites"][:200]
            self._save_access_locked()
        self.append_audit(actor, "invite.create", target=code, detail=f"label={inv['label']}, maxUses={inv['maxUses']}")
        return inv

    def revoke_invite(self, code: str, actor: str) -> bool:
        target = (code or "").strip().upper()
        with self._lock:
            before = len(self._access["invites"])
            self._access["invites"] = [i for i in self._access["invites"] if i["code"].upper() != target]
            removed = len(self._access["invites"]) < before
            if removed:
                self._save_access_locked()
        if removed:
            self.append_audit(actor, "invite.revoke", target=target)
        return removed

    # ------------------------------------------------------------------ dashboard queries
    def overview(self, sessions_summary: list[dict], hf_status: dict) -> dict:
        now = time.time()
        today = _today_key(now)
        days30 = _date_keys(30)
        days7 = set(days30[-7:])

        with self._lock:
            # Prune expired online entries
            cutoff = now - ONLINE_WINDOW_SEC
            for uid in [u for u, ts in self._active_seen.items() if ts < cutoff]:
                self._active_seen.pop(uid, None)
            online_uids = set(self._active_seen.keys())

            daily = self._metrics.get("daily") or {}
            wau_set: set[str] = set()
            mau_set: set[str] = set()
            series30 = []
            for dkey in days30:
                b = daily.get(dkey) if isinstance(daily.get(dkey), dict) else {}
                uids = b.get("activeUids") or []
                mau_set.update(uids)
                if dkey in days7:
                    wau_set.update(uids)
                tools_cnt = int(b.get("weather") or 0) + int(b.get("music") or 0) + int(b.get("places") or 0) + int(b.get("exports") or 0)
                series30.append({
                    "date": dkey,
                    "label": dkey[8:10] + "/" + dkey[5:7],
                    "dau": len(uids),
                    "logins": int(b.get("logins") or 0),
                    "moments": int(b.get("moments") or 0),
                    "photos": int(b.get("photos") or 0),
                    "videos": int(b.get("videos") or 0),
                    "photobooth": int(b.get("photobooth") or 0),
                    "messages": int(b.get("messages") or 0),
                    "tools": tools_cnt,
                })

            today_b = daily.get(today) if isinstance(daily.get(today), dict) else _empty_day()
            yest_key = days30[-2] if len(days30) >= 2 else today
            yest_b = daily.get(yest_key) if isinstance(daily.get(yest_key), dict) else _empty_day()
            dau_uids = set(today_b.get("activeUids") or []) | online_uids
            wau_set |= online_uids
            mau_set |= online_uids

            # Count users whose firstSeen falls on Vietnam "today"
            new_today = 0
            for u in self._users.values():
                fs = int(u.get("firstSeen") or 0)
                if fs and _today_key(fs / 1000.0) == today:
                    new_today += 1

            # Also count UIDs only present in disk sessions (e.g. logged in before admin existed)
            known_uids = set(self._users.keys())
            for s in sessions_summary:
                if s.get("uid"):
                    known_uids.add(s["uid"])

            # Top 5 active members leaderboard
            top_candidates = []
            for uid, rec in self._users.items():
                m_cnt = int(rec.get("moments") or 0)
                msg_cnt = int(rec.get("messages") or 0)
                tool_cnt = int(rec.get("tools") or 0)
                log_cnt = int(rec.get("logins") or 0)
                score = m_cnt * 3 + msg_cnt * 2 + tool_cnt + log_cnt
                em = rec.get("email") or ""
                is_adm = config.is_admin_identity(uid, em)
                g_info = self.gold_info(uid, em, is_admin=is_adm)
                top_candidates.append({
                    "uid": uid,
                    "name": rec.get("name") or rec.get("username") or (em.split("@")[0] if em else uid[:12]),
                    "username": rec.get("username") or "",
                    "avatar": rec.get("avatar"),
                    "moments": m_cnt,
                    "photos": int(rec.get("photos") or 0),
                    "videos": int(rec.get("videos") or 0),
                    "photobooth": int(rec.get("photobooth") or 0),
                    "messages": msg_cnt,
                    "tools": tool_cnt,
                    "logins": log_cnt,
                    "online": uid in online_uids,
                    "isAdmin": is_adm,
                    "isGold": g_info["active"],
                    "_score": score,
                })
            top_candidates.sort(key=lambda r: (r["_score"], r["moments"], r["logins"]), reverse=True)
            top_users = [{k: v for k, v in item.items() if k != "_score"} for item in top_candidates[:5]]

            lats = sorted(self._latencies)
            avg_lat = round(sum(lats) / len(lats), 1) if lats else 0.0
            p95_lat = round(lats[min(len(lats) - 1, int(len(lats) * 0.95))], 1) if lats else 0.0
            req_tot = self._req_total
            err_rate = round((self._req_5xx / req_tot) * 100.0, 2) if req_tot else 0.0

            totals = copy.deepcopy(self._metrics.get("totals") or {})
            banned_count = len(self._access.get("banned") or {})
            gold_count = len(self._access.get("gold") or {})
            open_feedback_count = sum(1 for f in self._feedback if f.get("status") == "open")
            whitelist_count = len(self._access.get("whitelist") or [])
            invite_count = len(self._access.get("invites") or [])
            recent_err_count = len(self._recent_errors)
            uptime_sec = int(max(0, now - self._started_at))
            site_state = {
                "maintenanceEnabled": bool(self._site_config["maintenance"]["enabled"]),
                "inviteOnly": bool(self._access.get("inviteOnly", False)),
                "announcementEnabled": bool(self._site_config["announcement"]["enabled"] and self._site_config["announcement"]["text"]),
                "disabledFeaturesCount": sum(1 for v in self._site_config["features"].values() if not v),
                "whitelistCount": whitelist_count,
                "inviteCount": invite_count,
                "goldCount": gold_count,
                "openFeedbackCount": open_feedback_count,
            }

        thumbs_b, thumbs_files = _dir_stats(config.THUMBS_DIR)
        videos_b, videos_files = _dir_stats(config.VIDEO_CACHE_DIR)
        accounts_b = _dir_bytes(config.ACCOUNTS_DIR)
        sessions_b = _dir_bytes(config.SESSIONS_DIR)
        admin_b = _dir_bytes(config.ADMIN_DIR)

        return {
            "kpi": {
                "onlineNow": len(online_uids),
                "activeSessions": len(sessions_summary),
                "inMemorySessions": sum(1 for s in sessions_summary if s.get("inMemory")),
                "totalUsers": len(known_uids),
                "newToday": new_today,
                "bannedUsers": banned_count,
                "goldUsers": gold_count,
                "openFeedback": open_feedback_count,
                "dau": len(dau_uids),
                "wau": len(wau_set),
                "mau": len(mau_set),
            },
            "totals": {
                "logins": int(totals.get("logins") or 0),
                "moments": int(totals.get("moments") or 0),
                "photos": int(totals.get("photos") or 0),
                "videos": int(totals.get("videos") or 0),
                "photobooth": int(totals.get("photobooth") or 0),
                "messages": int(totals.get("messages") or 0),
                "weather": int(totals.get("weather") or 0),
                "music": int(totals.get("music") or 0),
                "places": int(totals.get("places") or 0),
                "exports": int(totals.get("exports") or 0),
            },
            "today": {
                "date": today,
                "dau": len(dau_uids),
                "logins": int(today_b.get("logins") or 0),
                "moments": int(today_b.get("moments") or 0),
                "messages": int(today_b.get("messages") or 0),
                "tools": int(today_b.get("weather") or 0) + int(today_b.get("music") or 0) + int(today_b.get("places") or 0) + int(today_b.get("exports") or 0),
            },
            "yesterday": {
                "date": yest_key,
                "dau": len(yest_b.get("activeUids") or []),
                "logins": int(yest_b.get("logins") or 0),
                "moments": int(yest_b.get("moments") or 0),
                "messages": int(yest_b.get("messages") or 0),
                "tools": int(yest_b.get("weather") or 0) + int(yest_b.get("music") or 0) + int(yest_b.get("places") or 0) + int(yest_b.get("exports") or 0),
            },
            "topUsers": top_users,
            "siteState": site_state,
            "security": {
                "stealth404": True,
                "adminEmailCount": len(config.ADMIN_EMAILS),
                "adminUidCount": len(config.ADMIN_UIDS),
                "secretPortalEnabled": config.has_secret_admin_portal(),
                "hfEnabled": bool(hf_status.get("enabled")),
                "hfEncrypted": bool(hf_status.get("encrypted")),
            },
            "series30": series30,
            "health": {
                "uptimeSec": uptime_sec,
                "avgLatencyMs": avg_lat,
                "p95LatencyMs": p95_lat,
                "requestsTotal": req_tot,
                "errors4xx": self._req_4xx,
                "errors5xx": self._req_5xx,
                "recentErrorCount": recent_err_count,
                "errorRatePct": err_rate,
                "disk": {
                    "thumbsBytes": thumbs_b,
                    "thumbsFiles": thumbs_files,
                    "videoBytes": videos_b,
                    "videoFiles": videos_files,
                    "accountsBytes": accounts_b,
                    "sessionsBytes": sessions_b,
                    "adminBytes": admin_b,
                    "totalBytes": thumbs_b + videos_b + accounts_b + sessions_b + admin_b,
                },
                "hf": hf_status,
            },
        }

    def list_users(self, sessions_summary: list[dict], q: str = "", filt: str = "all", sort: str = "recent") -> dict:
        now = time.time()
        today = _today_key(now)
        cutoff = now - ONLINE_WINDOW_SEC

        sess_by_uid: dict[str, list[dict]] = {}
        for s in sessions_summary:
            u = s.get("uid") or ""
            if u:
                sess_by_uid.setdefault(u, []).append(s)

        with self._lock:
            wl_set = set(self._access.get("whitelist") or [])
            merged: dict[str, dict] = {}
            for uid, rec in self._users.items():
                merged[uid] = copy.deepcopy(rec)

            # Include UIDs from active disk sessions or ban list that aren't in users.json yet
            for uid, slist in sess_by_uid.items():
                if uid not in merged:
                    latest_ms = max((s.get("lastSeenMs") or 0) for s in slist)
                    email = next((s.get("email") for s in slist if s.get("email")), "")
                    merged[uid] = {
                        "uid": uid,
                        "email": email,
                        "name": email.split("@")[0] if email else uid[:12],
                        "firstName": "",
                        "lastName": "",
                        "username": "",
                        "avatar": None,
                        "firstSeen": latest_ms,
                        "lastSeen": latest_ms,
                        "logins": 0,
                        "moments": 0,
                        "photos": 0,
                        "videos": 0,
                        "photobooth": 0,
                        "messages": 0,
                        "tools": 0,
                        "invited": False,
                        "note": "",
                        "lastIp": "",
                    }

            for uid, binfo in self._access["banned"].items():
                if uid not in merged:
                    merged[uid] = {
                        "uid": uid,
                        "email": binfo.get("email") or "",
                        "name": binfo.get("name") or uid[:12],
                        "firstName": "",
                        "lastName": "",
                        "username": binfo.get("username") or "",
                        "avatar": None,
                        "firstSeen": binfo.get("at") or 0,
                        "lastSeen": binfo.get("at") or 0,
                        "logins": 0,
                        "moments": 0,
                        "photos": 0,
                        "videos": 0,
                        "photobooth": 0,
                        "messages": 0,
                        "tools": 0,
                        "invited": False,
                        "note": "",
                        "lastIp": "",
                    }

            for uid, ginfo in (self._access.get("gold") or {}).items():
                if uid not in merged:
                    merged[uid] = {
                        "uid": uid,
                        "email": ginfo.get("email") or "",
                        "name": (ginfo.get("email") or "").split("@")[0] if ginfo.get("email") else uid[:12],
                        "firstName": "",
                        "lastName": "",
                        "username": "",
                        "avatar": None,
                        "firstSeen": ginfo.get("at") or 0,
                        "lastSeen": ginfo.get("at") or 0,
                        "logins": 0,
                        "moments": 0,
                        "photos": 0,
                        "videos": 0,
                        "photobooth": 0,
                        "messages": 0,
                        "tools": 0,
                        "invited": False,
                        "note": "",
                        "lastIp": "",
                    }

            rows = []
            for uid, rec in merged.items():
                ban = self._access["banned"].get(uid)
                seen_ts = self._active_seen.get(uid, 0.0)
                online = seen_ts >= cutoff
                slist = sess_by_uid.get(uid) or []
                email = rec.get("email") or ""
                is_adm = config.is_admin_identity(uid, email)
                is_wl = (uid in wl_set) or (bool(email) and email.lower() in wl_set)
                g_entry = self._gold_entry_locked(uid, email)
                g_info = self.gold_info(uid, email, is_admin=is_adm)
                first_seen = int(rec.get("firstSeen") or 0)
                is_new_today = bool(first_seen and _today_key(first_seen / 1000.0) == today)
                rows.append({
                    "uid": uid,
                    "name": rec.get("name") or rec.get("username") or (email.split("@")[0] if email else uid[:12]),
                    "username": rec.get("username") or "",
                    "email": email,
                    "avatar": rec.get("avatar"),
                    "firstSeen": first_seen,
                    "lastSeen": int(rec.get("lastSeen") or 0),
                    "logins": int(rec.get("logins") or 0),
                    "moments": int(rec.get("moments") or 0),
                    "photos": int(rec.get("photos") or 0),
                    "videos": int(rec.get("videos") or 0),
                    "photobooth": int(rec.get("photobooth") or 0),
                    "messages": int(rec.get("messages") or 0),
                    "tools": int(rec.get("tools") or 0),
                    "activeSessions": len(slist),
                    "sessions": [
                        {"sidHash": s["sidHash"], "inMemory": bool(s.get("inMemory")), "lastSeenMs": int(s.get("lastSeenMs") or 0)}
                        for s in slist
                    ],
                    "online": online,
                    "newToday": is_new_today,
                    "banned": ban is not None,
                    "banReason": (ban or {}).get("reason") or "",
                    "invited": bool(rec.get("invited")),
                    "whitelisted": is_wl,
                    "isGold": g_info["active"],
                    "goldSince": g_info["since"],
                    "goldTier": g_info["tier"],
                    "goldNote": str((g_entry or {}).get("note") or ""),
                    "note": str(rec.get("note") or ""),
                    "isAdmin": is_adm,
                })

        total = len(rows)
        counts = {
            "all": total,
            "online": sum(1 for r in rows if r["online"]),
            "today": sum(1 for r in rows if r["newToday"]),
            "gold": sum(1 for r in rows if r["isGold"]),
            "whitelist": sum(1 for r in rows if r["whitelisted"]),
            "banned": sum(1 for r in rows if r["banned"]),
        }

        if filt == "online":
            rows = [r for r in rows if r["online"]]
        elif filt == "today":
            rows = [r for r in rows if r["newToday"]]
        elif filt == "gold":
            rows = [r for r in rows if r["isGold"]]
        elif filt == "whitelist":
            rows = [r for r in rows if r["whitelisted"]]
        elif filt == "banned":
            rows = [r for r in rows if r["banned"]]

        query = (q or "").strip().lower()
        if query:
            rows = [
                r for r in rows
                if query in (r["name"] or "").lower()
                or query in (r["username"] or "").lower()
                or query in (r["email"] or "").lower()
                or query in (r["uid"] or "").lower()
                or query in (r["note"] or "").lower()
            ]

        if sort == "moments":
            rows.sort(key=lambda r: (r["moments"], r["messages"], r["lastSeen"]), reverse=True)
        elif sort == "sessions":
            rows.sort(key=lambda r: (r["activeSessions"], r["online"], r["lastSeen"]), reverse=True)
        elif sort == "newest":
            rows.sort(key=lambda r: (r["firstSeen"], r["lastSeen"]), reverse=True)
        else:
            rows.sort(key=lambda r: (r["online"], r["activeSessions"] > 0, r["lastSeen"]), reverse=True)
        return {
            "users": rows,
            "total": total,
            "filtered": len(rows),
            "counts": counts,
            "activeSessions": len(sessions_summary),
        }

    def get_user_detail(self, uid: str, sessions_summary: list[dict]) -> Optional[dict]:
        data = self.list_users(sessions_summary)
        return next((u for u in data["users"] if u["uid"] == uid), None)

    def recent_logs(self) -> dict:
        with self._lock:
            errors = list(reversed(self._recent_errors))
            audit = list(reversed(self._audit))
        return {"errors": errors, "audit": audit}

    # ------------------------------------------------------------------ CSV exports
    def export_users_csv(self, sessions_summary: list[dict]) -> str:
        data = self.list_users(sessions_summary)
        buf = io.StringIO()
        buf.write("\ufeff")
        writer = csv.writer(buf)
        writer.writerow([
            "UID", "Tên", "Username", "Email", "Trạng thái", "Phiên đang mở",
            "Lượt đăng nhập", "Khoảnh khắc", "Ảnh", "Video", "Photobooth", "Tin nhắn", "Công cụ",
            "Lần đầu", "Gần nhất", "Lý do chặn",
        ])
        for u in data["users"]:
            status = "Đã chặn" if u["banned"] else ("Online" if u["online"] else ("Admin" if u["isAdmin"] else "Bình thường"))
            fs = datetime.fromtimestamp(u["firstSeen"] / 1000, tz=VN_TZ).strftime("%Y-%m-%d %H:%M") if u["firstSeen"] else ""
            ls = datetime.fromtimestamp(u["lastSeen"] / 1000, tz=VN_TZ).strftime("%Y-%m-%d %H:%M") if u["lastSeen"] else ""
            writer.writerow([
                _safe_csv_cell(u["uid"]),
                _safe_csv_cell(u["name"]),
                _safe_csv_cell(u["username"]),
                _safe_csv_cell(u["email"]),
                status,
                u["activeSessions"],
                u["logins"],
                u["moments"],
                u["photos"],
                u["videos"],
                u["photobooth"],
                u["messages"],
                u["tools"],
                fs,
                ls,
                _safe_csv_cell(u["banReason"]),
            ])
        return buf.getvalue()

    def export_metrics_csv(self) -> str:
        with self._lock:
            daily = copy.deepcopy(self._metrics.get("daily") or {})
        buf = io.StringIO()
        buf.write("\ufeff")
        writer = csv.writer(buf)
        writer.writerow(["Ngày", "DAU", "Đăng nhập", "Khoảnh khắc", "Ảnh", "Video", "Photobooth", "Tin nhắn", "Thời tiết", "Nhạc", "Vị trí", "Xuất ZIP"])
        for dkey in sorted(daily.keys(), reverse=True):
            b = daily[dkey] if isinstance(daily[dkey], dict) else {}
            writer.writerow([
                dkey,
                len(b.get("activeUids") or []),
                int(b.get("logins") or 0),
                int(b.get("moments") or 0),
                int(b.get("photos") or 0),
                int(b.get("videos") or 0),
                int(b.get("photobooth") or 0),
                int(b.get("messages") or 0),
                int(b.get("weather") or 0),
                int(b.get("music") or 0),
                int(b.get("places") or 0),
                int(b.get("exports") or 0),
            ])
        return buf.getvalue()


admin_store = AdminStore()
