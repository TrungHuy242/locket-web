"""Smart caption tools: resilient multi-provider Weather, Place/GPS Geocoding, and Music Search.

Designed for shared-IP cloud environments (like Render Free) where any single free API
(such as Open-Meteo) may periodically rate-limit (429) or time out:
- Built-in Vietnam cities & slang aliases (TP.HCM, SG, HN, ĐN, Sapa...) resolve in 0 ms.
- In-memory TTL caches cut duplicate upstream requests dramatically.
- Multi-provider fallbacks (MET Norway -> Open-Meteo -> wttr.in for weather;
  Nominatim -> Open-Meteo for geocoding; Nominatim -> BigDataCloud -> nearest VN city for reverse GPS;
  iTunes -> Deezer for music) keep the tools working reliably without requiring API keys.
"""
from __future__ import annotations

import logging
import math
import time
import unicodedata
from typing import Optional

import httpx

from .providers.live_common import proxied

log = logging.getLogger(__name__)

USER_AGENT = "LocketWeb/2.0 (https://locket-web-wmqv.onrender.com)"

# Simple bounded in-memory TTL caches: key -> (expires_at, value)
_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_MAX = 400


def _cache_get(key: str):
    item = _CACHE.get(key)
    if item is None:
        return None
    exp, val = item
    if time.monotonic() > exp:
        _CACHE.pop(key, None)
        return None
    return val


