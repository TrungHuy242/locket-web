// Caption style picker (sheet). The shell owns the tab bar, the shared background colour, the audio preview
// player and the Locket presets; Music / Weather / Location / Badges live in StylePickerPanels.
// Every tab hands onPick the same payload shape the camera posts: { key, type, text, icon, colors, textColor, overlayMeta }.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Icon, SymbolIcon } from '../../lib/icons.jsx';
import { clock, overlayStyle } from '../../lib/format.js';
import { useSiteConfig } from '../../lib/siteConfig.js';
import { fold } from '../../store.js';
import { ui } from '../../ui/overlays.jsx';
import { BadgesPanel, LocationPanel, MusicPanel, PillPreview, WeatherPanel } from './StylePickerPanels.jsx';

let presetsCache = null;

// Curated, slightly muted gradients (top -> bottom, the way Locket draws a caption background).
const GRADIENTS = [
  { id: 'glass', name: 'Tự động', colors: [], textColor: '#FFFFFF' },
  { id: 'gold', name: 'Vàng Locket', colors: ['#FFD23F', '#FFAE1A'], textColor: '#1A1300' },
  { id: 'white', name: 'Trắng', colors: ['#FFFFFF', '#ECECF1'], textColor: '#111111' },
  { id: 'sunset', name: 'Hoàng hôn', colors: ['#FF9A6B', '#FF5F7E'], textColor: '#FFFFFF' },
  { id: 'berry', name: 'Hồng', colors: ['#F79CC0', '#E9638F'], textColor: '#FFFFFF' },
  { id: 'lavender', name: 'Oải hương', colors: ['#B5A1F5', '#7C68E8'], textColor: '#FFFFFF' },
  { id: 'ocean', name: 'Biển', colors: ['#6BB8FF', '#2F7CF0'], textColor: '#FFFFFF' },
  { id: 'matcha', name: 'Matcha', colors: ['#8ED08B', '#3E9E63'], textColor: '#FFFFFF' },
  { id: 'noir', name: 'Đen', colors: ['#3A3A3C', '#1C1C1E'], textColor: '#FFFFFF' },
];

const REVIEW_WORDS = ['', 'Tệ', 'Tạm được', 'Ổn', 'Ngon', 'Tuyệt vời'];
const REVIEW_QUICK = ['Ngon xỉu', 'Đáng tiền', 'Sẽ quay lại', 'Chill phết', 'Hơi đắt', 'Không như kỳ vọng'];

