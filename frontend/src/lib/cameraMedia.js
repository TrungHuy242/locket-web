// Media constants and canvas/video helpers shared by CameraPage.

export const PHOTO_SIZE = 1020;
export const VIDEO_SIZE = 1080;
export const VIDEO_BITRATE = 8_000_000;
export const MAX_RECORD_MS = 10000;
export const CLIP_S = MAX_RECORD_MS / 1000;       // longest clip, recorded or cut from the library
export const MAX_FILE_BYTES = 200 * 1024 * 1024;  // server upload limit for library videos
export const BOOTH_SIZE = 1200;                   // photobooth shots are kept square at this size, cropped when composed
export const BOOTH_KEY = 'locket.booth.v1';
export const HOLD_MS = 360;
export const RING = 2 * Math.PI * 42;
export const SELF = '@self';                      // recipient choice: send to myself only

// iOS Safari records the camera stream reliably but not a canvas stream, so there the raw camera
// is recorded and the server crops it square (and mirrors it for the front camera). Elsewhere a
// square canvas is recorded, so what you see in the viewfinder is exactly what is sent.
export const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const CANVAS_RECORDING = !IS_IOS && typeof HTMLCanvasElement.prototype.captureStream === 'function';

export const readJSON = (key, fallback) => {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return fallback; }
};

export function pickMime() {
  if (!window.MediaRecorder) return null;
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

export function drawSquare(ctx, source, sw, sh, size, { mirror = false, zoomBy = 1 } = {}) {
  const side = Math.min(sw, sh) / zoomBy;
  ctx.save();
  if (mirror) { ctx.translate(size, 0); ctx.scale(-1, 1); }
  ctx.drawImage(source, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, size, size);
  ctx.restore();
}

export const toBlob = (canvas, quality = 0.96) => new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
export const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Load a library clip into a detached <video> to read its length and grab frames from it.
export function openClip(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    const url = URL.createObjectURL(file);
    const fail = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    const timer = setTimeout(fail, 20000);
    const done = () => { clearTimeout(timer); v.currentTime = 0; resolve({ v, url, duration: v.duration }); };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration)) { done(); return; }
      // WebM files written by MediaRecorder carry no duration: seeking far past the end makes the browser compute it
      v.ondurationchange = () => { if (Number.isFinite(v.duration)) { v.ondurationchange = null; done(); } };
      v.currentTime = 1e7;
    };
    v.onerror = () => { clearTimeout(timer); fail(); };
    v.src = url;
  });
}

// Square still of the clip at `t` seconds, or null when this browser cannot decode the codec
// (e.g. HEVC on some desktop browsers): the server then extracts the still from the video itself.
export async function stillAt(v, t) {
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('seek')), 8000);
      v.onseeked = () => { clearTimeout(timer); resolve(); };
      v.currentTime = Math.max(0.001, t);
    });
    if (!v.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PHOTO_SIZE;
    drawSquare(canvas.getContext('2d'), v, v.videoWidth, v.videoHeight, PHOTO_SIZE);
    return await toBlob(canvas);
  } catch {
    return null;
  }
}