def _cache_set(key: str, val: object, ttl: float) -> None:
    if len(_CACHE) >= _CACHE_MAX:
        now = time.monotonic()
        stale = [k for k, (exp, _) in _CACHE.items() if exp <= now]
        for k in stale:
            _CACHE.pop(k, None)
        if len(_CACHE) >= _CACHE_MAX:
            for k in list(_CACHE)[: _CACHE_MAX // 4]:
                _CACHE.pop(k, None)
    _CACHE[key] = (time.monotonic() + ttl, val)


def _norm(text: str) -> str:
    s = unicodedata.normalize("NFD", (text or "").lower().strip())
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = s.replace("đ", "d").replace(".", " ").replace("-", " ").replace(",", " ")
    return " ".join(s.split())


# Built-in major Vietnamese cities & popular destinations: (canonical_name, lat, lon, aliases...)
_VN_CITIES_RAW = [
    ("Hà Nội", 21.0285, 105.8542, ["ha noi", "hanoi", "hn", "tp ha noi", "thu do ha noi"]),
    ("TP. Hồ Chí Minh", 10.7769, 106.7009, ["tp hcm", "tphcm", "hcm", "ho chi minh", "sai gon", "saigon", "sg", "tp ho chi minh", "hcmc"]),
    ("Đà Nẵng", 16.0544, 108.2022, ["da nang", "danang", "dn", "tp da nang"]),
    ("Hải Phòng", 20.8449, 106.6881, ["hai phong", "haiphong", "hp"]),
    ("Cần Thơ", 10.0452, 105.7469, ["can tho", "cantho", "ct"]),
    ("Huế", 16.4637, 107.5909, ["hue", "thua thien hue", "tp hue"]),
    ("Đà Lạt", 11.9404, 108.4583, ["da lat", "dalat", "lam dong"]),
    ("Nha Trang", 12.2388, 109.1967, ["nha trang", "nhatrang", "khanh hoa"]),
    ("Vũng Tàu", 10.3460, 107.0843, ["vung tau", "vungtau", "ba ria vung tau"]),
    ("Quy Nhơn", 13.7829, 109.2197, ["quy nhon", "quynhon", "binh dinh"]),
    ("Phú Quốc", 10.2899, 103.9840, ["phu quoc", "phuquoc"]),
    ("Hội An", 15.8801, 108.3380, ["hoi an", "hoian", "quang nam"]),
    ("Hạ Long", 20.9599, 107.0425, ["ha long", "halong", "quang ninh"]),
    ("Sa Pa", 22.3364, 103.8438, ["sa pa", "sapa", "lao cai"]),
    ("Biên Hòa", 10.9574, 106.8427, ["bien hoa", "dong nai"]),
    ("Thủ Dầu Một", 10.9804, 106.6519, ["thu dau mot", "binh duong"]),
    ("Buôn Ma Thuột", 12.6667, 108.0500, ["buon ma thuot", "bmt", "dak lak"]),
    ("Vinh", 18.6796, 105.6813, ["vinh", "nghe an"]),
    ("Thanh Hóa", 19.8067, 105.7852, ["thanh hoa"]),
    ("Phan Thiết", 10.9289, 108.1021, ["phan thiet", "mui ne", "binh thuan"]),
    ("Bắc Ninh", 21.1861, 106.0763, ["bac ninh"]),
    ("Thái Nguyên", 21.5672, 105.8252, ["thai nguyen"]),
    ("Ninh Bình", 20.2506, 105.9745, ["ninh binh"]),
    ("Nam Định", 20.4388, 106.1621, ["nam dinh"]),
    ("Hải Dương", 20.9373, 106.3146, ["hai duong"]),
    ("Thái Bình", 20.4463, 106.3366, ["thai binh"]),
    ("Bắc Giang", 21.2731, 106.1946, ["bac giang"]),
    ("Việt Trì", 21.3227, 105.4019, ["viet tri", "phu tho"]),
    ("Pleiku", 13.9833, 108.0000, ["pleiku", "gia lai"]),
    ("Tuy Hòa", 13.0955, 109.3209, ["tuy hoa", "phu yen"]),
    ("Đồng Hới", 17.4833, 106.6000, ["dong hoi", "quang binh"]),
    ("Hà Tĩnh", 18.3428, 105.9057, ["ha tinh"]),
    ("Mỹ Tho", 10.3600, 106.3600, ["my tho", "tien giang"]),
    ("Long Xuyên", 10.3864, 105.4352, ["long xuyen", "an giang"]),
    ("Rạch Giá", 10.0125, 105.0809, ["rach gia", "kien giang"]),
    ("Cà Mau", 9.1768, 105.1524, ["ca mau"]),
    ("Vĩnh Long", 10.2537, 105.9722, ["vinh long"]),
    ("Bến Tre", 10.2433, 106.3756, ["ben tre"]),
    ("Tây Ninh", 11.3100, 106.0983, ["tay ninh"]),
    ("Tam Kỳ", 15.5736, 108.4740, ["tam ky"]),
    ("Quảng Ngãi", 15.1214, 108.8044, ["quang ngai"]),
    ("Hà Giang", 22.8233, 104.9836, ["ha giang"]),
]

_VN_ALIAS_MAP: dict[str, tuple[str, float, float]] = {}
for _name, _lat, _lon, _aliases in _VN_CITIES_RAW:
    _VN_ALIAS_MAP[_norm(_name)] = (_name, _lat, _lon)
    for _al in _aliases:
        _VN_ALIAS_MAP[_norm(_al)] = (_name, _lat, _lon)


def _match_vn_city(q: str) -> Optional[tuple[str, float, float]]:
    nq = _norm(q)
    if not nq:
        return None
    if nq in _VN_ALIAS_MAP:
        return _VN_ALIAS_MAP[nq]
    return None


def _nearest_vn_city(lat: float, lon: float, max_km: float = 60.0) -> Optional[str]:
    best_name = None
    best_km = max_km
    for name, clat, clon, _ in _VN_CITIES_RAW:
        dlat = math.radians(lat - clat)
        dlon = math.radians(lon - clon)
        a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat)) * math.cos(math.radians(clat)) * math.sin(dlon / 2) ** 2
        km = 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))
        if km < best_km:
            best_km = km
            best_name = name
    return best_name


