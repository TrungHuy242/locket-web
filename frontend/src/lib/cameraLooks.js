// Camera "Diện mạo" (AR Face Props & Die-Cut Sticker Looks) + Custom Look Cutout Studio + Face Tracker.
// Combines automatic live face/head tracking with manual drag, pinch/slider scale, and rotation,
// and composites directly onto captured 1020x1020 photos, Photobooth shots, and recorded 1080x1080 videos!

const CUSTOM_KEY = 'locket.customLooks.v1';
const spriteCache = new Map();

export const LOOK_CATEGORIES = [
  { id: 'custom', label: 'Của bạn' },
  { id: 'goofy', label: 'Goofy' },
  { id: 'looks', label: 'Looks' },
  { id: 'celebrate', label: 'Celebrate' },
  { id: 'cute', label: 'Cute' },
  { id: 'costumes', label: 'Costumes' },
];

// Anchor offsets relative to detected face center (cx, cy) and face width (fw),
// or default normalized stage coordinates when no face is in frame.
export const ANCHOR_PRESETS = {
  crown: { defaultX: 0.5, defaultY: 0.27, defaultScale: 0.48, faceDy: -0.62, faceScale: 1.38 },
  forehead: { defaultX: 0.5, defaultY: 0.36, defaultScale: 0.38, faceDy: -0.26, faceScale: 1.05 },
  eyes: { defaultX: 0.5, defaultY: 0.42, defaultScale: 0.4, faceDy: -0.1, faceScale: 1.12 },
  cheeks: { defaultX: 0.5, defaultY: 0.48, defaultScale: 0.48, faceDy: 0.02, faceScale: 1.32 },
  mouth: { defaultX: 0.5, defaultY: 0.57, defaultScale: 0.3, faceDy: 0.28, faceScale: 0.82 },
  chin: { defaultX: 0.5, defaultY: 0.62, defaultScale: 0.42, faceDy: 0.42, faceScale: 1.18 },
  free: { defaultX: 0.5, defaultY: 0.5, defaultScale: 0.38, faceDy: 0, faceScale: 1.0 },
};

export const BUILTIN_LOOKS = [
  // Goofy
  { id: 'okay_wig', cat: 'goofy', name: 'Okay Wig', anchor: 'crown', draw: 'wig_bowl' },
  { id: 'influencer', cat: 'goofy', name: 'Influencer', anchor: 'mouth', draw: 'glam_lips' },
  { id: 'looks_maxxing', cat: 'goofy', name: 'Looks-Maxxing', anchor: 'eyes', draw: 'cool_shades' },
  { id: 'toothless', cat: 'goofy', name: 'Toothless', anchor: 'mouth', draw: 'gap_grin' },
  { id: 'bye_brows', cat: 'goofy', name: 'Bye Brows', anchor: 'forehead', draw: 'bold_brows' },

  // Looks
  { id: 'bowling_ball', cat: 'looks', name: 'Bowling Ball', anchor: 'crown', draw: 'bowling_helmet' },
  { id: 'blonde_bleached', cat: 'looks', name: 'Blonde & Bleached', anchor: 'crown', draw: 'blonde_spikes' },
  { id: 'beard', cat: 'looks', name: 'Beard', anchor: 'chin', draw: 'full_beard' },
  { id: 'bob_cut', cat: 'looks', name: 'Bob Cut', anchor: 'crown', draw: 'bob_hair' },
  { id: 'buns', cat: 'looks', name: 'Buns', anchor: 'crown', draw: 'space_buns' },

  // Celebrate
  { id: 'slimed', cat: 'celebrate', name: 'Slimed', anchor: 'crown', draw: 'slime_drip' },
  { id: 'princess', cat: 'celebrate', name: 'Princess', anchor: 'crown', draw: 'tiara' },
  { id: 'disco', cat: 'celebrate', name: 'Disco', anchor: 'crown', draw: 'disco_headband' },
  { id: 'cash_money', cat: 'celebrate', name: 'Ca$h Money', anchor: 'eyes', draw: 'dollar_shades' },
  { id: 'happy_bday', cat: 'celebrate', name: 'Happy Birthday', anchor: 'crown', draw: 'bday_hat' },

  // Cute
  { id: 'cutesy', cat: 'cute', name: 'Cutesy', anchor: 'cheeks', draw: 'coquette_blush' },
  { id: 'sticker_face', cat: 'cute', name: 'Sticker Face', anchor: 'cheeks', draw: 'cheek_stickers' },
  { id: 'flower_crown', cat: 'cute', name: 'Flower Crown', anchor: 'crown', draw: 'floral_crown' },
  { id: 'love_bug', cat: 'cute', name: 'Love Bug', anchor: 'eyes', draw: 'heart_glasses' },

  // Costumes
  { id: 'bunny_ears', cat: 'costumes', name: 'Bunny Ears', anchor: 'crown', draw: 'bunny_ears' },
  { id: 'cat_whiskers', cat: 'costumes', name: 'Cat Whiskers', anchor: 'cheeks', draw: 'cat_set' },
  { id: 'cyber_visor', cat: 'costumes', name: 'Cyber Visor', anchor: 'eyes', draw: 'cyber_visor' },
  { id: 'pirate_captain', cat: 'costumes', name: 'Pirate Hat', anchor: 'crown', draw: 'pirate_hat' },
  { id: 'alien_boppers', cat: 'costumes', name: 'Alien', anchor: 'crown', draw: 'alien_antenna' },
];

