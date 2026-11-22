// Smart Caption & Style Picker: standard/gradient colors, Music (iTunes search + 30s preview),
// Review (1-5 stars), Location, Weather (Open-Meteo live), and searchable Locket presets.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Icon, SymbolIcon } from '../../lib/icons.jsx';
import { clock, overlayStyle } from '../../lib/format.js';
import { fold } from '../../store.js';
import { ui } from '../../ui/overlays.jsx';

let presetsCache = null;

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

export function StylePicker({ onPick, current }) {
  const [presets, setPresets] = useState(presetsCache);
  const [tab, setTab] = useState('presets'); // presets | music | review | location | weather
  const [query, setQuery] = useState('');
  const [colorPick, setColorPick] = useState(() => {
    const cur = current?.colors || [];
    return GRADIENTS.find((g) => JSON.stringify(g.colors) === JSON.stringify(cur)) || GRADIENTS[0];
  });

  // Music state
  const [musicQ, setMusicQ] = useState('');
  const [tracks, setTracks] = useState([]);
  const [musicBusy, setMusicBusy] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const audioRef = useRef(null);

  // Review state
  const [stars, setStars] = useState(current?.rating || 5);
  const [reviewText, setReviewText] = useState(current?.type === 'review' ? (current.text || '') : '');

  // Location state
  const [place, setPlace] = useState(current?.type === 'location' ? (current.text || '') : '');

  // Weather state
  const [city, setCity] = useState('');
  const [weatherRes, setWeatherRes] = useState(null);
  const [weatherBusy, setWeatherBusy] = useState(false);

  useEffect(() => {
    if (presetsCache) return;
    api.captions().then((d) => { presetsCache = d.presets; setPresets(d.presets); }).catch((err) => ui.error(err.message));
  }, []);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const colorPayload = colorPick.colors.length ? { colors: colorPick.colors, textColor: colorPick.textColor } : null;

  const applyWithColors = (obj) => {
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

  const searchTracks = async (e) => {
    e?.preventDefault();
    const q = musicQ.trim();
    if (!q) return;
    setMusicBusy(true);
    try {
      const data = await api.searchMusic(q);
      setTracks(data.tracks || []);
      if (!data.tracks?.length) ui.info('Không tìm thấy bài hát phù hợp');
    } catch (err) {
      ui.error(err.message);
    } finally {
      setMusicBusy(false);
    }
  };

  const toggleTrackPreview = (e, track) => {
    e.stopPropagation();
    if (!track.previewProxy) return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener('ended', () => setPlayingId(null));
    }
    const a = audioRef.current;
    if (playingId === track.id && !a.paused) { a.pause(); setPlayingId(null); return; }
    a.src = track.previewProxy;
    setPlayingId(track.id);
    a.play().catch(() => { setPlayingId(null); ui.error('Không phát được đoạn nhạc này'); });
  };

  const pickTrack = (track) => {
    audioRef.current?.pause();
    const label = [track.title, track.artist].filter(Boolean).join(' – ');
    applyWithColors({
      key: 'music',
      type: 'music',
      text: label,
      icon: track.artworkProxy ? { kind: 'image', value: track.artworkProxy } : { kind: 'symbol', value: 'music.note', color: '#FFFFFFCC' },
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

  const fetchWeather = async (opts) => {
    setWeatherBusy(true);
    try {
      const data = await api.weather(opts);
      setWeatherRes(data);
    } catch (err) {
      ui.error(err.message);
    } finally {
      setWeatherBusy(false);
    }
  };

  const fetchGpsWeather = () => {
    if (!navigator.geolocation) { ui.warning('Trình duyệt không hỗ trợ định vị'); return; }
    setWeatherBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeather({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { setWeatherBusy(false); ui.warning('Chưa được cấp quyền vị trí — hãy nhập tên thành phố'); },
      { timeout: 8000 },
    );
  };

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
      <div className="sheet-title">Kiểu chú thích</div>

      <div className="smart-tabs" role="tablist">
        {[
          ['presets', 'Mẫu', 'sparkles'],
          ['music', 'Nhạc', 'music'],
          ['review', 'Đánh giá', 'star'],
          ['location', 'Vị trí', 'pin'],
          ['weather', 'Thời tiết', 'cloud'],
        ].map(([id, label, ic]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={`chip sm ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>
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
                  <button type="button" key={p.key} className="chip" style={overlayStyle(p)} onClick={() => onPick(p)}>
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
          <form className="search" onSubmit={searchTracks}>
            <Icon name="music" />
            <input type="search" placeholder="Tìm tên bài hát hoặc ca sĩ…" value={musicQ}
              onChange={(e) => setMusicQ(e.target.value)} autoComplete="off" enterKeyHint="search" />
            <button type="submit" className="btn btn-gold btn-sm" disabled={musicBusy || !musicQ.trim()}>
              {musicBusy ? '…' : 'Tìm'}
            </button>
          </form>
          <div className="music-list">
            {tracks.map((tr) => (
              <div key={tr.id} className="music-row" role="button" tabIndex={0} onClick={() => pickTrack(tr)}
                onKeyDown={(e) => { if (e.key === 'Enter') pickTrack(tr); }}>
                {tr.artworkProxy ? <img src={tr.artworkProxy} alt="" /> : <span className="music-ph"><Icon name="music" /></span>}
                <div className="grow"><b>{tr.title}</b><small>{tr.artist}</small></div>
                {tr.previewProxy ? (
                  <button type="button" className={`icon-btn ${playingId === tr.id ? 'on' : ''}`}
                    aria-label={playingId === tr.id ? 'Dừng nghe thử' : 'Nghe thử'}
                    onClick={(e) => toggleTrackPreview(e, tr)}>
                    <Icon name={playingId === tr.id ? 'mute' : 'play'} />
                  </button>
                ) : null}
              </div>
            ))}
            {!tracks.length && !musicBusy ? <p className="smart-hint">Tìm kiếm bài hát qua iTunes để gắn ảnh bìa và đoạn nghe thử 30 giây lên khoảnh khắc.</p> : null}
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
          <div className="field">
            <input type="text" maxLength={60} placeholder="Nhập tên địa điểm…" value={place} onChange={(e) => setPlace(e.target.value)} />
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            {QUICK_PLACES.map((pl) => (
              <button key={pl} type="button" className="chip sm" onClick={() => setPlace(pl)}>{pl}</button>
            ))}
          </div>
          <button type="button" className="btn btn-gold" style={{ marginTop: 14, width: '100%' }} disabled={!place.trim()}
            onClick={() => applyWithColors({
              key: 'location',
              type: 'location',
              text: place.trim(),
              icon: { kind: 'symbol', value: 'location.fill', color: '#FFFFFFCC' },
            })}>
            Gắn vị trí
          </button>
        </div>
      ) : null}

      {tab === 'weather' ? (
        <div className="smart-panel">
          <form className="search" onSubmit={(e) => { e.preventDefault(); if (city.trim()) fetchWeather({ q: city.trim() }); }}>
            <Icon name="cloud" />
            <input type="search" placeholder="Nhập thành phố (Hà Nội, TP.HCM…)" value={city}
              onChange={(e) => setCity(e.target.value)} autoComplete="off" enterKeyHint="search" />
            <button type="submit" className="btn btn-gold btn-sm" disabled={weatherBusy || !city.trim()}>
              {weatherBusy ? '…' : 'Xem'}
            </button>
          </form>
          <button type="button" className="btn btn-dark btn-sm" style={{ marginTop: 10 }} disabled={weatherBusy} onClick={fetchGpsWeather}>
            <Icon name="pin" /> Dùng vị trí hiện tại
          </button>
          {weatherRes ? (
            <div className="weather-card">
              <div className="weather-preview" style={colorPayload ? overlayStyle(colorPayload) : undefined}>
                <SymbolIcon name={weatherRes.symbol} />
                <span>{weatherRes.text}</span>
              </div>
              <button type="button" className="btn btn-gold" style={{ marginTop: 12, width: '100%' }} onClick={() => applyWithColors({
                key: 'weather',
                type: 'weather',
                text: weatherRes.text,
                icon: { kind: 'symbol', value: weatherRes.symbol, color: '#FFFFFFCC' },
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