# WMO codes (Open-Meteo) -> (Vietnamese desc, day SF symbol, night SF symbol)
_WMO_VI = {
    0: ("Quang đãng", "sun.max.fill", "moon.fill"),
    1: ("Ít mây", "cloud.sun.fill", "moon.stars.fill"),
    2: ("Mây rải rác", "cloud.sun.fill", "cloud.fill"),
    3: ("Nhiều mây", "cloud.fill", "cloud.fill"),
    45: ("Sương mù", "cloud.fill", "cloud.fill"),
    48: ("Sương mù", "cloud.fill", "cloud.fill"),
    51: ("Mưa phùn nhẹ", "cloud.rain.fill", "cloud.rain.fill"),
    53: ("Mưa phùn", "cloud.rain.fill", "cloud.rain.fill"),
    55: ("Mưa phùn dày", "cloud.rain.fill", "cloud.rain.fill"),
    61: ("Mưa nhẹ", "cloud.rain.fill", "cloud.rain.fill"),
    63: ("Có mưa", "cloud.rain.fill", "cloud.rain.fill"),
    65: ("Mưa lớn", "cloud.rain.fill", "cloud.rain.fill"),
    71: ("Tuyết nhẹ", "cloud.snow.fill", "cloud.snow.fill"),
    73: ("Có tuyết", "cloud.snow.fill", "cloud.snow.fill"),
    75: ("Tuyết dày", "cloud.snow.fill", "cloud.snow.fill"),
    80: ("Mưa rào nhẹ", "cloud.rain.fill", "cloud.rain.fill"),
    81: ("Mưa rào", "cloud.rain.fill", "cloud.rain.fill"),
    82: ("Mưa rào lớn", "cloud.rain.fill", "cloud.rain.fill"),
    95: ("Giông bão", "cloud.bolt.fill", "cloud.bolt.fill"),
    96: ("Giông bão", "cloud.bolt.fill", "cloud.bolt.fill"),
    99: ("Giông bão", "cloud.bolt.fill", "cloud.bolt.fill"),
}


def _metno_symbol_to_vi(code: str) -> tuple[str, str]:
    c = (code or "").lower()
    is_night = c.endswith("_night")
    if "thunder" in c:
        return ("Giông bão", "cloud.bolt.fill")
    if "snow" in c or "sleet" in c:
        return ("Có tuyết", "cloud.snow.fill")
    if "heavyrain" in c:
        return ("Mưa lớn", "cloud.rain.fill")
    if "lightrain" in c:
        return ("Mưa nhẹ", "cloud.rain.fill")
    if "rain" in c:
        return ("Có mưa", "cloud.rain.fill")
    if "fog" in c:
        return ("Sương mù", "cloud.fill")
    if "clearsky" in c:
        return ("Quang đãng", "moon.fill" if is_night else "sun.max.fill")
    if "fair" in c:
        return ("Ít mây", "moon.stars.fill" if is_night else "cloud.sun.fill")
    if "partlycloudy" in c:
        return ("Mây rải rác", "cloud.fill" if is_night else "cloud.sun.fill")
    return ("Nhiều mây", "cloud.fill")


def _wttr_code_to_vi(code: int, is_day: bool = True) -> tuple[str, str]:
    if code in (113,):
        return ("Quang đãng", "sun.max.fill" if is_day else "moon.fill")
    if code in (116,):
        return ("Mây rải rác", "cloud.sun.fill" if is_day else "moon.stars.fill")
    if code in (119, 122):
        return ("Nhiều mây", "cloud.fill")
    if code in (143, 248, 260):
        return ("Sương mù", "cloud.fill")
    if code in (200, 386, 389, 392, 395):
        return ("Giông bão", "cloud.bolt.fill")
    if code in (179, 182, 185, 227, 230, 323, 326, 329, 332, 335, 338, 368, 371):
        return ("Có tuyết", "cloud.snow.fill")
    if code in (176, 263, 266, 293, 296, 353):
        return ("Mưa nhẹ", "cloud.rain.fill")
    if code in (299, 302, 305, 308, 356, 359):
        return ("Có mưa", "cloud.rain.fill")
    return ("Nhiều mây", "cloud.fill")


