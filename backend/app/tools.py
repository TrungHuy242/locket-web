"""Smart caption tools: resilient multi-provider Weather + AQI, Place/Nearby POI Geocoding,
and Music Search + Link Resolver (Spotify/Apple Music/YouTube/SoundCloud) + VN Trending.
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
import unicodedata
from typing import Optional
from urllib.parse import parse_qs, urlparse

import httpx

from .providers.live_common import proxied

log = logging.getLogger(__name__)

USER_AGENT = "LocketWeb/2.0 (https://locket-web-wmqv.onrender.com)"

# Bounded in-memory TTL cache: key -> (expires_at, value)
_CACHE: dict[str, tuple[float, object]] = {}
_CACHE_MAX = 500


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


def _dist_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 6371.0 * 2 * math.asin(min(1.0, math.sqrt(a)))


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

_VN_ISO_CITY = {
    "VN-HN": "Hà Nội",
    "VN-SG": "TP. Hồ Chí Minh",
    "VN-DN": "Đà Nẵng",
    "VN-HP": "Hải Phòng",
    "VN-CT": "Cần Thơ",
    "VN-26": "Huế",
}


def _match_vn_city(q: str) -> Optional[tuple[str, float, float]]:
    nq = _norm(q)
    return _VN_ALIAS_MAP.get(nq) if nq else None


def _nearest_vn_city(lat: float, lon: float, max_km: float = 60.0) -> Optional[str]:
    best_name = None
    best_km = max_km
    for name, clat, clon, _ in _VN_CITIES_RAW:
        km = _dist_km(lat, lon, clat, clon)
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


def _aqi_label(aqi: int) -> str:
    if aqi <= 50:
        return "Tốt"
    if aqi <= 100:
        return "Khá"
    if aqi <= 150:
        return "Trung bình"
    if aqi <= 200:
        return "Kém"
    return "Xấu"


def _poi_category(osm_key: str, osm_val: str) -> str:
    v = (osm_val or "").lower()
    k = (osm_key or "").lower()
    if v in ("cafe", "coffee_shop"):
        return "cafe"
    if v in ("restaurant", "fast_food", "food_court", "bar", "pub", "bakery"):
        return "food"
    if v in ("mall", "supermarket", "department_store", "marketplace") or k == "shop":
        return "shop"
    if v in ("university", "school", "college", "library"):
        return "school"
    if v in ("park", "beach", "garden", "playground"):
        return "park"
    if k == "tourism" or v in ("cinema", "theatre", "stadium"):
        return "landmark"
    return "place"


def _tools_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        http2=False,
        follow_redirects=True,
        timeout=httpx.Timeout(9.0, connect=5.0),
        headers={"User-Agent": USER_AGENT, "Accept-Language": "vi,en;q=0.8"},
    )


# --------------------------------------------------------------------------- geocoding, reverse GPS & nearby POIs
async def reverse_geocode(lat: float, lon: float) -> dict:
    """Resolve GPS coordinates into street/district/city + real nearby POIs (cafes, landmarks, parks)."""
    ck = f"rev2:{round(lat, 3)}:{round(lon, 3)}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    suggestions: list[dict] = []
    seen: set[str] = set()
    city = ""

    def _push(label: str, detail: str = "", category: str = "place", p_lat: float = lat, p_lon: float = lon) -> None:
        lbl = (label or "").strip().strip(",")
        key = _norm(lbl)
        if not lbl or key in seen:
            return
        seen.add(key)
        suggestions.append({
            "name": lbl,
            "detail": detail,
            "city": city or lbl,
            "category": category,
            "lat": p_lat,
            "lon": p_lon,
        })

    async with _tools_client() as client:
        async def _nom():
            try:
                r = await client.get(
                    "https://nominatim.openstreetmap.org/reverse",
                    params={"lat": lat, "lon": lon, "format": "jsonv2", "zoom": 16, "addressdetails": 1, "accept-language": "vi"},
                )
                return r.json() if r.status_code == 200 else None
            except Exception as exc:
                log.warning("Nominatim reverse geocode failed: %s", exc)
                return None

        async def _photon():
            try:
                r = await client.get(
                    "https://photon.komoot.io/reverse",
                    params={"lat": lat, "lon": lon, "limit": 10, "radius": 0.9},
                    timeout=5.0,
                )
                return r.json() if r.status_code == 200 else None
            except Exception as exc:
                log.warning("Photon reverse POI failed: %s", exc)
                return None

        nom_data, photon_data = await asyncio.gather(_nom(), _photon())

        if isinstance(nom_data, dict):
            addr = nom_data.get("address") or {}
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
            road = addr.get("road") or addr.get("amenity") or nom_data.get("name") or ""
            if district and city and _norm(district) != _norm(city):
                _push(f"{district}, {city}", "Khu vực hiện tại", "area")
            if city:
                _push(city, "Thành phố", "city")
            if road and district and _norm(road) != _norm(district):
                _push(f"{road}, {district}", city, "street")

        # Add nearby named POIs from Photon (cafes, landmarks, parks, malls, streets)
        if isinstance(photon_data, dict):
            for feat in photon_data.get("features") or []:
                props = feat.get("properties") or {}
                coords = (feat.get("geometry") or {}).get("coordinates") or [lon, lat]
                pname = (props.get("name") or "").strip()
                if not pname or len(pname) < 2:
                    continue
                plon, plat = float(coords[0]), float(coords[1])
                d_m = int(round(_dist_km(lat, lon, plat, plon) * 1000))
                cat = _poi_category(props.get("osm_key", ""), props.get("osm_value", ""))
                dist_txt = f"~{d_m}m" if d_m < 1000 else f"~{d_m / 1000:.1f}km"
                sub = props.get("district") or props.get("street") or city
                detail = " · ".join(p for p in (dist_txt, sub) if p)
                _push(pname, detail, cat, plat, plon)
                if len(suggestions) >= 10:
                    break

        # Fallback: BigDataCloud if still missing city
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
                    if loc and city and _norm(loc) != _norm(city):
                        _push(f"{loc}, {city}", "Khu vực hiện tại", "area")
                    if city:
                        _push(city, "Thành phố", "city")
            except Exception as exc:
                log.warning("BigDataCloud reverse geocode failed: %s", exc)

    if not city:
        near = _nearest_vn_city(lat, lon)
        if near:
            city = near
            if not suggestions:
                _push(near, "Thành phố gần nhất", "city")

    result = {"city": city, "places": suggestions}
    _cache_set(ck, result, 1800)
    return result


async def search_places(q: str, lat: Optional[float] = None, lon: Optional[float] = None, limit: int = 8) -> list[dict]:
    """Search cities, cafes, landmarks, districts (offline VN cities + GPS-biased Photon + Nominatim + Open-Meteo)."""
    cleaned = (q or "").strip()
    if not cleaned:
        return []
    nq = _norm(cleaned)
    bias_key = f"{round(lat, 2)}:{round(lon, 2)}" if (lat is not None and lon is not None) else "none"
    ck = f"places2:{nq}:{bias_key}:{limit}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    out: list[dict] = []
    seen: set[str] = set()

    def _add(name: str, detail: str, city: str, plat: float, plon: float, category: str = "place") -> None:
        key = _norm(f"{name} {detail}")
        if not name or key in seen:
            return
        seen.add(key)
        out.append({"name": name, "detail": detail, "city": city or name, "category": category, "lat": plat, "lon": plon})

    # 1) Instant exact / prefix matches from built-in VN cities
    exact = _match_vn_city(cleaned)
    if exact:
        _add(exact[0], "Việt Nam", exact[0], exact[1], exact[2], "city")
    else:
        for cname, clat, clon, aliases in _VN_CITIES_RAW:
            if nq in _norm(cname) or any(nq in _norm(a) for a in aliases):
                _add(cname, "Việt Nam", cname, clat, clon, "city")
                if len(out) >= 2:
                    break

    async with _tools_client() as client:
        # 2) Photon fast autocomplete (supports lat/lon proximity bias for local cafes & spots!)
        try:
            p_params = {"q": cleaned, "limit": limit + 4, "lang": "default"}   # "default" = local (Vietnamese) names
            if lat is not None and lon is not None:
                p_params["lat"] = round(lat, 4)
                p_params["lon"] = round(lon, 4)
            r = await client.get("https://photon.komoot.io/api", params=p_params, timeout=5.0)
            if r.status_code == 200:
                for feat in r.json().get("features") or []:
                    props = feat.get("properties") or {}
                    coords = (feat.get("geometry") or {}).get("coordinates") or [0, 0]
                    name = (props.get("name") or "").strip()
                    if not name:
                        continue
                    city = (props.get("city") or props.get("state") or "").replace("Thành phố ", "")
                    district = props.get("district") or props.get("street") or ""
                    country = props.get("country") or ""
                    parts = [p for p in (district, city, country) if p and _norm(p) != _norm(name)]
                    detail = ", ".join(dict.fromkeys(parts))[:80]
                    cat = _poi_category(props.get("osm_key", ""), props.get("osm_value", ""))
                    _add(name, detail, city or name, float(coords[1]), float(coords[0]), cat)
                    if len(out) >= limit:
                        break
        except Exception as exc:
            log.warning("Photon search failed for %r: %s", cleaned, exc)

        # 3) Nominatim fallback / supplement
        if len(out) < 3:
            try:
                r = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": cleaned, "format": "jsonv2", "addressdetails": 1, "accept-language": "vi", "limit": limit},
                )
                if r.status_code == 200:
                    for item in r.json() or []:
                        addr = item.get("address") or {}
                        primary = (item.get("name") or "").strip() or (item.get("display_name") or "").split(",")[0].strip()
                        city = (
                            _VN_ISO_CITY.get((addr.get("ISO3166-2-lvl4") or "").upper())
                            or addr.get("city")
                            or addr.get("town")
                            or addr.get("state")
                            or addr.get("province")
                            or ""
                        ).replace("Thành phố ", "")
                        district = addr.get("city_district") or addr.get("suburb") or addr.get("county") or ""
                        country = addr.get("country") or ""
                        parts = [p for p in (district, city, country) if p and _norm(p) != _norm(primary)]
                        detail = ", ".join(dict.fromkeys(parts))[:80]
                        _add(primary, detail, city or primary, float(item["lat"]), float(item["lon"]))
                        if len(out) >= limit:
                            break
            except Exception as exc:
                log.warning("Nominatim place search failed for %r: %s", cleaned, exc)

        # 4) Open-Meteo Geocoding last resort
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
                        _add(name, detail, name, float(item["latitude"]), float(item["longitude"]), "city")
            except Exception as exc:
                log.warning("Open-Meteo geocoding failed for %r: %s", cleaned, exc)

    if lat is not None and lon is not None and out:
        # nearest first; drop far-away namesakes (another country) when enough nearby places matched
        for item in out:
            item["km"] = round(_dist_km(lat, lon, item["lat"], item["lon"]), 1)
        near = [i for i in out if i["km"] <= 300]
        pool = near if len(near) >= 3 else out
        out = sorted(pool, key=lambda i: (i["category"] != "city" and i["km"] > 300, i["km"]))
    result = out[:limit]
    if result:
        _cache_set(ck, result, 12 * 3600)
    return result


# --------------------------------------------------------------------------- weather + AQI
async def _fetch_aqi(client: httpx.AsyncClient, lat: float, lon: float) -> Optional[dict]:
    ck = f"aqi:{round(lat, 2)}:{round(lon, 2)}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached
    try:
        r = await client.get(
            "https://air-quality-api.open-meteo.com/v1/air-quality",
            params={"latitude": round(lat, 4), "longitude": round(lon, 4), "current": "us_aqi"},
            timeout=3.5,
        )
        if r.status_code == 200:
            val = (r.json().get("current") or {}).get("us_aqi")
            if isinstance(val, (int, float)):
                aqi = int(round(val))
                res = {"aqi": aqi, "aqiLabel": _aqi_label(aqi)}
                _cache_set(ck, res, 1800)
                return res
    except Exception:
        pass
    return None


async def lookup_weather(q: str = "", lat: Optional[float] = None, lon: Optional[float] = None) -> dict:
    """Fetch live weather + optional AQI via MET Norway -> Open-Meteo -> wttr.in with caching & VN city lookup."""
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

    ck = f"wx2:{round(lat, 2)}:{round(lon, 2)}"
    forecast = _cache_get(ck)

    if forecast is None:
        errors: list[str] = []
        async with _tools_client() as client:
            aqi_task = asyncio.create_task(_fetch_aqi(client, lat, lon))

            # Provider 1: MET Norway
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

            aqi_info = await aqi_task
            if forecast is None:
                raise RuntimeError(f"Không lấy được dữ liệu thời tiết ({'; '.join(errors)[:120]}).")
            if aqi_info:
                forecast["aqi"] = aqi_info["aqi"]
                forecast["aqiLabel"] = aqi_info["aqiLabel"]
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
        "aqi": forecast.get("aqi"),
        "aqiLabel": forecast.get("aqiLabel"),
        "desc": desc,
        "symbol": sym,
        "city": city,
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "text": full_label,
        "shortText": short_label,
    }


# --------------------------------------------------------------------------- music search, link resolver & VN trending
_MUSIC_URL_RE = re.compile(r"^https?://", re.I)
_TITLE_NOISE_RE = re.compile(
    r"(\[[^\]]*\]|\((?:official|mv|video|lyric|lyrics|audio|visualizer|hd|4k)[^)]*\)|\bofficial\s*(?:music\s*)?(?:mv|video|audio|lyric(?:s)?)\b|\|.*$)",
    re.I,
)


def _clean_song_query(title: str, author: str = "") -> str:
    clean = _TITLE_NOISE_RE.sub(" ", title or "")
    clean = re.sub(r"[-–—|]+", " ", clean)
    clean = " ".join(clean.split()).strip()
    if author:
        au = re.sub(r"\b(official|vevo|topic|channel|music)\b", "", author, flags=re.I).strip()
        if au and _norm(au) not in _norm(clean):
            clean = f"{clean} {au}"
    return clean[:90]


def _itunes_item_to_track(it: dict, idx: int = 0) -> Optional[dict]:
    title = (it.get("trackName") or "").strip()
    artist = (it.get("artistName") or "").strip()
    if not title:
        return None
    artwork = (it.get("artworkUrl100") or it.get("artworkUrl60") or "").replace("100x100bb", "200x200bb")
    preview = (it.get("previewUrl") or "").strip()
    return {
        "id": f"it-{it.get('trackId') or idx}",
        "title": title,
        "artist": artist,
        "artwork": artwork,
        "artworkProxy": proxied(artwork) if artwork else None,
        "previewUrl": preview,
        "previewProxy": proxied(preview) if preview else None,
        "appleMusicUrl": (it.get("trackViewUrl") or "").strip(),
        "source": "itunes",
    }


_VARIANT_RE = re.compile(r"\b(remix|cover|karaoke|instrumental|live|sped ?up|slowed|nightcore|acoustic|8d|beat|lofi|lo-fi)\b", re.I)


def _rank_link_matches(tracks: list[dict], title: str, artist: str = "") -> list[dict]:
    """Put the track a link points to first: same title, same artist, and not a remix / cover / live
    version unless the linked title itself is one."""
    want = _norm(_TITLE_NOISE_RE.sub(" ", title or ""))
    who = _norm(artist or "")
    wants_variant = bool(_VARIANT_RE.search(title or ""))

    def score(t: dict) -> int:
        tt = _norm(t.get("title") or "")
        ta = _norm(t.get("artist") or "")
        s = 0
        if want and tt == want:
            s += 6
        elif want and (tt.startswith(want) or want.startswith(tt)):
            s += 3
        if not wants_variant and _VARIANT_RE.search(t.get("title") or ""):
            s -= 6
        if who and ta and (who in ta or ta in who):
            s += 5
        return s

    return sorted(tracks, key=score, reverse=True)


async def _spotify_artist(client: httpx.AsyncClient, url: str) -> str:
    """Spotify's oEmbed has no artist; the public track page title does ("Song - song by Artist | Spotify")."""
    try:
        r = await client.get(url, timeout=6.0, follow_redirects=True)
        if r.status_code != 200:
            return ""
        m = re.search(r"<title>(.*?)</title>", r.text, re.S | re.I)
        if not m:
            return ""
        t = re.sub(r"\s+", " ", m.group(1)).replace("&amp;", "&")
        m2 = re.search(r" - (?:song|single|album)(?: and lyrics)? by (.+?) \| Spotify", t, re.I)
        return m2.group(1).strip()[:80] if m2 else ""
    except Exception:
        return ""


