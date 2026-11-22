// Modular panels for StylePicker:
// - MusicPanel (Group A): search + Spotify/Apple/YouTube/SoundCloud link paste + Top VN Trending + Favorites + Adaptive Album Palette
// - WeatherPanel (Group B): auto-load last city + °C/°F + AQI + Humidity + Weather Mood Gradients + manual icon picker
// - LocationPanel (Group C): GPS + Nearby POIs (cafes/landmarks) + debounced autocomplete + Pinned Places + Check-in icons
// - BadgesPanel (Group D): Live Clock (24h/12h), Streak, Locket Count, 12 Zodiac Signs, and Custom Saved Presets
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Icon, SymbolIcon } from '../../lib/icons.jsx';
import { clock, overlayStyle } from '../../lib/format.js';
import { extractAlbumPalette } from '../../lib/albumPalette.js';
import {
  deleteCustomPreset, loadCustomPresets, loadFavMusic, loadLastWeather, loadPinnedPlaces,
  loadRecentMusic, loadRecentPlaces, loadZodiac, saveCustomPreset, saveLastWeather,
  saveRecentMusic, saveRecentPlace, saveZodiac, toggleFavMusic, togglePinnedPlace,
} from '../../lib/captionStorage.js';
import { ui } from '../../ui/overlays.jsx';

let trendingCache = null;
let statsCache = null;

const QUICK_MUSIC = ['Sơn Tùng', 'HIEUTHUHAI', 'Wren Evans', 'tlinh', 'Lofi Chill', 'Taylor Swift'];
const QUICK_CITIES = ['Hà Nội', 'TP.HCM', 'Đà Nẵng', 'Đà Lạt', 'Nha Trang', 'Huế', 'Cần Thơ', 'Hải Phòng'];
const QUICK_PLACES = ['Ở nhà', 'Quán cà phê', 'Trường học', 'Công ty', 'Ngoài phố', 'Đi du lịch'];

const PLACE_ICONS = [
  { id: '', label: 'Ghim', emoji: null },
  { id: '☕', label: 'Cà phê', emoji: '☕' },
  { id: '🏠', label: 'Nhà', emoji: '🏠' },
  { id: '🎓', label: 'Trường', emoji: '🎓' },
  { id: '🍜', label: 'Ăn uống', emoji: '🍜' },
  { id: '✈️', label: 'Du lịch', emoji: '✈️' },
  { id: '🎬', label: 'Giải trí', emoji: '🎬' },
];

const CAT_EMOJI = { cafe: '☕', food: '🍜', shop: '🛍️', school: '🎓', park: '🌿', landmark: '✨' };

const WEATHER_ICONS = [
  { sym: 'sun.max.fill', label: 'Nắng' },
  { sym: 'cloud.sun.fill', label: 'Ít mây' },
  { sym: 'cloud.fill', label: 'Nhiều mây' },
  { sym: 'cloud.rain.fill', label: 'Mưa' },
  { sym: 'cloud.bolt.fill', label: 'Giông' },
  { sym: 'cloud.snow.fill', label: 'Tuyết' },
  { sym: 'moon.stars.fill', label: 'Đêm' },
];

const WEATHER_MOODS = {
  'sun.max.fill': { colors: ['#FF9500', '#FFD60A'], textColor: '#111111' },
  'cloud.sun.fill': { colors: ['#36A2EB', '#6DD5ED'], textColor: '#FFFFFF' },
  'cloud.fill': { colors: ['#5B677E', '#3A455A'], textColor: '#FFFFFF' },
  'cloud.rain.fill': { colors: ['#2B5876', '#4E4376'], textColor: '#FFFFFF' },
  'cloud.bolt.fill': { colors: ['#232526', '#414345'], textColor: '#FFE8A3' },
  'cloud.snow.fill': { colors: ['#83A4D4', '#C9E6FF'], textColor: '#102030' },
  'moon.fill': { colors: ['#141E30', '#243B55'], textColor: '#FFE8A3' },
  'moon.stars.fill': { colors: ['#141E30', '#2B3A67'], textColor: '#FFE8A3' },
};