def _tools_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        http2=False,
        follow_redirects=True,
        timeout=httpx.Timeout(9.0, connect=5.0),
        headers={"User-Agent": USER_AGENT, "Accept-Language": "vi,en;q=0.8"},
    )


# Nominatim sometimes mislabels suburbs in VN municipalities under neighboring towns, while ISO3166-2-lvl4 is exact
_VN_ISO_CITY = {
    "VN-HN": "Hà Nội",
    "VN-SG": "TP. Hồ Chí Minh",
    "VN-DN": "Đà Nẵng",
    "VN-HP": "Hải Phòng",
    "VN-CT": "Cần Thơ",
    "VN-26": "Huế",
}


# --------------------------------------------------------------------------- geocoding & places
async def reverse_geocode(lat: float, lon: float) -> dict:
    """Resolve GPS coordinates into friendly place names (neighborhood, district, city)."""
    ck = f"rev:{round(lat, 3)}:{round(lon, 3)}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    suggestions: list[dict] = []
    city = ""
    async with _tools_client() as client:
        # 1) OpenStreetMap Nominatim (great detail for Vietnamese streets, wards, districts, cities)
        try:
            r = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 16, "addressdetails": 1, "accept-language": "vi"},
            )
            if r.status_code == 200:
                data = r.json()
                addr = data.get("address") or {}
                city = (
                    _VN_ISO_CITY.get((addr.get("ISO3166-2-lvl4") or "").upper())
                    or addr.get("city")
                    or addr.get("town")
                    or addr.get("state")
                    or addr.get("province")
                    or addr.get("county")
                    or ""
                ).replace("Thành phố ", "")
                district = (
                    addr.get("city_district")
                    or addr.get("suburb")
                    or addr.get("quarter")
                    or addr.get("borough")
                    or addr.get("county")
                    or ""
                )
                road = addr.get("road") or addr.get("amenity") or data.get("name") or ""
                seen: set[str] = set()

                def _push(label: str, detail: str = "") -> None:
                    lbl = label.strip().strip(",")
                    if lbl and lbl.lower() not in seen:
                        seen.add(lbl.lower())
                        suggestions.append({"name": lbl, "detail": detail, "city": city or lbl, "lat": lat, "lon": lon})

                if road and district and road.lower() != district.lower():
                    _push(f"{road}, {district}", city)
                if district and city and district.lower() != city.lower():
                    _push(f"{district}, {city}", "Quận / Khu vực")
                if city:
                    _push(city, "Thành phố")
        except Exception as exc:
            log.warning("Nominatim reverse geocode failed: %s", exc)

        # 2) BigDataCloud client reverse geocode fallback (very fast, high cloud rate limits)
        if not suggestions:
            try:
                r = await client.get(
                    "https://api.bigdatacloud.net/data/reverse-geocode-client",
                    params={"latitude": lat, "longitude": lon, "localityLanguage": "vi"},
                )
                if r.status_code == 200:
                    data = r.json()
                    city = (data.get("city") or data.get("principalSubdivision") or "").replace("Thành phố ", "")
                    loc = data.get("locality") or ""
                    if loc and city and loc.lower() != city.lower():
                        suggestions.append({"name": f"{loc}, {city}", "detail": "Khu vực hiện tại", "city": city, "lat": lat, "lon": lon})
                    if city:
                        suggestions.append({"name": city, "detail": "Thành phố", "city": city, "lat": lat, "lon": lon})
            except Exception as exc:
                log.warning("BigDataCloud reverse geocode failed: %s", exc)

    # 3) Built-in nearest Vietnamese city offline fallback
    if not city:
        near = _nearest_vn_city(lat, lon)
        if near:
            city = near
            if not suggestions:
                suggestions.append({"name": near, "detail": "Vị trí gần nhất", "city": near, "lat": lat, "lon": lon})

    result = {"city": city, "places": suggestions}
    _cache_set(ck, result, 6 * 3600)
    return result


