// Smart caption panels used by StylePicker:
// - MusicPanel: search / pasted Spotify, Apple Music, YouTube, SoundCloud link, Top VN, favourites, recent, album colours
// - WeatherPanel: last city auto-load, GPS, °C/°F, humidity / AQI variants, sky colours, manual condition icon
// - LocationPanel: GPS + nearby places, debounced search (nearest first), pinned / recent places, check-in icon
// - BadgesPanel: live clock (24h/12h), real streak and Locket count, zodiac signs, saved custom captions
// Payload shapes are what the camera posts and the backend overlay builder expects; keep them stable.
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

// the emoji here is what gets posted with the caption (Locket shows it in front of the place name)
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

// list icons (Maps-style: white glyph on a coloured circle)
const CAT_ICON = {
  cafe: { c: '#B07D4F', d: '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10.500h1.500a2.500 2.500 0 0 1 0 5H16"/><path d="M8 3.500c-.8 1 .8 2 0 3M12 3.500c-.8 1 .8 2 0 3"/>' },
  food: { c: '#FF9500', d: '<path d="M3 11.500h18a9 9 0 0 1-18 0z"/><path d="M14 3.500 9.500 10M19.500 4.500 13.500 10"/>' },
  shop: { c: '#FF375F', d: '<path d="M5 8h14l-1.200 12H6.200z"/><path d="M9 8V6.500a3 3 0 0 1 6 0V8"/>' },
  school: { c: '#0A84FF', d: '<path d="M2 9.500 12 4.500l10 5-10 5z"/><path d="M6 11.500v4.500c3.200 2.400 8.800 2.400 12 0v-4.500"/>' },
  park: { c: '#30B158', d: '<path d="M12 21v-6"/><path d="M12 3a6 6 0 0 1 0 12 6 6 0 0 1 0-12z"/>' },
  landmark: { c: '#AF52DE', d: '<path d="M3 20.500h18M5.500 20V10.500M10 20V10.500M14 20V10.500M18.500 20V10.500M2.500 10 12 4.500 21.500 10z"/>' },
  city: { c: '#8E8E93', d: '<path d="M3 21V9l6-3v15M9 21V3.500l8 4V21M21 21H2M12.500 10h1.500M12.500 14h1.500M12.500 18h1.500"/>' },
};
function CatIcon({ cat }) {
  const it = CAT_ICON[cat];
  if (!it) return <span className="cat" style={{ background: '#FF453A' }}><SymbolIcon name="location.fill" /></span>;
  return (
    <span className="cat" style={{ background: it.c }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: it.d }} />
    </span>
  );
}

const WEATHER_ICONS = [
  { sym: 'sun.max.fill', label: 'Nắng' },
  { sym: 'cloud.sun.fill', label: 'Ít mây' },
  { sym: 'cloud.fill', label: 'Nhiều mây' },
  { sym: 'cloud.rain.fill', label: 'Mưa' },
  { sym: 'cloud.bolt.fill', label: 'Giông' },
  { sym: 'cloud.snow.fill', label: 'Tuyết' },
  { sym: 'moon.fill', label: 'Trăng' },
  { sym: 'moon.stars.fill', label: 'Đêm sao' },
];

const WEATHER_MOODS = {
  'sun.max.fill': { colors: ['#FFB547', '#FF8A2B'], textColor: '#FFFFFF' },
  'cloud.sun.fill': { colors: ['#5FB2F2', '#3B86E0'], textColor: '#FFFFFF' },
  'cloud.fill': { colors: ['#8A97AB', '#5D6A80'], textColor: '#FFFFFF' },
  'cloud.rain.fill': { colors: ['#5B7290', '#3B4C66'], textColor: '#FFFFFF' },
  'cloud.bolt.fill': { colors: ['#4A4E69', '#2B2D42'], textColor: '#FFE8A3' },
  'cloud.snow.fill': { colors: ['#A9C6E8', '#7FA3CC'], textColor: '#FFFFFF' },
  'moon.fill': { colors: ['#2E3A59', '#1A2238'], textColor: '#FFE8A3' },
  'moon.stars.fill': { colors: ['#36306B', '#1C1A3F'], textColor: '#FFE8A3' },
};