async def _resolve_music_link(url: str) -> list[dict]:
    """Resolve a pasted Spotify / Apple Music / YouTube / SoundCloud URL into playable tracks."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not host:
        return []

    async with _tools_client() as client:
        # 1) Apple Music direct ID lookup (100% exact track + permanent preview!)
        if "music.apple.com" in host:
            qs = parse_qs(parsed.query)
            track_id = (qs.get("i") or [None])[0]
            if not track_id:
                m = re.search(r"/(\d{6,})(?:$|[/?])", parsed.path)
                track_id = m.group(1) if m else None
            if track_id:
                try:
                    r = await client.get("https://itunes.apple.com/lookup", params={"id": track_id, "country": "VN"})
                    if r.status_code == 200:
                        rows = r.json().get("results") or []
                        tracks = [t for idx, it in enumerate(rows) if (t := _itunes_item_to_track(it, idx))]
                        if tracks:
                            return tracks
                except Exception as exc:
                    log.warning("Apple Music link lookup failed: %s", exc)

        # 2) Spotify / YouTube / SoundCloud oEmbed -> match against iTunes/Deezer for 30s preview & crisp cover
        oembed_url = None
        oembed_params = {"url": url.strip()}
        if "spotify.com" in host or "spotify.link" in host:
            oembed_url = "https://open.spotify.com/oembed"
        elif "youtube.com" in host or "youtu.be" in host:
            oembed_url = "https://www.youtube.com/oembed"
            oembed_params["format"] = "json"
        elif "soundcloud.com" in host:
            oembed_url = "https://soundcloud.com/oembed"
            oembed_params["format"] = "json"

        if oembed_url:
            try:
                r = await client.get(oembed_url, params=oembed_params, timeout=6.0)
                if r.status_code == 200:
                    meta = r.json()
                    raw_title = (meta.get("title") or "").strip()
                    raw_author = (meta.get("author_name") or "").strip()
                    if not raw_author and ("spotify.com" in host or "spotify.link" in host):
                        raw_author = await _spotify_artist(client, url.strip())
                    thumb_url = (meta.get("thumbnail_url") or "").strip()
                    search_q = _clean_song_query(raw_title, raw_author)
                    matched = await search_music(search_q, limit=8, allow_url=False) if search_q else []
                    if matched:
                        matched = _rank_link_matches(matched, raw_title, raw_author)[:6]
                        if "spotify.com" in host:
                            matched[0] = {**matched[0], "appleMusicUrl": url.strip()}
                        return matched
                    if raw_title:
                        return [{
                            "id": f"link-{abs(hash(url)) % 10**8}",
                            "title": raw_title[:100],
                            "artist": raw_author[:80],
                            "artwork": thumb_url if thumb_url.startswith("https://") else "",
                            "artworkProxy": proxied(thumb_url) if thumb_url.startswith("https://") else None,
                            "previewUrl": "",
                            "previewProxy": None,
                            "appleMusicUrl": url.strip() if "spotify.com" in host else "",
                            "source": "link",
                        }]
            except Exception as exc:
                log.warning("Music link oEmbed failed for %s: %s", host, exc)
    return []


async def search_music(q: str, limit: int = 12, allow_url: bool = True) -> list[dict]:
    """Search songs via iTunes + Deezer fallback, or resolve a pasted Spotify/Apple/YouTube/SoundCloud URL."""
    cleaned = (q or "").strip()
    if not cleaned:
        return []
    if allow_url and _MUSIC_URL_RE.match(cleaned):
        resolved = await _resolve_music_link(cleaned)
        if resolved:
            return resolved

    ck = f"music:{_norm(cleaned)}:{limit}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    tracks: list[dict] = []
    seen: set[str] = set()

    def _add(item: Optional[dict]) -> None:
        if not item or not item.get("title"):
            return
        key = _norm(f"{item['title']} {item['artist']}")
        if key in seen:
            return
        seen.add(key)
        tracks.append(item)

    async with _tools_client() as client:
        # 1) iTunes Search API first (permanent preview URLs & Apple Music links)
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
                for idx, it in enumerate(rows):
                    _add(_itunes_item_to_track(it, idx))
        except Exception as exc:
            log.warning("iTunes search failed for %r: %s", cleaned, exc)

        # 2) Deezer Search API fallback / supplement
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


async def trending_music(limit: int = 12) -> list[dict]:
    """Fetch Top Trending Vietnam songs (Apple Music VN RSS -> Deezer Chart fallback), cached 2h."""
    ck = f"music:trending:vn:{limit}"
    cached = _cache_get(ck)
    if cached is not None:
        return cached

    tracks: list[dict] = []
    async with _tools_client() as client:
        # 1) Apple Music Vietnam Top Songs RSS (permanent preview URLs + artwork)
        try:
            r = await client.get(f"https://itunes.apple.com/vn/rss/topsongs/limit={limit}/json", timeout=7.0)
            if r.status_code == 200:
                entries = (r.json().get("feed") or {}).get("entry") or []
                if isinstance(entries, dict):
                    entries = [entries]
                for idx, e in enumerate(entries):
                    title = ((e.get("im:name") or {}).get("label") or "").strip()
                    artist = ((e.get("im:artist") or {}).get("label") or "").strip()
                    imgs = e.get("im:image") or []
                    artwork = (imgs[-1].get("label") if isinstance(imgs, list) and imgs else "") or ""
                    links = e.get("link") or []
                    if isinstance(links, dict):
                        links = [links]
                    preview = ""
                    apple_url = ""
                    for lk in links:
                        attrs = lk.get("attributes") or {}
                        if attrs.get("rel") == "enclosure" and attrs.get("href"):
                            preview = attrs["href"]
                        elif attrs.get("rel") == "alternate" and attrs.get("href"):
                            apple_url = attrs["href"]
                    if not title:
                        continue
                    tracks.append({
                        "id": f"rss-{idx}-{abs(hash(title)) % 10**6}",
                        "title": title,
                        "artist": artist,
                        "artwork": artwork,
                        "artworkProxy": proxied(artwork) if artwork else None,
                        "previewUrl": preview,
                        "previewProxy": proxied(preview) if preview else None,
                        "appleMusicUrl": apple_url,
                        "source": "itunes",
                    })
        except Exception as exc:
            log.warning("Apple RSS VN trending failed: %s", exc)

        # 2) Deezer global/chart fallback if Apple RSS failed
        if not tracks:
            try:
                r = await client.get("https://api.deezer.com/chart/0/tracks", params={"limit": limit}, timeout=7.0)
                if r.status_code == 200:
                    for it in r.json().get("data") or []:
                        title = (it.get("title_short") or it.get("title") or "").strip()
                        artist = ((it.get("artist") or {}).get("name") or "").strip()
                        album = it.get("album") or {}
                        artwork = (album.get("cover_medium") or album.get("cover") or "").strip()
                        preview = (it.get("preview") or "").strip()
                        if title:
                            tracks.append({
                                "id": f"dz-top-{it.get('id') or len(tracks)}",
                                "title": title,
                                "artist": artist,
                                "artwork": artwork,
                                "artworkProxy": proxied(artwork) if artwork else None,
                                "previewUrl": preview,
                                "previewProxy": proxied(preview) if preview else None,
                                "appleMusicUrl": (it.get("link") or "").strip(),
                                "source": "deezer",
                            })
            except Exception as exc:
                log.warning("Deezer chart fallback failed: %s", exc)

    if tracks:
        _cache_set(ck, tracks[:limit], 7200)
    return tracks[:limit]
