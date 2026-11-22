// Photobooth strip renderer (Canvas 2D). Draws a frame template - background, pattern and texture tiles, photo
// cells, text, date, SVG illustrations - then the user's stickers on top. The same functions render the live
// preview and the exported file, so the saved image matches what is on screen.
import { filteredCanvas } from './filters.js';
import { FLAT_STICKERS, TEXTURES, fontById, stickerUrl, templateById, textureUrl } from './boothAssets.js';

export const LAYOUTS = [
  { id: 'strip', name: 'Dải dọc', cols: 1 },
  { id: 'double', name: 'Dải đôi', cols: 1, twin: true },   // two identical strips, like a real booth print
  { id: 'grid', name: 'Lưới 2×2', cols: 2 },
  { id: 'row', name: 'Dải ngang', cols: 0 },
];

export const ASPECTS = [
  { id: '3:4', name: 'Dọc 3:4', ratio: 3 / 4 },
  { id: '1:1', name: 'Vuông', ratio: 1 },
  { id: '4:3', name: 'Ngang 4:3', ratio: 4 / 3 },
];

export const DATE_FORMATS = [
  { id: 'dot', name: '19.11.2026' },
  { id: 'film', name: "'26 11 19" },
  { id: 'time', name: '19.11.2026 21:05' },
];
export const DATE_POSITIONS = [
  { id: 'footer', name: 'Chân khung' },
  { id: 'photo', name: 'Trên ảnh (film)' },
  { id: 'header', name: 'Đầu khung' },
];

// null = use the template's value
export function defaultOptions() {
  return {
    layout: 'strip', aspect: '3:4', template: 'puppy', bg: null, texture: null, gap: null, border: 'template', radius: null,
    text: null, font: null, textColor: null, showDate: true, dateFormat: 'dot', datePos: 'footer', stickers: [], decorDetached: false,
  };
}

/* ------------------------------------------------------------------ assets */
const pending = new Map();
const ready = new Map();
export function loadImage(url) {
  if (!pending.has(url)) {
    pending.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { ready.set(url, img); resolve(img); };
      img.onerror = () => { pending.delete(url); reject(new Error(`asset ${url}`)); };
      img.src = url;
    }));
  }
  return pending.get(url);
}
export const loadedImage = (url) => ready.get(url) || null;
export const stickerImage = (id) => ready.get(stickerUrl(id)) || null;

const BOOTH_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Comfortaa:wght@700&family=Dancing+Script:wght@700&family=Itim&family=Pacifico&family=Playfair+Display:ital,wght@1,700&family=Space+Mono:wght@700&display=swap';
let boothFontsPromise = null;
function ensureBoothFonts() {
  if (boothFontsPromise) return boothFontsPromise;
  boothFontsPromise = new Promise((resolve) => {
    if (typeof document === 'undefined' || document.getElementById('booth-fonts')) { resolve(); return; }
    const timer = setTimeout(resolve, 4000);
    const done = () => { clearTimeout(timer); resolve(); };
    const link = document.createElement('link');
    link.id = 'booth-fonts';
    link.rel = 'stylesheet';
    link.href = BOOTH_FONTS_URL;
    link.onload = done;
    link.onerror = done;
    document.head.appendChild(link);
  });
  return boothFontsPromise;
}

function fontSpec(fontId, size) {
  const f = fontById(fontId);
  return `${f.style || 'normal'} ${f.weight || 400} ${Math.round(size)}px ${f.css}, "Nunito", sans-serif`;
}