async def search_places(q: str, limit: int = 6) -> list[dict]:
    """Search cities, landmarks, cafes, districts (offline VN cities + Nominatim + Open-Meteo)."""
    cleaned = (q or "").strip()
    if not cleaned:
        return []
    nq = _norm(cleaned)
    ck = f"places:{nq}:{limit}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    out: list[dict] = []
    seen: set[str] = set()

    def _add(name: str, detail: str, city: str, lat: float, lon: float) -> None:
        key = _norm(f"{name} {detail}")
        if not name or key in seen:
            return
        seen.add(key)
        out.append({"name": name, "detail": detail, "city": city or name, "lat": lat, "lon": lon})

    # 1) Instant exact / prefix matches from built-in VN cities
    exact = _match_vn_city(cleaned)
    if exact:
        _add(exact[0], "Việt Nam", exact[0], exact[1], exact[2])
    else:
        for cname, clat, clon, aliases in _VN_CITIES_RAW:
            if nq in _norm(cname) or any(nq in _norm(a) for a in aliases):
                _add(cname, "Việt Nam", cname, clat, clon)
                if len(out) >= 3:
                    break

    async with _tools_client() as client:
        # 2) OpenStreetMap Nominatim (great for specific places, landmarks, streets, cafes in VN & worldwide)
        try:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": cleaned, "format": "jsonv2", "addressdetails": 1, "accept-language": "vi", "limit": limit},
            )
            if r.status_code == 200:
                for item in r.json() or []:
                    addr = item.get("address") or {}
                    primary = (item.get("name") or "").strip()
                    city = (addr.get("city") or addr.get("town") or addr.get("state") or addr.get("province") or "").replace("Thành phố ", "")
                    district = addr.get("city_district") or addr.get("suburb") or addr.get("county") or ""
                    country = addr.get("country") or ""
                    if not primary:
                        primary = (item.get("display_name") or "").split(",")[0].strip()
                    parts = [p for p in (district, city, country) if p and _norm(p) != _norm(primary)]
                    detail = ", ".join(dict.fromkeys(parts))[:80]
                    _add(primary, detail, city or primary, float(item["lat"]), float(item["lon"]))
                    if len(out) >= limit:
                        break
        except Exception as exc:
            log.warning("Nominatim place search failed for %r: %s", cleaned, exc)

        # 3) Open-Meteo Geocoding fallback if still empty
        if not out:
            try:
                r = await client.get(
                    "https://geocoding-api.open-meteo.com/v1/search",
                    params={"name": cleaned, "count": limit, "language": "vi", "format": "json"},
                )
                if r.status_code == 200:
                    for item in r.json().get("results") or []:
                        name = (item.get("name") or "").strip()
                        detail = ", ".join(p for p in (item.get("admin1"), item.get("country")) if p)
                        _add(name, detail, name, float(item["latitude"]), float(item["longitude"]))
            except Exception as exc:
                log.warning("Open-Meteo geocoding failed for %r: %s", cleaned, exc)

    result = out[:limit]
    if result:
        _cache_set(ck, result, 24 * 3600)
    return result


