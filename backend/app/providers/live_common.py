"""Shared constants and pure normalization helpers for LiveProvider."""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

FIRESTORE = "https://firestore.googleapis.com/v1/projects/locket-4252a/databases/(default)/documents"
STORAGE = "https://firebasestorage.googleapis.com/v0/b"
# a moment's video and thumbnail share one file name: thumbnails/<id>.webp <-> videos/<id>.mp4
THUMB_NAME = re.compile(r"^(users/[A-Za-z0-9]+/moments)/thumbnails/([^/]+)\.[A-Za-z0-9]+$")
PROFILE_TTL = 3600
OWNER_IN_URL = re.compile(r"users(?:%2F|/)([A-Za-z0-9]+)(?:%2F|/)moments")

LABELS = {"reactions": "cảm xúc trên khoảnh khắc", "messages": "tin nhắn", "friends": "bạn bè"}

LOGIN_ERRORS = {
    "INVALID_LOGIN_CREDENTIALS": "Email hoặc mật khẩu không đúng.",
    "EMAIL_NOT_FOUND": "Không tìm thấy tài khoản với email này.",
    "INVALID_PASSWORD": "Mật khẩu không đúng.",
    "INVALID_EMAIL": "Địa chỉ email không hợp lệ.",
    "USER_DISABLED": "Tài khoản này đã bị vô hiệu hóa.",
    "TOO_MANY_ATTEMPTS_TRY_LATER": "Bạn đã thử quá nhiều lần. Hãy thử lại sau.",
    "MISSING_PASSWORD": "Vui lòng nhập mật khẩu.",
}


def proxied(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    return "/api/media?u=" + quote(url, safe="")


def to_ms(value) -> int:
    """Best-effort conversion of the timestamp shapes Locket returns into epoch milliseconds."""
    if value is None or value == "":
        return 0
    if isinstance(value, dict):
        secs = value.get("_seconds", value.get("seconds"))
        if secs is None:
            return 0
        nanos = value.get("_nanoseconds", value.get("nanos", 0)) or 0
        return int(float(secs) * 1000 + float(nanos) / 1e6)
    if isinstance(value, (int, float)):
        return int(value if value > 1e11 else value * 1000)
    text = str(value).strip()
    if text.isdigit():
        return to_ms(int(text))
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        # Firestore may send nanosecond precision, which fromisoformat rejects.
        if "." in text:
            head, _, tail = text.partition(".")
            frac = "".join(ch for ch in tail if ch.isdigit())
            rest = tail[len(frac):]
            text = f"{head}.{frac[:6]}{rest}"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def fold_text(text: str) -> str:
    """Lower-case, accent-free text so "tuan kiet" finds "Tuấn Kiệt"."""
    normalized = unicodedata.normalize("NFD", (text or "").lower().replace("đ", "d"))
    return "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")


def local_date(ms: int, tz_minutes: int) -> datetime:
    """Convert epoch ms into a browser-local datetime using UTC offset in minutes."""
    return datetime.fromtimestamp((ms or 0) / 1000, tz=timezone.utc) + timedelta(minutes=tz_minutes)


def parse_overlay(moment: dict) -> Optional[dict]:
    """Normalize Locket's caption overlay exactly as sent: text, icon, colours, and type payload.

    Icons come in three kinds (emoji / SF Symbol name / image URL); music captions carry the
    song, artist and a preview clip; some badges have a background image. Nothing is invented:
    a moment without an overlay or caption yields None.
    """
    for ov in moment.get("overlays") or []:
        if not isinstance(ov, dict) or ov.get("overlay_type") not in (None, "caption"):
            continue
        data = ov.get("data") or {}
        text = data.get("text") or ""
        raw_icon = data.get("icon") if isinstance(data.get("icon"), dict) else {}
        icon = None
        if raw_icon.get("data"):
            kind = {"emoji": "emoji", "sf_symbol": "symbol", "image": "image"}.get(raw_icon.get("type") or "emoji")
            if kind:
                icon = {"kind": kind, "value": raw_icon["data"], "color": raw_icon.get("color")}
        background = data.get("background") if isinstance(data.get("background"), dict) else {}
        bg_image = background.get("image") if isinstance(background.get("image"), dict) else {}
        payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
        music = None
        if data.get("type") == "music" and (payload.get("song_title") or payload.get("preview_url")):
            music = {"title": payload.get("song_title") or "", "artist": payload.get("artist") or "",
                     "preview": payload.get("preview_url"),
                     "link": payload.get("spotify_url") or payload.get("apple_music_url")}
        rating = payload.get("rating")
        if not text and not icon and not music:
            text = ov.get("alt_text") or ""
            if not text:
                continue
        try:
            max_lines = int((data.get("max_lines") or {}).get("value")) if isinstance(data.get("max_lines"), dict) \
                else int(data.get("max_lines") or 4)
        except (TypeError, ValueError):
            max_lines = 4
        return {
            "id": ov.get("overlay_id") or "caption:standard",
            "type": data.get("type") or "standard",
            "text": text,
            "icon": icon,
            "colors": background.get("colors") or [],
            "textColor": data.get("text_color") or "#FFFFFF",
            "bgImage": bg_image.get("data") if bg_image.get("source", "url") == "url" else None,
            "maxLines": max_lines,
            "music": music,
            "rating": rating if isinstance(rating, (int, float)) else None,
        }
    caption = moment.get("caption")
    if caption:
        return {"id": "caption:standard", "type": "standard", "text": caption, "icon": None, "colors": [],
                "textColor": "#FFFFFF", "bgImage": None, "maxLines": 4, "music": None, "rating": None}
    return None


def public_overlay(overlay: Optional[dict]) -> Optional[dict]:
    """Overlay as the browser gets it: remote icon/background/audio URLs go through the media proxy."""
    if not overlay:
        return None
    out = dict(overlay)
    icon = out.get("icon")
    if isinstance(icon, str):                      # entries stored before icons had kinds
        icon = {"kind": "emoji", "value": icon, "color": None}
    if isinstance(icon, dict) and icon.get("kind") == "image":
        icon = {**icon, "value": proxied(icon.get("value"))}
    out["icon"] = icon
    out["bgImage"] = proxied(out.get("bgImage"))
    music = out.get("music")
    if isinstance(music, dict):
        link = music.get("link") or ""
        out["music"] = {**music, "preview": proxied(music.get("preview")),
                        "link": link if link.startswith(("https://open.spotify.com/", "https://music.apple.com/")) else None}
    return out
