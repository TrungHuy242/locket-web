// A moment's caption, rendered from the overlay Locket sent: text, icon (emoji / SF Symbol /
// album art), colours, background image, and for music captions a tappable preview clip.
import { SYMBOLS, SymbolIcon } from '../lib/icons.jsx';
import { isColored, overlayStyle, safeColor, thumb } from '../lib/format.js';

function OverlayIcon({ icon }) {
  if (!icon) return null;
  if (typeof icon === 'string' || icon.kind === 'emoji') return <span className="ico">{typeof icon === 'string' ? icon : icon.value}</span>;
  if (icon.kind === 'image' && icon.value) return <img className="ico art" src={thumb(icon.value, 128)} alt="" draggable="false" />;
  if (icon.kind === 'symbol' && SYMBOLS[icon.value]) {
    return <span className="ico sym" style={{ color: safeColor(icon.color, 'currentColor') }}><SymbolIcon name={icon.value} /></span>;
  }
  return null;
}

export function CaptionPill({ overlay, playing = false, onPlay }) {
  if (!overlay) return null;
  const music = overlay.music;
  const text = overlay.text || (music ? [music.title, music.artist].filter(Boolean).join(' – ') : '');
  const hasIcon = !!overlay.icon && (typeof overlay.icon === 'string' || overlay.icon.kind !== 'symbol' || SYMBOLS[overlay.icon.value]);
  if (!text && !hasIcon) return null;
  const cls = `caption-pill ${overlay.type === 'music' ? 'music' : ''} ${isColored(overlay) ? 'colored' : ''} ${playing ? 'playing' : ''}`;
  const inner = (
    <>
      <OverlayIcon icon={overlay.icon} />
      {typeof overlay.rating === 'number' ? <span className="rate">★ {overlay.rating}</span> : null}
      <span className="txt">{text}</span>
    </>
  );
  if (music?.preview && onPlay) {
    return (
      <button type="button" className={cls} style={overlayStyle(overlay)} onClick={(e) => { e.stopPropagation(); onPlay(music.preview); }}
        title={[music.title, music.artist].filter(Boolean).join(' – ')} aria-label="Phát đoạn nhạc xem trước">
        {inner}<span className="eq" aria-hidden="true"><i /><i /><i /></span>
      </button>
    );
  }
  return <div className={cls} style={overlayStyle(overlay)}>{inner}</div>;
}
