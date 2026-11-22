// Extracts a harmonious 2-stop gradient palette + readable text color from a same-origin album cover URL.

function toHex(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function mix(c, target, t) {
  return [c[0] + (target[0] - c[0]) * t, c[1] + (target[1] - c[1]) * t, c[2] + (target[2] - c[2]) * t];
}

function luminance(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

const cache = new Map();

export function extractAlbumPalette(imageUrl) {
  if (!imageUrl) return Promise.resolve({ colors: ['#1C1C1E', '#2C2C2E'], textColor: '#FFFFFF' });
  if (cache.has(imageUrl)) return Promise.resolve(cache.get(imageUrl));

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const fallback = { colors: ['#1C1C1E', '#2C2C2E'], textColor: '#FFFFFF' };
    const timer = setTimeout(() => resolve(fallback), 2500);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 16;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 16, 16);
        const { data } = ctx.getImageData(0, 0, 16, 16);
        let sumR = 0; let sumG = 0; let sumB = 0; let count = 0;
        let bestSat = -1;
        let accent = [42, 42, 48];
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
          if (data[i + 3] < 128) continue;
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const lum = luminance(r, g, b);
          // ignore near-black/near-white borders when averaging
          if (lum > 0.08 && lum < 0.94) {
            sumR += r; sumG += g; sumB += b; count += 1;
          }
          const sat = mx ? (mx - mn) / mx : 0;
          const score = sat * (1 - Math.abs(lum - 0.5) * 1.4);
          if (score > bestSat) { bestSat = score; accent = [r, g, b]; }
        }
        const avg = count ? [sumR / count, sumG / count, sumB / count] : accent;
        // Build a rich, readable Apple-Music-like 2-stop gradient
        const c1 = mix(accent, avg, 0.25);
        const c2 = mix(avg, [18, 18, 24], 0.42);
        const midLum = (luminance(...c1) + luminance(...c2)) / 2;
        const result = {
          colors: [toHex(...c1), toHex(...c2)],
          textColor: midLum > 0.66 ? '#111111' : '#FFFFFF',
        };
        cache.set(imageUrl, result);
        resolve(result);
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve(fallback); };
    img.src = imageUrl;
  });
}