const ZODIAC_SIGNS = [
  { id: 'aries', name: 'Bạch Dương', emoji: '♈', colors: ['#FF416C', '#FF4B2B'], textColor: '#FFFFFF' },
  { id: 'taurus', name: 'Kim Ngưu', emoji: '♉', colors: ['#11998E', '#38EF7D'], textColor: '#0E2918' },
  { id: 'gemini', name: 'Song Tử', emoji: '♊', colors: ['#F7971E', '#FFD200'], textColor: '#111111' },
  { id: 'cancer', name: 'Cự Giải', emoji: '♋', colors: ['#667EEA', '#764BA2'], textColor: '#FFFFFF' },
  { id: 'leo', name: 'Sư Tử', emoji: '♌', colors: ['#F12711', '#F5AF19'], textColor: '#FFFFFF' },
  { id: 'virgo', name: 'Xử Nữ', emoji: '♍', colors: ['#56AB2F', '#A8E063'], textColor: '#0E2918' },
  { id: 'libra', name: 'Thiên Bình', emoji: '♎', colors: ['#EC008C', '#FC6767'], textColor: '#FFFFFF' },
  { id: 'scorpio', name: 'Bọ Cạp', emoji: '♏', colors: ['#200122', '#6F0000'], textColor: '#FFFFFF' },
  { id: 'sagittarius', name: 'Nhân Mã', emoji: '♐', colors: ['#7F00FF', '#E100FF'], textColor: '#FFFFFF' },
  { id: 'capricorn', name: 'Ma Kết', emoji: '♑', colors: ['#232526', '#414345'], textColor: '#FFFFFF' },
  { id: 'aquarius', name: 'Bảo Bình', emoji: '♒', colors: ['#00B4DB', '#0083B0'], textColor: '#FFFFFF' },
  { id: 'pisces', name: 'Song Ngư', emoji: '♓', colors: ['#8E2DE2', '#4A00E0'], textColor: '#FFFFFF' },
];

const CUSTOM_EMOJIS = ['✨', '💛', '🫶', '☕', '🍜', '🎀', '🎧', '💻', '🌙', '🔥', '🥹', '📸', '🧋', '🌈'];

const trackKey = (t) => `${t?.title || ''}|${t?.artist || ''}`.toLowerCase();

