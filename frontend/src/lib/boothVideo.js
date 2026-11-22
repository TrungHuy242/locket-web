// Animated Photobooth video exporter (1:1 square clip for Locket, <= 6s).
// Renders three motion styles directly from Canvas 2D via MediaRecorder so the video matches the booth frame.
import { centerCrop, filteredCanvas } from './filters.js';
import { pickMime } from './cameraMedia.js';
import { canvasToBlob, compose, composeBase, drawStickers, preloadBooth } from './photobooth.js';

export const VIDEO_STYLES = [
  { id: 'flash', name: 'Nháy từng ô', desc: 'Từng ảnh lần lượt chớp sáng hiện lên khung' },
  { id: 'slideshow', name: 'Phóng từng tấm', desc: 'Chiếu rõ từng ảnh rồi thu về toàn bộ khung' },
  { id: 'loop', name: 'Stop-motion', desc: 'Chuyển nhanh liên tục giữa các biểu cảm' },
];

export function canExportBoothVideo() {
  return typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    && !!pickMime();
}

function easeOutCubic(t) {
  return 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;
}

export async function renderBoothVideo({
  shots,
  opts,
  filter = 'none',
  amount = 1,
  takenAt = Date.now(),
  style = 'flash',
  size = 900,
  onProgress = null,
}) {
  const mime = pickMime();
  if (!mime || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    throw new Error('Trình duyệt này chưa hỗ trợ xuất video động Photobooth.');
  }

  const locketOpts = { ...opts, outputMode: 'locket' };
  await preloadBooth(locketOpts);
  const cellW = Math.round(size / 1.8);
  const adjust = locketOpts.adjust || null;

  // Pre-compose final full frame & per-step stages for buttery-smooth 30fps playback
  const finalFrame = compose(shots, locketOpts, { filter, amount, adjust, cellW, takenAt });
  const W = finalFrame.canvas.width;
  const H = finalFrame.canvas.height;
  const count = shots.length;

  // Full-square filtered shots for slideshow / stop-motion
  const fullShots = shots.map((shot) => {
    const f = shot.filter || filter;
    const a = shot.filter ? shot.amount ?? amount : amount;
    const img = shot.image;
    const sw = img.videoWidth || img.naturalWidth || img.width || 1;
    const sh = img.videoHeight || img.naturalHeight || img.height || 1;
    const crop = centerCrop(sw, sh, 1, shot.zoom || 1, shot.panX || 0, shot.panY || 0);
    return filteredCanvas(img, { filter: f, amount: a, width: W, height: H, crop, mirror: !!shot.flip, adjust });
  });

  // For 'flash' reveal: pre-render incremental frames (0..count revealed)
  const stageFrames = [];
  if (style === 'flash') {
    for (let k = 0; k <= count; k++) {
      const skip = new Set();
      for (let i = k; i < count; i++) skip.add(i);
      const { canvas, geometry: g } = composeBase(shots, locketOpts, { filter, amount, adjust, cellW, takenAt, skipCells: skip });
      drawStickers(canvas.getContext('2d'), locketOpts.stickers, g);
      stageFrames.push(canvas);
    }
  }

  const outCanvas = document.createElement('canvas');
  outCanvas.width = W;
  outCanvas.height = H;
  const ctx = outCanvas.getContext('2d');

  // Duration calculation (keep ~4.2 - 5.8s, snappy & well under Locket's 6MB cap)
  const stepMs = style === 'loop' ? 380 : 880;
  const cycles = style === 'loop' ? 2 : 1;
  const introMs = style === 'flash' ? 350 : 0;
  const holdMs = 1550;
  const totalMs = introMs + count * cycles * stepMs + holdMs;

  const stream = outCanvas.captureStream(30);
  const chunks = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    recorder.onerror = () => reject(new Error('Không thể mã hóa video Photobooth'));
  });

  const drawFrame = (elapsed) => {
    ctx.clearRect(0, 0, W, H);
    if (style === 'flash') {
      if (elapsed < introMs) {
        ctx.drawImage(stageFrames[0], 0, 0);
        return;
      }
      const t = elapsed - introMs;
      const revealDur = count * stepMs;
      if (t < revealDur) {
        const idx = Math.min(count - 1, Math.floor(t / stepMs));
        const local = (t - idx * stepMs) / stepMs;
        ctx.drawImage(stageFrames[idx + 1], 0, 0);
        // Subtle camera flash pop on the newly revealed cell
        const flashAlpha = Math.max(0, 1 - local * 3.4) * 0.72;
        if (flashAlpha > 0.01) {
          ctx.save();
          ctx.fillStyle = `rgba(255,255,255,${flashAlpha.toFixed(3)})`;
          const cell = finalFrame.geometry.cells[idx];
          if (cell) ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
          else ctx.fillRect(0, 0, W, H);
          ctx.restore();
        }
        return;
      }
      ctx.drawImage(finalFrame.canvas, 0, 0);
      return;
    }

    if (style === 'slideshow') {
      const slideDur = count * stepMs;
      if (elapsed < slideDur) {
        const idx = Math.min(count - 1, Math.floor(elapsed / stepMs));
        const local = (elapsed - idx * stepMs) / stepMs;
        const zoom = 1 + 0.07 * easeOutCubic(local);
        const dw = W * zoom;
        const dh = H * zoom;
        ctx.drawImage(fullShots[idx], (W - dw) / 2, (H - dh) / 2, dw, dh);
        // Soft flash transition at shot boundary
        if (local < 0.16) {
          ctx.fillStyle = `rgba(255,255,255,${((1 - local / 0.16) * 0.55).toFixed(3)})`;
          ctx.fillRect(0, 0, W, H);
        }
        return;
      }
      const holdLocal = Math.min(1, (elapsed - slideDur) / 380);
      const scale = 1.08 - 0.08 * easeOutCubic(holdLocal);
      const dw = W * scale;
      const dh = H * scale;
      ctx.drawImage(finalFrame.canvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return;
    }

    // style === 'loop' (Stop-motion)
    const loopDur = count * cycles * stepMs;
    if (elapsed < loopDur) {
      const step = Math.floor(elapsed / stepMs);
      const idx = step % count;
      ctx.drawImage(fullShots[idx], 0, 0, W, H);
      // Thin vintage border flash for stop-motion rhythm
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = W * 0.025;
      ctx.strokeRect(W * 0.0125, H * 0.0125, W * 0.975, H * 0.975);
      ctx.restore();
      return;
    }
    ctx.drawImage(finalFrame.canvas, 0, 0);
  };

  drawFrame(0);
  recorder.start(200);
  const startedAt = performance.now();

  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const frac = Math.min(1, elapsed / totalMs);
      drawFrame(elapsed);
      onProgress?.(frac);
      if (elapsed >= totalMs) {
        clearInterval(timer);
        resolve();
      }
    }, 1000 / 30);
  });

  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  const [video, image] = await Promise.all([
    done,
    canvasToBlob(finalFrame.canvas, 'image/jpeg', 0.95),
  ]);
  return { video, image, seconds: totalMs / 1000 };
}
