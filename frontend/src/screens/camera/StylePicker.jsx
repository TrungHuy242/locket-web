// Smart Caption & Style Picker: standard/gradient colors, Music (iTunes + Deezer search & 30s preview),
// Review (1-5 stars), Location (GPS + live place search + recent), Weather (multi-provider live + VN quick cities),
// and searchable Locket presets.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Icon, SymbolIcon } from '../../lib/icons.jsx';
import { clock, overlayStyle } from '../../lib/format.js';
import { fold } from '../../store.js';
import { ui } from '../../ui/overlays.jsx';

let presetsCache = null;

const RECENT_PLACES_KEY = 'locket.recent.places.v1';
const GRADIENTS = [
  { id: 'glass', name: 'Kính mờ', colors: [], textColor: '#FFFFFF' },
  { id: 'gold', name: 'Vàng Locket', colors: ['#FFC629', '#FF9F1C'], textColor: '#111111' },
  { id: 'sunset', name: 'Hoàng hôn', colors: ['#FF5F6D', '#FFC371'], textColor: '#FFFFFF' },
  { id: 'ocean', name: 'Biển xanh', colors: ['#2193B0', '#6DD5ED'], textColor: '#FFFFFF' },
  { id: 'berry', name: 'Hồng tím', colors: ['#EC008C', '#FC6767'], textColor: '#FFFFFF' },
  { id: 'lavender', name: 'Tím mộng mơ', colors: ['#7F00FF', '#E100FF'], textColor: '#FFFFFF' },
  { id: 'matcha', name: 'Matcha', colors: ['#11998E', '#38EF7D'], textColor: '#0E2918' },
  { id: 'noir', name: 'Đen tuyền', colors: ['#1C1C1E', '#2C2C2E'], textColor: '#FFFFFF' },
];

const QUICK_PLACES = ['Ở nhà', 'Quán cà phê', 'Trường học', 'Công ty', 'Ngoài phố', 'Đi du lịch'];
const QUICK_CITIES = ['Hà Nội', 'TP.HCM', 'Đà Nẵng', 'Đà Lạt', 'Nha Trang', 'Huế', 'Cần Thơ', 'Hải Phòng'];
const QUICK_MUSIC = ['Sơn Tùng', 'HIEUTHUHAI', 'Wren Evans', 'tlinh', 'Lofi Chill', 'Taylor Swift'];

