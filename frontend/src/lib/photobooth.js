// Photobooth renderer (Canvas 2D). Supports both native 1:1 Locket feed layouts (full-bleed 1080x1080
// with caption-safe header/footer) and classic printable booth strips, plus SVG stickers, die-cut emoji
// stickers, and draggable floating text labels. Preview and export use the exact same renderer.
import { centerCrop, filteredCanvas } from './filters.js';
import { FLAT_STICKERS, TEXTURES, fontById, stickerUrl, templateById, textureUrl } from './boothAssets.js';

// layouts / aspects / defaults live in boothConfig.js (the camera uses them without this renderer)
import { ASPECTS, BACKDROPS, DATE_FORMATS, DATE_POSITIONS, LAYOUTS, defaultOptions, isSquareNative } from './boothConfig.js';
export { ASPECTS, BACKDROPS, DATE_FORMATS, DATE_POSITIONS, LAYOUTS, defaultOptions, isSquareNative };

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
export const stickerImage = (id) => (id ? ready.get(stickerUrl(id)) || null : null);

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

export function fontSpec(fontId, size) {
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
  (opts.stickers || []).forEach((s) => {
    if ((!s.kind || s.kind === 'svg') && s.a) urls.add(stickerUrl(s.a));
    if (s.kind === 'text' && s.font) fonts.add(s.font);
  });
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
    gap: opts.gap ?? (opts.outputMode !== 'print' && isSquareNative(opts.layout) ? 18 : 22),
    radius: opts.radius ?? t.cell.radius ?? 0,
    text: opts.text ?? t.footer.text,
    font: opts.font || t.footer.font,
    textColor,
    dateColor: opts.textColor || t.footer.date || textColor,
    texture: opts.texture === 'none' ? null : (opts.texture || t.texture || null),
  };
}