// Everything a set of options needs (images + fonts), loaded before drawing.
export async function preloadBooth(opts, extraTemplates = []) {
  const urls = new Set();
  const fonts = new Set();
  [templateById(opts.template), ...extraTemplates].forEach((t) => {
    t.decor.forEach((d) => urls.add(stickerUrl(d.a)));
    if (t.header?.banner) urls.add(stickerUrl(t.header.banner));
    if (t.pattern) urls.add(textureUrl(t.pattern));
    if (t.texture) urls.add(textureUrl(t.texture));
    fonts.add(t.footer.font);
    if (t.header) fonts.add(t.header.font);
  });
  if (opts.texture && opts.texture !== 'none') urls.add(textureUrl(opts.texture));
  opts.stickers.forEach((s) => urls.add(stickerUrl(s.a)));
  if (opts.font) fonts.add(opts.font);
  fonts.add('Space Mono');
  const loadFonts = async () => {
    await ensureBoothFonts();
    if (!document.fonts?.load) return;
    await Promise.all([...fonts].map((f) => document.fonts.load(fontSpec(f, 40)).catch(() => null)));
  };
  await Promise.all([
    ...[...urls].map((u) => loadImage(u).catch(() => null)),
    loadFonts(),
  ]);
}

/* ------------------------------------------------------------------ geometry */
export function resolved(opts) {
  const t = templateById(opts.template);
  const textColor = opts.textColor || t.footer.color;
  return {
    t,
    gap: opts.gap ?? 22,
    radius: opts.radius ?? t.cell.radius ?? 0,
    text: opts.text ?? t.footer.text,
    font: opts.font || t.footer.font,
    textColor,
    dateColor: opts.textColor || t.footer.date || textColor,
    texture: opts.texture === 'none' ? null : (opts.texture || t.texture || null),
  };
}

export function geometry(count, opts, cellW) {
  const r = resolved(opts);
  const { t } = r;
  const layout = LAYOUTS.find((l) => l.id === opts.layout) || LAYOUTS[0];
  const ratio = (ASPECTS.find((a) => a.id === opts.aspect) || ASPECTS[0]).ratio;
  const cellH = Math.round(cellW / ratio);
  const s = cellW / 600;
  const gap = Math.round(r.gap * s);
  // margins come from the template (decorated frames need room for their illustrations)
  const side = Math.round((t.side ?? (t.film ? 74 : Math.max(36, r.gap * 1.6))) * s);
  const top = Math.round((t.header ? t.header.h : (t.top ?? Math.max(36, r.gap * 1.6))) * s);
  const footer = Math.round(t.footer.h * s);
  let cols = layout.cols === 0 ? count : layout.cols;
  let rows = Math.ceil(count / cols);
  if (layout.id === 'grid' && count === 3) { cols = 2; rows = 2; }
  const blockW = cols * cellW + (cols - 1) * gap;
  const blockH = rows * cellH + (rows - 1) * gap;
  const stripW = blockW + side * 2;
  const stripH = top + blockH + footer;
  const cells = [];
  for (let i = 0; i < count; i++) {
    const c = i % cols;
    const row = Math.floor(i / cols);
    cells.push({ x: side + c * (cellW + gap), y: top + row * (cellH + gap), w: cellW, h: cellH });
  }
  const twin = layout.twin ? 2 : 1;
  return { cellW, cellH, s, gap, side, top, footer, stripW, stripH, cells, twin, width: stripW * twin, height: stripH, r };
}

