// Shared UI kit: buttons, spinner, skeletons and empty / error states. One implementation per control,
// so every screen looks and behaves the same (see styles/base.css for the visuals).
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../lib/icons.jsx';

export function Spinner({ size, dark = false, className = '' }) {
  return <span className={`spinner ${size || ''} ${dark ? 'dark' : ''} ${className}`} role="progressbar" aria-label="Đang tải" />;
}

// <Button variant="primary|secondary|tinted|plain|destructive|destructive-tinted" size="lg|md|sm">.
// When onClick returns a promise the button shows a spinner and ignores further taps until it settles,
// so a slow request can never be sent twice.
export function Button({
  variant = 'secondary', size = 'md', block = false, loading = false, disabled = false, icon = null,
  type = 'button', className = '', onClick, children, ...rest
}) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const handle = async (e) => {
    if (running.current || !onClick) return;
    const result = onClick(e);
    if (!result || typeof result.then !== 'function') return;
    running.current = true;
    setBusy(true);
    try { await result; } catch { /* the caller reports its own errors */ } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const isLoading = loading || busy;
  return (
    <button type={type} {...rest}
      className={`btn btn-${variant} btn-${size} ${block ? 'btn-block' : ''} ${isLoading ? 'is-loading' : ''} ${className}`}
      disabled={disabled || isLoading} aria-busy={isLoading || undefined} onClick={handle}>
      <span className="btn-label">{icon ? <Icon name={icon} /> : null}{children}</span>
      {isLoading ? <span className="btn-spinner"><Spinner size="sm" /></span> : null}
    </button>
  );
}

// Round icon button; `label` is required (it is the accessible name and the tooltip).
export function IconButton({ icon, label, bare = false, size, badge = 0, className = '', children, ...rest }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={`icon-btn pressable ${bare ? 'bare' : ''} ${size || ''} ${className}`}>
      {icon ? <Icon name={icon} /> : null}{children}
      {badge ? <i className="badge">{badge > 9 ? '9+' : badge}</i> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ skeletons */
const widths = ['62%', '45%', '74%', '52%', '68%', '40%', '58%'];

// Avatar + two text lines, like a conversation, notification or friend row.
export function SkeletonList({ rows = 6, avatar = 52, thumb = false }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i}>
          <div className="sk sk-circle" style={{ width: avatar, height: avatar }} />
          <div className="sk-lines">
            <div className="sk sk-line" style={{ width: widths[i % widths.length] }} />
            <div className="sk sk-line" style={{ width: widths[(i + 3) % widths.length], height: 10, opacity: .7 }} />
          </div>
          {thumb ? <div className="sk" style={{ width: 46, height: 46, borderRadius: 12 }} /> : null}
        </div>
      ))}
    </div>
  );
}

export function SkeletonGrid({ count = 12 }) {
  return <div className="sk-grid" aria-hidden="true">{Array.from({ length: count }, (_, i) => <div className="sk" key={i} />)}</div>;
}

export function SkeletonBubbles({ count = 8 }) {
  return (
    <div className="sk-bubbles" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`sk sk-bubble ${i % 3 === 1 ? 'mine' : ''}`} style={{ width: `${30 + ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

// Empty or error state: icon, title, short text and an optional action.
export function StateView({ icon = 'info', tone, title, text, action, onAction }) {
  return (
    <div className="empty">
      <span className={`state-ic ${tone || ''}`}><Icon name={icon} /></span>
      {title ? <b>{title}</b> : null}
      {text ? <span>{text}</span> : null}
      {action ? <Button variant={tone === 'error' ? 'secondary' : 'tinted'} size="sm" onClick={onAction}>{action}</Button> : null}
    </div>
  );
}