function buildSquareCells(count, layoutId, area, gap, s) {
  const { x, y, w, h } = area;
  const cells = [];
  if (count <= 1) {
    cells.push({ x, y, w, h });
    return cells;
  }

  if (layoutId === 'polaroid') {
    if (count === 2) {
      const cw = w * 0.56;
      const ch = h * 0.62;
      cells.push({ x: x + w * 0.04, y: y + h * 0.04, w: cw, h: ch, rot: -5.5, polaroid: true });
      cells.push({ x: x + w - cw - w * 0.04, y: y + h - ch - h * 0.04, w: cw, h: ch, rot: 5, polaroid: true });
      return cells;
    }
    if (count === 3) {
      const cw = w * 0.47;
      const ch = h * 0.46;
      cells.push({ x: x + w * 0.03, y: y + h * 0.03, w: cw, h: ch, rot: -5, polaroid: true });
      cells.push({ x: x + w - cw - w * 0.03, y: y + h * 0.06, w: cw, h: ch, rot: 4.5, polaroid: true });
      cells.push({ x: x + (w - cw * 1.06) / 2, y: y + h - ch - h * 0.04, w: cw * 1.06, h: ch, rot: -2, polaroid: true });
      return cells;
    }
    if (count === 4) {
      const cw = (w - gap * 1.8) / 2;
      const ch = (h - gap * 2.2) / 2;
      const rots = [-3.8, 3.4, 3.2, -3.6];
      for (let i = 0; i < 4; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const padX = col === 0 ? gap * 0.4 : gap * 1.4;
        const padY = row === 0 ? gap * 0.3 : gap * 1.6;
        cells.push({ x: x + col * cw + padX, y: y + row * ch + padY, w: cw * 0.96, h: ch * 0.94, rot: rots[i], polaroid: true });
      }
      return cells;
    }
    const cols = 3;
    const rows = Math.ceil(count / cols);
    const cw = (w - gap * (cols + 0.6)) / cols;
    const ch = (h - gap * (rows + 0.8)) / rows;
    const rots = [-3.5, 2.5, -2.8, 3.2, -2.5, 3.6];
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      cells.push({
        x: x + gap * 0.3 + col * (cw + gap),
        y: y + gap * 0.3 + row * (ch + gap * 1.2),
        w: cw * 0.96,
        h: ch * 0.92,
        rot: rots[i % rots.length],
        polaroid: true,
      });
    }
    return cells;
  }

  if (layoutId === 'editorial') {
    if (count === 2) {
      const w1 = Math.round((w - gap) * 0.61);
      const w2 = w - gap - w1;
      cells.push({ x, y, w: w1, h });
      cells.push({ x: x + w1 + gap, y, w: w2, h });
      return cells;
    }
    if (count === 3) {
      const w1 = Math.round((w - gap) * 0.57);
      const w2 = w - gap - w1;
      const h2 = (h - gap) / 2;
      cells.push({ x, y, w: w1, h });
      cells.push({ x: x + w1 + gap, y, w: w2, h: h2 });
      cells.push({ x: x + w1 + gap, y: y + h2 + gap, w: w2, h: h - h2 - gap });
      return cells;
    }
    if (count === 4) {
      const h1 = Math.round((h - gap) * 0.56);
      const h2 = h - gap - h1;
      const w2 = (w - gap * 2) / 3;
      cells.push({ x, y, w, h: h1 });
      for (let i = 0; i < 3; i++) {
        cells.push({ x: x + i * (w2 + gap), y: y + h1 + gap, w: w2, h: h2 });
      }
      return cells;
    }
    // 5 or 6: hero top-left 2x2 + surrounding frames
    const cols = 3;
    const rows = 3;
    const cw = (w - gap * 2) / cols;
    const ch = (h - gap * 2) / rows;
    cells.push({ x, y, w: cw * 2 + gap, h: ch * 2 + gap });
    cells.push({ x: x + (cw + gap) * 2, y, w: cw, h: ch });
    cells.push({ x: x + (cw + gap) * 2, y: y + ch + gap, w: cw, h: ch });
    const rest = count - 3;
    const rw = (w - gap * (rest - 1)) / rest;
    for (let i = 0; i < rest; i++) {
      cells.push({ x: x + i * (rw + gap), y: y + (ch + gap) * 2, w: rw, h: ch });
    }
    return cells;
  }

  if (layoutId === 'split') {
    if (count === 2) {
      const ch = (h - gap) / 2;
      cells.push({ x, y, w, h: ch });
      cells.push({ x, y: y + ch + gap, w, h: ch });
      return cells;
    }
    if (count === 3) {
      const cw = (w - gap * 2) / 3;
      for (let i = 0; i < 3; i++) cells.push({ x: x + i * (cw + gap), y, w: cw, h });
      return cells;
    }
    if (count === 4) {
      // Wide 2x2 cinema framing
      const insetY = Math.round(28 * s);
      const ah = Math.max(120 * s, h - insetY * 2);
      const cw = (w - gap) / 2;
      const ch = (ah - gap) / 2;
      for (let i = 0; i < 4; i++) {
        cells.push({ x: x + (i % 2) * (cw + gap), y: y + insetY + Math.floor(i / 2) * (ch + gap), w: cw, h: ch });
      }
      return cells;
    }
    // 5-6: 2 cols x 3 rows
    const cols = 2;
    const rows = Math.ceil(count / cols);
    const cw = (w - gap) / cols;
    const ch = (h - gap * (rows - 1)) / rows;
    for (let i = 0; i < count; i++) {
      cells.push({ x: x + (i % cols) * (cw + gap), y: y + Math.floor(i / cols) * (ch + gap), w: cw, h: ch });
    }
    return cells;
  }

  // Default: 'grid' (Lưới Full 1:1)
  if (count === 2) {
    const cw = (w - gap) / 2;
    cells.push({ x, y, w: cw, h });
    cells.push({ x: x + cw + gap, y, w: cw, h });
    return cells;
  }
  if (count === 3) {
    const h1 = Math.round((h - gap) * 0.52);
    const h2 = h - gap - h1;
    const cw = (w - gap) / 2;
    cells.push({ x, y, w, h: h1 });
    cells.push({ x, y: y + h1 + gap, w: cw, h: h2 });
    cells.push({ x: x + cw + gap, y: y + h1 + gap, w: cw, h: h2 });
    return cells;
  }
  if (count === 5) {
    const h1 = Math.round((h - gap) * 0.52);
    const h2 = h - gap - h1;
    const w1 = (w - gap) / 2;
    const w2 = (w - gap * 2) / 3;
    cells.push({ x, y, w: w1, h: h1 });
    cells.push({ x: x + w1 + gap, y, w: w1, h: h1 });
    for (let i = 0; i < 3; i++) cells.push({ x: x + i * (w2 + gap), y: y + h1 + gap, w: w2, h: h2 });
    return cells;
  }
  const cols = count >= 6 ? 3 : 2;
  const rows = Math.ceil(count / cols);
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;
  for (let i = 0; i < count; i++) {
    cells.push({ x: x + (i % cols) * (cw + gap), y: y + Math.floor(i / cols) * (ch + gap), w: cw, h: ch });
  }
  return cells;
}