/* ------------------------------------------------------------------ drawing helpers */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function tile(ctx, url, w, h, scale, blend, alpha) {
  const img = loadedImage(url);
  if (!img) return;
  const pattern = ctx.createPattern(img, 'repeat');
  if (!pattern) return;
  if (pattern.setTransform && typeof DOMMatrix !== 'undefined') pattern.setTransform(new DOMMatrix().scale(scale));
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function dateText(ms, fmt) {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  if (fmt === 'film') return `'${String(d.getFullYear()).slice(2)} ${mm} ${dd}`;
  if (fmt === 'time') return `${dd}.${mm}.${d.getFullYear()}  ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// draws one SVG sticker centred at (cx, cy), width w, rotated
function drawSticker(ctx, id, cx, cy, w, rot, s) {
  const img = stickerImage(id);
  if (!img) return;
  const h = w * (img.naturalHeight / img.naturalWidth || 1);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((rot || 0) * Math.PI) / 180);
  if (!FLAT_STICKERS.has(id)) {
    ctx.shadowColor = 'rgba(60, 30, 20, .22)';
    ctx.shadowBlur = 8 * s;
    ctx.shadowOffsetY = 3 * s;
  }
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

// where a template decoration lands for this geometry: [{ a, cx, cy, w, rot }]
export function placeDecor(t, g) {
  const out = [];
  const aspect = (id) => { const img = stickerImage(id); return img ? img.naturalHeight / img.naturalWidth : 1; };
  t.decor.forEach((d) => {
    const boxes = [];
    if (d.at === 'cell') {
      const n = g.cells.length;
      const idx = d.cell === 'each' ? g.cells.map((_, i) => i) : d.cell === 'first' ? [0] : d.cell === 'last' ? [n - 1] : [Math.min(n - 1, d.cell)];
      idx.forEach((i) => boxes.push({ ...g.cells[i], base: g.cells[i].w }));
    } else if (d.at === 'footer') boxes.push({ x: 0, y: g.stripH - g.footer, w: g.stripW, h: g.footer, base: g.stripW });
    else if (d.at === 'header') boxes.push({ x: 0, y: 0, w: g.stripW, h: g.top, base: g.stripW });
    else boxes.push({ x: 0, y: 0, w: g.stripW, h: g.stripH, base: g.stripW });
    boxes.forEach((b, k) => {
      const w = d.w * b.base;
      const h = w * aspect(d.a);
      const ay = d.ay ?? 0.5;
      const rot = d.cell === 'each' && k % 2 ? -(d.rot || 0) : (d.rot || 0);
      out.push({ a: d.a, cx: b.x + d.x * b.w, cy: b.y + d.y * b.h + (0.5 - ay) * h, w, rot });
    });
  });
  return out;
}

/* ------------------------------------------------------------------ one strip */
function drawStrip(ctx, g, photos, opts, takenAt) {
  const { r } = g;
  const { t } = r;
  const { s, stripW: W, stripH: H } = g;

  // background
  if (opts.bg) ctx.fillStyle = opts.bg;
  else if (Array.isArray(t.bg)) {
    const grad = ctx.createLinearGradient(0, 0, W * 0.6, H);
    grad.addColorStop(0, t.bg[0]);
    grad.addColorStop(1, t.bg[1]);
    ctx.fillStyle = grad;
  } else ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  if (t.pattern) {
    const kind = TEXTURES.find((x) => x.id === t.pattern);
    tile(ctx, textureUrl(t.pattern), W, H, s * (t.pattern === 'kraft' ? 2 : 1.4), kind?.blend || 'multiply', kind?.alpha ?? 1);
  }
  if (r.texture) {
    const kind = TEXTURES.find((x) => x.id === r.texture);
    tile(ctx, textureUrl(r.texture), W, H, s * (r.texture === 'kraft' ? 2 : 1.2), kind?.blend || 'source-over', kind?.alpha ?? 1);
  }
  // film stock: sprocket holes down both edges
  if (t.film) {
    ctx.save();
    ctx.fillStyle = '#efe9df';
    const hw = 20 * s;
    const hh = 30 * s;
    for (let y = 18 * s; y < H - hh; y += 52 * s) {
      roundRect(ctx, 16 * s, y, hw, hh, 5 * s); ctx.fill();
      roundRect(ctx, W - 16 * s - hw, y, hw, hh, 5 * s); ctx.fill();
    }
    ctx.restore();
  }
  if (t.line) {
    ctx.save();
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 2 * s;
    ctx.strokeRect(14 * s, 14 * s, W - 28 * s, H - 28 * s);
    ctx.restore();
  }

  // photo cells
  const border = opts.border || 'template';
  const bw = (border === 'template' ? (t.cell.border || 0) : border === 'thin' ? 3 : border === 'thick' ? 12 : 0) * s;
  const bColor = border === 'thin' ? r.textColor : (t.cell.borderColor || '#ffffff');
  const inset = (border === 'template' ? (t.cell.inset || 0) : border === 'polaroid' ? 14 : 0) * s;
  const insetColor = t.cell.insetColor || '#ffffff';
  const rad = r.radius * s;
  g.cells.forEach((c, i) => {
    const ox = bw + inset;
    const bottomExtra = inset ? inset * 1.6 : 0;   // polaroid: thicker bottom edge
    ctx.save();
    if (t.cell.shadow || inset) {
      ctx.shadowColor = 'rgba(40, 20, 10, .2)';
      ctx.shadowBlur = 14 * s;
      ctx.shadowOffsetY = 5 * s;
    }
    if (ox) {
      ctx.fillStyle = inset ? insetColor : bColor;
      roundRect(ctx, c.x - ox, c.y - ox, c.w + ox * 2, c.h + ox * 2 + bottomExtra, rad + ox);
      ctx.fill();
    } else if (t.cell.shadow) {
      ctx.fillStyle = '#000';
      roundRect(ctx, c.x, c.y, c.w, c.h, rad);
      ctx.fill();
    }
    ctx.restore();
    if (inset && bw) {
      ctx.save();
      ctx.strokeStyle = bColor;
      ctx.lineWidth = bw;
      roundRect(ctx, c.x - ox + bw / 2, c.y - ox + bw / 2, c.w + ox * 2 - bw, c.h + ox * 2 + bottomExtra - bw, rad + ox);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    roundRect(ctx, c.x, c.y, c.w, c.h, rad);
    ctx.clip();
    if (photos[i]) ctx.drawImage(photos[i], c.x, c.y, c.w, c.h);
    else { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(c.x, c.y, c.w, c.h); }
    ctx.restore();
    if (border === 'stitch') {
      ctx.save();
      ctx.strokeStyle = r.textColor;
      ctx.lineWidth = 2.5 * s;
      ctx.setLineDash([9 * s, 7 * s]);
      roundRect(ctx, c.x - 9 * s, c.y - 9 * s, c.w + 18 * s, c.h + 18 * s, rad + 9 * s);
      ctx.stroke();
      ctx.restore();
    }
    if (t.film) {
      ctx.save();
      ctx.font = fontSpec('Space Mono', 17 * s);
      ctx.fillStyle = '#ff9f43';
      ctx.textBaseline = 'top';
      const n = 12 + i * 2;
      ctx.fillText(String(n), c.x, c.y + c.h + 6 * s);
      ctx.textAlign = 'right';
      ctx.fillText(`${n}A  >`, c.x + c.w, c.y + c.h + 6 * s);
      ctx.restore();
    }
    if (opts.showDate && opts.datePos === 'photo' && photos[i]) {
      ctx.save();
      ctx.font = fontSpec('Space Mono', 26 * s);
      ctx.fillStyle = '#ff9a3c';
      ctx.shadowColor = 'rgba(255, 120, 30, .85)';
      ctx.shadowBlur = 9 * s;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(dateText(takenAt, 'film'), c.x + c.w - 16 * s, c.y + c.h - 18 * s);
      ctx.restore();
    }
  });

  // header
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (t.header) {
    const hy = g.top / 2;
    if (t.header.banner) drawSticker(ctx, t.header.banner, W / 2, hy, W * 0.74, 0, s);
    ctx.save();
    ctx.font = fontSpec(t.header.font, t.header.size * s);
    ctx.fillStyle = t.header.color;
    ctx.fillText(t.header.text, W / 2, hy - (t.header.banner ? 4 * s : 0), W * 0.62);
    ctx.restore();
  }
  if (opts.showDate && opts.datePos === 'header') {
    ctx.save();
    ctx.font = fontSpec('Space Mono', 22 * s);
    ctx.fillStyle = r.dateColor;
    ctx.fillText(dateText(takenAt, opts.dateFormat), W / 2, t.header ? g.top - 16 * s : g.top / 2);
    ctx.restore();
  }
  // footer: caption + date
  const fy = H - g.footer;
  const showFooterDate = opts.showDate && (opts.datePos || 'footer') === 'footer';
  if (r.text) {
    ctx.save();
    // fit the caption between the footer illustrations: shrink the type rather than squashing it
    const footerArt = !opts.decorDetached && t.decor.some((d) => d.at === 'footer');
    const room = W * (footerArt ? 0.44 : 0.8);
    const text = r.text.slice(0, 40);
    let size = (t.footer.size || 48) * s;
    ctx.font = fontSpec(r.font, size);
    while (ctx.measureText(text).width > room && size > (t.footer.size || 48) * s * 0.4) {
      size *= 0.92;
      ctx.font = fontSpec(r.font, size);
    }
    ctx.fillStyle = r.textColor;
    ctx.fillText(text, W / 2, fy + g.footer * (showFooterDate ? 0.42 : 0.5), room);
    ctx.restore();
  }
  if (showFooterDate) {
    ctx.save();
    ctx.font = fontSpec('Space Mono', 22 * s);
    ctx.fillStyle = r.dateColor;
    ctx.fillText(dateText(takenAt, opts.dateFormat), W / 2, fy + g.footer * (r.text ? 0.74 : 0.5));
    ctx.restore();
  }
  // template illustrations (unless the user turned them into editable stickers)
  if (!opts.decorDetached) placeDecor(t, g).forEach((d) => drawSticker(ctx, d.a, d.cx, d.cy, d.w, d.rot, s));
}

/* ------------------------------------------------------------------ public API */
// Filter every shot (per-shot filter if set, otherwise the strip filter) into a cell-sized canvas.
export function processShots(shots, g, globalFilter, amount) {
  return shots.map((shot) => {
    if (!shot) return null;
    const f = shot.filter || globalFilter;
    const a = shot.filter ? shot.amount ?? amount : amount;
    return filteredCanvas(shot.image, { filter: f, amount: a, width: g.cellW, height: g.cellH });
  });
}

// Everything except the user's stickers (cached by the editor while stickers are dragged).
export function composeBase(shots, opts, { filter = 'none', amount = 1, cellW = 600, takenAt = Date.now() } = {}) {
  const g = geometry(shots.length, opts, cellW);
  const canvas = document.createElement('canvas');
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext('2d');
  const photos = processShots(shots, g, filter, amount);
  for (let k = 0; k < g.twin; k++) {
    ctx.save();
    ctx.translate(k * g.stripW, 0);
    drawStrip(ctx, g, photos, opts, takenAt);
    ctx.restore();
  }
  if (g.twin === 2) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    ctx.setLineDash([8 * g.s, 8 * g.s]);
    ctx.beginPath();
    ctx.moveTo(g.stripW, 0);
    ctx.lineTo(g.stripW, g.height);
    ctx.stroke();
    ctx.restore();
  }
  return { canvas, geometry: g };
}

// The user's stickers, positioned in fractions of one strip (x, y centre; w width).
export function drawStickers(ctx, stickers, g) {
  for (let k = 0; k < g.twin; k++) {
    stickers.forEach((st) => drawSticker(ctx, st.a, k * g.stripW + st.x * g.stripW, st.y * g.stripH, st.w * g.stripW, st.rot, g.s));
  }
}

export function compose(shots, opts, look = {}) {
  const { canvas, geometry: g } = composeBase(shots, opts, look);
  drawStickers(canvas.getContext('2d'), opts.stickers, g);
  return { canvas, geometry: g };
}

// The template's illustrations as editable stickers (same positions), so they can be moved or removed.
export function decorAsStickers(count, opts) {
  const g = geometry(count, opts, 600);
  return placeDecor(templateById(opts.template), g).map((d, i) => ({
    id: `d${Date.now().toString(36)}${i}`, a: d.a, x: d.cx / g.stripW, y: d.cy / g.stripH, w: d.w / g.stripW, rot: d.rot,
  }));
}

// Locket shows every moment as a square: centre the strip on a square of the frame colour.
export function toSquare(strip, opts, size = 1020) {
  const t = templateById(opts.template);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  const bg = opts.bg || (Array.isArray(t.bg) ? t.bg[0] : t.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  const scale = Math.min(size / strip.width, size / strip.height) * 0.94;
  const w = strip.width * scale;
  const h = strip.height * scale;
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur = size * 0.02;
  ctx.drawImage(strip, (size - w) / 2, (size - h) / 2, w, h);
  return out;
}

export const canvasToBlob = (canvas, type = 'image/jpeg', quality = 0.95) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
