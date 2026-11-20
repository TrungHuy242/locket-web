"""Caption badge presets, read from the SDK's own caption_presets.json."""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Optional

from . import config

# Presets that need extra live data (music, weather, location...) are not offered in the web UI.
SUPPORTED_TYPES = ("standard", "time", "static_content")


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
        if p.get("type") not in SUPPORTED_TYPES or key == "standard":
            continue
        out.append({"key": key, "text": p.get("text") or "", "icon": p.get("icon"),
                    "colors": p.get("colors") or [], "textColor": p.get("text_color") or "#FFFFFF",
                    "type": p.get("type"), "section": (p.get("section") or "").strip()})
    return out


def is_valid(key: Optional[str]) -> bool:
    return bool(key) and key in _raw() and _raw()[key].get("type") in SUPPORTED_TYPES