export function squareGeometry(count, opts, size = 1080) {
  const r = resolved(opts);
  const { t } = r;
  const s = size / 1080;
  const gap = Math.round(Math.min(44, Math.max(6, r.gap)) * s);
  const captionSafe = opts.captionSafe !== false;
  const side = Math.round(
    (t.film ? 64 : opts.layout === 'polaroid' ? 34 : Math.min(44, Math.max(24, (t.side ?? 44) * 0.52))) * s,
  );
  const hasFooterDate = opts.showDate && (opts.datePos || 'footer') === 'footer';
  const hasHeaderDate = opts.showDate && opts.datePos === 'header';
  const hasAnyTopText = !!(t.header || hasHeaderDate || (captionSafe && (r.text || hasFooterDate)));
  const top = Math.round((t.filmHoriz ? 92 : hasAnyTopText ? 104 : 42) * s);
  const footer = Math.round(
    (t.filmHoriz ? 112 : captionSafe ? 118 : (r.text || hasFooterDate ? 126 : 46)) * s,
  );
  const area = { x: side, y: top, w: size - side * 2, h: size - top - footer };
  const cells = buildSquareCells(count, opts.layout || 'grid', area, gap, s);
  const cellW = Math.round(cells[0]?.w || size / 2);
  const cellH = Math.round(cells[0]?.h || size / 2);
  return {
    squareMode: true,
    captionSafe,
    cellW,
    cellH,
    s,
    gap,
    side,
    top,
    footer,
    stripW: size,
    stripH: size,
    cells,
    twin: 1,
    width: size,
    height: size,
    r,
  };
}

export function stripGeometry(count, opts, cellW) {
  const r = resolved(opts);
  const { t } = r;
  const layout = LAYOUTS.find((l) => l.id === opts.layout) || LAYOUTS[4];
  const ratio = (ASPECTS.find((a) => a.id === opts.aspect) || ASPECTS[1]).ratio;
  const cellH = Math.round(cellW / ratio);
  const s = cellW / 600;
  const gap = Math.round(r.gap * s);
  const side = Math.round((t.side ?? (t.film ? 74 : Math.max(36, r.gap * 1.6))) * s);
  const top = Math.round((t.header ? t.header.h : (t.top ?? Math.max(36, r.gap * 1.6))) * s);
  const footer = Math.round(t.footer.h * s);
  let cols = layout.cols === 0 ? count : (layout.cols || 1);
  if (layout.id === 'grid' && count >= 6) cols = 3;
  else if (layout.id === 'grid' && count <= 2) cols = count;
  let rows = Math.ceil(count / cols);
  if ((layout.id === 'grid' || layout.id === 'editorial' || layout.id === 'polaroid') && count === 3) { cols = 2; rows = 2; }
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
  return { squareMode: false, cellW, cellH, s, gap, side, top, footer, stripW, stripH, cells, twin, width: stripW * twin, height: stripH, r };
}