// US AQI bands -> colour of the little AQI dot
const aqiColor = (v) => (v <= 50 ? '#34C759' : v <= 100 ? '#FFCC00' : v <= 150 ? '#FF9500' : v <= 200 ? '#FF3B30' : '#AF52DE');

// softer element palettes instead of a neon gradient per sign
const ELEMENT = {
  fire: { colors: ['#FF8F6B', '#F2556E'], textColor: '#FFFFFF' },
  earth: { colors: ['#9CC17F', '#5E8F62'], textColor: '#FFFFFF' },
  air: { colors: ['#8CBFF7', '#6C8CF5'], textColor: '#FFFFFF' },
  water: { colors: ['#6CCFDB', '#3E86C6'], textColor: '#FFFFFF' },
};
const ZODIAC_SIGNS = [
  { id: 'aries', name: 'Bạch Dương', emoji: '♈', el: 'fire', dates: '21/3 – 19/4' },
  { id: 'taurus', name: 'Kim Ngưu', emoji: '♉', el: 'earth', dates: '20/4 – 20/5' },
  { id: 'gemini', name: 'Song Tử', emoji: '♊', el: 'air', dates: '21/5 – 20/6' },
  { id: 'cancer', name: 'Cự Giải', emoji: '♋', el: 'water', dates: '21/6 – 22/7' },
  { id: 'leo', name: 'Sư Tử', emoji: '♌', el: 'fire', dates: '23/7 – 22/8' },
  { id: 'virgo', name: 'Xử Nữ', emoji: '♍', el: 'earth', dates: '23/8 – 22/9' },
  { id: 'libra', name: 'Thiên Bình', emoji: '♎', el: 'air', dates: '23/9 – 22/10' },
  { id: 'scorpio', name: 'Bọ Cạp', emoji: '♏', el: 'water', dates: '23/10 – 21/11' },
  { id: 'sagittarius', name: 'Nhân Mã', emoji: '♐', el: 'fire', dates: '22/11 – 21/12' },
  { id: 'capricorn', name: 'Ma Kết', emoji: '♑', el: 'earth', dates: '22/12 – 19/1' },
  { id: 'aquarius', name: 'Bảo Bình', emoji: '♒', el: 'air', dates: '20/1 – 18/2' },
  { id: 'pisces', name: 'Song Ngư', emoji: '♓', el: 'water', dates: '19/2 – 20/3' },
].map((z) => ({ ...z, ...ELEMENT[z.el] }));

const CUSTOM_EMOJIS = ['✨', '💛', '🫶', '☕', '🍜', '🎀', '🎧', '💻', '🌙', '🔥', '🥹', '📸', '🧋', '🌈'];

const trackKey = (t) => `${t?.title || ''}|${t?.artist || ''}`.toLowerCase();
const grad = (colors) => `linear-gradient(180deg, ${colors.join(', ')})`;

/* ------------------------------------------------------------------ shared bits */

// how the caption will look on the photo
export function PillPreview({ style, icon, text, label = 'Xem trước' }) {
  return (
    <div className="cap-preview">
      <span className="cap-preview-label">{label}</span>
      <div className="cap-preview-stage">
        <div className={`cap-preview-pill ${style ? '' : 'glass'}`} style={style}>
          {icon}<span className="t">{text}</span>
        </div>
      </div>
    </div>
  );
}

function Switch({ on, onChange, label, sub }) {
  return (
    <div className="cap-switch-row">
      <span className="grow"><b>{label}</b>{sub ? <small>{sub}</small> : null}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" onClick={() => onChange(!on)} />
    </div>
  );
}