export function StylePicker({ onPick, current }) {
  const smartEnabled = useSiteConfig((s) => s.features.smartCaptions);
  const [presets, setPresets] = useState(presetsCache);
  const [tab, setTab] = useState(() => {
    if (smartEnabled && ['music', 'location', 'weather'].includes(current?.type)) return current.type;
    if (current?.type === 'review') return 'review';
    if (['streak', 'star_sign', 'locket_count', 'custom'].includes(current?.type)) return 'badges';
    return 'presets';
  });
  const [query, setQuery] = useState('');
  const [colorPick, setColorPick] = useState(() => {
    const cur = current?.colors || [];
    return GRADIENTS.find((g) => JSON.stringify(g.colors) === JSON.stringify(cur)) || GRADIENTS[0];
  });

  const [stars, setStars] = useState(current?.rating || 5);
  const [reviewText, setReviewText] = useState(current?.type === 'review' ? (current.text || '') : '');

  // one audio element shared by every preview button in the Music tab
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

  const tabs = useMemo(() => [
    ['presets', 'Mẫu', <Icon key="i" name="sparkles" />],
    ...(smartEnabled ? [
      ['music', 'Nhạc', <Icon key="i" name="music" />],
      ['weather', 'Thời tiết', <SymbolIcon key="i" name="cloud.sun.fill" />],
      ['location', 'Vị trí', <SymbolIcon key="i" name="location.fill" />],
    ] : []),
    ['badges', 'Huy hiệu', <SymbolIcon key="i" name="flame.fill" />],
    ['review', 'Đánh giá', <SymbolIcon key="i" name="star.fill" />],
  ], [smartEnabled]);
  const tabIndex = Math.max(0, tabs.findIndex(([id]) => id === tab));

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

  const reviewPayload = {
    key: 'review',
    type: 'review',
    text: reviewText.trim() || `${stars} sao`,
    rating: stars,
    icon: { kind: 'symbol', value: 'star.fill', color: '#FFC629' },
    overlayMeta: { rating: stars },
  };

  return (
    <div className="cap">
      <div className="cap-head">
        <div className="cap-title">
          <div className="sheet-title">Kiểu chú thích</div>
          {current ? (
            <button type="button" className="cap-remove" onClick={() => { stopAudio(); onPick(null); }}>Gỡ</button>
          ) : null}
        </div>
        <div className="cap-tabs" role="tablist" style={{ '--n': tabs.length, '--i': tabIndex }}>
          <i className="cap-tab-ind" aria-hidden="true" />
          {tabs.map(([id, label, icon]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id}
              className={tab === id ? 'on' : ''} onClick={() => switchTab(id)}>
              <span className="ti">{icon}</span>
              <span className="tl">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cap-colors">
        <div className="cap-colors-label">Màu nền <b>{colorPick.name}</b></div>
        <div className="cap-dots" role="radiogroup" aria-label="Màu nền chú thích">
          {GRADIENTS.map((g) => (
            <button key={g.id} type="button" role="radio" aria-checked={colorPick.id === g.id} aria-label={g.name}
              className={`cap-dot ${g.colors.length ? '' : 'auto'} ${colorPick.id === g.id ? 'on' : ''}`}
              style={g.colors.length ? { background: `linear-gradient(180deg, ${g.colors.join(', ')})` } : undefined}
              onClick={() => setColorPick(g)}>
              {!g.colors.length ? 'A' : null}
            </button>
          ))}
        </div>
      </div>

      <div key={tab} className="cap-panel">
        {tab === 'presets' ? (
          <>
            <div className="search cap-search">
              <Icon name="search" />
              <input type="search" placeholder="Tìm mẫu chú thích" value={query}
                onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false} />
              {query ? <button type="button" className="x" onClick={() => setQuery('')} aria-label="Xóa"><Icon name="closeSm" /></button> : null}
            </div>

            <div className="cap-chips">
              <button type="button" className={`cap-chip ${colorPayload ? '' : 'glass'}`}
                style={colorPayload ? overlayStyle(colorPayload) : undefined} onClick={() => applyWithColors(null)}>
                {colorPayload ? 'Chữ thường' : 'Chữ thường (không nền)'}
              </button>
            </div>

            {!presets ? (
              <div className="cap-chips">
                {[64, 92, 78, 110, 70, 96].map((w, i) => <span key={i} className="cap-skel chip" style={{ width: w }} />)}
              </div>
            ) : null}
            {presets && !filteredSections.length ? <p className="cap-empty">Không có mẫu nào khớp &ldquo;{query.trim()}&rdquo;.</p> : null}
            {filteredSections.map(([name, list]) => (
              <section key={name}>
                <h4 className="cap-h">{name}</h4>
                <div className="cap-chips">
                  {list.map((p) => {
                    const hasBg = (p.colors || []).length > 0 || p.bgImage;
                    return (
                      <button type="button" key={p.key} className={`cap-chip ${hasBg ? '' : 'glass'}`}
                        style={hasBg ? overlayStyle(p) : undefined} onClick={() => { stopAudio(); onPick(p); }}>
                        {p.icon && typeof p.icon === 'string' ? <span className="em">{p.icon}</span> : null}
                        {p.type === 'time' ? clock(Date.now()) : p.text}
                      </button>
                    );
                  })}
                </div>
              </section>
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
          <div className="cap-review">
            <div className="cap-stars" role="radiogroup" aria-label="Số sao đánh giá">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n <= stars ? `${n}-${stars}` : n} type="button" role="radio" aria-checked={n === stars}
                  className={`cap-star ${n <= stars ? 'on' : ''}`} style={{ '--d': `${(n - 1) * 45}ms` }}
                  onClick={() => setStars(n)} aria-label={`${n} sao`}>
                  <SymbolIcon name="star.fill" />
                </button>
              ))}
            </div>
            <div className="cap-star-word">{REVIEW_WORDS[stars]}</div>

            <div className="cap-field">
              <input type="text" maxLength={80} placeholder="Nhận xét ngắn (vd: Trà sữa ngon xỉu)" value={reviewText}
                onChange={(e) => setReviewText(e.target.value)} />
              {reviewText ? <button type="button" className="x" aria-label="Xóa" onClick={() => setReviewText('')}><Icon name="closeSm" /></button> : null}
            </div>
            <div className="cap-scroll">
              {REVIEW_QUICK.map((t) => (
                <button key={t} type="button" className={`cap-pill-btn ${reviewText === t ? 'on' : ''}`} onClick={() => setReviewText(t)}>{t}</button>
              ))}
            </div>

            <PillPreview style={colorPayload ? overlayStyle(colorPayload) : undefined}
              icon={<span className="sym" style={{ color: '#FFC629' }}><SymbolIcon name="star.fill" /></span>}
              text={reviewPayload.text} />
            <button type="button" className="btn btn-gold cap-apply" onClick={() => applyWithColors(reviewPayload)}>
              Dùng đánh giá {stars} sao
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
