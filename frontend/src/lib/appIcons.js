// Custom App Icons (32 Locket Gold designs matching native iOS Locket icon gallery).
// Rendered procedurally on high-DPI <canvas> so zero external assets or CSP changes are needed,
// and dynamically applied to <link rel="icon">, <link rel="apple-touch-icon"> and in-app brand marks.

const cache = new Map();

export const APP_ICONS = [
  { id: 'classic', name: 'Vàng cổ điển', free: true, bg: ['#ffd84d', '#ffb400'], kind: 'classic', fg: '#141416' },
  { id: 'tet_horse', name: 'Tết Hồng Mã', bg: ['#d91c24', '#8e0910'], kind: 'tet', fg: '#ffd563' },
  { id: 'neon_gold_outline', name: 'Đen Viền Vàng', bg: ['#141416', '#050507'], kind: 'outline_glow', fg: '#ffd43b' },
  { id: 'dark_gold_3d', name: 'Đen Vàng 3D', bg: ['#1e1e22', '#09090b'], kind: 'puffy3d', fg: '#ffca28', hi: '#fff3b0' },

  { id: 'brushed_gold', name: 'Vàng Kim Xước', bg: ['#f5d97e', '#b98b27'], kind: 'brushed', fg: '#fff6d1' },
  { id: 'metal_gold', name: 'Vàng Ánh Kim', bg: ['#fff0b3', '#e0a216'], kind: 'puffy3d', fg: '#ffd13b', hi: '#ffffff' },
  { id: 'metal_pink', name: 'Hồng Ánh Kim', bg: ['#ffc4e8', '#d62887'], kind: 'puffy3d', fg: '#ff4da6', hi: '#fff0f8' },
  { id: 'metal_blue', name: 'Lam Ánh Kim', bg: ['#bae0ff', '#1d63dc'], kind: 'puffy3d', fg: '#3b82f6', hi: '#eff8ff' },

  { id: 'metal_green', name: 'Lục Bảo 3D', bg: ['#bbf7d0', '#159947'], kind: 'puffy3d', fg: '#22c55e', hi: '#f0fdf4' },
  { id: 'chrome_silver', name: 'Bạc Chrome', bg: ['#f4f5f8', '#9ea4b0'], kind: 'chrome', fg: '#d4d8e2' },
  { id: 'holo_blue', name: 'Pha Lê Băng', bg: ['#10131a', '#07080c'], kind: 'crystal', fg: '#7dd3fc', c2: '#c084fc' },
  { id: 'holo_pink', name: 'Pha Lê Hồng', bg: ['#f8fafc', '#e2e8f0'], kind: 'crystal', fg: '#f472b6', c2: '#60a5fa' },

  { id: 'holo_lavender', name: 'Pha Lê Tím', bg: ['#faf5ff', '#e9d5ff'], kind: 'crystal', fg: '#c084fc', c2: '#fb7185' },
  { id: 'glow_amber', name: 'Hào Quang Cam', bg: ['#19120c', '#090705'], kind: 'neon_aura', fg: '#ff8a00', c2: '#ffe600' },
  { id: 'glow_magenta', name: 'Hào Quang Tím', bg: ['#190b18', '#080408'], kind: 'neon_aura', fg: '#ff2cdf', c2: '#ffb8f6' },
  { id: 'glow_cyan', name: 'Hào Quang Băng', bg: ['#08181d', '#04090c'], kind: 'neon_aura', fg: '#00e5ff', c2: '#b8ffff' },

  { id: 'glow_lime', name: 'Hào Quang Xanh', bg: ['#0c1a0e', '#050906'], kind: 'neon_aura', fg: '#39ff14', c2: '#d9ffbf' },
  { id: 'notebook_sketch', name: 'Sổ Kẻ Vẽ Tay', bg: ['#fffef7', '#f5f2e6'], kind: 'notebook', fg: '#2563eb' },
  { id: 'petals_light', name: 'Hoa Sắc Sáng', bg: ['#ffffff', '#f1f5f9'], kind: 'petals', fg: '#ff5e9c' },
  { id: 'petals_dark', name: 'Hoa Sắc Tối', bg: ['#151518', '#070709'], kind: 'petals', fg: '#ff7ab8' },

  { id: 'ripple_gold', name: 'Sóng Tâm Vàng', bg: ['#ffe57f', '#f59e0b'], kind: 'ripple', fg: '#7c2d12' },
  { id: 'pendant_3d', name: 'Mặt Dây Locket', bg: ['#fffbeb', '#fde68a'], kind: 'pendant', fg: '#d97706' },
  { id: 'silk_gold', name: 'Lụa Sóng Vàng', bg: ['#fbbf24', '#b45309'], kind: 'silk', fg: '#ffffff', wave: '#fde68a' },
  { id: 'silk_obsidian', name: 'Lụa Sóng Đen', bg: ['#27272a', '#09090b'], kind: 'silk', fg: '#ffd43b', wave: '#52525b' },

  { id: 'silk_ocean', name: 'Lụa Sóng Biển', bg: ['#2563eb', '#1e1b4b'], kind: 'silk', fg: '#ffffff', wave: '#60a5fa' },
  { id: 'silk_violet', name: 'Lụa Sóng Tím', bg: ['#7c3aed', '#3b0764'], kind: 'silk', fg: '#ffffff', wave: '#c084fc' },
  { id: 'daisy_pink', name: 'Hoa Cúc Hồng', bg: ['#fbcfe8', '#f472b6'], kind: 'daisy', fg: '#ffffff', center: '#facc15' },
  { id: 'daisy_sky', name: 'Hoa Cúc Mây', bg: ['#bae6fd', '#38bdf8'], kind: 'daisy', fg: '#fef08a', center: '#fb7185' },

  { id: 'daisy_sunny', name: 'Hoa Cúc Nắng', bg: ['#fef08a', '#facc15'], kind: 'daisy', fg: '#ffffff', center: '#f97316' },
  { id: 'toon_pink', name: 'Hoạt Hình Hồng', bg: ['#bbf7d0', '#4ade80'], kind: 'toon', fg: '#ff6ec7' },
  { id: 'toon_gold', name: 'Hoạt Hình Vàng', bg: ['#e9d5ff', '#a855f7'], kind: 'toon', fg: '#facc15' },
  { id: 'rainbow_aura', name: 'Cầu Vồng Aura', bg: ['#fff7ed', '#fce7f3'], kind: 'rainbow', fg: '#ffffff' },
];