# --------------------------------------------------------------------------- weather
async def lookup_weather(q: str = "", lat: Optional[float] = None, lon: Optional[float] = None) -> dict:
    """Fetch live weather via MET Norway -> Open-Meteo -> wttr.in with caching & VN city resolution."""
    city = (q or "").strip()

    if lat is None or lon is None:
        if not city:
            raise ValueError("Nhập tên thành phố hoặc bật vị trí.")
        vn = _match_vn_city(city)
        if vn:
            city, lat, lon = vn
        else:
            places = await search_places(city, limit=1)
            if not places:
                raise LookupError(f"Không tìm thấy địa điểm '{city}'.")
            lat = places[0]["lat"]
            lon = places[0]["lon"]
            city = places[0]["name"]
    elif not city:
        rev = await reverse_geocode(lat, lon)
        city = rev.get("city") or ""

    ck = f"wx:{round(lat, 2)}:{round(lon, 2)}"
    forecast = _cache_get(ck)

    if forecast is None:
        errors: list[str] = []
        async with _tools_client() as client:
            # Provider 1: MET Norway (reliable on cloud servers, zero API key, rich current conditions)
            try:
                r = await client.get(
                    "https://api.met.no/weatherapi/locationforecast/2.0/compact",
                    params={"lat": round(lat, 4), "lon": round(lon, 4)},
                )
                r.raise_for_status()
                ts = (r.json().get("properties") or {}).get("timeseries") or []
                if ts:
                    entry = ts[0].get("data") or {}
                    inst = (entry.get("instant") or {}).get("details") or {}
                    sym_code = (
                        ((entry.get("next_1_hours") or {}).get("summary") or {}).get("symbol_code")
                        or ((entry.get("next_6_hours") or {}).get("summary") or {}).get("symbol_code")
                        or "cloudy"
                    )
                    temp = round(float(inst.get("air_temperature", 0)))
                    humidity = round(float(inst["relative_humidity"])) if "relative_humidity" in inst else None
                    desc, sym = _metno_symbol_to_vi(sym_code)
                    forecast = {"temp": temp, "feelsLike": temp, "humidity": humidity, "desc": desc, "symbol": sym, "source": "metno"}
            except Exception as exc:
                errors.append(f"metno:{exc}")
                log.warning("Weather provider met.no failed: %s", exc)

            # Provider 2: Open-Meteo
            if forecast is None:
                try:
                    r = await client.get(
                        "https://api.open-meteo.com/v1/forecast",
                        params={
                            "latitude": round(lat, 4),
                            "longitude": round(lon, 4),
                            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day",
                        },
                    )
                    r.raise_for_status()
                    cur = r.json().get("current") or {}
                    temp = round(float(cur.get("temperature_2m", 0)))
                    feels = round(float(cur.get("apparent_temperature", temp)))
                    humidity = round(float(cur["relative_humidity_2m"])) if cur.get("relative_humidity_2m") is not None else None
                    code = int(cur.get("weather_code", 0))
                    is_day = int(cur.get("is_day", 1)) == 1
                    desc, day_sym, night_sym = _WMO_VI.get(code, ("Nhiều mây", "cloud.fill", "cloud.fill"))
                    forecast = {
                        "temp": temp,
                        "feelsLike": feels,
                        "humidity": humidity,
                        "desc": desc,
                        "symbol": day_sym if is_day else night_sym,
                        "source": "open-meteo",
                    }
                except Exception as exc:
                    errors.append(f"open-meteo:{exc}")
                    log.warning("Weather provider open-meteo failed: %s", exc)

            # Provider 3: wttr.in
            if forecast is None:
                try:
                    r = await client.get(f"https://wttr.in/{round(lat, 3)},{round(lon, 3)}", params={"format": "j1"})
                    r.raise_for_status()
                    cc = (r.json().get("current_condition") or [{}])[0]
                    temp = round(float(cc.get("temp_C", 0)))
                    feels = round(float(cc.get("FeelsLikeC", temp)))
                    humidity = round(float(cc["humidity"])) if cc.get("humidity") else None
                    code = int(cc.get("weatherCode", 119))
                    desc, sym = _wttr_code_to_vi(code, is_day=True)
                    forecast = {"temp": temp, "feelsLike": feels, "humidity": humidity, "desc": desc, "symbol": sym, "source": "wttr"}
                except Exception as exc:
                    errors.append(f"wttr:{exc}")
                    log.warning("Weather provider wttr.in failed: %s", exc)

        if forecast is None:
            raise RuntimeError(f"Không lấy được dữ liệu thời tiết ({'; '.join(errors)[:120]}).")
        _cache_set(ck, forecast, 600)

    temp = forecast["temp"]
    desc = forecast["desc"]
    sym = forecast["symbol"]
    full_label = f"{temp}°C · {desc}" + (f" · {city}" if city else "")
    short_label = f"{temp}°C · {city}" if city else f"{temp}°C · {desc}"
    return {
        "temp": temp,
        "feelsLike": forecast.get("feelsLike", temp),
        "humidity": forecast.get("humidity"),
        "desc": desc,
        "symbol": sym,
        "city": city,
        "text": full_label,
        "shortText": short_label,
    }