export function loadCustomLooks() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && x.id && x.dataUrl) : [];
  } catch {
    return [];
  }
}

export function saveCustomLooks(list) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, 24)));
  } catch { /* quota */ }
}

export function deleteCustomLook(id) {
  const next = loadCustomLooks().filter((x) => x.id !== id);
  saveCustomLooks(next);
  spriteCache.delete(id);
  return next;
}

// Wrap any transparent artwork canvas in a crisp white die-cut vinyl sticker outline + soft shadow!
function wrapWithDieCutBorder(artCanvas, borderPx = 8) {
  const w = artCanvas.width;
  const h = artCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');

  // Build white silhouette copy
  const sil = document.createElement('canvas');
  sil.width = w;
  sil.height = h;
  const sctx = sil.getContext('2d');
  sctx.drawImage(artCanvas, 0, 0);
  sctx.globalCompositeOperation = 'source-in';
  sctx.fillStyle = '#ffffff';
  sctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.36)';
  ctx.shadowBlur = borderPx * 1.4;
  ctx.shadowOffsetY = borderPx * 0.4;
  const steps = 16;
  for (let i = 0; i < steps; i += 1) {
    const ang = (i / steps) * Math.PI * 2;
    ctx.drawImage(sil, Math.cos(ang) * borderPx, Math.sin(ang) * borderPx);
  }
  ctx.restore();
  for (let i = 0; i < steps; i += 1) {
    const ang = (i / steps) * Math.PI * 2;
    ctx.drawImage(sil, Math.cos(ang) * (borderPx * 0.6), Math.sin(ang) * (borderPx * 0.6));
  }
  ctx.drawImage(artCanvas, 0, 0);
  return out;
}