function loadRecentPlaces() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_PLACES_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.trim()).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecentPlace(name) {
  const clean = (name || '').trim();
  if (!clean) return;
  try {
    const next = [clean, ...loadRecentPlaces().filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 5);
    localStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export function StylePicker({ onPick, current }) {
  const [presets, setPresets] = useState(presetsCache);
  const [tab, setTab] = useState(() => (
    ['music', 'review', 'location', 'weather'].includes(current?.type) ? current.type : 'presets'
  ));
  const [query, setQuery] = useState('');
  const [colorPick, setColorPick] = useState(() => {
    const cur = current?.colors || [];
    return GRADIENTS.find((g) => JSON.stringify(g.colors) === JSON.stringify(cur)) || GRADIENTS[0];
  });

  // Music state
  const [musicQ, setMusicQ] = useState('');
  const [tracks, setTracks] = useState([]);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicSearched, setMusicSearched] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const audioRef = useRef(null);
  const musicReqId = useRef(0);

  // Review state
  const [stars, setStars] = useState(current?.rating || 5);
  const [reviewText, setReviewText] = useState(current?.type === 'review' ? (current.text || '') : '');

  // Location state
  const [place, setPlace] = useState(current?.type === 'location' ? (current.text || '') : '');
  const [placeResults, setPlaceResults] = useState([]);
  const [placeBusy, setPlaceBusy] = useState(false);
  const [recentPlaces, setRecentPlaces] = useState(() => loadRecentPlaces());

  // Weather state
  const [city, setCity] = useState('');
  const [weatherRes, setWeatherRes] = useState(null);
  const [weatherCompact, setWeatherCompact] = useState(false);
  const [weatherBusy, setWeatherBusy] = useState(false);

  useEffect(() => {
    if (presetsCache) return;
    api.captions().then((d) => { presetsCache = d.presets; setPresets(d.presets); }).catch((err) => ui.error(err.message));
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setPlayingId(null);
  }, []);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const switchTab = (next) => {
    if (next !== 'music') stopAudio();
    setTab(next);
  };

  const colorPayload = colorPick.colors.length ? { colors: colorPick.colors, textColor: colorPick.textColor } : null;
  const iconColor = colorPayload?.textColor || '#FFFFFFCC';

  const applyWithColors = (obj) => {
    stopAudio();
    if (!obj) {
      if (colorPayload) {
        onPick({ key: 'standard', type: 'standard', text: '', ...colorPayload, overlayMeta: colorPayload });
      } else {
        onPick(null);
      }
      return;
    }
    const mergedMeta = { ...(obj.overlayMeta || {}), ...(colorPayload || {}) };
    onPick({
      ...obj,
      ...(colorPayload || {}),
      overlayMeta: Object.keys(mergedMeta).length ? mergedMeta : undefined,
    });
  };

  /* ---------------- Music */
  const runMusicSearch = useCallback(async (term) => {
    const q = (term || '').trim();
    if (!q) { setTracks([]); setMusicSearched(false); return; }
    const reqId = ++musicReqId.current;
    setMusicBusy(true);
    try {
      const data = await api.searchMusic(q);
      if (reqId !== musicReqId.current) return;
      setTracks(data.tracks || []);
      setMusicSearched(true);
    } catch (err) {
      if (reqId === musicReqId.current) ui.error(err.message || 'Không tìm được bài hát');
    } finally {
      if (reqId === musicReqId.current) setMusicBusy(false);
    }
  }, []);

  // Debounced auto-search as user types in Music tab
  useEffect(() => {
    if (tab !== 'music') return undefined;
    const q = musicQ.trim();
    if (q.length < 2) return undefined;
    const timer = setTimeout(() => runMusicSearch(q), 420);
    return () => clearTimeout(timer);
  }, [tab, musicQ, runMusicSearch]);

  const toggleTrackPreview = (e, track) => {
    e.stopPropagation();
    if (!track.previewProxy) { ui.info('Bài hát này chưa có đoạn nghe thử'); return; }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener('ended', () => setPlayingId(null));
      audioRef.current.addEventListener('error', () => {
        setPlayingId(null);
        ui.error('Không phát được đoạn nhạc này');
      });
    }
    const a = audioRef.current;
    if (playingId === track.id && !a.paused) { a.pause(); setPlayingId(null); return; }
    a.src = track.previewProxy;
    setPlayingId(track.id);
    a.play().catch(() => { setPlayingId(null); ui.error('Không phát được đoạn nhạc này'); });
  };

  const pickTrack = (track) => {
    stopAudio();
    const label = [track.title, track.artist].filter(Boolean).join(' – ');
    applyWithColors({
      key: 'music',
      type: 'music',
      text: label,
      icon: track.artworkProxy ? { kind: 'image', value: track.artworkProxy } : { kind: 'symbol', value: 'music.note', color: iconColor },
      colors: colorPayload?.colors || ['#1C1C1E', '#2C2C2E'],
      textColor: colorPayload?.textColor || '#FFFFFF',
      overlayMeta: {
        music: {
          title: track.title,
          artist: track.artist,
          artwork: track.artwork,
          previewUrl: track.previewUrl,
          appleMusicUrl: track.appleMusicUrl,
        },
      },
    });
  };

  /* ---------------- Location */
  const searchPlaces = async (q) => {
    const clean = (q || '').trim();
    if (!clean) return;
    setPlaceBusy(true);
    try {
      const data = await api.places({ q: clean });
      setPlaceResults(data.places || []);
      if (!data.places?.length) ui.info(`Không tìm thấy địa điểm khớp "${clean}"`);
    } catch (err) {
      ui.error(err.message || 'Không tra được địa điểm');
    } finally {
      setPlaceBusy(false);
    }
  };

  const fetchGpsPlaces = () => {
    if (!navigator.geolocation) { ui.warning('Trình duyệt không hỗ trợ định vị'); return; }
    setPlaceBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await api.places({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          const list = data.places || [];
          setPlaceResults(list);
          if (list[0]?.name) setPlace(list[0].name);
          else if (data.city) setPlace(data.city);
          else ui.info('Không xác định được tên đường/quận tại vị trí này');
        } catch (err) {
          ui.error(err.message || 'Không tra được vị trí hiện tại');
        } finally {
          setPlaceBusy(false);
        }
      },
      () => { setPlaceBusy(false); ui.warning('Chưa được cấp quyền vị trí — hãy nhập tên địa điểm'); },
      { timeout: 9000, enableHighAccuracy: false },
    );
  };

  const pickPlace = (label) => {
    const clean = (label || '').trim();
    if (!clean) return;
    saveRecentPlace(clean);
    setRecentPlaces(loadRecentPlaces());
    applyWithColors({
      key: 'location',
      type: 'location',
      text: clean,
      icon: { kind: 'symbol', value: 'location.fill', color: iconColor },
    });
  };

  /* ---------------- Weather */
  const fetchWeather = async (opts) => {
    setWeatherBusy(true);
    try {
      const data = await api.weather(opts);
      setWeatherRes(data);
      if (data.city && !opts.q) setCity(data.city);
    } catch (err) {
      ui.error(err.message || 'Không lấy được thời tiết lúc này');
    } finally {
      setWeatherBusy(false);
    }
  };

  const fetchGpsWeather = () => {
    if (!navigator.geolocation) { ui.warning('Trình duyệt không hỗ trợ định vị'); return; }
    setWeatherBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeather({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { setWeatherBusy(false); ui.warning('Chưa được cấp quyền vị trí — hãy chọn thành phố bên dưới'); },
      { timeout: 9000, enableHighAccuracy: false },
    );
  };

  const weatherDisplayText = weatherRes
    ? (weatherCompact ? (weatherRes.shortText || weatherRes.text) : weatherRes.text)
    : '';

  const filteredSections = useMemo(() => {
    if (!presets) return [];
    const q = fold(query.trim());
    const map = new Map();
    presets.forEach((p) => {
      if (q && !fold(`${p.text} ${p.section} ${p.key}`).includes(q)) return;
      const key = p.section || 'Khác';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    });
    return [...map];
  }, [presets, query]);

  return (
    <div className="styles">
      <div className="styles-head">
        <div className="sheet-title">Kiểu chú thích</div>
        {current ? (
          <button type="button" className="link-btn" onClick={() => { stopAudio(); onPick(null); }}>Gỡ kiểu</button>
        ) : null}
      </div>

      <div className="smart-tabs" role="tablist">
        {[
          ['presets', 'Mẫu', 'sparkles'],
          ['music', 'Nhạc', 'music'],
          ['review', 'Đánh giá', 'star'],
          ['location', 'Vị trí', 'pin'],
          ['weather', 'Thời tiết', 'cloud'],
        ].map(([id, label, ic]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={`chip sm ${tab === id ? 'on' : ''}`} onClick={() => switchTab(id)}>
            <Icon name={ic} />{label}
          </button>
        ))}
      </div>

      {/* Custom gradient color strip */}
      <div className="color-strip" aria-label="Màu nền chú thích">
        {GRADIENTS.map((g) => (
          <button key={g.id} type="button" title={g.name}
            className={`color-dot ${colorPick.id === g.id ? 'on' : ''}`}
            style={g.colors.length ? { background: `linear-gradient(135deg, ${g.colors.join(', ')})` } : undefined}
            onClick={() => setColorPick(g)}>
            {!g.colors.length ? 'Aa' : null}
          </button>
        ))}
      </div>

      {tab === 'presets' ? (
        <>
          <div className="search" style={{ marginTop: 10 }}>
            <Icon name="search" />
            <input type="search" placeholder="Tìm kiểu chú thích…" value={query}
              onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
            {query ? <button type="button" className="x" onClick={() => setQuery('')} aria-label="Xóa"><Icon name="closeSm" /></button> : null}
          </div>

          <div className="chips" style={{ marginTop: 12 }}>
            <button type="button" className="chip" style={colorPayload ? overlayStyle(colorPayload) : undefined}
              onClick={() => applyWithColors(null)}>
              Aa&nbsp; {colorPayload ? `Văn bản (${colorPick.name})` : 'Văn bản mặc định'}
            </button>
          </div>

          {!presets ? <div className="empty"><span className="spinner" style={{ margin: '0 auto' }} /></div> : null}
          {presets && !filteredSections.length ? <div className="empty">Không có mẫu nào khớp &ldquo;{query.trim()}&rdquo;.</div> : null}
          {filteredSections.map(([name, list]) => (
            <div key={name}>
              <h4>{name}</h4>
              <div className="chips">
                {list.map((p) => (
                  <button type="button" key={p.key} className="chip" style={overlayStyle(p)} onClick={() => { stopAudio(); onPick(p); }}>
                    {p.icon ? <span>{p.icon}</span> : null}{p.type === 'time' ? clock(Date.now()) : p.text}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : null}

      {tab === 'music' ? (
        <div className="smart-panel">
          <form className="search" onSubmit={(e) => { e.preventDefault(); runMusicSearch(musicQ); }}>
            <Icon name="music" />
            <input type="search" placeholder="Tìm tên bài hát hoặc ca sĩ…" value={musicQ}
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

          {!musicQ.trim() ? (
            <div className="chips smart-quick">
              {QUICK_MUSIC.map((kw) => (
                <button key={kw} type="button" className="chip sm" onClick={() => { setMusicQ(kw); runMusicSearch(kw); }}>{kw}</button>
              ))}
            </div>
          ) : null}

          <div className="music-list">
            {musicBusy && !tracks.length ? <div className="empty"><span className="spinner" style={{ margin: '0 auto' }} /></div> : null}
            {tracks.map((tr) => (
              <div key={tr.id} className="music-row" role="button" tabIndex={0} onClick={() => pickTrack(tr)}
                onKeyDown={(e) => { if (e.key === 'Enter') pickTrack(tr); }}>
                {tr.artworkProxy ? <img src={tr.artworkProxy} alt="" loading="lazy" /> : <span className="music-ph"><Icon name="music" /></span>}
                <div className="grow"><b>{tr.title}</b><small>{tr.artist}</small></div>
                {tr.previewProxy ? (
                  <button type="button" className={`icon-btn sm ${playingId === tr.id ? 'on' : ''}`}
                    aria-label={playingId === tr.id ? 'Dừng nghe thử' : 'Nghe thử'}
                    onClick={(e) => toggleTrackPreview(e, tr)}>
                    <Icon name={playingId === tr.id ? 'mute' : 'play'} />
                  </button>
                ) : null}
              </div>
            ))}
            {musicSearched && !tracks.length && !musicBusy ? (
              <p className="smart-hint">Không tìm thấy bài hát khớp &ldquo;{musicQ.trim()}&rdquo;. Hãy thử từ khóa khác.</p>
            ) : !tracks.length && !musicBusy ? (
              <p className="smart-hint">Gõ tên bài hát / ca sĩ hoặc chạm gợi ý phía trên để gắn ảnh bìa và nhạc nghe thử 30s.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === 'review' ? (
        <div className="smart-panel">
          <div className="star-row" role="radiogroup" aria-label="Số sao đánh giá">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={`star-btn ${n <= stars ? 'on' : ''}`} onClick={() => setStars(n)} aria-label={`${n} sao`}>★</button>
            ))}
            <span className="star-val">{stars}/5</span>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <input type="text" maxLength={80} placeholder="Nhận xét ngắn (vd: Trà sữa ngon xỉu…)" value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
          </div>
          <button type="button" className="btn btn-gold" style={{ marginTop: 14, width: '100%' }} onClick={() => applyWithColors({
            key: 'review',
            type: 'review',
            text: reviewText.trim() || `${stars} sao`,
            rating: stars,
            icon: { kind: 'symbol', value: 'star.fill', color: '#FFC629' },
            overlayMeta: { rating: stars },
          })}>
            Dùng đánh giá ★ {stars}
          </button>
        </div>
      ) : null}

      {tab === 'location' ? (
        <div className="smart-panel">
          <form className="search" onSubmit={(e) => { e.preventDefault(); searchPlaces(place); }}>
            <Icon name="pin" />
            <input type="search" maxLength={60} placeholder="Tìm hoặc nhập tên địa điểm…" value={place}
              onChange={(e) => setPlace(e.target.value)} autoComplete="off" enterKeyHint="search" />
            {place ? (
              <button type="button" className="x" aria-label="Xóa" onClick={() => { setPlace(''); setPlaceResults([]); }}>
                <Icon name="closeSm" />
              </button>
            ) : null}
            <button type="submit" className="btn btn-gold btn-sm" disabled={placeBusy || !place.trim()}>
              {placeBusy ? '…' : 'Tìm'}
            </button>
          </form>

          <div className="smart-actions-row">
            <button type="button" className="btn btn-dark btn-sm" disabled={placeBusy} onClick={fetchGpsPlaces}>
              <Icon name="pin" /> {placeBusy ? 'Đang định vị…' : 'Lấy vị trí hiện tại'}
            </button>
            {place.trim() ? (
              <button type="button" className="btn btn-gold btn-sm" onClick={() => pickPlace(place)}>
                Gắn &ldquo;{place.trim().slice(0, 18)}{place.trim().length > 18 ? '…' : ''}&rdquo;
              </button>
            ) : null}
          </div>

          {placeResults.length ? (
            <div className="place-list">
              {placeResults.map((pl, idx) => (
                <button key={`${pl.name}-${idx}`} type="button" className="place-row" onClick={() => pickPlace(pl.name)}>
                  <span className="place-ico"><Icon name="pin" /></span>
                  <span className="grow">
                    <b>{pl.name}</b>
                    {pl.detail ? <small>{pl.detail}</small> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {recentPlaces.length ? (
            <div className="smart-sub-block">
              <h4>Gần đây</h4>
              <div className="chips">
                {recentPlaces.map((pl) => (
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
      ) : null}

      {tab === 'weather' ? (
        <div className="smart-panel">
          <form className="search" onSubmit={(e) => { e.preventDefault(); if (city.trim()) fetchWeather({ q: city.trim() }); }}>
            <Icon name="cloud" />
            <input type="search" placeholder="Nhập thành phố (Hà Nội, TP.HCM, Đà Nẵng…)" value={city}
              onChange={(e) => setCity(e.target.value)} autoComplete="off" enterKeyHint="search" />
            {city ? (
              <button type="button" className="x" aria-label="Xóa" onClick={() => setCity('')}>
                <Icon name="closeSm" />
              </button>
            ) : null}
            <button type="submit" className="btn btn-gold btn-sm" disabled={weatherBusy || !city.trim()}>
              {weatherBusy ? '…' : 'Xem'}
            </button>
          </form>

          <div className="smart-actions-row">
            <button type="button" className="btn btn-dark btn-sm" disabled={weatherBusy} onClick={fetchGpsWeather}>
              <Icon name="pin" /> {weatherBusy ? 'Đang tải…' : 'Dùng vị trí hiện tại'}
            </button>
          </div>

          <div className="chips smart-quick">
            {QUICK_CITIES.map((c) => (
              <button key={c} type="button" className="chip sm" disabled={weatherBusy}
                onClick={() => { setCity(c); fetchWeather({ q: c }); }}>{c}</button>
            ))}
          </div>

          {weatherRes ? (
            <div className="weather-card">
              <div className="weather-preview" style={colorPayload ? overlayStyle(colorPayload) : undefined}>
                <span className="ico sym" style={{ color: iconColor }}><SymbolIcon name={weatherRes.symbol} /></span>
                <span>{weatherDisplayText}</span>
              </div>
              {weatherRes.humidity != null || weatherRes.feelsLike != null ? (
                <div className="weather-meta">
                  {weatherRes.feelsLike != null ? <span>Cảm giác {weatherRes.feelsLike}°C</span> : null}
                  {weatherRes.humidity != null ? <span>Độ ẩm {weatherRes.humidity}%</span> : null}
                </div>
              ) : null}
              <div className="weather-modes">
                <button type="button" className={`chip sm ${!weatherCompact ? 'on' : ''}`} onClick={() => setWeatherCompact(false)}>Đầy đủ</button>
                <button type="button" className={`chip sm ${weatherCompact ? 'on' : ''}`} onClick={() => setWeatherCompact(true)}>Ngắn gọn</button>
              </div>
              <button type="button" className="btn btn-gold" style={{ marginTop: 12, width: '100%' }} onClick={() => applyWithColors({
                key: 'weather',
                type: 'weather',
                text: weatherDisplayText,
                icon: { kind: 'symbol', value: weatherRes.symbol, color: iconColor },
                overlayMeta: { weather: { symbol: weatherRes.symbol } },
              })}>
                Gắn thời tiết này
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
