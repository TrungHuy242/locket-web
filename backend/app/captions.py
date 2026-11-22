"""Caption badge presets and smart overlay metadata validation."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse

from . import config

SUPPORTED_TYPES = ("standard", "time", "static_content", "music", "review", "location", "weather")
HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
WEATHER_SYMBOLS = frozenset({
    "sun.max.fill", "cloud.sun.fill", "cloud.fill", "cloud.rain.fill",
    "cloud.bolt.fill", "cloud.snow.fill", "moon.fill", "moon.stars.fill",
})


def _host_ok(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme != "https" or parsed.port not in (None, 443):
        return False
    host = (parsed.hostname or "").lower()
    return host in config.MEDIA_HOST_ALLOWLIST or host.endswith(config.MEDIA_HOST_SUFFIX_ALLOWLIST)


@lru_cache(maxsize=1)
def _raw() -> dict:
    path = config.VENDOR_SDK_DIR / "locketlam" / "caption_presets.json"
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


@lru_cache(maxsize=1)
def presets() -> list:
    out = []
    for key, p in _raw().items():
        if p.get("type") not in ("standard", "time", "static_content") or key == "standard":
            continue
        out.append({"key": key, "text": p.get("text") or "", "icon": p.get("icon"),
                    "colors": p.get("colors") or [], "textColor": p.get("text_color") or "#FFFFFF",
                    "type": p.get("type"), "section": (p.get("section") or "").strip()})
    return out


def is_valid(key: Optional[str]) -> bool:
    if not key:
        return False
    if key in ("standard", "music", "review", "location", "weather", "time"):
        return True
    return key in _raw() and _raw()[key].get("type") in SUPPORTED_TYPES


def sanitize_overlay_meta(raw: Optional[dict]) -> Optional[dict]:
    """Validate and clean optional rich overlay metadata (custom colors, music, review, location, weather)."""
    if not isinstance(raw, dict) or not raw:
        return None
    out: dict = {}

    colors = raw.get("colors")
    if isinstance(colors, list):
        clean_colors = [c.strip() for c in colors[:3] if isinstance(c, str) and HEX_COLOR_RE.match(c.strip())]
        if clean_colors:
            out["colors"] = clean_colors

    text_color = raw.get("textColor")
    if isinstance(text_color, str) and HEX_COLOR_RE.match(text_color.strip()):
        out["textColor"] = text_color.strip()

    rating = raw.get("rating")
    if isinstance(rating, (int, float)) and 0.5 <= float(rating) <= 5.0:
        # Round to nearest 0.5
        out["rating"] = round(float(rating) * 2) / 2

    music = raw.get("music")
    if isinstance(music, dict):
        title = str(music.get("title") or "").strip()[:120]
        artist = str(music.get("artist") or "").strip()[:120]
        artwork = str(music.get("artwork") or "").strip()
        preview = str(music.get("previewUrl") or music.get("preview") or "").strip()
        link = str(music.get("appleMusicUrl") or music.get("link") or "").strip()
        if title or artist:
            m: dict = {"title": title, "artist": artist}
            if artwork and _host_ok(artwork):
                m["artwork"] = artwork
            if preview and _host_ok(preview):
                m["previewUrl"] = preview
            if link.startswith(("https://music.apple.com/", "https://open.spotify.com/")):
                m["link"] = link[:500]
            out["music"] = m

    weather = raw.get("weather")
    if isinstance(weather, dict):
        sym = str(weather.get("symbol") or "sun.max.fill").strip()
        if sym not in WEATHER_SYMBOLS:
            sym = "sun.max.fill"
        out["weather"] = {"symbol": sym}

    return out or None