function drawVectorProp(ctx, kind, s) {
  const cx = s / 2;
  const cy = s / 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'wig_bowl': {
      const g = ctx.createLinearGradient(0, s * 0.14, 0, s * 0.72);
      g.addColorStop(0, '#6b4226');
      g.addColorStop(1, '#3b2110');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.08, s * 0.36, Math.PI * 0.96, Math.PI * 2.04);
      ctx.quadraticCurveTo(cx + s * 0.38, cy + s * 0.28, cx + s * 0.3, cy + s * 0.32);
      ctx.lineTo(cx - s * 0.3, cy + s * 0.32);
      ctx.quadraticCurveTo(cx - s * 0.38, cy + s * 0.28, cx - s * 0.36, cy + s * 0.08);
      ctx.fill();
      // Shine streak
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = s * 0.035;
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.08, s * 0.28, Math.PI * 1.18, Math.PI * 1.82);
      ctx.stroke();
      break;
    }
    case 'glam_lips': {
      ctx.fillStyle = '#e11d48';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.34, cy);
      ctx.quadraticCurveTo(cx - s * 0.16, cy - s * 0.24, cx, cy - s * 0.09);
      ctx.quadraticCurveTo(cx + s * 0.16, cy - s * 0.24, cx + s * 0.34, cy);
      ctx.quadraticCurveTo(cx, cy + s * 0.32, cx - s * 0.34, cy);
      ctx.fill();
      ctx.strokeStyle = '#881337';
      ctx.lineWidth = s * 0.022;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.31, cy + s * 0.01);
      ctx.quadraticCurveTo(cx, cy + s * 0.06, cx + s * 0.31, cy + s * 0.01);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.68)';
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.1, cy + s * 0.09, s * 0.08, s * 0.03, -0.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cool_shades': {
      ctx.fillStyle = '#111827';
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = s * 0.026;
      // Left & right angular lenses
      const lens = (lx, dir) => {
        ctx.beginPath();
        ctx.moveTo(lx - dir * s * 0.18, cy - s * 0.1);
        ctx.lineTo(lx + dir * s * 0.17, cy - s * 0.07);
        ctx.lineTo(lx + dir * s * 0.14, cy + s * 0.12);
        ctx.lineTo(lx - dir * s * 0.15, cy + s * 0.09);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      lens(cx - s * 0.2, 1);
      lens(cx + s * 0.2, -1);
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.04, cy - s * 0.06);
      ctx.lineTo(cx + s * 0.04, cy - s * 0.06);
      ctx.stroke();
      // Sparkle glint
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(s * 0.14)}px sans-serif`;
      ctx.fillText('✦', cx + s * 0.22, cy - s * 0.02);
      break;
    }
    case 'gap_grin': {
      ctx.fillStyle = '#7f1d1d';
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 0.32, s * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      // White teeth with goofy missing center tooth!
      ctx.fillStyle = '#ffffff';
      [-0.22, -0.11, 0.11, 0.22].forEach((ox) => {
        ctx.fillRect(cx + s * ox - s * 0.04, cy - s * 0.14, s * 0.08, s * 0.12);
      });
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = s * 0.04;
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 0.32, s * 0.18, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'bold_brows': {
      ctx.fillStyle = '#1f2937';
      const brow = (bx, rot) => {
        ctx.save();
        ctx.translate(bx, cy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.roundRect(-s * 0.16, -s * 0.05, s * 0.32, s * 0.09, s * 0.045);
        ctx.fill();
        ctx.restore();
      };
      brow(cx - s * 0.21, -0.18);
      brow(cx + s * 0.21, 0.18);
      break;
    }
    case 'bowling_helmet': {
      const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.1, s * 0.04, cx, cy, s * 0.38);
      g.addColorStop(0, '#c084fc');
      g.addColorStop(0.55, '#6b21a8');
      g.addColorStop(1, '#2e1065');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.05, s * 0.34, Math.PI * 0.9, Math.PI * 2.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1e1b4b';
      [[-0.06, -0.1], [0.06, -0.1], [0, -0.01]].forEach(([ox, oy]) => {
        ctx.beginPath(); ctx.arc(cx + s * ox, cy + s * oy, s * 0.028, 0, Math.PI * 2); ctx.fill();
      });
      break;
    }
    case 'blonde_spikes': {
      ctx.fillStyle = '#fef08a';
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = s * 0.02;
      ctx.beginPath();
      const spikes = [
        [-0.36, 0.2], [-0.34, -0.08], [-0.22, 0.02], [-0.18, -0.24],
        [-0.05, -0.06], [0, -0.3], [0.07, -0.06], [0.2, -0.24],
        [0.23, 0.02], [0.35, -0.06], [0.36, 0.2],
      ];
      ctx.moveTo(cx + s * spikes[0][0], cy + s * spikes[0][1]);
      spikes.slice(1).forEach(([x, y]) => ctx.lineTo(cx + s * x, cy + s * y));
      ctx.quadraticCurveTo(cx, cy + s * 0.06, cx + s * spikes[0][0], cy + s * spikes[0][1]);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'full_beard': {
      ctx.fillStyle = '#451a03';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.34, cy - s * 0.16);
      ctx.quadraticCurveTo(cx - s * 0.38, cy + s * 0.3, cx, cy + s * 0.34);
      ctx.quadraticCurveTo(cx + s * 0.38, cy + s * 0.3, cx + s * 0.34, cy - s * 0.16);
      ctx.quadraticCurveTo(cx + s * 0.18, cy - s * 0.02, cx + s * 0.14, cy - s * 0.08);
      ctx.quadraticCurveTo(cx, cy - s * 0.16, cx - s * 0.14, cy - s * 0.08);
      ctx.quadraticCurveTo(cx - s * 0.18, cy - s * 0.02, cx - s * 0.34, cy - s * 0.16);
      ctx.fill();
      break;
    }
    case 'bob_hair': {
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.08, s * 0.37, Math.PI, 0);
      ctx.quadraticCurveTo(cx + s * 0.4, cy + s * 0.38, cx + s * 0.26, cy + s * 0.42);
      ctx.lineTo(cx + s * 0.24, cy + s * 0.05);
      ctx.lineTo(cx - s * 0.24, cy + s * 0.05);
      ctx.lineTo(cx - s * 0.26, cy + s * 0.42);
      ctx.quadraticCurveTo(cx - s * 0.4, cy + s * 0.38, cx - s * 0.37, cy + s * 0.08);
      ctx.fill();
      break;
    }
    case 'space_buns': {
      ctx.fillStyle = '#3f2314';
      [[-0.26, -0.06], [0.26, -0.06]].forEach(([bx, by]) => {
        ctx.beginPath(); ctx.arc(cx + s * bx, cy + s * by, s * 0.15, 0, Math.PI * 2); ctx.fill();
      });
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.14, s * 0.3, Math.PI * 1.08, Math.PI * 1.92);
      ctx.lineWidth = s * 0.09;
      ctx.strokeStyle = '#3f2314';
      ctx.stroke();
      // Cute pink bows on buns
      ctx.fillStyle = '#f472b6';
      [-0.26, 0.26].forEach((bx) => {
        ctx.beginPath();
        ctx.ellipse(cx + s * (bx - 0.05), cy + s * 0.06, s * 0.05, s * 0.03, -0.3, 0, Math.PI * 2);
        ctx.ellipse(cx + s * (bx + 0.05), cy + s * 0.06, s * 0.05, s * 0.03, 0.3, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'slime_drip': {
      ctx.fillStyle = '#65a30d';
      const lg = ctx.createLinearGradient(0, s * 0.15, 0, s * 0.78);
      lg.addColorStop(0, '#a3e635');
      lg.addColorStop(1, '#4d7c0f');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.36, cy - s * 0.02);
      ctx.quadraticCurveTo(cx, cy - s * 0.34, cx + s * 0.36, cy - s * 0.02);
      const drips = [0.32, 0.22, 0.1, 0, -0.12, -0.24, -0.34];
      const depths = [0.18, 0.04, 0.28, 0.06, 0.24, 0.05, 0.16];
      drips.forEach((dx, idx) => {
        ctx.quadraticCurveTo(cx + s * dx, cy + s * depths[idx], cx + s * (drips[idx + 1] ?? -0.36), cy + s * 0.04);
      });
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'tiara': {
      const tg = ctx.createLinearGradient(cx - s * 0.3, cy - s * 0.2, cx + s * 0.3, cy + s * 0.2);
      tg.addColorStop(0, '#fef08a');
      tg.addColorStop(0.5, '#facc15');
      tg.addColorStop(1, '#ca8a04');
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.32, cy + s * 0.16);
      ctx.lineTo(cx - s * 0.26, cy - s * 0.06);
      ctx.lineTo(cx - s * 0.13, cy + s * 0.06);
      ctx.lineTo(cx, cy - s * 0.24);
      ctx.lineTo(cx + s * 0.13, cy + s * 0.06);
      ctx.lineTo(cx + s * 0.26, cy - s * 0.06);
      ctx.lineTo(cx + s * 0.32, cy + s * 0.16);
      ctx.closePath();
      ctx.fill();
      // Pink & cyan jewels
      ctx.fillStyle = '#ec4899';
      ctx.beginPath(); ctx.arc(cx, cy - s * 0.02, s * 0.045, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#38bdf8';
      [-0.17, 0.17].forEach((ox) => {
        ctx.beginPath(); ctx.arc(cx + s * ox, cy + s * 0.06, s * 0.03, 0, Math.PI * 2); ctx.fill();
      });
      break;
    }
    case 'disco_headband': {
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = s * 0.035;
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.18, s * 0.28, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      [-0.2, 0.2].forEach((ox) => {
        const bx = cx + s * ox;
        const by = cy - s * 0.12;
        const rg = ctx.createRadialGradient(bx - s * 0.03, by - s * 0.03, s * 0.01, bx, by, s * 0.11);
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(0.6, '#94a3b8');
        rg.addColorStop(1, '#334155');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(bx, by, s * 0.11, 0, Math.PI * 2); ctx.fill();
      });
      break;
    }
    case 'dollar_shades': {
      ctx.fillStyle = '#15803d';
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = s * 0.03;
      [-0.19, 0.19].forEach((ox) => {
        ctx.beginPath();
        ctx.roundRect(cx + s * ox - s * 0.15, cy - s * 0.11, s * 0.3, s * 0.22, s * 0.05);
        ctx.fill();
        ctx.stroke();
      });
      ctx.fillStyle = '#fde047';
      ctx.font = `900 ${Math.round(s * 0.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', cx - s * 0.19, cy + s * 0.01);
      ctx.fillText('$', cx + s * 0.19, cy + s * 0.01);
      break;
    }
    case 'bday_hat': {
      const hg = ctx.createLinearGradient(cx, cy - s * 0.32, cx, cy + s * 0.22);
      hg.addColorStop(0, '#f43f5e');
      hg.addColorStop(0.5, '#facc15');
      hg.addColorStop(1, '#3b82f6');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.3);
      ctx.lineTo(cx - s * 0.24, cy + s * 0.22);
      ctx.lineTo(cx + s * 0.24, cy + s * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fde047';
      ctx.beginPath(); ctx.arc(cx, cy - s * 0.31, s * 0.065, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(s * 0.1)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('HBD!', cx, cy + s * 0.14);
      break;
    }
    case 'coquette_blush': {
      // Rosy blush cheeks + top pink bow
      [-0.26, 0.26].forEach((ox) => {
        const rg = ctx.createRadialGradient(cx + s * ox, cy + s * 0.08, s * 0.01, cx + s * ox, cy + s * 0.08, s * 0.12);
        rg.addColorStop(0, 'rgba(251, 113, 133, 0.85)');
        rg.addColorStop(1, 'rgba(251, 113, 133, 0)');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(cx + s * ox, cy + s * 0.08, s * 0.12, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.09, cy - s * 0.24, s * 0.09, s * 0.055, -0.3, 0, Math.PI * 2);
      ctx.ellipse(cx + s * 0.09, cy - s * 0.24, s * 0.09, s * 0.055, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ec4899';
      ctx.beginPath(); ctx.arc(cx, cy - s * 0.24, s * 0.035, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'cheek_stickers': {
      ctx.font = `${Math.round(s * 0.14)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⭐', cx - s * 0.27, cy + s * 0.02);
      ctx.fillText('💖', cx + s * 0.27, cy + s * 0.02);
      ctx.fillText('🌸', cx - s * 0.2, cy + s * 0.14);
      ctx.fillText('✨', cx + s * 0.2, cy + s * 0.14);
      ctx.fillText('🦋', cx, cy - s * 0.22);
      break;
    }
    case 'floral_crown': {
      const cols = ['#f472b6', '#fbbf24', '#a78bfa', '#fb7185', '#34d399'];
      for (let i = -2; i <= 2; i += 1) {
        const fx = cx + i * s * 0.14;
        const fy = cy + Math.abs(i) * s * 0.03;
        ctx.fillStyle = cols[i + 2];
        for (let p = 0; p < 5; p += 1) {
          const a = (p / 5) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(a) * s * 0.045, fy + Math.sin(a) * s * 0.045, s * 0.038, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#fef08a';
        ctx.beginPath(); ctx.arc(fx, fy, s * 0.028, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'heart_glasses': {
      const miniHeart = (hx, hy, hs) => {
        ctx.beginPath();
        ctx.moveTo(hx, hy + hs * 0.7);
        ctx.bezierCurveTo(hx - hs, hy + hs * 0.1, hx - hs, hy - hs * 0.65, hx - hs * 0.48, hy - hs * 0.72);
        ctx.bezierCurveTo(hx - hs * 0.16, hy - hs * 0.76, hx, hy - hs * 0.45, hx, hy - hs * 0.4);
        ctx.bezierCurveTo(hx, hy - hs * 0.45, hx + hs * 0.16, hy - hs * 0.76, hx + hs * 0.48, hy - hs * 0.72);
        ctx.bezierCurveTo(hx + hs, hy - hs * 0.65, hx + hs, hy + hs * 0.1, hx, hy + hs * 0.7);
        ctx.closePath();
      };
      ctx.fillStyle = 'rgba(244, 63, 94, 0.85)';
      ctx.strokeStyle = '#ffe4e6';
      ctx.lineWidth = s * 0.028;
      [-0.19, 0.19].forEach((ox) => {
        miniHeart(cx + s * ox, cy, s * 0.17);
        ctx.fill();
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.04, cy - s * 0.03);
      ctx.lineTo(cx + s * 0.04, cy - s * 0.03);
      ctx.stroke();
      break;
    }
    case 'bunny_ears': {
      [-0.16, 0.16].forEach((ox, idx) => {
        ctx.save();
        ctx.translate(cx + s * ox, cy + s * 0.02);
        ctx.rotate(idx === 0 ? -0.14 : 0.14);
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath(); ctx.ellipse(0, -s * 0.1, s * 0.095, s * 0.25, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fbcfe8';
        ctx.beginPath(); ctx.ellipse(0, -s * 0.09, s * 0.05, s * 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      });
      break;
    }
    case 'cat_set': {
      // Pink nose + whiskers
      ctx.fillStyle = '#fb7185';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.05, cy - s * 0.02);
      ctx.lineTo(cx + s * 0.05, cy - s * 0.02);
      ctx.lineTo(cx, cy + s * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = s * 0.022;
      [-1, 1].forEach((dir) => {
        [-0.04, 0.02, 0.08].forEach((wy) => {
          ctx.beginPath();
          ctx.moveTo(cx + dir * s * 0.12, cy + s * wy);
          ctx.lineTo(cx + dir * s * 0.34, cy + s * (wy + (wy - 0.02) * 0.6));
          ctx.stroke();
        });
      });
      break;
    }
    case 'cyber_visor': {
      const vg = ctx.createLinearGradient(cx - s * 0.36, cy, cx + s * 0.36, cy);
      vg.addColorStop(0, '#06b6d4');
      vg.addColorStop(0.5, '#a855f7');
      vg.addColorStop(1, '#ec4899');
      ctx.fillStyle = vg;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.36, cy - s * 0.09);
      ctx.lineTo(cx + s * 0.36, cy - s * 0.09);
      ctx.lineTo(cx + s * 0.3, cy + s * 0.1);
      ctx.lineTo(cx + s * 0.06, cy + s * 0.04);
      ctx.lineTo(cx, cy + s * 0.11);
      ctx.lineTo(cx - s * 0.06, cy + s * 0.04);
      ctx.lineTo(cx - s * 0.3, cy + s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = s * 0.02;
      ctx.stroke();
      break;
    }
    case 'pirate_hat': {
      ctx.fillStyle = '#18181b';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.4, cy + s * 0.14);
      ctx.quadraticCurveTo(cx, cy - s * 0.36, cx + s * 0.4, cy + s * 0.14);
      ctx.quadraticCurveTo(cx, cy + s * 0.22, cx - s * 0.4, cy + s * 0.14);
      ctx.fill();
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = s * 0.025;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.round(s * 0.16)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('☠️', cx, cy + s * 0.07);
      break;
    }
    default: {
      // alien_antenna
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = s * 0.032;
      [-0.18, 0.18].forEach((ox) => {
        ctx.beginPath();
        ctx.moveTo(cx + s * (ox * 0.5), cy + s * 0.2);
        ctx.quadraticCurveTo(cx + s * ox * 1.2, cy, cx + s * ox, cy - s * 0.18);
        ctx.stroke();
        ctx.fillStyle = '#86efac';
        ctx.beginPath();
        ctx.arc(cx + s * ox, cy - s * 0.2, s * 0.065, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
  }
}

export function getLookSprite(look, size = 280) {
  if (!look || typeof document === 'undefined') return null;
  const key = `${look.id}:${size}`;
  if (spriteCache.has(key)) return spriteCache.get(key);

  if (look.dataUrl) {
    // Custom look stored as dataUrl: return an Image element once decoded
    const img = new Image();
    img.src = look.dataUrl;
    spriteCache.set(key, img);
    return img;
  }

  const raw = document.createElement('canvas');
  raw.width = size;
  raw.height = size;
  drawVectorProp(raw.getContext('2d'), look.draw, size);
  const outlined = wrapWithDieCutBorder(raw, Math.max(4, Math.round(size * 0.03)));
  spriteCache.set(key, outlined);
  return outlined;
}

export function getLookThumbUrl(look) {
  if (!look) return '';
  if (look.dataUrl) return look.dataUrl;
  const key = `thumb:${look.id}`;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const canvas = getLookSprite(look, 160);
  const url = canvas?.toDataURL ? canvas.toDataURL('image/png') : '';
  spriteCache.set(key, url);
  return url;
}

export function getAllLooks() {
  return [...loadCustomLooks(), ...BUILTIN_LOOKS];
}

// Create a custom die-cut sticker look from an uploaded image file!
export async function createCustomLookFromFile(file, { name = 'Diện mạo mới', anchor = 'crown', removeBg = true } = {}) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const size = 280;
    const pad = 26;
    const inner = size - pad * 2;
    const art = document.createElement('canvas');
    art.width = size;
    art.height = size;
    const ctx = art.getContext('2d');

    const ratio = Math.min(inner / bitmap.width, inner / bitmap.height);
    const dw = Math.round(bitmap.width * ratio);
    const dh = Math.round(bitmap.height * ratio);
    const dx = Math.round((size - dw) / 2);
    const dy = Math.round((size - dh) / 2);
    ctx.drawImage(bitmap, dx, dy, dw, dh);

    if (removeBg) {
      // Sample 4 corners of drawn region and key out close background pixels smoothly
      const imgData = ctx.getImageData(dx, dy, dw, dh);
      const d = imgData.data;
      const samples = [
        0,
        (dw - 1) * 4,
        (dh - 1) * dw * 4,
        ((dh - 1) * dw + (dw - 1)) * 4,
      ];
      let sr = 0; let sg = 0; let sb = 0; let sa = 0;
      samples.forEach((idx) => {
        sr += d[idx]; sg += d[idx + 1]; sb += d[idx + 2]; sa += d[idx + 3];
      });
      sr /= 4; sg /= 4; sb /= 4; sa /= 4;
      // Only remove background if corners are opaque (not already a transparent PNG)
      if (sa > 200) {
        const thresh = 44;
        for (let i = 0; i < d.length; i += 4) {
          const dist = Math.hypot(d[i] - sr, d[i + 1] - sg, d[i + 2] - sb);
          if (dist < thresh) {
            d[i + 3] = 0;
          } else if (dist < thresh + 18) {
            d[i + 3] = Math.round(((dist - thresh) / 18) * d[i + 3]);
          }
        }
        ctx.putImageData(imgData, dx, dy);
      }
    }

    const cut = wrapWithDieCutBorder(art, 8);
    const dataUrl = cut.toDataURL('image/webp', 0.9);
    const item = {
      id: `custom_${Date.now().toString(36)}`,
      cat: 'custom',
      name: (name || 'Diện mạo mới').trim().slice(0, 28),
      anchor: ANCHOR_PRESETS[anchor] ? anchor : 'crown',
      dataUrl,
    };
    const next = [item, ...loadCustomLooks()].slice(0, 24);
    saveCustomLooks(next);
    return item;
  } finally {
    bitmap.close?.();
  }
}

export function createCustomLookFromEmoji(text, { name = '', anchor = 'crown' } = {}) {
  const clean = (text || '😎').trim().slice(0, 10);
  const size = 280;
  const art = document.createElement('canvas');
  art.width = size;
  art.height = size;
  const ctx = art.getContext('2d');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${clean.length <= 2 ? 148 : 68}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  ctx.fillStyle = '#111113';
  ctx.fillText(clean, size / 2, size / 2 + 4);
  const cut = wrapWithDieCutBorder(art, 9);
  const item = {
    id: `custom_${Date.now().toString(36)}`,
    cat: 'custom',
    name: (name || clean).trim().slice(0, 28),
    anchor: ANCHOR_PRESETS[anchor] ? anchor : 'crown',
    dataUrl: cut.toDataURL('image/webp', 0.9),
  };
  const next = [item, ...loadCustomLooks()].slice(0, 24);
  saveCustomLooks(next);
  return item;
}

// Compute normalized (0..1) center, width, and rotation (radians) of the active Look inside the 1:1 square stage
export function resolveLookPlacement(look, faceBox, manual) {
  if (!look) return null;
  const preset = ANCHOR_PRESETS[look.anchor] || ANCHOR_PRESETS.crown;
  const dx = manual?.dx || 0;
  const dy = manual?.dy || 0;
  const scaleMul = manual?.scale || 1;
  const rot = manual?.rot || 0;

  if (faceBox && faceBox.w > 0.06) {
    const cx = faceBox.cx + dx;
    const cy = faceBox.cy + faceBox.w * preset.faceDy + dy;
    const size = Math.min(0.95, Math.max(0.14, faceBox.w * preset.faceScale * scaleMul));
    return { cx, cy, size, rot: (faceBox.roll || 0) + rot };
  }
  return {
    cx: preset.defaultX + dx,
    cy: preset.defaultY + dy,
    size: Math.min(0.95, Math.max(0.14, preset.defaultScale * scaleMul)),
    rot,
  };
}

export function drawLookOnSquareCanvas(ctx, canvasSize, look, faceBox, manual) {
  if (!look || !ctx) return;
  const sprite = getLookSprite(look, 320);
  if (!sprite) return;
  if (sprite instanceof HTMLImageElement && !sprite.complete) return;
  const p = resolveLookPlacement(look, faceBox, manual);
  if (!p) return;
  const px = p.cx * canvasSize;
  const py = p.cy * canvasSize;
  const drawSize = p.size * canvasSize;
  ctx.save();
  ctx.translate(px, py);
  if (p.rot) ctx.rotate(p.rot);
  ctx.drawImage(sprite, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
  ctx.restore();
}

// Lightweight Face Tracker: uses native FaceDetector API when available, with a fast 72x72 skin-centroid
// fallback so props smoothly follow head motion across Chrome, Edge, Safari, and Firefox!
export function createLiveFaceTracker() {
  let nativeDetector = null;
  if (typeof window !== 'undefined' && 'FaceDetector' in window) {
    try {
      // eslint-disable-next-line no-undef
      nativeDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
    } catch {
      nativeDetector = null;
    }
  }
  const probe = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (probe) { probe.width = 72; probe.height = 72; }
  const pctx = probe?.getContext('2d', { willReadFrequently: true });
  let smooth = null;
  let busy = false;

  const lerp = (a, b, t) => a + (b - a) * t;

  async function detect(video, { mirror = true, zoomBy = 1 } = {}) {
    if (busy || !video || video.readyState < 2 || !video.videoWidth || !probe || !pctx) return smooth;
    busy = true;
    try {
      // Draw the exact square crop seen in the viewfinder into the 72x72 probe
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const side = Math.min(vw, vh) / Math.max(1, zoomBy);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      pctx.save();
      pctx.clearRect(0, 0, 72, 72);
      if (mirror) {
        pctx.translate(72, 0);
        pctx.scale(-1, 1);
      }
      pctx.drawImage(video, sx, sy, side, side, 0, 0, 72, 72);
      pctx.restore();

      let rawBox = null;
      if (nativeDetector) {
        try {
          const faces = await nativeDetector.detect(probe);
          if (faces && faces.length) {
            const b = faces[0].boundingBox;
            let roll = 0;
            const lm = faces[0].landmarks || [];
            const eyes = lm.filter((l) => l.type === 'eye');
            if (eyes.length >= 2 && eyes[0].locations?.[0] && eyes[1].locations?.[0]) {
              const [e1, e2] = [eyes[0].locations[0], eyes[1].locations[0]].sort((a, c) => a.x - c.x);
              roll = Math.atan2(e2.y - e1.y, e2.x - e1.x) * 0.7;
            }
            rawBox = {
              cx: (b.x + b.width / 2) / 72,
              cy: (b.y + b.height / 2) / 72,
              w: b.width / 72,
              roll,
            };
          }
        } catch {
          nativeDetector = null;
        }
      }

      // Skin-tone centroid fallback when FaceDetector is unavailable in browser
      if (!rawBox) {
        const data = pctx.getImageData(0, 0, 72, 72).data;
        let sumX = 0; let sumY = 0; let count = 0;
        let minX = 72; let maxX = 0;
        for (let y = 8; y < 64; y += 2) {
          for (let x = 8; x < 64; x += 2) {
            const i = (y * 72 + x) * 4;
            const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
            // YCbCr skin cluster check
            const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
            const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
            if (r > 65 && g > 40 && b > 25 && r > b && cr >= 134 && cr <= 176 && cb >= 80 && cb <= 128) {
              sumX += x;
              sumY += y;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              count += 1;
            }
          }
        }
        if (count >= 28 && count <= 520) {
          const spanW = Math.min(0.56, Math.max(0.24, ((maxX - minX) / 72) * 0.85));
          rawBox = {
            cx: sumX / count / 72,
            cy: sumY / count / 72,
            w: spanW,
            roll: 0,
          };
        }
      }

      if (rawBox) {
        smooth = smooth
          ? {
            cx: lerp(smooth.cx, rawBox.cx, 0.38),
            cy: lerp(smooth.cy, rawBox.cy, 0.38),
            w: lerp(smooth.w, rawBox.w, 0.3),
            roll: lerp(smooth.roll || 0, rawBox.roll || 0, 0.35),
          }
          : rawBox;
      }
      return smooth;
    } finally {
      busy = false;
    }
  }

  return {
    detect,
    get: () => smooth,
    reset: () => { smooth = null; },
  };
}