function Segmented({ value, onChange, options, label }) {
  const idx = Math.max(0, options.findIndex(([v]) => v === value));
  return (
    <div className="cap-seg" role="radiogroup" aria-label={label} style={{ '--n': options.length, '--i': idx }}>
      <i aria-hidden="true" />
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

function SkeletonRows({ n = 5, art = true }) {
  return Array.from({ length: n }, (_, i) => (
    <div key={i} className="cap-row skel" aria-hidden="true">
      {art ? <span className="cap-skel art" /> : <span className="cap-skel cat-sk" />}
      <span className="grow"><span className="cap-skel line" /><span className="cap-skel line short" /></span>
    </div>
  ));
}

function SearchField({ icon, value, onChange, onSubmit, placeholder, busy, onClear, trailing, maxLength }) {
  return (
    <form className="search cap-search" onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
      {icon}
      <input type="search" placeholder={placeholder} value={value} maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} enterKeyHint="search" />
      {busy ? <span className="spinner cap-spin" /> : null}
      {value && !busy ? <button type="button" className="x" aria-label="Xóa" onClick={onClear}><Icon name="closeSm" /></button> : null}
      {trailing}
    </form>
  );
}

/* ================================================================== MUSIC */
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
  const [pickingId, setPickingId] = useState(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (trendingCache) return undefined;
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
    if (q.length < 2) { reqIdRef.current += 1; setTracks([]); setMusicSearched(false); setMusicBusy(false); return undefined; }
    const delay = /^https?:\/\//i.test(q) ? 180 : 420;
    const timer = setTimeout(() => runSearch(q), delay);
    return () => clearTimeout(timer);
  }, [musicQ, runSearch]);

  const favKeys = new Set(favs.map(trackKey));
  const onStar = (e, tr) => { e.stopPropagation(); setFavs(toggleFavMusic(tr)); };

  const pickTrack = async (track) => {
    stopAudio();
    setRecent(saveRecentMusic(track));
    const label = [track.title, track.artist].filter(Boolean).join(' – ');
    let palette = colorPayload;
    if (!palette && autoColor && track.artworkProxy) {
      setPickingId(track.id || trackKey(track));
      palette = await extractAlbumPalette(track.artworkProxy);
      setPickingId(null);
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

  const searching = musicQ.trim().length >= 2;
  const listToShow = searching ? tracks : subView === 'favs' ? favs : subView === 'recent' ? recent : trending;
  const loading = searching ? musicBusy && !tracks.length : subView === 'trending' && trendingBusy && !trending.length;
  const isLink = /^https?:\/\//i.test(musicQ.trim());

  return (
    <div className="cap-music">
      <SearchField icon={<Icon name="search" />} value={musicQ} onChange={setMusicQ} onSubmit={() => runSearch(musicQ)}
        placeholder="Bài hát, ca sĩ hoặc dán link nhạc" busy={musicBusy}
        onClear={() => { setMusicQ(''); stopAudio(); }} />

      {!searching ? (
        <div className="cap-scroll">
          {QUICK_MUSIC.map((kw) => (
            <button key={kw} type="button" className="cap-pill-btn" onClick={() => setMusicQ(kw)}>{kw}</button>
          ))}
        </div>
      ) : null}

      {!colorPayload ? (
        <Switch on={autoColor} onChange={setAutoColor} label="Màu theo bìa đĩa" sub="Nền chú thích lấy màu từ ảnh bìa bài hát" />
      ) : null}

      {!searching ? (
        <Segmented label="Danh sách nhạc" value={subView} onChange={setSubView}
          options={[['trending', 'Top VN'], ['favs', favs.length ? `Yêu thích · ${favs.length}` : 'Yêu thích'], ['recent', 'Gần đây']]} />
      ) : (
        <h4 className="cap-h">{isLink ? 'Bài hát từ link' : 'Kết quả'}</h4>
      )}

      <div className="cap-list">
        {loading ? <SkeletonRows n={6} /> : null}
        {listToShow.map((tr, i) => {
          const id = tr.id || trackKey(tr);
          const isFav = favKeys.has(trackKey(tr));
          const playing = playingId === tr.id;
          return (
            <div key={id} className={`cap-row music-row ${pickingId === id ? 'busy' : ''}`} role="button" tabIndex={0}
              style={{ '--k': Math.min(i, 9) }} onClick={() => pickTrack(tr)} onKeyDown={(e) => { if (e.key === 'Enter') pickTrack(tr); }}>
              {!searching && subView === 'trending' ? <span className="rank">{i + 1}</span> : null}
              {tr.previewProxy ? (
                <button type="button" className={`art ${playing ? 'playing' : ''}`} aria-label={playing ? 'Dừng nghe thử' : 'Nghe thử'}
                  onClick={(e) => toggleTrackPreview(e, tr)}>
                  {tr.artworkProxy ? <img src={tr.artworkProxy} alt="" loading="lazy" /> : <span className="ph"><Icon name="music" /></span>}
                  <span className="ov">{playing ? <span className="eq"><i /><i /><i /></span> : <Icon name="play" />}</span>
                </button>
              ) : (
                <span className="art">
                  {tr.artworkProxy ? <img src={tr.artworkProxy} alt="" loading="lazy" /> : <span className="ph"><Icon name="music" /></span>}
                </span>
              )}
              <div className="grow"><b>{tr.title}</b><small>{tr.artist}</small></div>
              {pickingId === id ? <span className="spinner cap-spin" /> : (
                <button type="button" className={`fav ${isFav ? 'on' : ''}`} aria-label={isFav ? 'Bỏ yêu thích' : 'Lưu bài hát yêu thích'}
                  onClick={(e) => onStar(e, tr)}>
                  {isFav ? <SymbolIcon name="star.fill" /> : <Icon name="star" />}
                </button>
              )}
            </div>
          );
        })}
        {searching && musicSearched && !tracks.length && !musicBusy ? (
          <p className="cap-empty">Không tìm thấy bài hát khớp &ldquo;{musicQ.trim()}&rdquo;. Thử từ khóa khác hoặc dán link Spotify, Apple Music, YouTube.</p>
        ) : null}
        {!searching && !loading && !listToShow.length ? (
          <p className="cap-empty">
            {subView === 'favs' ? 'Chạm vào ngôi sao cạnh bài hát để lưu vào Yêu thích.'
              : subView === 'recent' ? 'Bài hát bạn gắn sẽ hiện ở đây.' : 'Chưa tải được bảng xếp hạng. Hãy tìm bài hát ở trên.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ================================================================== WEATHER */
export function WeatherPanel({ colorPayload, iconColor, applyWithColors }) {
  const [city, setCity] = useState('');
  const [weatherRes, setWeatherRes] = useState(null);
  const [unit, setUnit] = useState('C');
  const [detailMode, setDetailMode] = useState('full'); // full | short | humidity | aqi
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
      () => { setBusy(false); ui.warning('Chưa được cấp quyền vị trí. Hãy chọn thành phố.'); },
      { timeout: 9000, enableHighAccuracy: false },
    );
  };

  const activeSym = customSym || weatherRes?.symbol || 'sun.max.fill';
  const moodPalette = !colorPayload && autoMood ? (WEATHER_MOODS[activeSym] || WEATHER_MOODS['cloud.fill']) : colorPayload;
  const activeIconColor = moodPalette?.textColor || iconColor;

  const toUnit = (c) => (unit === 'F' ? Math.round((c * 9) / 5 + 32) : c);
  const fmtTemp = (c) => `${toUnit(c)}°${unit}`;
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
  const heroPalette = moodPalette || { colors: ['#4A4A4E', '#2C2C2E'], textColor: '#FFFFFF' };
  const modes = [['full', 'Đầy đủ'], ['short', 'Ngắn']];
  if (weatherRes?.humidity != null) modes.push(['humidity', 'Độ ẩm']);
  if (weatherRes?.aqi != null) modes.push(['aqi', 'AQI']);

  return (
    <div className="cap-weather">
      <SearchField icon={<Icon name="search" />} value={city} onChange={setCity}
        onSubmit={() => { if (city.trim()) fetchWeather({ q: city.trim() }); }}
        placeholder="Tên thành phố" busy={busy} onClear={() => setCity('')}
        trailing={(
          <button type="button" className="field-btn" aria-label="Dùng vị trí hiện tại" disabled={busy} onClick={fetchGps}>
            <SymbolIcon name="location.fill" />
          </button>
        )} />

      <div className="cap-scroll">
        {QUICK_CITIES.map((c) => (
          <button key={c} type="button" className={`cap-pill-btn ${weatherRes?.city === c ? 'on' : ''}`} disabled={busy}
            onClick={() => { setCity(c); fetchWeather({ q: c }); }}>{c}</button>
        ))}
      </div>

      {!weatherRes && busy ? <div className="wx-hero skel cap-skel" aria-hidden="true" /> : null}
      {!weatherRes && !busy ? (
        <div className="cap-blank">
          <span className="big"><SymbolIcon name="cloud.sun.fill" /></span>
          <b>Thời tiết thật lúc chụp</b>
          <small>Nhập thành phố, chọn nhanh bên trên hoặc dùng vị trí hiện tại.</small>
          <button type="button" className="btn btn-gold btn-sm" onClick={fetchGps}>Dùng vị trí hiện tại</button>
        </div>
      ) : null}

      {weatherRes ? (
        <>
          <div className={`wx-hero ${busy ? 'dim' : ''}`} style={{ background: grad(heroPalette.colors), color: heroPalette.textColor }}>
            <div className="wx-top">
              <div className="grow">
                <div className="wx-city">{weatherRes.city || 'Vị trí của bạn'}</div>
                <div className="wx-desc">{weatherRes.desc}</div>
              </div>
              <span key={activeSym} className={`wx-sym ${activeSym.startsWith('sun') ? 'spin' : 'float'}`}><SymbolIcon name={activeSym} /></span>
            </div>
            <div className="wx-temp">{toUnit(weatherRes.temp)}°</div>
            <div className="wx-meta">
              {weatherRes.feelsLike != null ? <span>Cảm giác {toUnit(weatherRes.feelsLike)}°</span> : null}
              {weatherRes.humidity != null ? <span>Độ ẩm {weatherRes.humidity}%</span> : null}
              {weatherRes.aqi != null ? (
                <span className="aqi"><i style={{ background: aqiColor(weatherRes.aqi) }} />AQI {weatherRes.aqi} · {weatherRes.aqiLabel}</span>
              ) : null}
            </div>
          </div>

          <div className="cap-two">
            <Segmented label="Đơn vị" value={unit} onChange={setUnit} options={[['C', '°C'], ['F', '°F']]} />
            <Segmented label="Nội dung" value={modes.some(([m]) => m === detailMode) ? detailMode : 'full'} onChange={setDetailMode} options={modes} />
          </div>

          {!colorPayload ? <Switch on={autoMood} onChange={setAutoMood} label="Màu theo trời" sub="Nền đổi theo nắng, mưa, đêm" /> : null}

          <h4 className="cap-h">Biểu tượng</h4>
          <div className="wx-icons" role="radiogroup" aria-label="Đổi biểu tượng thời tiết">
            {WEATHER_ICONS.map((it) => (
              <button key={it.sym} type="button" role="radio" aria-checked={activeSym === it.sym} aria-label={it.label} title={it.label}
                className={activeSym === it.sym ? 'on' : ''} onClick={() => setCustomSym(it.sym)}>
                <SymbolIcon name={it.sym} />
              </button>
            ))}
          </div>

          <PillPreview style={moodPalette ? overlayStyle(moodPalette) : undefined}
            icon={<span className="sym" style={{ color: activeIconColor }}><SymbolIcon name={activeSym} /></span>} text={displayText} />
          <button type="button" className="btn btn-gold cap-apply" onClick={() => applyWithColors({
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
            Gắn thời tiết
          </button>
        </>
      ) : null}
    </div>
  );
}

/* ================================================================== LOCATION */
const fmtKm = (km) => (km == null ? '' : km < 1 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${km < 10 ? +km.toFixed(1) : Math.round(km)} km`);

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
        const reqId = ++reqIdRef.current;
        try {
          const data = await api.places(coords);
          if (reqId !== reqIdRef.current) return;
          const list = data.places || [];
          setResults(list);
          if (!list.length && data.city) setResults([{ name: data.city, detail: 'Vị trí hiện tại', category: 'city' }]);
          if (!list.length && !data.city) ui.info('Không xác định được địa điểm quanh đây');
        } catch (err) {
          ui.error(err.message || 'Không tra được vị trí hiện tại');
        } finally {
          if (reqId === reqIdRef.current) setBusy(false);
        }
      },
      () => { setBusy(false); ui.warning('Chưa được cấp quyền vị trí. Hãy nhập tên địa điểm.'); },
      { timeout: 9000, enableHighAccuracy: false },
    );
  };

  const pinnedSet = new Set(pinned.map((x) => x.toLowerCase()));
  const onPin = (e, name) => { e.stopPropagation(); setPinned(togglePinnedPlace(name)); };

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

  const typed = place.trim();
  const typedIsResult = results.some((r) => r.name.toLowerCase() === typed.toLowerCase());

  return (
    <div className="cap-location">
      <SearchField icon={<Icon name="search" />} value={place} onChange={setPlace} maxLength={60}
        onSubmit={() => searchPlaces(place, gpsCoords)} placeholder="Quán cà phê, đường, địa danh" busy={busy}
        onClear={() => { setPlace(''); setResults([]); }}
        trailing={(
          <button type="button" className="field-btn" aria-label="Địa điểm quanh đây" disabled={busy} onClick={fetchGpsPlaces}>
            <SymbolIcon name="location.fill" />
          </button>
        )} />

      <h4 className="cap-h">Biểu tượng khi đăng</h4>
      <div className="cap-scroll loc-icons" role="radiogroup" aria-label="Biểu tượng check-in">
        {PLACE_ICONS.map((ic) => (
          <button key={ic.id || 'pin'} type="button" role="radio" aria-checked={placeIcon === ic.id}
            className={placeIcon === ic.id ? 'on' : ''} onClick={() => setPlaceIcon(ic.id)}>
            <span className="em">{ic.emoji || <SymbolIcon name="location.fill" />}</span>
            <small>{ic.label}</small>
          </button>
        ))}
      </div>

      {(typed || results.length || busy) ? (
        <div className="cap-list cap-group">
          {typed && !typedIsResult ? (
            <div className="cap-row place-row typed" role="button" tabIndex={0} onClick={() => pickPlace(typed)}
              onKeyDown={(e) => { if (e.key === 'Enter') pickPlace(typed); }}>
              <span className="cat" style={{ background: 'var(--gold)', color: '#111' }}><Icon name="pencil" /></span>
              <span className="grow"><b>Dùng &ldquo;{typed}&rdquo;</b><small>Tên tự nhập</small></span>
            </div>
          ) : null}
          {busy && !results.length ? <SkeletonRows n={4} art={false} /> : null}
          {results.map((pl, idx) => {
            const isPinned = pinnedSet.has(pl.name.toLowerCase());
            const dist = fmtKm(pl.km);
            return (
              <div key={`${pl.name}-${idx}`} className="cap-row place-row" role="button" tabIndex={0} style={{ '--k': Math.min(idx, 9) }}
                onClick={() => pickPlace(pl.name, pl.category)}
                onKeyDown={(e) => { if (e.key === 'Enter') pickPlace(pl.name, pl.category); }}>
                <CatIcon cat={pl.category} />
                <span className="grow">
                  <b>{pl.name}</b>
                  {pl.detail || dist ? <small>{[dist, pl.detail].filter(Boolean).join(' · ')}</small> : null}
                </span>
                <button type="button" className={`fav ${isPinned ? 'on' : ''}`}
                  aria-label={isPinned ? 'Bỏ ghim địa điểm' : 'Ghim địa điểm'} onClick={(e) => onPin(e, pl.name)}>
                  {isPinned ? <SymbolIcon name="star.fill" /> : <Icon name="star" />}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {pinned.length ? (
        <>
          <h4 className="cap-h">Đã ghim</h4>
          <div className="cap-scroll">
            {pinned.map((pl) => (
              <span key={pl} className="cap-pill-btn pinned">
                <button type="button" onClick={() => pickPlace(pl)}><span className="st"><SymbolIcon name="star.fill" /></span>{pl}</button>
                <button type="button" className="x" aria-label={`Bỏ ghim ${pl}`} onClick={(e) => onPin(e, pl)}><Icon name="closeSm" /></button>
              </span>
            ))}
          </div>
        </>
      ) : null}

      {recent.length ? (
        <>
          <h4 className="cap-h">Gần đây</h4>
          <div className="cap-scroll">
            {recent.map((pl) => <button key={pl} type="button" className="cap-pill-btn" onClick={() => pickPlace(pl)}>{pl}</button>)}
          </div>
        </>
      ) : null}

      {!typed ? (
        <>
          <h4 className="cap-h">Gợi ý nhanh</h4>
          <div className="cap-scroll">
            {QUICK_PLACES.map((pl) => <button key={pl} type="button" className="cap-pill-btn" onClick={() => pickPlace(pl)}>{pl}</button>)}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ================================================================== BADGES & CUSTOM */
const STREAK_DEFAULT = { colors: ['#FF512F', '#F09819'], textColor: '#FFFFFF' };
const COUNT_DEFAULT = { colors: ['#FFC629', '#FF9F1C'], textColor: '#111111' };

export function BadgesPanel({ colorPayload, applyWithColors }) {
  const [stats, setStats] = useState(statsCache);
  const [statsErr, setStatsErr] = useState(false);
  const [time12h, setTime12h] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [savedZodiac, setSavedZodiac] = useState(() => loadZodiac());
  const [customEmoji, setCustomEmoji] = useState('✨');
  const [customText, setCustomText] = useState('');
  const [customList, setCustomList] = useState(() => loadCustomPresets());

  useEffect(() => {
    if (statsCache) return undefined;
    let alive = true;
    api.memoriesStats()
      .then((d) => { statsCache = d; if (alive) setStats(d); })
      .catch(() => { if (alive) setStatsErr(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const timeLabel = (() => {
    if (!time12h) return clock(now);
    const d = new Date(now);
    let h = d.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
  })();

  const streakNum = stats ? (stats.myStreak || stats.currentStreak || 0) : null;
  const countNum = stats ? (stats.mineCount || stats.total || 0) : null;
  const statLabel = (v, fmt) => (v != null ? fmt(v) : statsErr ? 'Không tải được' : '…');

  const pickClock = () => {
    applyWithColors({
      key: 'time',
      type: 'time',
      text: timeLabel,
      icon: { kind: 'symbol', value: 'clock.fill', color: colorPayload?.textColor || '#FFFFFFCC' },
    });
  };

  const pickStreak = () => {
    const { colors, textColor } = colorPayload || STREAK_DEFAULT;
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
    const { colors, textColor } = colorPayload || COUNT_DEFAULT;
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
    setCustomList(saveCustomPreset({
      emoji: customEmoji.trim(),
      text: txt,
      colors: colorPayload?.colors || [],
      textColor: colorPayload?.textColor || '#FFFFFF',
    }));
    setCustomText('');
    ui.success('Đã lưu mẫu');
  };

  const clockBg = colorPayload ? grad(colorPayload.colors) : 'linear-gradient(180deg, #8E8E93, #636366)';

  return (
    <div className="cap-badges">
      <h4 className="cap-h first">Huy hiệu sống</h4>
      <div className="bd-grid">
        <button type="button" className="bd-tile" onClick={pickClock}>
          <span className="bd-ic" style={{ background: clockBg, color: colorPayload?.textColor || '#fff' }}><SymbolIcon name="clock.fill" /></span>
          <b className="tick">{timeLabel}</b><small>Đồng hồ</small>
        </button>
        <button type="button" className="bd-tile" disabled={streakNum == null} onClick={pickStreak}>
          <span className="bd-ic flame" style={{ background: grad((colorPayload || STREAK_DEFAULT).colors), color: (colorPayload || STREAK_DEFAULT).textColor }}><SymbolIcon name="flame.fill" /></span>
          <b>{statLabel(streakNum, (v) => `${v} ngày`)}</b><small>Chuỗi đăng</small>
        </button>
        <button type="button" className="bd-tile" disabled={countNum == null} onClick={pickCount}>
          <span className="bd-ic beat" style={{ background: grad((colorPayload || COUNT_DEFAULT).colors), color: (colorPayload || COUNT_DEFAULT).textColor }}><SymbolIcon name="heart.fill" /></span>
          <b>{statLabel(countNum, (v) => `${v}`)}</b><small>Lockets</small>
        </button>
      </div>
      <Segmented label="Kiểu giờ" value={time12h ? '12' : '24'} onChange={(v) => setTime12h(v === '12')}
        options={[['24', '24 giờ'], ['12', '12 giờ (AM/PM)']]} />

      <h4 className="cap-h">Cung hoàng đạo</h4>
      <div className="zd-grid">
        {ZODIAC_SIGNS.map((z, i) => (
          <button key={z.id} type="button" className={`zd ${savedZodiac === z.id ? 'on' : ''}`} style={{ '--k': i }} onClick={() => pickZodiac(z)}>
            <span className="glyph" style={{ background: grad(colorPayload?.colors || z.colors), color: colorPayload?.textColor || z.textColor }}>{`${z.emoji}︎`}</span>
            <b>{z.name}</b>
            <small>{z.dates}</small>
            {savedZodiac === z.id ? <span className="mine" aria-label="Cung của bạn"><Icon name="check" /></span> : null}
          </button>
        ))}
      </div>

      <h4 className="cap-h">Mẫu của bạn</h4>
      <div className="cu-card">
        <PillPreview label="Xem trước" style={colorPayload ? overlayStyle(colorPayload) : undefined}
          icon={customEmoji ? <span className="em">{customEmoji}</span> : null} text={customText.trim() || 'Nội dung chú thích'} />
        <div className="cap-scroll cu-emojis" role="radiogroup" aria-label="Chọn emoji">
          {CUSTOM_EMOJIS.map((em) => (
            <button key={em} type="button" role="radio" aria-checked={customEmoji === em} className={customEmoji === em ? 'on' : ''} onClick={() => setCustomEmoji(em)}>{em}</button>
          ))}
        </div>
        <div className="cu-inputs">
          <input type="text" className="cu-em" maxLength={4} value={customEmoji} aria-label="Emoji" onChange={(e) => setCustomEmoji(e.target.value)} />
          <input type="text" className="cu-txt" maxLength={48} placeholder="Vd: Đang chạy deadline" value={customText} onChange={(e) => setCustomText(e.target.value)} />
        </div>
        <div className="cu-actions">
          <button type="button" className="btn btn-sm cu-save" disabled={!customText.trim()} onClick={handleSaveCustom}>Lưu mẫu</button>
          <button type="button" className="btn btn-gold btn-sm" disabled={!customText.trim()}
            onClick={() => applyCustomItem({ emoji: customEmoji, text: customText.trim(), colors: colorPayload?.colors || [], textColor: colorPayload?.textColor || '#FFFFFF' })}>
            Dùng ngay
          </button>
        </div>
      </div>
      {customList.length ? (
        <div className="cap-chips cu-saved">
          {customList.map((item) => {
            const hasBg = item.colors?.length > 0;
            return (
              <span key={item.id} className={`cap-chip saved ${hasBg ? '' : 'glass'}`} style={hasBg ? overlayStyle(item) : undefined}>
                <button type="button" onClick={() => applyCustomItem(item)}>{item.emoji ? <span className="em">{item.emoji}</span> : null}{item.text}</button>
                <button type="button" className="x" aria-label="Xóa mẫu" onClick={() => setCustomList(deleteCustomPreset(item.id))}><Icon name="closeSm" /></button>
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
