"""Video handling with ffmpeg.

Two jobs:
  * outgoing - turn whatever the browser recorded (WebM from Chrome/Firefox, MP4 from Safari, any
    aspect ratio, phone-library clips included) into what Locket stores: a square 1080x1080 MP4 (the
    size of the iPhone app's own clips) under the 6 MB upload limit, optionally trimmed;
  * incoming - Locket's own clips are HEVC (hvc1), which many desktop browsers cannot decode, so
    a cached H.264 copy can be produced for playback.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Optional, Union

import requests

from . import cache, config
from .providers.base import ProviderError

LOCKET_MAX_BYTES = 6_291_455          # Firebase Storage rule on the locket-video bucket
TARGET_BYTES = 5_600_000
SIDE = 1080                           # Locket's own clips are 1080x1080
MAX_SECONDS = 15

_locks: dict = {}
_locks_guard = threading.Lock()


def ffmpeg_path() -> Optional[str]:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which("ffmpeg")


def probe(path: str) -> dict:
    """Duration, size, codecs - parsed from `ffmpeg -i` (the bundled build has no ffprobe)."""
    exe = ffmpeg_path()
    if not exe:
        return {}
    out = subprocess.run([exe, "-hide_banner", "-i", path], capture_output=True, timeout=60).stderr.decode("utf-8", "ignore")
    info: dict = {"audio": " Audio: " in out}
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", out)
    if m:
        info["duration"] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    v = re.search(r"Video:\s*([a-z0-9_]+).*?(\d{2,5})x(\d{2,5})", out)
    if v:
        info.update(codec=v.group(1), width=int(v.group(2)), height=int(v.group(3)))
    rot = re.search(r"rotation of (-?\d+(?:\.\d+)?) degrees", out) or re.search(r"rotate\s*:\s*(-?\d+)", out)
    if rot and abs(int(float(rot.group(1)))) in (90, 270) and "width" in info:
        info["width"], info["height"] = info["height"], info["width"]
    return info


def _run(cmd: list, timeout: int = 240) -> bool:
    try:
        return subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout).returncode == 0
    except subprocess.TimeoutExpired:
        return False


def normalize_for_locket(source: Union[bytes, Path, str], mirror: bool = False,
                         start: float = 0.0, length: float = 0.0) -> bytes:
    """Square 1080x1080 H.264/AAC MP4 with faststart, guaranteed under Locket's 6 MB limit.
    `source` may be raw bytes or a path on disk (preferred for large uploads so RAM stays low).
    `start` / `length` (seconds) cut a clip out of a longer video picked from the library."""
    exe = ffmpeg_path()
    is_path = isinstance(source, (Path, str))
    if is_path:
        src_path = Path(source)
        src_size = src_path.stat().st_size
        with open(src_path, "rb") as fh:
            head = fh.read(16)
    else:
        src_size = len(source)
        head = source[:16]

    is_mp4 = head[4:8] == b"ftyp" and head[8:12] != b"qt  "      # QuickTime .mov is re-muxed
    if not exe:
        if is_mp4 and src_size <= LOCKET_MAX_BYTES and not mirror:
            return Path(source).read_bytes() if is_path else source
        raise ProviderError("Máy chủ chưa có ffmpeg nên chưa xử lý được video này. Chạy `pip install imageio-ffmpeg`.", 501)

    work = tempfile.mkdtemp(prefix="locket-video-")
    dst = os.path.join(work, "out.mp4")
    try:
        if is_path:
            src = str(source)
        else:
            src = os.path.join(work, "in.bin")
            with open(src, "wb") as fh:
                fh.write(source)
        info = probe(src)
        if not info.get("width"):
            raise ProviderError("Không đọc được video này.", 422)
        start = max(0.0, min(float(start or 0), max((info.get("duration") or 0) - 0.5, 0.0)))
        span = min(float(length) if length and length > 0 else MAX_SECONDS, MAX_SECONDS)
        duration = min(max((info.get("duration") or span) - start, 0.5), span)
        if (is_mp4 and info.get("codec") == "h264" and info["width"] == info["height"] and info["width"] <= SIDE
                and not mirror and not start and src_size <= TARGET_BYTES and (info.get("duration") or 0) <= span):
            return Path(source).read_bytes() if is_path else source
        filters = ["crop='min(iw,ih)':'min(iw,ih)'", f"scale={SIDE}:{SIDE}"]
        if mirror:
            filters.append("hflip")
        seek = ["-ss", f"{start:.3f}"] if start else []
        base = [exe, "-y", *seek, "-i", src, "-t", f"{duration:.3f}", "-vf", ",".join(filters), "-r", "30",
                "-c:v", "libx264", "-threads", str(config.FFMPEG_THREADS), "-pix_fmt", "yuv420p", "-preset", "fast", "-movflags", "+faststart"]
        audio = ["-c:a", "aac", "-b:a", "96k"] if info.get("audio") else ["-an"]
        ok = _run(base + ["-crf", "21"] + audio + [dst])
        if ok and os.path.getsize(dst) > TARGET_BYTES:
            # too big for Locket: re-encode against a bitrate budget instead of a quality target
            kbps = max(300, int(TARGET_BYTES * 8 / max(duration, 1) / 1000) - (96 if info.get("audio") else 0))
            ok = _run(base + ["-b:v", f"{kbps}k", "-maxrate", f"{kbps}k", "-bufsize", f"{kbps * 2}k"] + audio + [dst])
        if not ok or not os.path.exists(dst) or os.path.getsize(dst) == 0:
            raise ProviderError("Không xử lý được video này.", 422)
        if os.path.getsize(dst) > LOCKET_MAX_BYTES:
            raise ProviderError("Video quá lớn so với giới hạn 6 MB của Locket.", 413)
        with open(dst, "rb") as fh:
            return fh.read()
    finally:
        shutil.rmtree(work, ignore_errors=True)


def h264_copy(url: str) -> Path:
    """Cached H.264 version of a remote clip, for browsers that cannot play Locket's HEVC."""
    exe = ffmpeg_path()
    if not exe:
        raise ProviderError("Máy chủ chưa có ffmpeg để chuyển mã video.", 501)
    key = hashlib.sha256(url.encode()).hexdigest()[:40]
    out = config.VIDEO_CACHE_DIR / f"{key}.mp4"
    if out.exists() and out.stat().st_size > 0:
        cache.touch_if_old(out)
        return out
    with _locks_guard:
        entry = _locks.get(key)
        if entry is None:
            entry = [threading.Lock(), 0]
            _locks[key] = entry
        entry[1] += 1
        lock = entry[0]
    try:
        with lock:
            if out.exists() and out.stat().st_size > 0:
                cache.touch_if_old(out)
                return out
            src = config.VIDEO_CACHE_DIR / f"{key}.src"
            tmp = config.VIDEO_CACHE_DIR / f"{key}.tmp.mp4"
            try:
                with requests.get(url, stream=True, timeout=30, allow_redirects=False) as res:
                    if res.status_code != 200 or not res.headers.get("Content-Type", "").startswith("video/"):
                        raise ProviderError("Không tải được video.", 404)
                    size = 0
                    with open(src, "wb") as fh:
                        for chunk in res.iter_content(256 * 1024):
                            size += len(chunk)
                            if size > config.MAX_VIDEO_BYTES:
                                raise ProviderError("Video quá lớn.", 413)
                            fh.write(chunk)
                if not _run([exe, "-y", "-i", str(src), "-c:v", "libx264", "-threads", str(config.FFMPEG_THREADS),
                             "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k",
                             "-movflags", "+faststart", str(tmp)]):
                    raise ProviderError("Không chuyển mã được video.", 502)
                os.replace(tmp, out)
                cache.schedule_prune(config.VIDEO_CACHE_DIR, config.VIDEO_CACHE_MAX_BYTES)
            except requests.RequestException as exc:
                raise ProviderError("Không tải được video.", 502) from exc
            finally:
                for leftover in (src, tmp):
                    try:
                        os.remove(leftover)
                    except OSError:
                        pass
    finally:
        with _locks_guard:
            entry[1] -= 1
            if entry[1] <= 0 and _locks.get(key) is entry:
                _locks.pop(key, None)
    return out