export function geometry(count, opts, cellW = 600) {
  if (opts.outputMode !== 'print' && isSquareNative(opts.layout)) {
    return squareGeometry(count, opts, Math.round(cellW * 1.8));
  }
  return stripGeometry(count, opts, cellW);
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

function fillThemeBg(ctx, t, opts, r, W, H, s) {
  if (opts.bg) ctx.fillStyle = opts.bg;
  else if (Array.isArray(t.bg)) {
    const grad = ctx.createLinearGradient(0, 0, W * 0.65, H);
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
}

function fillBlurredBackdrop(ctx, photo, t, opts, W, H) {
  const bg = opts.bg || (Array.isArray(t.bg) ? t.bg[0] : t.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (!photo) return;
  // Downscale + blur for silky bokeh across all browsers (even where ctx.filter is ignored)
  const small = document.createElement('canvas');
  small.width = 48;
  small.height = 48;
  const sctx = small.getContext('2d');
  sctx.drawImage(photo, 0, 0, 48, 48);
  ctx.save();
  if ('filter' in ctx) ctx.filter = `blur(${Math.round(W * 0.028)}px) saturate(1.25)`;
  ctx.drawImage(small, -W * 0.08, -H * 0.08, W * 1.16, H * 1.16);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
  ctx.fillRect(0, 0, W, H);
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
function drawSvgSticker(ctx, id, cx, cy, w, rot, s) {
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

function drawEmojiSticker(ctx, st, cx, cy, w, rot, s) {
  const txt = st.text || '✨';
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((rot || 0) * Math.PI) / 180);
  ctx.font = `${Math.round(w * 0.86)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, .28)';
  ctx.shadowBlur = 10 * s;
  ctx.shadowOffsetY = 3 * s;
  if (st.outline !== false) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, w * 0.13);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(txt, 0, 0);
  }
  ctx.fillText(txt, 0, 0);
  ctx.restore();
}

function drawTextSticker(ctx, st, cx, cy, w, rot, s) {
  const txt = (st.text || '').trim();
  if (!txt) return;
  const fontSize = Math.max(14 * s, w * 0.22);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((rot || 0) * Math.PI) / 180);
  ctx.font = fontSpec(st.font || 'Itim', fontSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(txt);
  const padX = fontSize * 0.55;
  const padY = fontSize * 0.34;
  const boxW = metrics.width + padX * 2;
  const boxH = fontSize * 1.25 + padY * 1.4;
  if (st.bg && st.bg !== 'none') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.22)';
    ctx.shadowBlur = 10 * s;
    ctx.shadowOffsetY = 3 * s;
    ctx.fillStyle = st.bg;
    roundRect(ctx, -boxW / 2, -boxH / 2, boxW, boxH, boxH / 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 8 * s;
    ctx.shadowOffsetY = 2 * s;
  }
  ctx.fillStyle = st.color || '#ffffff';
  ctx.fillText(txt, 0, 1 * s);
  ctx.restore();
}

export function measureStickerBox(st, stripW) {
  const w = st.w * stripW;
  if (st.kind === 'emoji') return { w, h: w };
  if (st.kind === 'text') {
    const fontSize = Math.max(14, w * 0.22);
    const len = Math.max(3, (st.text || '').length);
    return { w: Math.max(w * 0.8, len * fontSize * 0.58 + fontSize * 1.1), h: fontSize * 1.95 };
  }
  const img = stickerImage(st.a);
  const ratio = img ? img.naturalHeight / img.naturalWidth : 1;
  return { w, h: w * ratio };
}

// Responsive decor placement: scales down gently in native 1:1 square layouts so art hugs corners cleanly.
export function placeDecor(t, g) {
  const out = [];
  const aspect = (id) => { const img = stickerImage(id); return img ? img.naturalHeight / img.naturalWidth : 1; };
  const isSq = !!g.squareMode;
  const capSafe = isSq && !!g.captionSafe;
  t.decor.forEach((d) => {
    const boxes = [];
    if (d.at === 'cell') {
      const n = g.cells.length;
      if (!n) return;
      const idx = d.cell === 'each' ? g.cells.map((_, i) => i) : d.cell === 'first' ? [0] : d.cell === 'last' ? [n - 1] : [Math.min(n - 1, d.cell)];
      idx.forEach((i) => boxes.push({ ...g.cells[i], base: Math.min(g.cells[i].w, g.cells[i].h) }));
    } else if (d.at === 'footer') {
      boxes.push({ x: 0, y: g.stripH - g.footer, w: g.stripW, h: g.footer, base: g.stripW });
    } else if (d.at === 'header') {
      boxes.push({ x: 0, y: 0, w: g.stripW, h: g.top, base: g.stripW });
    } else {
      boxes.push({ x: 0, y: 0, w: g.stripW, h: g.stripH, base: g.stripW });
    }
    boxes.forEach((b, k) => {
      let scaleFactor = 1;
      if (isSq) {
        if (d.at === 'footer' || d.at === 'header') scaleFactor = 0.54;
        else if (d.at === 'strip') scaleFactor = 0.56;
        else if (d.at === 'cell') scaleFactor = 0.72;
      }
      const w = d.w * b.base * scaleFactor;
      const h = w * aspect(d.a);
      const ay = d.ay ?? 0.5;
      const rot = d.cell === 'each' && k % 2 ? -(d.rot || 0) : (d.rot || 0);
      let dx = d.x;
      // In 1:1 caption-safe mode, keep footer stickers near left/right corners outside Locket's center caption pill
      if (capSafe && d.at === 'footer' && dx > 0.25 && dx < 0.75) {
        dx = dx < 0.5 ? 0.16 : 0.84;
      }
      // On full-width hero cells (e.g., Editorial 4-shot, Grid 3-shot), shift top-peeking stickers off-center so they don't cover the top title
      if (capSafe && d.at === 'cell' && d.y <= 0.05 && b.w > g.stripW * 0.62 && dx > 0.35 && dx < 0.65) {
        dx = 0.2;
      }
      let cx = b.x + dx * b.w;
      let cy = b.y + d.y * b.h + (0.5 - ay) * h;
      // Keep peeking stickers inside canvas top
      if (isSq && d.at === 'cell' && d.y <= 0.05) {
        cy = Math.max(h * 0.45 + 6 * g.s, cy);
      }
      out.push({ a: d.a, cx, cy, w, rot });
    });
  });
  return out;
}

/* ------------------------------------------------------------------ cell drawing */
function drawCellPhoto(ctx, c, i, photo, opts, g, takenAt) {
  const { r, s } = g;
  const { t } = r;
  const border = opts.border || 'template';
  const isPolaroid = !!c.polaroid || border === 'polaroid';
  const bw = (border === 'template' ? (t.cell.border || 0) : border === 'thin' ? 3 : border === 'thick' ? 10 : 0) * s;
  const bColor = border === 'thin' ? r.textColor : (t.cell.borderColor || '#ffffff');
  const inset = (isPolaroid ? (c.polaroid ? 14 : 12) : border === 'template' ? (t.cell.inset || 0) : 0) * s;
  const insetColor = t.cell.insetColor || '#ffffff';
  const rad = (c.polaroid ? Math.min(r.radius, 6) : r.radius) * s;

  ctx.save();
  if (c.rot) {
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
    ctx.rotate((c.rot * Math.PI) / 180);
    ctx.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
  }

  const ox = (c.polaroid ? 0 : bw) + inset;
  const bottomExtra = inset ? inset * (c.polaroid ? 2.4 : 1.55) : 0;
  ctx.save();
  if (t.cell.shadow || inset) {
    ctx.shadowColor = 'rgba(20, 12, 8, .24)';
    ctx.shadowBlur = (c.polaroid ? 22 : 14) * s;
    ctx.shadowOffsetY = (c.polaroid ? 8 : 5) * s;
  }
  if (ox) {
    ctx.fillStyle = inset ? insetColor : bColor;
    roundRect(ctx, c.x - ox, c.y - ox, c.w + ox * 2, c.h + ox * 2 + bottomExtra, rad + (c.polaroid ? 4 * s : ox));
    ctx.fill();
  } else if (t.cell.shadow) {
    ctx.fillStyle = '#000';
    roundRect(ctx, c.x, c.y, c.w, c.h, rad);
    ctx.fill();
  }
  ctx.restore();

  if (inset && bw && !c.polaroid) {
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
  if (photo) ctx.drawImage(photo, c.x, c.y, c.w, c.h);
  else {
    ctx.fillStyle = 'rgba(0,0,0,.14)';
    ctx.fillRect(c.x, c.y, c.w, c.h);
  }
  ctx.restore();

  if (border === 'stitch') {
    ctx.save();
    ctx.strokeStyle = r.textColor;
    ctx.lineWidth = 2.5 * s;
    ctx.setLineDash([9 * s, 7 * s]);
    roundRect(ctx, c.x - 8 * s, c.y - 8 * s, c.w + 16 * s, c.h + 16 * s, rad + 8 * s);
    ctx.stroke();
    ctx.restore();
  }

  if (t.film || t.filmHoriz) {
    ctx.save();
    ctx.font = fontSpec('Space Mono', 15 * s);
    ctx.fillStyle = '#ff9f43';
    ctx.textBaseline = 'top';
    const n = 1 + i;
    const tag = String(n).padStart(2, '0');
    ctx.fillText(tag, c.x + 2 * s, c.y + c.h + 4 * s);
    ctx.textAlign = 'right';
    ctx.fillText(`${tag}A  >`, c.x + c.w - 2 * s, c.y + c.h + 4 * s);
    ctx.restore();
  }

  if (opts.showDate && opts.datePos === 'photo' && photo) {
    ctx.save();
    ctx.font = fontSpec('Space Mono', Math.max(15, Math.min(26, c.w * 0.055)));
    ctx.fillStyle = '#ff9a3c';
    ctx.shadowColor = 'rgba(255, 120, 30, .85)';
    ctx.shadowBlur = 9 * s;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(dateText(takenAt, 'film'), c.x + c.w - 14 * s, c.y + c.h - 14 * s);
    ctx.restore();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ one strip / native square */
function drawStrip(ctx, g, photos, opts, takenAt, { skipCells = null } = {}) {
  const { r } = g;
  const { t } = r;
  const { s, stripW: W, stripH: H } = g;
  const isSq = !!g.squareMode;
  const capSafe = isSq && !!g.captionSafe;

  fillThemeBg(ctx, t, opts, r, W, H, s);

  // film stock: vertical sprockets (classic) or horizontal sprockets (35mm Contact)
  if (t.film) {
    ctx.save();
    ctx.fillStyle = '#efe9df';
    const hw = 18 * s;
    const hh = 28 * s;
    for (let y = 18 * s; y < H - hh; y += 50 * s) {
      roundRect(ctx, 14 * s, y, hw, hh, 5 * s); ctx.fill();
      roundRect(ctx, W - 14 * s - hw, y, hw, hh, 5 * s); ctx.fill();
    }
    ctx.restore();
  }
  if (t.filmHoriz) {
    ctx.save();
    ctx.fillStyle = '#e8e2d6';
    const hw = 26 * s;
    const hh = 17 * s;
    for (let x = 36 * s; x < W - hw - 24 * s; x += 48 * s) {
      roundRect(ctx, x, 16 * s, hw, hh, 4 * s); ctx.fill();
      roundRect(ctx, x, H - 16 * s - hh, hw, hh, 4 * s); ctx.fill();
    }
    ctx.restore();
  }
  if (t.line) {
    ctx.save();
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 2 * s;
    const pad = (isSq ? 16 : 14) * s;
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, isSq ? 36 * s : 0);
    ctx.stroke();
    ctx.restore();
  }

  // photo cells
  g.cells.forEach((c, i) => {
    if (skipCells && skipCells.has(i)) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      roundRect(ctx, c.x, c.y, c.w, c.h, r.radius * s);
      ctx.fill();
      ctx.restore();
      return;
    }
    drawCellPhoto(ctx, c, i, photos[i], opts, g, takenAt);
  });

  // header & footer typography (caption-safe mode lifts footer copy into the sleek top bar)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const showFooterDate = opts.showDate && (opts.datePos || 'footer') === 'footer';
  const showHeaderDate = opts.showDate && opts.datePos === 'header';

  if (capSafe) {
    // Caption-safe 1:1 mode: title + date cleanly centered at the top, leaving bottom center 100% open for Locket's caption pill
    const topLabel = (opts.text !== null && opts.text !== undefined) ? opts.text : (t.header?.text || r.text || '');
    const topFont = opts.font || (t.header && opts.text == null ? t.header.font : r.font);
    const topColor = opts.textColor || (t.header && opts.text == null ? t.header.color : r.textColor);
    const showTopDate = showFooterDate || showHeaderDate;
    const hy = t.filmHoriz ? (36 * s + (g.top - 36 * s) * 0.54) : g.top * 0.52;
    if (t.header?.banner) drawSticker(ctx, { a: t.header.banner }, W / 2, hy, W * 0.42, 0, s);
    if (topLabel) {
      ctx.save();
      const text = topLabel.slice(0, 40);
      const room = W * 0.64;
      let size = Math.min(44, (t.header?.size || t.footer.size || 44) * 0.72) * s;
      ctx.font = fontSpec(topFont, size);
      while (ctx.measureText(text).width > room && size > 18 * s) {
        size *= 0.92;
        ctx.font = fontSpec(topFont, size);
      }
      ctx.fillStyle = topColor;
      ctx.fillText(text, W / 2, showTopDate ? hy - 12 * s : hy, room);
      ctx.restore();
    }
    if (showTopDate) {
      ctx.save();
      ctx.font = fontSpec('Space Mono', 18 * s);
      ctx.fillStyle = r.dateColor;
      ctx.fillText(dateText(takenAt, opts.dateFormat), W / 2, topLabel ? hy + 20 * s : hy);
      ctx.restore();
    }
  } else {
    // Classic header + footer
    if (t.header) {
      const hy = g.top / 2;
      if (t.header.banner) drawSticker(ctx, { a: t.header.banner }, W / 2, hy, W * (isSq ? 0.44 : 0.74), 0, s);
      ctx.save();
      const hSize = (isSq ? Math.min(44, t.header.size * 0.75) : t.header.size) * s;
      ctx.font = fontSpec(t.header.font, hSize);
      ctx.fillStyle = t.header.color;
      ctx.fillText(t.header.text, W / 2, hy - (t.header.banner ? 4 * s : 0), W * 0.62);
      ctx.restore();
    }
    if (showHeaderDate) {
      ctx.save();
      ctx.font = fontSpec('Space Mono', (isSq ? 18 : 22) * s);
      ctx.fillStyle = r.dateColor;
      ctx.fillText(dateText(takenAt, opts.dateFormat), W / 2, t.header ? g.top - 14 * s : g.top / 2);
      ctx.restore();
    }
    const fy = H - g.footer;
    const footerCenterY = t.filmHoriz ? fy + (g.footer - 34 * s) * 0.48 : fy + g.footer * 0.5;
    if (r.text) {
      ctx.save();
      const footerArt = !opts.decorDetached && t.decor.some((d) => d.at === 'footer');
      const room = W * (footerArt ? (isSq ? 0.56 : 0.44) : 0.8);
      const text = r.text.slice(0, 40);
      let size = (isSq ? Math.min(46, (t.footer.size || 48) * 0.78) : (t.footer.size || 48)) * s;
      ctx.font = fontSpec(r.font, size);
      while (ctx.measureText(text).width > room && size > 18 * s) {
        size *= 0.92;
        ctx.font = fontSpec(r.font, size);
      }
      ctx.fillStyle = r.textColor;
      ctx.fillText(text, W / 2, showFooterDate ? footerCenterY - 14 * s : footerCenterY, room);
      ctx.restore();
    }
    if (showFooterDate) {
      ctx.save();
      ctx.font = fontSpec('Space Mono', (isSq ? 18 : 22) * s);
      ctx.fillStyle = r.dateColor;
      ctx.fillText(dateText(takenAt, opts.dateFormat), W / 2, r.text ? footerCenterY + 22 * s : footerCenterY);
      ctx.restore();
    }
  }

  // template illustrations (unless the user turned them into editable stickers)
  if (!opts.decorDetached) placeDecor(t, g).forEach((d) => drawSvgSticker(ctx, d.a, d.cx, d.cy, d.w, d.rot, s));
}

function drawSticker(ctx, st, cx, cy, w, rot, s) {
  if (st.kind === 'emoji') drawEmojiSticker(ctx, st, cx, cy, w, rot, s);
  else if (st.kind === 'text') drawTextSticker(ctx, st, cx, cy, w, rot, s);
  else drawSvgSticker(ctx, st.a, cx, cy, w, rot, s);
}

/* ------------------------------------------------------------------ public API */
// Filter every shot (per-shot filter + crop/pan/zoom/flip + global retouch) into its cell dimensions.
export function processShots(shots, g, globalFilter, amount, adjust = null) {
  return shots.map((shot, i) => {
    if (!shot) return null;
    const cell = g.cells[i] || { w: g.cellW, h: g.cellH };
    const w = Math.max(40, Math.round(cell.w));
    const h = Math.max(40, Math.round(cell.h));
    const f = shot.filter || globalFilter;
    const a = shot.filter ? shot.amount ?? amount : amount;
    const img = shot.image;
    const sw = img.videoWidth || img.naturalWidth || img.width || 1;
    const sh = img.videoHeight || img.naturalHeight || img.height || 1;
    const crop = centerCrop(sw, sh, w / h, shot.zoom || 1, shot.panX || 0, shot.panY || 0);
    return filteredCanvas(img, { filter: f, amount: a, width: w, height: h, crop, mirror: !!shot.flip, adjust });
  });
}

// Render classic strip + mount onto a gorgeous 1:1 Locket square (with theme/blurred backdrop + optional twin fan).
function composeStripInLocket(shots, opts, { filter = 'none', amount = 1, adjust = null, cellW = 540, takenAt = Date.now(), skipCells = null } = {}) {
  const size = Math.round(cellW * 1.8);
  const stripCellW = Math.max(240, Math.round(size * 0.42));
  const sg = stripGeometry(shots.length, opts, stripCellW);
  const { r } = sg;
  const { t } = r;
  const photos = processShots(shots, sg, filter, amount, adjust);

  const single = document.createElement('canvas');
  single.width = sg.stripW;
  single.height = sg.stripH;
  drawStrip(single.getContext('2d'), sg, photos, opts, takenAt, { skipCells });

  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  const s = size / 1080;

  if (opts.backdrop === 'blur' && photos[0]) {
    fillBlurredBackdrop(ctx, photos[0], t, opts, size, size);
  } else if (opts.backdrop === 'solid') {
    ctx.fillStyle = opts.bg || (Array.isArray(t.bg) ? t.bg[0] : t.bg);
    ctx.fillRect(0, 0, size, size);
  } else {
    fillThemeBg(ctx, t, opts, r, size, size, s);
    // subtle depth vignette so the printed strip pops
    const vig = ctx.createRadialGradient(size / 2, size / 2, size * 0.25, size / 2, size / 2, size * 0.72);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, size, size);
  }

  const capSafe = opts.captionSafe !== false;
  const availH = size * (capSafe ? 0.87 : 0.94);
  const cy = size * (capSafe ? 0.46 : 0.5);
  const mappedCells = [];

  if (sg.twin === 2 && opts.twinFan !== false) {
    // Aesthetic fanned twin strips filling ~74% of the square!
    const scale = Math.min((size * 0.44) / sg.stripW, availH / sg.stripH);
    const dw = sg.stripW * scale;
    const dh = sg.stripH * scale;
    const offsets = [
      { cx: size * 0.34, cy: cy + 4 * s, deg: -6 },
      { cx: size * 0.66, cy: cy - 4 * s, deg: 6 },
    ];
    offsets.forEach((p, idx) => {
      ctx.save();
      ctx.translate(p.cx, p.cy);
      ctx.rotate((p.deg * Math.PI) / 180);
      ctx.shadowColor = 'rgba(0, 0, 0, .28)';
      ctx.shadowBlur = 26 * s;
      ctx.shadowOffsetY = 10 * s;
      ctx.drawImage(single, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      if (idx === 0) {
        sg.cells.forEach((c) => {
          mappedCells.push({
            x: p.cx - dw / 2 + c.x * scale,
            y: p.cy - dh / 2 + c.y * scale,
            w: c.w * scale,
            h: c.h * scale,
          });
        });
      }
    });
  } else {
    // Full twin or single strip or horizontal row centered cleanly
    const totalW = sg.stripW * sg.twin;
    const scale = Math.min((size * 0.92) / totalW, availH / sg.stripH);
    const dw = sg.stripW * scale;
    const dh = sg.stripH * scale;
    const x0 = (size - dw * sg.twin) / 2;
    const y0 = cy - dh / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, .26)';
    ctx.shadowBlur = 24 * s;
    ctx.shadowOffsetY = 8 * s;
    for (let k = 0; k < sg.twin; k++) {
      ctx.drawImage(single, x0 + k * dw, y0, dw, dh);
    }
    ctx.restore();
    if (sg.twin === 2) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,.18)';
      ctx.setLineDash([7 * s, 7 * s]);
      ctx.beginPath();
      ctx.moveTo(x0 + dw, y0);
      ctx.lineTo(x0 + dw, y0 + dh);
      ctx.stroke();
      ctx.restore();
    }
    sg.cells.forEach((c) => {
      mappedCells.push({
        x: x0 + c.x * scale,
        y: y0 + c.y * scale,
        w: c.w * scale,
        h: c.h * scale,
      });
    });
  }

  return {
    canvas: out,
    geometry: {
      squareMode: true,
      mountedStrip: true,
      captionSafe: capSafe,
      s,
      stripW: size,
      stripH: size,
      width: size,
      height: size,
      twin: 1,
      cells: mappedCells,
      cellW: Math.round(mappedCells[0]?.w || size / 3),
      cellH: Math.round(mappedCells[0]?.h || size / 3),
      r,
    },
  };
}

// Everything except the user's stickers (cached by the editor while stickers are dragged).
export function composeBase(shots, opts, { filter = 'none', amount = 1, adjust = null, cellW = 600, takenAt = Date.now(), skipCells = null } = {}) {
  const effectiveAdj = adjust || opts.adjust || null;
  if (opts.outputMode !== 'print') {
    if (isSquareNative(opts.layout)) {
      const size = Math.round(cellW * 1.8);
      const g = squareGeometry(shots.length, opts, size);
      const canvas = document.createElement('canvas');
      canvas.width = g.width;
      canvas.height = g.height;
      const photos = processShots(shots, g, filter, amount, effectiveAdj);
      drawStrip(canvas.getContext('2d'), g, photos, opts, takenAt, { skipCells });
      return { canvas, geometry: g };
    }
    return composeStripInLocket(shots, opts, { filter, amount, adjust: effectiveAdj, cellW, takenAt, skipCells });
  }

  const g = stripGeometry(shots.length, opts, cellW);
  const canvas = document.createElement('canvas');
  canvas.width = g.width;
  canvas.height = g.height;
  const ctx = canvas.getContext('2d');
  const photos = processShots(shots, g, filter, amount, effectiveAdj);
  for (let k = 0; k < g.twin; k++) {
    ctx.save();
    ctx.translate(k * g.stripW, 0);
    drawStrip(ctx, g, photos, opts, takenAt, { skipCells });
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

// The user's stickers (SVG, Emoji, Floating Text), positioned in fractions of one strip/square.
export function drawStickers(ctx, stickers, g) {
  for (let k = 0; k < g.twin; k++) {
    (stickers || []).forEach((st) => {
      drawSticker(ctx, st, k * g.stripW + st.x * g.stripW, st.y * g.stripH, st.w * g.stripW, st.rot, g.s);
    });
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
    id: `d${Date.now().toString(36)}${i}`, kind: 'svg', a: d.a, x: d.cx / g.stripW, y: d.cy / g.stripH, w: d.w / g.stripW, rot: d.rot,
  }));
}

// Always returns a crisp square ready for Locket upload (1080x1080).
export function toSquare(canvas, opts, size = 1080) {
  if (canvas.width === canvas.height && Math.abs(canvas.width - size) <= 2) return canvas;
  const t = templateById(opts.template);
  const r = resolved(opts);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d');
  fillThemeBg(ctx, t, opts, r, size, size, size / 1080);
  const scale = Math.min(size / canvas.width, size / canvas.height) * 0.94;
  const w = canvas.width * scale;
  const h = canvas.height * scale;
  ctx.shadowColor = 'rgba(0,0,0,.2)';
  ctx.shadowBlur = size * 0.022;
  ctx.drawImage(canvas, (size - w) / 2, (size - h) / 2, w, h);
  return out;
}

export const canvasToBlob = (canvas, type = 'image/jpeg', quality = 0.95) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