function heartPath(ctx, cx, cy, scale) {
  ctx.beginPath();
  const s = scale;
  ctx.moveTo(cx, cy + s * 0.72);
  ctx.bezierCurveTo(cx - s * 0.96, cy + s * 0.14, cx - s * 1.02, cy - s * 0.62, cx - s * 0.48, cy - s * 0.72);
  ctx.bezierCurveTo(cx - s * 0.18, cy - s * 0.78, cx - s * 0.04, cy - s * 0.56, cx, cy - s * 0.42);
  ctx.bezierCurveTo(cx + s * 0.04, cy - s * 0.56, cx + s * 0.18, cy - s * 0.78, cx + s * 0.48, cy - s * 0.72);
  ctx.bezierCurveTo(cx + s * 1.02, cy - s * 0.62, cx + s * 0.96, cy + s * 0.14, cx, cy + s * 0.72);
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawAppIcon(ctx, spec, size) {
  const s = size;
  const cx = s / 2;
  const cy = s * 0.52;
  const hs = s * 0.34;
  ctx.save();
  ctx.clearRect(0, 0, s, s);
  roundRect(ctx, 0, 0, s, s, s * 0.225);
  ctx.clip();

  // Base gradient
  const bgGrad = ctx.createLinearGradient(0, 0, s * 0.85, s);
  bgGrad.addColorStop(0, spec.bg[0]);
  bgGrad.addColorStop(1, spec.bg[1]);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, s, s);

  if (spec.kind === 'brushed') {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(1, s * 0.008);
    for (let y = 2; y < s; y += Math.max(3, s * 0.025)) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + (y % 2 ? 1.5 : -1.5));
      ctx.stroke();
    }
  } else if (spec.kind === 'notebook') {
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.35)';
    ctx.lineWidth = Math.max(1, s * 0.012);
    for (let y = s * 0.18; y < s; y += s * 0.14) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(248, 113, 113, 0.45)';
    ctx.beginPath(); ctx.moveTo(s * 0.18, 0); ctx.lineTo(s * 0.18, s); ctx.stroke();
  } else if (spec.kind === 'silk') {
    ctx.strokeStyle = spec.wave;
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = s * 0.09;
    for (let i = -1; i <= 3; i += 1) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.1, s * (0.2 + i * 0.24));
      ctx.bezierCurveTo(s * 0.35, s * (0.04 + i * 0.24), s * 0.65, s * (0.38 + i * 0.24), s * 1.1, s * (0.18 + i * 0.24));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (spec.kind === 'ripple') {
    for (let r = 1.75; r >= 1.15; r -= 0.28) {
      heartPath(ctx, cx, cy, hs * r);
      ctx.strokeStyle = 'rgba(124, 45, 18, 0.22)';
      ctx.lineWidth = s * 0.035;
      ctx.stroke();
    }
  } else if (spec.kind === 'rainbow') {
    const colors = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#5856d6', '#ff2d55'];
    colors.forEach((c, idx) => {
      const rg = ctx.createRadialGradient(
        cx + Math.cos((idx / colors.length) * Math.PI * 2) * s * 0.16,
        cy + Math.sin((idx / colors.length) * Math.PI * 2) * s * 0.16,
        s * 0.02,
        cx,
        cy,
        s * 0.48,
      );
      rg.addColorStop(0, c);
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, s, s);
    });
  } else if (spec.kind === 'tet') {
    // Festive gold blossoms in corners
    ctx.fillStyle = 'rgba(255, 213, 99, 0.26)';
    [[0.18, 0.2], [0.84, 0.22], [0.2, 0.82], [0.82, 0.8]].forEach(([px, py]) => {
      for (let a = 0; a < 5; a += 1) {
        const ang = (a * Math.PI * 2) / 5;
        ctx.beginPath();
        ctx.arc(s * px + Math.cos(ang) * s * 0.045, s * py + Math.sin(ang) * s * 0.045, s * 0.03, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Foreground artwork
  if (spec.kind === 'outline_glow') {
    ctx.save();
    ctx.shadowColor = spec.fg;
    ctx.shadowBlur = s * 0.14;
    heartPath(ctx, cx, cy, hs);
    ctx.strokeStyle = spec.fg;
    ctx.lineWidth = s * 0.065;
    ctx.stroke();
    ctx.restore();
  } else if (spec.kind === 'neon_aura') {
    ctx.save();
    const glow = ctx.createRadialGradient(cx, cy, s * 0.04, cx, cy, s * 0.46);
    glow.addColorStop(0, spec.c2);
    glow.addColorStop(0.45, spec.fg);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);
    heartPath(ctx, cx, cy, hs * 0.92);
    ctx.fillStyle = '#0b0b0e';
    ctx.fill();
    ctx.strokeStyle = spec.c2;
    ctx.lineWidth = s * 0.04;
    ctx.stroke();
    ctx.restore();
  } else if (spec.kind === 'puffy3d' || spec.kind === 'chrome' || spec.kind === 'brushed') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.34)';
    ctx.shadowBlur = s * 0.1;
    ctx.shadowOffsetY = s * 0.045;
    heartPath(ctx, cx, cy, hs);
    const hg = ctx.createLinearGradient(cx - hs, cy - hs, cx + hs, cy + hs);
    if (spec.kind === 'chrome') {
      hg.addColorStop(0, '#ffffff');
      hg.addColorStop(0.35, '#94a3b8');
      hg.addColorStop(0.55, '#f8fafc');
      hg.addColorStop(1, '#334155');
    } else {
      hg.addColorStop(0, spec.hi || '#ffffff');
      hg.addColorStop(0.5, spec.fg);
      hg.addColorStop(1, '#1f1f24');
    }
    ctx.fillStyle = hg;
    ctx.fill();
    ctx.restore();
    // Specular highlight
    ctx.save();
    heartPath(ctx, cx, cy, hs);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.beginPath();
    ctx.ellipse(cx - hs * 0.36, cy - hs * 0.36, hs * 0.26, hs * 0.13, -0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (spec.kind === 'crystal') {
    ctx.save();
    ctx.shadowColor = spec.fg;
    ctx.shadowBlur = s * 0.11;
    heartPath(ctx, cx, cy, hs * 1.02);
    const cg = ctx.createLinearGradient(cx - hs, cy - hs, cx + hs, cy + hs);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(0.42, spec.fg);
    cg.addColorStop(0.8, spec.c2);
    cg.addColorStop(1, '#ffffff');
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.clip();
    // Facet lines
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = Math.max(1, s * 0.014);
    ctx.beginPath();
    ctx.moveTo(cx, cy - hs); ctx.lineTo(cx, cy + hs);
    ctx.moveTo(cx - hs, cy - hs * 0.2); ctx.lineTo(cx + hs, cy + hs * 0.2);
    ctx.moveTo(cx + hs, cy - hs * 0.2); ctx.lineTo(cx - hs, cy + hs * 0.2);
    ctx.stroke();
    ctx.restore();
  } else if (spec.kind === 'notebook') {
    ctx.save();
    ctx.strokeStyle = spec.fg;
    ctx.lineWidth = s * 0.042;
    ctx.lineJoin = 'round';
    heartPath(ctx, cx, cy, hs * 0.96);
    ctx.stroke();
    heartPath(ctx, cx + s * 0.015, cy - s * 0.01, hs * 0.9);
    ctx.lineWidth = s * 0.02;
    ctx.stroke();
    ctx.restore();
  } else if (spec.kind === 'petals') {
    const palette = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#32ade6', '#af52de', '#ff2d55'];
    ctx.save();
    palette.forEach((col, idx) => {
      const ang = (idx / palette.length) * Math.PI * 2 - Math.PI / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * s * 0.13, cy + Math.sin(ang) * s * 0.13);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.17, s * 0.095, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.globalAlpha = 1;
    heartPath(ctx, cx, cy, hs * 0.56);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  } else if (spec.kind === 'pendant') {
    // Gold chain + locket heart medallion
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = s * 0.032;
    ctx.beginPath();
    ctx.moveTo(s * 0.18, 0);
    ctx.quadraticCurveTo(cx, s * 0.34, cx, cy - hs * 0.52);
    ctx.moveTo(s * 0.82, 0);
    ctx.quadraticCurveTo(cx, s * 0.34, cx, cy - hs * 0.52);
    ctx.stroke();
    ctx.save();
    ctx.shadowColor = 'rgba(180,83,9,0.35)';
    ctx.shadowBlur = s * 0.09;
    heartPath(ctx, cx, cy + s * 0.04, hs * 0.95);
    const pg = ctx.createLinearGradient(cx - hs, cy - hs, cx + hs, cy + hs);
    pg.addColorStop(0, '#fffbeb');
    pg.addColorStop(0.45, '#f59e0b');
    pg.addColorStop(1, '#92400e');
    ctx.fillStyle = pg;
    ctx.fill();
    ctx.strokeStyle = '#fef3c7';
    ctx.lineWidth = s * 0.025;
    ctx.stroke();
    ctx.restore();
  } else if (spec.kind === 'daisy') {
    ctx.save();
    const petals = 10;
    ctx.fillStyle = spec.fg;
    for (let i = 0; i < petals; i += 1) {
      const ang = (i / petals) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx + Math.cos(ang) * s * 0.19, cy + Math.sin(ang) * s * 0.19);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.14, s * 0.075, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    heartPath(ctx, cx, cy, hs * 0.62);
    ctx.fillStyle = spec.center;
    ctx.fill();
    ctx.restore();
  } else if (spec.kind === 'toon') {
    ctx.save();
    heartPath(ctx, cx + s * 0.025, cy + s * 0.03, hs);
    ctx.fillStyle = '#111113';
    ctx.fill();
    heartPath(ctx, cx, cy, hs);
    ctx.fillStyle = spec.fg;
    ctx.fill();
    ctx.lineWidth = s * 0.055;
    ctx.strokeStyle = '#111113';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx - hs * 0.34, cy - hs * 0.32, hs * 0.18, hs * 0.09, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    // classic / tet / ripple / silk / rainbow solid sculpted heart
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = s * 0.07;
    ctx.shadowOffsetY = s * 0.025;
    heartPath(ctx, cx, cy, hs);
    ctx.fillStyle = spec.fg;
    ctx.fill();
    if (spec.kind === 'classic') {
      // Inner subtle cutout keyhole / locket gleam
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.ellipse(cx - hs * 0.34, cy - hs * 0.34, hs * 0.18, hs * 0.09, -0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Subtle iOS squircle inner rim highlight
  roundRect(ctx, 0, 0, s, s, s * 0.225);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(1.5, s * 0.02);
  ctx.stroke();
  ctx.restore();
}

export function getAppIconSpec(id) {
  return APP_ICONS.find((item) => item.id === id) || APP_ICONS[0];
}

export function getAppIconDataUrl(id = 'classic', size = 160) {
  const spec = getAppIconSpec(id);
  const key = `${spec.id}:${size}`;
  if (cache.has(key)) return cache.get(key);
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawAppIcon(ctx, spec, size);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

export function syncDocumentAppIcon(iconId = 'classic', hasGold = false) {
  if (typeof document === 'undefined') return;
  const effectiveId = hasGold ? getAppIconSpec(iconId).id : 'classic';
  const url = effectiveId === 'classic' ? '/icons/icon-192.png' : getAppIconDataUrl(effectiveId, 192);
  if (!url) return;
  let fav = document.querySelector('link[rel="icon"]');
  if (!fav) {
    fav = document.createElement('link');
    fav.rel = 'icon';
    document.head.appendChild(fav);
  }
  fav.type = 'image/png';
  fav.href = url;

  let touch = document.querySelector('link[rel="apple-touch-icon"]');
  if (!touch) {
    touch = document.createElement('link');
    touch.rel = 'apple-touch-icon';
    document.head.appendChild(touch);
  }
  touch.href = url;
}
