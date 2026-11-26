import { useEffect, useState } from 'react';
import { initials, thumb } from '../lib/format.js';

export function Avatar({ user, className = '', size, goldBadge = false }) {
  const src = user?.avatar ? thumb(user.avatar, 128) : null;
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const style = size ? { '--s': `${size}px` } : undefined;
  return (
    <span className={`avatar ${goldBadge ? 'gold-ring' : ''} ${className}`} style={style}>
      {src && !broken ? <img src={src} alt="" decoding="async" draggable="false" onError={() => setBroken(true)} /> : initials(user)}
      {goldBadge ? (
        <i className="avatar-gold-heart" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
            <path d="M12 20.6c-.4 0-.8-.1-1.1-.4C6.8 16.7 3 13.5 3 9.4 3 6.4 5.3 4.1 8.2 4.1c1.5 0 2.8.6 3.8 1.7 1-1.1 2.3-1.7 3.8-1.7 2.9 0 5.2 2.3 5.2 5.3 0 4.1-3.8 7.3-7.9 10.8-.3.3-.7.4-1.1.4z" />
          </svg>
        </i>
      ) : null}
    </span>
  );
}
