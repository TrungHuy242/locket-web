import { useEffect, useState } from 'react';
import { initials, thumb } from '../lib/format.js';

export function Avatar({ user, className = '', size }) {
  const src = user?.avatar ? thumb(user.avatar, 128) : null;
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const style = size ? { '--s': `${size}px` } : undefined;
  return (
    <span className={`avatar ${className}`} style={style}>
      {src && !broken ? <img src={src} alt="" decoding="async" draggable="false" onError={() => setBroken(true)} /> : initials(user)}
    </span>
  );
}