/* ================================================================== GROUP A: MUSIC */
export function MusicPanel({ colorPayload, iconColor, applyWithColors, playingId, toggleTrackPreview, stopAudio }) {
  const [musicQ, setMusicQ] = useState('');
  const [tracks, setTracks] = useState([]);
  const [trending, setTrending] = useState(trendingCache || []);
  const [trendingBusy, setTrendingBusy] = useState(!trendingCache);
  const [recent, setRecent] = useState(() => loadRecentMusic());
  const [favs, setFavs] = useState(() => loadFavMusic());
  const [subView, setSubView] = useState('trending'); // trending | favs | recent
  const [autoColor, setAutoColor] = useState(!colorPayload);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicSearched, setMusicSearched] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (trendingCache) return;
    let alive = true;
    api.trendingMusic()
      .then((d) => {
        trendingCache = d.tracks || [];
        if (alive) setTrending(trendingCache);
      })
      .catch(() => {})
      .finally(() => { if (alive) setTrendingBusy(false); });
    return () => { alive = false; };
  }, []);

  const runSearch = useCallback(async (term) => {
    const q = (term || '').trim();
    if (!q) { setTracks([]); setMusicSearched(false); return; }
    const reqId = ++reqIdRef.current;
    setMusicBusy(true);
    try {
      const data = await api.searchMusic(q);
      if (reqId !== reqIdRef.current) return;
      setTracks(data.tracks || []);
      setMusicSearched(true);
    } catch (err) {
      if (reqId === reqIdRef.current) ui.error(err.message || 'Không tìm được bài hát');
    } finally {
      if (reqId === reqIdRef.current) setMusicBusy(false);
    }
  }, []);

  useEffect(() => {
    const q = musicQ.trim();
    if (q.length < 2) { setTracks([]); setMusicSearched(false); return undefined; }
    const delay = /^https?:\/\//i.test(q) ? 180 : 420;
    const timer = setTimeout(() => runSearch(q), delay);
    return () => clearTimeout(timer);
  }, [musicQ, runSearch]);

  const favKeys = new Set(favs.map(trackKey));

  const onStar = (e, tr) => {
    e.stopPropagation();
    setFavs(toggleFavMusic(tr));
  };

  const pickTrack = async (track) => {
    stopAudio();
    setRecent(saveRecentMusic(track));
    const label = [track.title, track.artist].filter(Boolean).join(' – ');
    let palette = colorPayload;
    if (!palette && autoColor && track.artworkProxy) {
      palette = await extractAlbumPalette(track.artworkProxy);
    }
    const finalColors = palette?.colors || ['#1C1C1E', '#2C2C2E'];
    const finalText = palette?.textColor || '#FFFFFF';
    applyWithColors({
      key: 'music',
      type: 'music',
      text: label,
      previewProxy: track.previewProxy || null,
      icon: track.artworkProxy ? { kind: 'image', value: track.artworkProxy } : { kind: 'symbol', value: 'music.note', color: finalText || iconColor },
      colors: finalColors,
      textColor: finalText,
      overlayMeta: {
        colors: finalColors,
        textColor: finalText,
        music: {
          title: track.title,
          artist: track.artist,
          artwork: track.artwork,
          previewUrl: track.previewUrl,
          appleMusicUrl: track.appleMusicUrl,
        },
      },
    }, { skipColorOverride: !colorPayload && autoColor });
  };

  const listToShow = musicQ.trim().length >= 2
    ? tracks
    : subView === 'favs' ? favs : subView === 'recent' ? recent : trending;

  return (
    <div className="smart-panel">
      <form className="search" onSubmit={(e) => { e.preventDefault(); runSearch(musicQ); }}>
        <Icon name="music" />
        <input type="search" placeholder="Tìm bài hát, ca sĩ hoặc dán link Spotify / YouTube…" value={musicQ}
          onChange={(e) => setMusicQ(e.target.value)} autoComplete="off" enterKeyHint="search" />
        {musicQ ? (
          <button type="button" className="x" aria-label="Xóa" onClick={() => { setMusicQ(''); setTracks([]); setMusicSearched(false); stopAudio(); }}>
            <Icon name="closeSm" />
          </button>
        ) : null}
        <button type="submit" className="btn btn-gold btn-sm" disabled={musicBusy || !musicQ.trim()}>
          {musicBusy ? '…' : 'Tìm'}
        </button>
      </form>

      <div className="smart-actions-row">
        <button type="button" className={`chip sm ${autoColor && !colorPayload ? 'on' : ''}`}
          onClick={() => setAutoColor((v) => !v)}>
          <Icon name="sparkles" /> {autoColor ? 'Màu theo bìa đĩa: Bật' : 'Màu theo bìa đĩa: Tắt'}
        </button>
        {!musicQ.trim() ? (
          <>
            <button type="button" className={`chip sm ${subView === 'trending' ? 'on' : ''}`} onClick={() => setSubView('trending')}>Top VN</button>
            {favs.length ? <button type="button" className={`chip sm ${subView === 'favs' ? 'on' : ''}`} onClick={() => setSubView('favs')}>★ Yêu thích ({favs.length})</button> : null}
            {recent.length ? <button type="button" className={`chip sm ${subView === 'recent' ? 'on' : ''}`} onClick={() => setSubView('recent')}>Gần đây</button> : null}
          </>
        ) : null}
      </div>

      {!musicQ.trim() ? (
        <div className="chips smart-quick">
          {QUICK_MUSIC.map((kw) => (
            <button key={kw} type="button" className="chip sm" onClick={() => { setMusicQ(kw); runSearch(kw); }}>{kw}</button>
          ))}
        </div>
      ) : null}

      <div className="music-list">
        {(musicBusy || (subView === 'trending' && trendingBusy && !musicQ.trim())) && !listToShow.length ? (
          <div className="empty"><span className="spinner" style={{ margin: '0 auto' }} /></div>
        ) : null}
        {listToShow.map((tr) => {
          const isFav = favKeys.has(trackKey(tr));
          return (
            <div key={tr.id || trackKey(tr)} className="music-row" role="button" tabIndex={0} onClick={() => pickTrack(tr)}
              onKeyDown={(e) => { if (e.key === 'Enter') pickTrack(tr); }}>
              {tr.artworkProxy ? <img src={tr.artworkProxy} alt="" loading="lazy" /> : <span className="music-ph"><Icon name="music" /></span>}
              <div className="grow"><b>{tr.title}</b><small>{tr.artist}</small></div>
              <button type="button" className={`icon-btn sm ${isFav ? 'on' : ''}`} aria-label={isFav ? 'Bỏ yêu thích' : 'Lưu bài hát yêu thích'}
                onClick={(e) => onStar(e, tr)}>
                <Icon name="star" />
              </button>
              {tr.previewProxy ? (
                <button type="button" className={`icon-btn sm ${playingId === tr.id ? 'on' : ''}`}
                  aria-label={playingId === tr.id ? 'Dừng nghe thử' : 'Nghe thử'}
                  onClick={(e) => toggleTrackPreview(e, tr)}>
                  <Icon name={playingId === tr.id ? 'mute' : 'play'} />
                </button>
              ) : null}
            </div>
          );
        })}
        {musicSearched && !tracks.length && !musicBusy ? (
          <p className="smart-hint">Không tìm thấy bài hát khớp &ldquo;{musicQ.trim()}&rdquo;. Bạn có thể thử từ khóa khác hoặc dán link Spotify / Apple Music / YouTube.</p>
        ) : null}
      </div>
    </div>
  );
}

