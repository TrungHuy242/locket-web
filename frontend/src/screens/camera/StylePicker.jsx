// Smart Caption & Style Picker shell: delegates Music, Weather, Location, and Badges/Custom Presets
// to StylePickerPanels while handling shared gradient colors, audio preview lifecycle, and Locket presets.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../lib/icons.jsx';
import { clock, overlayStyle } from '../../lib/format.js';
import { fold } from '../../store.js';
import { ui } from '../../ui/overlays.jsx';
import { BadgesPanel, LocationPanel, MusicPanel, WeatherPanel } from './StylePickerPanels.jsx';

let presetsCache = null;

const GRADIENTS = [
  { id: 'glass', name: 'Tự động / Kính mờ', colors: [], textColor: '#FFFFFF' },
  { id: 'gold', name: 'Vàng Locket', colors: ['#FFC629', '#FF9F1C'], textColor: '#111111' },
  { id: 'sunset', name: 'Hoàng hôn', colors: ['#FF5F6D', '#FFC371'], textColor: '#FFFFFF' },
  { id: 'ocean', name: 'Biển xanh', colors: ['#2193B0', '#6DD5ED'], textColor: '#FFFFFF' },
  { id: 'berry', name: 'Hồng tím', colors: ['#EC008C', '#FC6767'], textColor: '#FFFFFF' },
  { id: 'lavender', name: 'Tím mộng mơ', colors: ['#7F00FF', '#E100FF'], textColor: '#FFFFFF' },
  { id: 'matcha', name: 'Matcha', colors: ['#11998E', '#38EF7D'], textColor: '#0E2918' },
  { id: 'noir', name: 'Đen tuyền', colors: ['#1C1C1E', '#2C2C2E'], textColor: '#FFFFFF' },
];

export function StylePicker({ onPick, current }) {
  const [presets, setPresets] = useState(presetsCache);
  const [tab, setTab] = useState(() => {
    if (['music', 'review', 'location', 'weather'].includes(current?.type)) return current.type;
    if (['streak', 'star_sign', 'locket_count', 'custom'].includes(current?.type)) return 'badges';
    return 'presets';
  });
  const [query, setQuery] = useState('');
  const [colorPick, setColorPick] = useState(() => {
    const cur = current?.colors || [];
    return GRADIENTS.find((g) => JSON.stringify(g.colors) === JSON.stringify(cur)) || GRADIENTS[0];
  });

  // Review state
  const [stars, setStars] = useState(current?.rating || 5);
  const [reviewText, setReviewText] = useState(current?.type === 'review' ? (current.text || '') : '');

  // Shared preview audio player for Music tab
  const [playingId, setPlayingId] = useState(null);
  const audioRef = useRef(null);

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

  const toggleTrackPreview = useCallback((e, track) => {
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
  }, [playingId]);

  const colorPayload = useMemo(
    () => (colorPick.colors.length ? { colors: colorPick.colors, textColor: colorPick.textColor } : null),
    [colorPick],
  );
  const iconColor = colorPayload?.textColor || '#FFFFFFCC';

  const applyWithColors = useCallback((obj, { skipColorOverride = false } = {}) => {
    stopAudio();
    if (!obj) {
      if (colorPayload) {
        onPick({ key: 'standard', type: 'standard', text: '', ...colorPayload, overlayMeta: colorPayload });
      } else {
        onPick(null);
      }
      return;
    }
    const extraColors = skipColorOverride ? null : colorPayload;
    const mergedMeta = { ...(obj.overlayMeta || {}), ...(extraColors || {}) };
    onPick({
      ...obj,
      ...(extraColors || {}),
      overlayMeta: Object.keys(mergedMeta).length ? mergedMeta : undefined,
    });
  }, [colorPayload, onPick, stopAudio]);

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
          ['weather', 'Thời tiết', 'cloud'],
          ['location', 'Vị trí', 'pin'],
          ['badges', 'Huy hiệu', 'heart'],
          ['review', 'Đánh giá', 'star'],
        ].map(([id, label, ic]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id}
            className={`chip sm ${tab === id ? 'on' : ''}`} onClick={() => switchTab(id)}>
            <Icon name={ic} />{label}
          </button>
        ))}
      </div>

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
        <MusicPanel
          colorPayload={colorPayload}
          iconColor={iconColor}
          applyWithColors={applyWithColors}
          playingId={playingId}
          toggleTrackPreview={toggleTrackPreview}
          stopAudio={stopAudio}
        />
      ) : null}

      {tab === 'weather' ? (
        <WeatherPanel colorPayload={colorPayload} iconColor={iconColor} applyWithColors={applyWithColors} />
      ) : null}

      {tab === 'location' ? (
        <LocationPanel current={current} iconColor={iconColor} applyWithColors={applyWithColors} />
      ) : null}

      {tab === 'badges' ? (
        <BadgesPanel colorPayload={colorPayload} applyWithColors={applyWithColors} />
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
    </div>
  );
}