# --------------------------------------------------------------------------- music search
async def search_music(q: str, limit: int = 12) -> list[dict]:
    """Search songs via iTunes Search API + Deezer fallback (with 30s audio preview & cover art)."""
    cleaned = (q or "").strip()
    if not cleaned:
        return []
    ck = f"music:{_norm(cleaned)}:{limit}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    tracks: list[dict] = []
    seen: set[str] = set()

    def _add(item: dict) -> None:
        key = _norm(f"{item['title']} {item['artist']}")
        if not item["title"] or key in seen:
            return
        seen.add(key)
        tracks.append(item)

    async with _tools_client() as client:
        # 1) iTunes Search API first (permanent preview URLs & Apple Music links that Locket iOS natively supports)
        try:
            r = await client.get(
                "https://itunes.apple.com/search",
                params={"term": cleaned, "media": "music", "entity": "song", "limit": limit, "country": "VN"},
            )
            if r.status_code == 200:
                rows = r.json().get("results") or []
                if not rows:
                    r_us = await client.get(
                        "https://itunes.apple.com/search",
                        params={"term": cleaned, "media": "music", "entity": "song", "limit": limit, "country": "US"},
                    )
                    if r_us.status_code == 200:
                        rows = r_us.json().get("results") or []
                for it in rows:
                    title = (it.get("trackName") or "").strip()
                    artist = (it.get("artistName") or "").strip()
                    if not title:
                        continue
                    artwork = (it.get("artworkUrl100") or it.get("artworkUrl60") or "").replace("100x100bb", "200x200bb")
                    preview = (it.get("previewUrl") or "").strip()
                    _add({
                        "id": f"it-{it.get('trackId') or len(tracks)}",
                        "title": title,
                        "artist": artist,
                        "artwork": artwork,
                        "artworkProxy": proxied(artwork) if artwork else None,
                        "previewUrl": preview,
                        "previewProxy": proxied(preview) if preview else None,
                        "appleMusicUrl": (it.get("trackViewUrl") or "").strip(),
                        "source": "itunes",
                    })
        except Exception as exc:
            log.warning("iTunes search failed for %r: %s", cleaned, exc)

        # 2) Deezer Search API fallback / supplement (MP3 previews + broad catalog if iTunes is sparse or throttled)
        if len(tracks) < limit:
            try:
                r = await client.get("https://api.deezer.com/search", params={"q": cleaned, "limit": limit})
                if r.status_code == 200:
                    for it in r.json().get("data") or []:
                        title = (it.get("title_short") or it.get("title") or "").strip()
                        artist = ((it.get("artist") or {}).get("name") or "").strip()
                        album = it.get("album") or {}
                        artwork = (album.get("cover_medium") or album.get("cover") or "").strip()
                        preview = (it.get("preview") or "").strip()
                        if not title:
                            continue
                        _add({
                            "id": f"dz-{it.get('id') or len(tracks)}",
                            "title": title,
                            "artist": artist,
                            "artwork": artwork,
                            "artworkProxy": proxied(artwork) if artwork else None,
                            "previewUrl": preview,
                            "previewProxy": proxied(preview) if preview else None,
                            "appleMusicUrl": (it.get("link") or "").strip(),
                            "source": "deezer",
                        })
                        if len(tracks) >= limit:
                            break
            except Exception as exc:
                log.warning("Deezer search failed for %r: %s", cleaned, exc)

    result = tracks[:limit]
    if result:
        _cache_set(ck, result, 1800)
    return result
