"""Runtime configuration. Values come from environment variables or a local .env file."""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
# React app (frontend/), built by `npm run build` into frontend/dist and served from there
FRONTEND_DIR = ROOT_DIR / "frontend" / "dist"
VENDOR_SDK_DIR = ROOT_DIR / "vendor" / "locketlam"


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(ROOT_DIR / ".env")

def ensure_sdk_path() -> Path:
    """Ensure the vendored locketlam SDK is importable."""
    if str(VENDOR_SDK_DIR) not in sys.path:
        sys.path.insert(0, str(VENDOR_SDK_DIR))
    return VENDOR_SDK_DIR


# The vendored SDK is imported straight from the cloned repository.
ensure_sdk_path()


def _flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _int_env(name: str, default: int, minimum: int = 1) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return max(minimum, int(raw.strip()))
    except ValueError:
        return default


def configure_logging() -> None:
    """Attach a concise formatter to the `backend` logger without duplicating handlers."""
    level_name = os.environ.get("LOCKET_LOG_LEVEL", "INFO").strip().upper()
    level = getattr(logging, level_name, logging.INFO)
    pkg = logging.getLogger("backend")
    pkg.setLevel(level)
    if not pkg.handlers and not logging.getLogger().handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s", "%H:%M:%S"))
        pkg.addHandler(handler)


DATA_DIR = Path(os.environ.get("LOCKET_DATA_DIR", str(BACKEND_DIR / "data"))).resolve()
SESSIONS_DIR = DATA_DIR / "sessions"   # Firebase tokens, one folder per browser session
ACCOUNTS_DIR = DATA_DIR / "accounts"   # per-account moment history synced from Locket
THUMBS_DIR = DATA_DIR / "thumbs"       # downscaled image cache
VIDEO_CACHE_DIR = DATA_DIR / "videos"  # H.264 copies of HEVC clips for browsers without HEVC

COOKIE_NAME = "lk_sid"
COOKIE_SECURE = _flag("LOCKET_COOKIE_SECURE", False)
SESSION_MAX_AGE = 60 * 60 * 24 * 30
SESSION_IDLE_SECONDS = _int_env("LOCKET_SESSION_IDLE_SECONDS", 60 * 60 * 12, minimum=60)

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024   # library clips are trimmed / re-encoded server-side
THUMBS_MAX_BYTES = _int_env("LOCKET_THUMBS_MAX_MB", 150, minimum=10) * 1024 * 1024
VIDEO_CACHE_MAX_BYTES = _int_env("LOCKET_VIDEO_CACHE_MAX_MB", 500, minimum=20) * 1024 * 1024
FFMPEG_THREADS = _int_env("LOCKET_FFMPEG_THREADS", 2, minimum=1)

# Optional persistent state sync to a PRIVATE Hugging Face Dataset (for ephemeral free PaaS containers)
HF_REPO = os.environ.get("LOCKET_HF_REPO", "").strip()
HF_TOKEN = (os.environ.get("LOCKET_HF_TOKEN") or os.environ.get("HF_TOKEN") or "").strip()
BACKUP_KEY = os.environ.get("LOCKET_BACKUP_KEY", "").strip()
HF_SYNC_INTERVAL = _int_env("LOCKET_HF_SYNC_INTERVAL", 90, minimum=10)
HF_URGENT_DELAY = _int_env("LOCKET_HF_URGENT_DELAY", 8, minimum=1)

# Hosts the media proxy is allowed to fetch from (Locket's storage buckets and CDNs).
MEDIA_HOST_ALLOWLIST = (
    "firebasestorage.googleapis.com",
    "storage.googleapis.com",
    "cdn.locketcamera.com",
    "locket-img.appspot.com",
    "lh3.googleusercontent.com",
    # music captions: album art and 30-second preview clips
    "i.scdn.co",
    "p.scdn.co",
    "audio-ssl.itunes.apple.com",
)
MEDIA_HOST_SUFFIX_ALLOWLIST = (".locketcamera.com", ".locket.cam", ".mzstatic.com", ".dzcdn.net")

for _d in (DATA_DIR, SESSIONS_DIR, ACCOUNTS_DIR, THUMBS_DIR, VIDEO_CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)
