// Formatting helpers shared by every screen.

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const isDesktop = () => window.matchMedia('(min-width: 769px)').matches;

// Ask the media proxy for a downscaled copy (grids, avatars) instead of the full-size photo.
export const thumb = (url, w = 360) => (url && url.startsWith('/api/media?') ? `${url}&w=${w}` : url);

export function initials(user) {
  const a = (user?.firstName || user?.name || user?.username || '?').trim();
  const b = (user?.lastName || '').trim();
  return ((a[0] || '?') + (b[0] || '')).toUpperCase();
}

// Compact relative time, the way the Locket feed prints it.
export function ago(ms) {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)}ph`;
  if (s < 86400) return `${Math.floor(s / 3600)}g`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}ng`;
  const d = new Date(ms);
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} thg ${d.getMonth() + 1}${year}`;
}

export function clock(ms) {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fullDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${clock(ms)} · ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export const fmtDuration = (sec) => {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.max(1, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const HEX = /^#[0-9a-f]{3,8}$/i;
export const safeColor = (c, fallback = '') => (typeof c === 'string' && HEX.test(c) ? c : fallback);
const PROXIED = /^\/api\/media\?u=[A-Za-z0-9%._~-]+(&w=\d+)?$/;

// Inline style for a caption pill, built only from validated hex colours and proxied image URLs.
export function overlayStyle(overlay) {
  if (!overlay) return undefined;
  const colors = (overlay.colors || []).map((c) => safeColor(c)).filter(Boolean);
  const layers = [];
  if (overlay.bgImage && PROXIED.test(overlay.bgImage)) layers.push(`url(${overlay.bgImage}) center/cover`);
  if (colors.length === 1) layers.push(colors[0]);
  if (colors.length > 1) layers.push(`linear-gradient(180deg,${colors.join(',')})`);
  const style = {};
  if (layers.length) style.background = layers.join(',');
  const text = safeColor(overlay.textColor);
  if (text) style.color = text;
  const lines = Number(overlay.maxLines);
  if (lines >= 1 && lines <= 8) style['--lines'] = Math.floor(lines);
  return style;
}

export const isColored = (overlay) => !!overlay && ((overlay.colors || []).some((c) => safeColor(c)) || !!overlay.bgImage);

export const vibrate = (pattern) => {
  try { navigator.vibrate?.(pattern); } catch { /* not allowed before a user gesture */ }
};

export function downloadBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}