/* ================================================================== GROUP B: WEATHER */
export function WeatherPanel({ colorPayload, iconColor, applyWithColors }) {
  const [city, setCity] = useState('');
  const [weatherRes, setWeatherRes] = useState(null);
  const [unit, setUnit] = useState('C'); // 'C' | 'F'
  const [detailMode, setDetailMode] = useState('full'); // 'short' | 'full' | 'humidity' | 'aqi'
  const [autoMood, setAutoMood] = useState(!colorPayload);
  const [customSym, setCustomSym] = useState(null);
  const [busy, setBusy] = useState(false);

  const fetchWeather = useCallback(async (opts, { silent = false } = {}) => {
    setBusy(true);
    try {
      const data = await api.weather(opts);
      setWeatherRes(data);
      setCustomSym(null);
      if (data.city) {
        if (!opts.q) setCity(data.city);
        saveLastWeather({ q: data.city });
      } else if (typeof opts.lat === 'number') {
        saveLastWeather({ lat: opts.lat, lon: opts.lon });
      }
    } catch (err) {
      if (!silent) ui.error(err.message || 'Không lấy được thời tiết lúc này');
    } finally {
      setBusy(false);
    }
  }, []);

  // Auto-load last used city on mount so weather is ready immediately
  useEffect(() => {
    const last = loadLastWeather();
    if (last) {
      if (last.q) setCity(last.q);
      fetchWeather(last, { silent: true });
    }
  }, [fetchWeather]);

  const fetchGps = () => {
    if (!navigator.geolocation) { ui.warning('Trình duyệt không hỗ trợ định vị'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeather({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { setBusy(false); ui.warning('Chưa được cấp quyền vị trí — hãy chọn thành phố bên dưới'); },
      { timeout: 9000, enableHighAccuracy: false },
    );
  };

  const activeSym = customSym || weatherRes?.symbol || 'sun.max.fill';
  const moodPalette = !colorPayload && autoMood ? (WEATHER_MOODS[activeSym] || WEATHER_MOODS['cloud.fill']) : colorPayload;
  const activeIconColor = moodPalette?.textColor || iconColor;

  const fmtTemp = (c) => (unit === 'F' ? `${Math.round((c * 9) / 5 + 32)}°F` : `${c}°C`);
  const buildLabel = () => {
    if (!weatherRes) return '';
    const tStr = fmtTemp(weatherRes.temp);
    const place = weatherRes.city || '';
    if (detailMode === 'short') return place ? `${tStr} · ${place}` : `${tStr} · ${weatherRes.desc}`;
    if (detailMode === 'humidity' && weatherRes.humidity != null) {
      return `${tStr} · 💧${weatherRes.humidity}%` + (place ? ` · ${place}` : '');
    }
    if (detailMode === 'aqi' && weatherRes.aqi != null) {
      return `${tStr} · AQI ${weatherRes.aqi} (${weatherRes.aqiLabel})` + (place ? ` · ${place}` : '');
    }
    return `${tStr} · ${weatherRes.desc}` + (place ? ` · ${place}` : '');
  };
  const displayText = buildLabel();

  return (
    <div className="smart-panel">
      <form className="search" onSubmit={(e) => { e.preventDefault(); if (city.trim()) fetchWeather({ q: city.trim() }); }}>
        <Icon name="cloud" />
        <input type="search" placeholder="Nhập thành phố (Hà Nội, TP.HCM, Đà Nẵng…)" value={city}
          onChange={(e) => setCity(e.target.value)} autoComplete="off" enterKeyHint="search" />
        {city ? <button type="button" className="x" aria-label="Xóa" onClick={() => setCity('')}><Icon name="closeSm" /></button> : null}
        <button type="submit" className="btn btn-gold btn-sm" disabled={busy || !city.trim()}>{busy ? '…' : 'Xem'}</button>
      </form>

      <div className="smart-actions-row">
        <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={fetchGps}>
          <Icon name="pin" /> {busy ? 'Đang tải…' : 'Dùng vị trí hiện tại'}
        </button>
        <button type="button" className={`chip sm ${unit === 'C' ? 'on' : ''}`} onClick={() => setUnit('C')}>°C</button>
        <button type="button" className={`chip sm ${unit === 'F' ? 'on' : ''}`} onClick={() => setUnit('F')}>°F</button>
        <button type="button" className={`chip sm ${autoMood && !colorPayload ? 'on' : ''}`} onClick={() => setAutoMood((v) => !v)}>
          <Icon name="sparkles" /> Màu theo trời
        </button>
      </div>

      <div className="chips smart-quick">
        {QUICK_CITIES.map((c) => (
          <button key={c} type="button" className="chip sm" disabled={busy}
            onClick={() => { setCity(c); fetchWeather({ q: c }); }}>{c}</button>
        ))}
      </div>

      {weatherRes ? (
        <div className="weather-card">
          <div className="weather-preview" style={moodPalette ? overlayStyle(moodPalette) : undefined}>
            <span className="ico sym" style={{ color: activeIconColor }}><SymbolIcon name={activeSym} /></span>
            <span>{displayText}</span>
          </div>
          <div className="weather-meta">
            {weatherRes.feelsLike != null ? <span>Cảm giác {fmtTemp(weatherRes.feelsLike)}</span> : null}
            {weatherRes.humidity != null ? <span>Độ ẩm {weatherRes.humidity}%</span> : null}
            {weatherRes.aqi != null ? <span>AQI {weatherRes.aqi} ({weatherRes.aqiLabel})</span> : null}
          </div>
          <div className="weather-modes">
            <button type="button" className={`chip sm ${detailMode === 'full' ? 'on' : ''}`} onClick={() => setDetailMode('full')}>Đầy đủ</button>
            <button type="button" className={`chip sm ${detailMode === 'short' ? 'on' : ''}`} onClick={() => setDetailMode('short')}>Ngắn gọn</button>
            {weatherRes.humidity != null ? (
              <button type="button" className={`chip sm ${detailMode === 'humidity' ? 'on' : ''}`} onClick={() => setDetailMode('humidity')}>+ Độ ẩm</button>
            ) : null}
            {weatherRes.aqi != null ? (
              <button type="button" className={`chip sm ${detailMode === 'aqi' ? 'on' : ''}`} onClick={() => setDetailMode('aqi')}>+ AQI</button>
            ) : null}
          </div>
          <div className="weather-icons-row" aria-label="Đổi biểu tượng thời tiết">
            {WEATHER_ICONS.map((it) => (
              <button key={it.sym} type="button" title={it.label}
                className={`icon-btn sm ${activeSym === it.sym ? 'on' : ''}`}
                onClick={() => setCustomSym(it.sym)}>
                <SymbolIcon name={it.sym} />
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-gold" style={{ marginTop: 12, width: '100%' }} onClick={() => applyWithColors({
            key: 'weather',
            type: 'weather',
            text: displayText,
            icon: { kind: 'symbol', value: activeSym, color: activeIconColor },
            ...(moodPalette ? { colors: moodPalette.colors, textColor: moodPalette.textColor } : {}),
            overlayMeta: {
              ...(moodPalette || {}),
              weather: { symbol: activeSym },
            },
          }, { skipColorOverride: !colorPayload && autoMood })}>
            Gắn thời tiết này
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ================================================================== GROUP C: LOCATION */
export function LocationPanel({ current, iconColor, applyWithColors }) {
  const [place, setPlace] = useState(current?.type === 'location' ? (current.text || '') : '');
  const [placeIcon, setPlaceIcon] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [gpsCoords, setGpsCoords] = useState(null);
  const [recent, setRecent] = useState(() => loadRecentPlaces());
  const [pinned, setPinned] = useState(() => loadPinnedPlaces());
  const reqIdRef = useRef(0);

  const searchPlaces = useCallback(async (q, coords = null) => {
    const clean = (q || '').trim();
    if (!clean) { setResults([]); return; }
    const reqId = ++reqIdRef.current;
    setBusy(true);
    try {
      const data = await api.places({ q: clean, ...(coords || {}) });
      if (reqId !== reqIdRef.current) return;
      setResults(data.places || []);
    } catch (err) {
      if (reqId === reqIdRef.current) ui.error(err.message || 'Không tra được địa điểm');
    } finally {
      if (reqId === reqIdRef.current) setBusy(false);
    }
  }, []);

  // Debounced autocomplete as user types
  useEffect(() => {
    const q = place.trim();
    if (q.length < 2) return undefined;
    const timer = setTimeout(() => searchPlaces(q, gpsCoords), 380);
    return () => clearTimeout(timer);
  }, [place, gpsCoords, searchPlaces]);

  const fetchGpsPlaces = () => {
    if (!navigator.geolocation) { ui.warning('Trình duyệt không hỗ trợ định vị'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGpsCoords(coords);
        try {
          const data = await api.places(coords);
          const list = data.places || [];
          setResults(list);
          if (list[0]?.name) setPlace(list[0].name);
          else if (data.city) setPlace(data.city);
          else ui.info('Không xác định được địa điểm quanh đây');
        } catch (err) {
          ui.error(err.message || 'Không tra được vị trí hiện tại');
        } finally {
          setBusy(false);
        }
      },
      () => { setBusy(false); ui.warning('Chưa được cấp quyền vị trí — hãy nhập tên địa điểm'); },
      { timeout: 9000, enableHighAccuracy: false },
    );
  };

  const pinnedSet = new Set(pinned.map((x) => x.toLowerCase()));
  const onPin = (e, name) => {
    e.stopPropagation();
    setPinned(togglePinnedPlace(name));
  };

  const pickPlace = (label, cat = null) => {
    const clean = (label || '').trim();
    if (!clean) return;
    setRecent(saveRecentPlace(clean));
    const chosenEmoji = placeIcon || (cat && CAT_EMOJI[cat]) || '';
    applyWithColors({
      key: 'location',
      type: 'location',
      text: clean,
      icon: chosenEmoji ? { kind: 'emoji', value: chosenEmoji } : { kind: 'symbol', value: 'location.fill', color: iconColor },
      overlayMeta: chosenEmoji ? { emoji: chosenEmoji } : undefined,
    });
  };

  return (
    <div className="smart-panel">
      <form className="search" onSubmit={(e) => { e.preventDefault(); searchPlaces(place, gpsCoords); }}>
        <Icon name="pin" />
        <input type="search" maxLength={60} placeholder="Tìm quán cà phê, đường, địa danh…" value={place}
          onChange={(e) => setPlace(e.target.value)} autoComplete="off" enterKeyHint="search" />
        {place ? <button type="button" className="x" aria-label="Xóa" onClick={() => { setPlace(''); setResults([]); }}><Icon name="closeSm" /></button> : null}
        <button type="submit" className="btn btn-gold btn-sm" disabled={busy || !place.trim()}>{busy ? '…' : 'Tìm'}</button>
      </form>

      <div className="smart-actions-row">
        <button type="button" className="btn btn-dark btn-sm" disabled={busy} onClick={fetchGpsPlaces}>
          <Icon name="pin" /> {busy ? 'Đang quét…' : 'Vị trí & quán quanh đây'}
        </button>
        {place.trim() ? (
          <button type="button" className="btn btn-gold btn-sm" onClick={() => pickPlace(place)}>
            Gắn &ldquo;{place.trim().slice(0, 18)}{place.trim().length > 18 ? '…' : ''}&rdquo;
          </button>
        ) : null}
      </div>

      <div className="chips smart-quick" aria-label="Biểu tượng check-in">
        {PLACE_ICONS.map((ic) => (
          <button key={ic.id || 'pin'} type="button" className={`chip sm ${placeIcon === ic.id ? 'on' : ''}`}
            onClick={() => setPlaceIcon(ic.id)}>
            {ic.emoji || '📍'} {ic.label}
          </button>
        ))}
      </div>

      {results.length ? (
        <div className="place-list">
          {results.map((pl, idx) => {
            const isPinned = pinnedSet.has(pl.name.toLowerCase());
            return (
              <div key={`${pl.name}-${idx}`} className="place-row" role="button" tabIndex={0}
                onClick={() => pickPlace(pl.name, pl.category)}
                onKeyDown={(e) => { if (e.key === 'Enter') pickPlace(pl.name, pl.category); }}>
                <span className="place-ico">{CAT_EMOJI[pl.category] || <Icon name="pin" />}</span>
                <span className="grow">
                  <b>{pl.name}</b>
                  {pl.detail ? <small>{pl.detail}</small> : null}
                </span>
                <button type="button" className={`icon-btn sm ${isPinned ? 'on' : ''}`}
                  aria-label={isPinned ? 'Bỏ ghim địa điểm' : 'Ghim địa điểm'} onClick={(e) => onPin(e, pl.name)}>
                  <Icon name="star" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {pinned.length ? (
        <div className="smart-sub-block">
          <h4>Địa điểm đã ghim</h4>
          <div className="chips">
            {pinned.map((pl) => (
              <span key={pl} className="chip sm chip-pinned">
                <button type="button" onClick={() => pickPlace(pl)}>★ {pl}</button>
                <button type="button" className="chip-x" aria-label={`Bỏ ghim ${pl}`} onClick={(e) => onPin(e, pl)}>×</button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {recent.length ? (
        <div className="smart-sub-block">
          <h4>Gần đây</h4>
          <div className="chips">
            {recent.map((pl) => (
              <button key={pl} type="button" className="chip sm" onClick={() => pickPlace(pl)}>{pl}</button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="smart-sub-block">
        <h4>Gợi ý nhanh</h4>
        <div className="chips">
          {QUICK_PLACES.map((pl) => (
            <button key={pl} type="button" className="chip sm" onClick={() => pickPlace(pl)}>{pl}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== GROUP D: BADGES & CUSTOM PRESETS */
export function BadgesPanel({ colorPayload, applyWithColors }) {
  const [stats, setStats] = useState(statsCache);
  const [time12h, setTime12h] = useState(false);
  const [savedZodiac, setSavedZodiac] = useState(() => loadZodiac());
  const [customEmoji, setCustomEmoji] = useState('✨');
  const [customText, setCustomText] = useState('');
  const [customList, setCustomList] = useState(() => loadCustomPresets());

  useEffect(() => {
    if (statsCache) return;
    let alive = true;
    api.memoriesStats()
      .then((d) => { statsCache = d; if (alive) setStats(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const nowTime = () => {
    const d = new Date();
    if (!time12h) return clock(d.getTime());
    let h = d.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
  };

  const streakNum = stats?.myStreak || stats?.currentStreak || 1;
  const countNum = stats?.mineCount || stats?.total || 1;

  const pickClock = () => {
    const label = nowTime();
    applyWithColors({
      key: 'time',
      type: 'time',
      text: label,
      icon: { kind: 'symbol', value: 'clock.fill', color: colorPayload?.textColor || '#FFFFFFCC' },
    });
  };

  const pickStreak = () => {
    const colors = colorPayload?.colors || ['#FF512F', '#F09819'];
    const textColor = colorPayload?.textColor || '#FFFFFF';
    applyWithColors({
      key: 'streak',
      type: 'streak',
      text: `Chuỗi ${streakNum} ngày`,
      icon: { kind: 'symbol', value: 'flame.fill', color: textColor },
      colors,
      textColor,
      overlayMeta: { colors, textColor, streak: streakNum },
    }, { skipColorOverride: !colorPayload });
  };

  const pickCount = () => {
    const colors = colorPayload?.colors || ['#FFC629', '#FF9F1C'];
    const textColor = colorPayload?.textColor || '#111111';
    applyWithColors({
      key: 'locket_count',
      type: 'locket_count',
      text: `${countNum} Lockets`,
      icon: { kind: 'symbol', value: 'heart.fill', color: textColor },
      colors,
      textColor,
      overlayMeta: { colors, textColor, count: countNum },
    }, { skipColorOverride: !colorPayload });
  };

  const pickZodiac = (z) => {
    saveZodiac(z.id);
    setSavedZodiac(z.id);
    const colors = colorPayload?.colors || z.colors;
    const textColor = colorPayload?.textColor || z.textColor;
    applyWithColors({
      key: 'star_sign',
      type: 'star_sign',
      text: z.name,
      icon: { kind: 'emoji', value: z.emoji },
      colors,
      textColor,
      overlayMeta: { colors, textColor, emoji: z.emoji },
    }, { skipColorOverride: !colorPayload });
  };

  const applyCustomItem = (item) => {
    const colors = item.colors || [];
    const textColor = item.textColor || '#FFFFFF';
    applyWithColors({
      key: 'standard',
      type: 'custom',
      text: item.text,
      icon: item.emoji ? { kind: 'emoji', value: item.emoji } : null,
      colors,
      textColor,
      overlayMeta: {
        ...(colors.length ? { colors, textColor } : {}),
        ...(item.emoji ? { emoji: item.emoji } : {}),
      },
    }, { skipColorOverride: true });
  };

  const handleSaveCustom = () => {
    const txt = customText.trim();
    if (!txt) { ui.info('Hãy nhập nội dung cho mẫu cá nhân'); return; }
    const entry = {
      emoji: customEmoji.trim(),
      text: txt,
      colors: colorPayload?.colors || [],
      textColor: colorPayload?.textColor || '#FFFFFF',
    };
    setCustomList(saveCustomPreset(entry));
    setCustomText('');
    ui.success('Đã lưu mẫu cá nhân của bạn');
  };

  return (
    <div className="smart-panel">
      <div className="smart-sub-block" style={{ marginTop: 0 }}>
        <h4>Huy hiệu Locket sống</h4>
        <div className="badge-quick-grid">
          <button type="button" className="badge-tile" style={colorPayload ? overlayStyle(colorPayload) : { background: 'rgba(58,58,60,.82)', color: '#fff' }} onClick={pickClock}>
            <SymbolIcon name="clock.fill" /><b>{nowTime()}</b><small>Đồng hồ</small>
          </button>
          <button type="button" className="badge-tile" style={overlayStyle(colorPayload || { colors: ['#FF512F', '#F09819'], textColor: '#FFFFFF' })} onClick={pickStreak}>
            <SymbolIcon name="flame.fill" /><b>Chuỗi {streakNum} ngày</b><small>Streak thật</small>
          </button>
          <button type="button" className="badge-tile" style={overlayStyle(colorPayload || { colors: ['#FFC629', '#FF9F1C'], textColor: '#111111' })} onClick={pickCount}>
            <SymbolIcon name="heart.fill" /><b>{countNum} Lockets</b><small>Tổng khoảnh khắc</small>
          </button>
        </div>
        <div className="smart-actions-row" style={{ marginTop: 8 }}>
          <button type="button" className={`chip sm ${!time12h ? 'on' : ''}`} onClick={() => setTime12h(false)}>Giờ 24h</button>
          <button type="button" className={`chip sm ${time12h ? 'on' : ''}`} onClick={() => setTime12h(true)}>Giờ 12h AM/PM</button>
        </div>
      </div>

      <div className="smart-sub-block">
        <h4>Cung Hoàng Đạo</h4>
        <div className="zodiac-grid">
          {ZODIAC_SIGNS.map((z) => (
            <button key={z.id} type="button" className={`zodiac-chip ${savedZodiac === z.id ? 'on' : ''}`}
              style={overlayStyle(z)} onClick={() => pickZodiac(z)}>
              <span>{z.emoji}</span><b>{z.name}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="smart-sub-block">
        <h4>Tạo &amp; Lưu Mẫu Cá nhân</h4>
        <div className="custom-preset-form">
          <div className="chips" style={{ marginBottom: 8 }}>
            {CUSTOM_EMOJIS.map((em) => (
              <button key={em} type="button" className={`chip sm ${customEmoji === em ? 'on' : ''}`} onClick={() => setCustomEmoji(em)}>{em}</button>
            ))}
          </div>
          <div className="custom-preset-row">
            <input type="text" className="custom-em-in" maxLength={4} value={customEmoji} aria-label="Emoji" onChange={(e) => setCustomEmoji(e.target.value)} />
            <input type="text" className="custom-txt-in" maxLength={48} placeholder="Vd: Đang chạy deadline…" value={customText} onChange={(e) => setCustomText(e.target.value)} />
          </div>
          <div className="smart-actions-row">
            <button type="button" className="btn btn-dark btn-sm" disabled={!customText.trim()} onClick={handleSaveCustom}>Lưu mẫu</button>
            <button type="button" className="btn btn-gold btn-sm" disabled={!customText.trim()}
              onClick={() => applyCustomItem({ emoji: customEmoji, text: customText.trim(), colors: colorPayload?.colors || [], textColor: colorPayload?.textColor || '#FFFFFF' })}>
              Dùng ngay
            </button>
          </div>
        </div>
        {customList.length ? (
          <div className="chips" style={{ marginTop: 10 }}>
            {customList.map((item) => (
              <span key={item.id} className="chip sm chip-pinned" style={item.colors?.length ? overlayStyle(item) : undefined}>
                <button type="button" onClick={() => applyCustomItem(item)}>{item.emoji ? `${item.emoji} ` : ''}{item.text}</button>
                <button type="button" className="chip-x" aria-label="Xóa mẫu" onClick={() => setCustomList(deleteCustomPreset(item.id))}>×</button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
