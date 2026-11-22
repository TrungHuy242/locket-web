// Camera page: live viewfinder (getUserMedia), tap = photo, hold = video (MediaRecorder), photos and
// videos from the device library (long clips get a 10-second trim window), preview with sound, caption
// style and recipients, then posting to Locket. Sizes match what the iPhone app stores: photos 1020x1020,
// clips 1080x1080 (the server encodes the final WebP / MP4 once, at high quality).
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../lib/icons.jsx';
import { clock, downloadBlob, thumb, vibrate, wait } from '../lib/format.js';
import { getSettings } from '../lib/settings.js';
import { useApp } from '../store.js';
import { ui } from '../ui/overlays.jsx';
import { Spinner } from '../ui/kit.jsx';
import { ErrorBoundary } from '../components/AppStatus.jsx';
import { FILTERS, FilterRenderer, centerCrop, filteredCanvas, webglSupported } from '../lib/filters.js';
import { ASPECTS, defaultOptions, isSquareNative, loadStyle } from '../lib/boothConfig.js';
import { playBeep, playShutter } from '../lib/boothAudio.js';
import {
  BOOTH_KEY, BOOTH_SIZE, CANVAS_RECORDING, CLIP_S, HOLD_MS, MAX_FILE_BYTES, MAX_RECORD_MS,
  PHOTO_SIZE, RING, SELF, VIDEO_BITRATE, VIDEO_SIZE,
  drawSquare, openClip, pickMime, readJSON, stillAt, toBlob,
} from '../lib/cameraMedia.js';
// the editor and its renderer (templates, stickers, export) are a separate chunk: loaded when a
// photobooth is opened, prefetched as soon as the PHOTOBOOTH mode is picked
const loadBoothEditor = () => import('./Photobooth.jsx');
const PhotoboothEditor = lazy(() => loadBoothEditor().then((m) => ({ default: m.PhotoboothEditor })));
import { StylePicker } from './camera/StylePicker.jsx';
import { CropSheet } from './camera/CropSheet.jsx';
import { BoothOverlays, CaptionEditor, FilterTray, PreviewLayers, RecipientsBar } from './camera/CameraOverlays.jsx';

export function CameraPage({ active, latest, onPreviewChange, onPosted, onOpenHistory }) {
  const user = useApp((s) => s.user);
  const friends = useApp((s) => s.friends);

  const vfRef = useRef(null);
  const videoRef = useRef(null);
  const shotVideoRef = useRef(null);
  const flashRef = useRef(null);
  const ringRef = useRef(null);
  const recDotRef = useRef(null);
  const captionRef = useRef(null);
  const fileRef = useRef(null);
  const boothFileRef = useRef(null);
  const shutterRef = useRef(null);

  // camera state lives in a ref: it is driven by events and timers, not by renders
  const cam = useRef({ stream: null, track: null, caps: {}, facing: localStorage.getItem('locket.facing') || 'user', starting: null, stopTimer: 0 });
  const [mirrored, setMirrored] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [flashOn, setFlashOn] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState(null);       // { title, body, retry }
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState(null);        // { image, video?, mirrorVideo, imageUrl, videoUrl, clip? }
  const [trimStart, setTrimStart] = useState(0);       // library clips: where the 10-second window begins
  const [soundOn, setSoundOn] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const clipRef = useRef(null);                        // detached <video> of the library clip
  const [preset, setPreset] = useState(null);
  const [previewMusicPlaying, setPreviewMusicPlaying] = useState(false);
  const previewAudioRef = useRef(null);
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState('idle');      // idle | sending | done
  const [progress, setProgress] = useState(null);      // upload fraction 0..1, then 'processing'
  const [spin, setSpin] = useState(0);
  // live filters (WebGL): preview on the viewfinder and applied to the saved pixels
  const glOk = useMemo(() => webglSupported(), []);
  const [glLost, setGlLost] = useState(false);
  const glRef = useRef(null);
  const rendererRef = useRef(null);
  const [filterId, setFilterId] = useState(() => localStorage.getItem('locket.filter') || 'none');
  const [filterAmount, setFilterAmount] = useState(() => Number(localStorage.getItem('locket.filterAmount')) || 1);
  const [trayOpen, setTrayOpen] = useState(false);
  const [thumbs, setThumbs] = useState({});
  // photo preview filter editing & self-timer & drag-drop
  const [previewTrayOpen, setPreviewTrayOpen] = useState(false);
  const [previewFilterId, setPreviewFilterId] = useState('none');
  const [previewFilterAmount, setPreviewFilterAmount] = useState(1);
  const [previewThumbs, setPreviewThumbs] = useState({});
  const previewThumbGen = useRef(0);
  const [timerSec, setTimerSec] = useState(0); // 0 | 3 | 5 | 10
  const [timerCount, setTimerCount] = useState(0);
  const timerRef = useRef({ running: false, cancel: false });
  const [draggingFile, setDraggingFile] = useState(false);
  const filterRef = useRef({ id: filterId, amount: filterAmount });
  filterRef.current = { id: filterId, amount: filterAmount };
  const glActive = glOk && !glLost && filterId !== 'none';
  // photobooth
  const [mode, setMode] = useState('photo');                       // photo | booth
  const [booth, setBooth] = useState(() => readJSON(BOOTH_KEY, { shots: 4, countdown: 3, sound: true }));
  const [boothStyle, setBoothStyle] = useState(() => loadStyle(defaultOptions()));
  const [boothLook, setBoothLook] = useState(null);                // filter chosen in the editor
  const [run, setRun] = useState(null);                            // { index, total, count, shots, manual? } while shooting
  const [boothShots, setBoothShots] = useState(null);
  const [editor, setEditor] = useState(false);
  const boothRef = useRef({ cancel: false, takenAt: Date.now(), running: false, manual: null });
  const shotsRef = useRef(null);
  shotsRef.current = boothShots;
  const editorRef = useRef(false);
  editorRef.current = editor;
  const activeRef = useRef(active);
  const previewRef = useRef(preview);
  activeRef.current = active;
  previewRef.current = preview;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const mirrorRef = useRef(mirrored);
  mirrorRef.current = mirrored;

  /* ------------------------------------------------ stream */
  const stop = useCallback(() => {
    const c = cam.current;
    c.stream?.getTracks().forEach((t) => t.stop());
    c.stream = null;
    c.track = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const applyZoom = useCallback((z) => {
    const c = cam.current;
    if (c.caps.zoom && c.track) {
      const value = Math.min(c.caps.zoom.max, Math.max(c.caps.zoom.min, c.caps.zoom.min * z));
      c.track.applyConstraints({ advanced: [{ zoom: value }] }).catch(() => {});
    }
  }, []);

  const start = useCallback(async () => {
    const c = cam.current;
    if (c.starting) return c.starting;
    c.starting = (async () => {
      stop();
      setMessage(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage({ title: 'Camera cần kết nối an toàn', body: 'Hãy mở trang qua https:// hoặc localhost. Bạn vẫn có thể chọn ảnh từ thư viện.' });
        return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: c.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
      } catch (err) {
        if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
          setMessage({ title: 'Cho phép truy cập camera', body: 'Bật quyền camera cho trang này trong trình duyệt để chụp khoảnh khắc.', retry: true });
        } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
          setMessage({ title: 'Không tìm thấy camera', body: 'Bạn vẫn có thể chọn ảnh từ thư viện.' });
        } else {
          setMessage({ title: 'Không mở được camera', body: 'Camera có thể đang được ứng dụng khác sử dụng.', retry: true });
        }
        return;
      }
      if (!activeRef.current || previewRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      c.stream = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      c.track = stream.getVideoTracks()[0];
      c.caps = c.track.getCapabilities?.() || {};
      const actual = c.track.getSettings?.().facingMode;
      setMirrored(actual ? actual !== 'environment' : c.facing !== 'environment');
      applyZoom(zoomRef.current);
      setSwitching(false);
    })();
    try { await c.starting; } finally { c.starting = null; }
    return undefined;
  }, [applyZoom, stop]);

  // Run the camera only while its page is on screen; release it shortly after leaving so the light goes off.
  useEffect(() => {
    const c = cam.current;
    clearTimeout(c.stopTimer);
    if (active && !preview && !editor) {
      if (!c.stream) start();
    } else {
      c.stopTimer = setTimeout(() => { if (!activeRef.current || previewRef.current || editorRef.current) stop(); }, active ? 0 : 1500);
    }
  }, [active, preview, editor, start, stop]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (activeRef.current && !previewRef.current && !editorRef.current && !cam.current.stream) start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); stop(); };
  }, [start, stop]);

  const flip = useCallback(async () => {
    setSpin((n) => n + 1);
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      if (cams.length < 2) { ui.warning('Thiết bị này chỉ có một camera'); return; }
    } catch { /* try anyway */ }
    const c = cam.current;
    c.facing = c.facing === 'user' ? 'environment' : 'user';
    localStorage.setItem('locket.facing', c.facing);
    setZoom(1);
    setSwitching(true);
    await wait(160);
    await start();
  }, [start]);

  const digitalZoom = () => (cam.current.caps.zoom ? 1 : zoomRef.current);
  const shouldMirror = () => mirrorRef.current && getSettings().mirrorFront;

  const stopPreviewMusic = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.currentTime = 0;
    }
    setPreviewMusicPlaying(false);
  }, []);

  const togglePreviewMusic = useCallback(() => {
    const url = preset?.previewProxy;
    if (!url) return;
    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio();
      previewAudioRef.current.addEventListener('ended', () => setPreviewMusicPlaying(false));
      previewAudioRef.current.addEventListener('error', () => {
        setPreviewMusicPlaying(false);
        ui.error('Không phát được đoạn nhạc này');
      });
    }
    const a = previewAudioRef.current;
    if (previewMusicPlaying && !a.paused) {
      a.pause();
      setPreviewMusicPlaying(false);
      return;
    }
    if (a.src !== new URL(url, window.location.origin).href) a.src = url;
    setPreviewMusicPlaying(true);
    a.play().catch(() => { setPreviewMusicPlaying(false); ui.error('Không phát được đoạn nhạc này'); });
  }, [preset, previewMusicPlaying]);

  useEffect(() => () => stopPreviewMusic(), [stopPreviewMusic]);

  /* ------------------------------------------------ preview */
  const enterPreview = useCallback((media) => {
    stopPreviewMusic();
    const next = { ...media, imageUrl: media.image ? URL.createObjectURL(media.image) : null, videoUrl: media.video ? URL.createObjectURL(media.video) : null };
    setPreview(next);
    setTrimStart(0);
    setSoundOn(false);
    setPreset(null);
    setSelected(new Set());
    setSending('idle');
    setPreviewTrayOpen(false);
    setPreviewFilterId(media.initialFilterId || 'none');
    setPreviewFilterAmount(media.initialFilterAmount ?? 1);
    setPreviewThumbs({});
    stop();
  }, [stop, stopPreviewMusic]);

  const exitPreview = useCallback(() => {
    stopPreviewMusic();
    previewThumbGen.current += 1;
    setPreviewTrayOpen(false);
    setPreview((p) => {
      if (p) { if (p.imageUrl) URL.revokeObjectURL(p.imageUrl); if (p.videoUrl) URL.revokeObjectURL(p.videoUrl); }
      return null;
    });
    if (clipRef.current) { URL.revokeObjectURL(clipRef.current.url); clipRef.current = null; }
  }, [stopPreviewMusic]);

  useEffect(() => { onPreviewChange(!!preview); }, [preview, onPreviewChange]);
  const prevPreviewIdRef = useRef(null);
  useEffect(() => {
    const rawKey = preview ? (preview.rawCanvas || preview.videoUrl || preview.imageUrl) : null;
    if (rawKey && rawKey !== prevPreviewIdRef.current && captionRef.current) captionRef.current.textContent = '';
    prevPreviewIdRef.current = rawKey;
    if (preview?.videoUrl) shotVideoRef.current?.play().catch(() => {});
  }, [preview]);

  // Re-render photo preview when user changes filter or strength in preview mode
  const applyPreviewFilter = useCallback(async (nextId, nextAmount) => {
    const cur = previewRef.current;
    if (!cur?.rawCanvas) return;
    const raw = cur.rawCanvas;
    let canvas;
    if (glOk && nextId !== 'none') {
      canvas = filteredCanvas(raw, { filter: nextId, amount: nextAmount, width: PHOTO_SIZE, height: PHOTO_SIZE });
    } else {
      canvas = raw;
    }
    const blob = await toBlob(canvas);
    if (!blob || previewRef.current?.rawCanvas !== raw) return;
    const url = URL.createObjectURL(blob);
    setPreview((p) => {
      if (!p || p.rawCanvas !== raw) { URL.revokeObjectURL(url); return p; }
      if (p.imageUrl) URL.revokeObjectURL(p.imageUrl);
      return { ...p, image: blob, imageUrl: url };
    });
  }, [glOk]);

  const togglePreviewTray = () => {
    if (!glOk) { ui.warning('Trình duyệt này không hỗ trợ WebGL nên chưa dùng được bộ lọc'); return; }
    const willOpen = !previewTrayOpen;
    setPreviewTrayOpen(willOpen);
    const gen = ++previewThumbGen.current;
    if (!willOpen || Object.keys(previewThumbs).length || !preview?.rawCanvas) return;
    const snap = document.createElement('canvas');
    snap.width = snap.height = 84;
    snap.getContext('2d').drawImage(preview.rawCanvas, 0, 0, 84, 84);
    let i = 0;
    const step = () => {
      if (previewThumbGen.current !== gen) return;
      const batch = {};
      const end = Math.min(i + 4, FILTERS.length);
      for (; i < end; i += 1) {
        const f = FILTERS[i];
        try { batch[f.id] = filteredCanvas(snap, { filter: f.id, amount: 1, width: 84, height: 84 }).toDataURL('image/jpeg', 0.7); } catch { /* skip */ }
      }
      setPreviewThumbs((prev) => ({ ...prev, ...batch }));
      if (i < FILTERS.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ------------------------------------------------ live filter preview */
  useEffect(() => { try { localStorage.setItem('locket.filter', filterId); localStorage.setItem('locket.filterAmount', String(filterAmount)); } catch { /* ignore */ } }, [filterId, filterAmount]);
  useEffect(() => () => { rendererRef.current?.dispose(); rendererRef.current = null; }, []);
  const trayGenRef = useRef(0);
  useEffect(() => () => { trayGenRef.current += 1; }, []);

  useEffect(() => {
    if (!glActive || !active || preview || editor) return undefined;
    const canvas = glRef.current;
    if (!canvas) return undefined;
    if (!rendererRef.current) {
      // preserve the buffer: the video recorder copies this canvas from a timer
      try {
        rendererRef.current = new FilterRenderer(canvas, {
          preserve: true,
          onLost: () => setGlLost(true),
          onRestored: () => setGlLost(false),
        });
      } catch {
        setGlLost(true);
        return undefined;
      }
    }
    const r = rendererRef.current;
    const t0 = performance.now();
    let alive = true;
    let raf = 0;
    let vfc = 0;
    let vfcVideo = null;
    let lastDraw = 0;

    const draw = (now) => {
      const v = videoRef.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return;
      // Cap live preview at 720px for smooth GPU frame times (photos & clips still export full 1020/1080)
      const size = Math.min(720, Math.round((canvas.clientWidth || 360) * Math.min(window.devicePixelRatio || 1, 2)));
      const look = filterRef.current;
      if (!r.render(v, { filter: look.id, amount: look.amount, crop: centerCrop(v.videoWidth, v.videoHeight, 1, 1), width: size, height: size, time: (now - t0) / 1000 })) {
        setGlLost(true);
      }
    };

    const scheduleVfc = (v) => {
      vfcVideo = v;
      vfc = v.requestVideoFrameCallback((now) => {
        if (!alive) return;
        draw(now);
        scheduleVfc(v);
      });
    };

    const loop = (now) => {
      if (!alive) return;
      const v = videoRef.current;
      if (v && typeof v.requestVideoFrameCallback === 'function' && v.readyState >= 2) {
        draw(now);
        scheduleVfc(v);
        return;
      }
      raf = requestAnimationFrame(loop);
      if (now - lastDraw < 32) return;
      lastDraw = now;
      draw(now);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (vfc && vfcVideo?.cancelVideoFrameCallback) vfcVideo.cancelVideoFrameCallback(vfc);
    };
  }, [glActive, active, preview, editor]);

  // filter tray thumbnails: freeze one 84x84 snapshot and render batches of 4 per frame to avoid jank
  const openTray = () => {
    if (!glOk) { ui.warning('Trình duyệt này không hỗ trợ WebGL nên chưa dùng được bộ lọc'); return; }
    const willOpen = !trayOpen;
    setTrayOpen(willOpen);
    const gen = ++trayGenRef.current;
    if (!willOpen) return;
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const snap = document.createElement('canvas');
    snap.width = snap.height = 84;
    drawSquare(snap.getContext('2d'), v, v.videoWidth, v.videoHeight, 84, { mirror: mirrorRef.current });
    let i = 0;
    const step = () => {
      if (trayGenRef.current !== gen) return;
      const batch = {};
      const end = Math.min(i + 4, FILTERS.length);
      for (; i < end; i += 1) {
        const f = FILTERS[i];
        try { batch[f.id] = filteredCanvas(snap, { filter: f.id, amount: 1, width: 84, height: 84 }).toDataURL('image/jpeg', 0.7); } catch { /* skip */ }
      }
      setThumbs((prev) => ({ ...prev, ...batch }));
      if (i < FILTERS.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /* ------------------------------------------------ photobooth */
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const setBoothOpt = (patch) => setBooth((b) => {
    const next = { ...b, ...patch };
    try { localStorage.setItem(BOOTH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      if (cam.current.stream && videoRef.current?.videoWidth) return true;
      await wait(100);
    }
    return false;
  };
  // a square, unfiltered frame (mirrored like saved selfies); the editor crops and filters it
  const boothFrame = () => {
    const v = videoRef.current;
    return filteredCanvas(v, { filter: 'none', width: BOOTH_SIZE, height: BOOTH_SIZE, crop: centerCrop(v.videoWidth, v.videoHeight, 1, digitalZoom()), mirror: shouldMirror() });
  };
  const captureOneBoothShot = async () => {
    const c = cam.current;
    let undoFlash = () => {};
    try {
      if (flashOn) {
        if (c.caps.torch && c.track) {
          await c.track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
          undoFlash = () => c.track?.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
          await wait(240);
        } else {
          const glow = document.createElement('div');
          glow.className = 'screen-flash';
          document.getElementById('layers')?.appendChild(glow);
          flashRef.current?.classList.add('hold');
          undoFlash = () => { glow.remove(); flashRef.current?.classList.remove('hold'); };
          await wait(260);
        }
      }
      const fl = flashRef.current;
      fl?.classList.remove('blink');
      void fl?.offsetWidth;
      fl?.classList.add('blink');
      vibrate(14);
      if (booth.sound !== false) playShutter();
      const image = boothFrame();
      const mini = document.createElement('canvas');
      mini.width = mini.height = 96;
      mini.getContext('2d').drawImage(image, 0, 0, 96, 96);
      return { image, thumb: mini.toDataURL('image/jpeg', 0.7) };
    } finally {
      undoFlash();
    }
  };
  const runBooth = async (only = null) => {
    const b = boothRef.current;
    // Manual shot-by-shot mode (countdown === 0): each tap takes one shot
    if (booth.countdown === 0 && only == null) {
      if (b.running) return;
      b.running = true;
      setTrayOpen(false);
      try {
        if (!(await waitReady())) { ui.warning('Camera chưa sẵn sàng'); return; }
        if (!b.manual) {
          b.takenAt = Date.now();
          b.manual = { total: booth.shots, shots: Array(booth.shots).fill(null), nextIdx: 0 };
        }
        const m = b.manual;
        const shot = await captureOneBoothShot();
        m.shots[m.nextIdx] = shot;
        m.nextIdx += 1;
        if (m.nextIdx >= m.total) {
          const finalShots = m.shots.slice();
          b.manual = null;
          setRun(null);
          setBoothShots(finalShots);
          setEditor(true);
        } else {
          setRun({ index: m.nextIdx, total: m.total, count: 0, shots: m.shots.slice(), manual: true });
        }
      } finally {
        b.running = false;
      }
      return;
    }

    if (b.running) return;
    b.running = true;
    b.cancel = false;
    b.manual = null;
    setTrayOpen(false);
    const total = only == null ? booth.shots : (shotsRef.current?.length || booth.shots);
    const order = only == null ? [...Array(total).keys()] : [only];
    const shots = only == null ? Array(total).fill(null) : [...(shotsRef.current || Array(total).fill(null))];
    if (only == null) b.takenAt = Date.now();
    try {
      for (let k = 0; k < order.length; k++) {
        const idx = order[k];
        for (let n = Math.max(1, booth.countdown || 3); n > 0; n--) {
          setRun({ index: idx, total, count: n, shots: shots.slice() });
          vibrate(6);
          if (booth.sound !== false) playBeep(n === 1);
          await wait(1000);
          if (b.cancel) return;
        }
        if (!(await waitReady())) { ui.warning('Camera chưa sẵn sàng'); return; }
        const shot = await captureOneBoothShot();
        shots[idx] = { ...(shots[idx] || {}), ...shot };
        setRun({ index: idx, total, count: 0, shots: shots.slice() });
        await wait(k < order.length - 1 ? 850 : 420);
        if (b.cancel) return;
      }
      setBoothShots(shots);
      setEditor(true);
    } finally {
      b.running = false;
      setRun(null);
    }
  };
  const runBoothRef = useRef(runBooth);
  runBoothRef.current = runBooth;
  const cancelBooth = () => {
    boothRef.current.cancel = true;
    boothRef.current.manual = null;
    setRun(null);
  };
  const finishManualBooth = () => {
    const m = boothRef.current.manual;
    if (!m) return;
    const picked = m.shots.filter(Boolean);
    boothRef.current.manual = null;
    setRun(null);
    if (picked.length) {
      setBoothShots(picked);
      setEditor(true);
    }
  };
  const loadBoothFiles = async (fileList) => {
    const isImg = (f) => f && (f.type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i.test(f.name || ''));
    const files = Array.from(fileList || []).filter(isImg).slice(0, 6);
    if (!files.length) return;
    try {
      const loaded = [];
      for (const file of files) {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = BOOTH_SIZE;
          drawSquare(canvas.getContext('2d'), bitmap, bitmap.width, bitmap.height, BOOTH_SIZE);
          const mini = document.createElement('canvas');
          mini.width = mini.height = 96;
          mini.getContext('2d').drawImage(canvas, 0, 0, 96, 96);
          loaded.push({ image: canvas, thumb: mini.toDataURL('image/jpeg', 0.7) });
        } finally {
          bitmap.close?.();
        }
      }
      if (loaded.length) {
        boothRef.current.takenAt = Date.now();
        setBoothShots(loaded);
        setEditor(true);
      }
    } catch {
      ui.warning('Không đọc được ảnh từ thư viện');
    }
  };
  const onBoothFiles = (e) => {
    // Snapshot live FileList into an array BEFORE clearing input.value (clearing empties live FileList in Chromium!)
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    loadBoothFiles(files);
  };
  const boothRatio = boothStyle.outputMode !== 'print' && isSquareNative(boothStyle.layout)
    ? 1
    : (ASPECTS.find((a) => a.id === boothStyle.aspect) || ASPECTS[0]).ratio;
  const onBoothRetake = (which) => {
    if (which === 'all') { setBoothShots(null); setTimeout(() => runBoothRef.current(), 450); } else setTimeout(() => runBoothRef.current(which), 450);
  };
  // Keep boothShots alive so user can click "Sửa khung" from Send Preview without losing their photos!
  const onBoothPost = (payload) => {
    const media = payload instanceof Blob ? { image: payload, fromBooth: true } : { ...payload, fromBooth: true };
    enterPreview(media);
  };
  const onEditBoothFromPreview = () => {
    if (!boothShots?.length) return;
    exitPreview();
    setEditor(true);
  };
  const onBoothLook = useCallback((look) => setBoothLook(look), []);

  /* ------------------------------------------------ photo */
  const takePhoto = useCallback(async () => {
    const c = cam.current;
    const video = videoRef.current;
    if (!c.stream || !video?.videoWidth) { ui.warning('Camera chưa sẵn sàng'); return; }
    let undoFlash = () => {};
    let rawCanvas;
    let canvas;
    const look = filterRef.current;
    try {
      if (flashOn) {
        if (c.caps.torch && c.track) {
          await c.track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
          undoFlash = () => c.track?.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
          await wait(260);
        } else {
          // front camera / desktop: light the face with the screen, like iOS Retina Flash
          const glow = document.createElement('div');
          glow.className = 'screen-flash';
          document.getElementById('layers')?.appendChild(glow);
          flashRef.current?.classList.add('hold');
          undoFlash = () => { glow.remove(); flashRef.current?.classList.remove('hold'); };
          await wait(280);
        }
      }
      rawCanvas = document.createElement('canvas');
      rawCanvas.width = rawCanvas.height = PHOTO_SIZE;
      drawSquare(rawCanvas.getContext('2d'), video, video.videoWidth, video.videoHeight, PHOTO_SIZE, { mirror: shouldMirror(), zoomBy: digitalZoom() });
      if (glOk && look.id !== 'none') {
        canvas = filteredCanvas(rawCanvas, { filter: look.id, amount: look.amount, width: PHOTO_SIZE, height: PHOTO_SIZE });
      } else {
        canvas = rawCanvas;
      }
    } finally {
      undoFlash();
    }
    const fl = flashRef.current;
    fl.classList.remove('blink');
    void fl.offsetWidth;
    fl.classList.add('blink');
    vibrate(12);
    const image = await toBlob(canvas);
    if (image) enterPreview({ image, rawCanvas, initialFilterId: look.id, initialFilterAmount: look.amount });
  }, [enterPreview, flashOn, glOk]);

  const cancelTimer = useCallback(() => {
    timerRef.current.cancel = true;
    setTimerCount(0);
  }, []);

  const triggerPhoto = useCallback(async () => {
    if (!timerSec) { takePhoto(); return; }
    const t = timerRef.current;
    if (t.running) { cancelTimer(); return; }
    t.running = true;
    t.cancel = false;
    setTrayOpen(false);
    try {
      for (let n = timerSec; n > 0; n -= 1) {
        setTimerCount(n);
        vibrate(6);
        await wait(1000);
        if (t.cancel || !activeRef.current || previewRef.current) return;
      }
      setTimerCount(0);
      await takePhoto();
    } finally {
      t.running = false;
      setTimerCount(0);
    }
  }, [timerSec, takePhoto, cancelTimer]);
  useEffect(() => () => { timerRef.current.cancel = true; }, []);

  /* ------------------------------------------------ video */
  const rec = useRef({ recorder: null, done: null, pressing: false, preparing: false, holdTimer: 0 });

  const stopRecording = useCallback(async () => {
    const r = rec.current;
    if (!r.recorder || r.recorder.state === 'inactive') return;
    const pending = r.done;
    r.recorder.stop();
    r.recorder = null;
    setRecording(false);
    if (ringRef.current) ringRef.current.style.strokeDashoffset = RING;
    const result = await pending;
    if (result.ms < 700 || !result.video.size) { ui.warning('Giữ lâu hơn để quay video'); return; }
    enterPreview({ image: result.image, video: result.video, mirrorVideo: result.mirrorVideo, seconds: result.ms / 1000, audio: result.audio });
  }, [enterPreview]);

  const startRecording = useCallback(async () => {
    const c = cam.current;
    const video = videoRef.current;
    const mime = pickMime();
    if (!mime) { ui.warning('Trình duyệt này không hỗ trợ quay video'); return false; }
    if (!c.stream || !video?.videoWidth) { ui.warning('Camera chưa sẵn sàng'); return false; }
    const mirror = shouldMirror();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = VIDEO_SIZE;
    const ctx = canvas.getContext('2d');
    // with a filter on, record the WebGL preview (already filtered) instead of the raw camera
    const src = glOk && filterRef.current.id !== 'none' && glRef.current && rendererRef.current?.isAvailable() ? glRef.current : video;
    const paint = () => drawSquare(ctx, src, src.videoWidth || src.width, src.videoHeight || src.height, VIDEO_SIZE, { mirror, zoomBy: digitalZoom() });
    paint();
    const still = await toBlob(canvas, 0.9);            // first frame: the moment's still image
    const out = CANVAS_RECORDING ? canvas.captureStream(30) : new MediaStream(c.stream.getVideoTracks());
    let mic = null;
    if (getSettings().recordAudio) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getAudioTracks().forEach((t) => out.addTrack(t));
      } catch { /* record silently */ }
    }
    if (!c.stream) {
      mic?.getTracks().forEach((t) => t.stop());
      if (CANVAS_RECORDING) out.getTracks().forEach((t) => t.stop());
      return false;
    }
    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE });
    } catch {
      mic?.getTracks().forEach((t) => t.stop());
      ui.error('Không khởi động được trình quay video');
      return false;
    }
    const r = rec.current;
    r.recorder = recorder;
    // flash on + a camera with a torch (rear camera on phones): keep the light on while recording
    const torch = flashOn && c.caps.torch && c.track;
    if (torch) c.track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const startedAt = performance.now();
    // a timer (not rAF) drives frames so the recording keeps its frame rate when rAF is throttled
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt;
      if (CANVAS_RECORDING) paint();
      if (ringRef.current) ringRef.current.style.strokeDashoffset = RING * (1 - Math.min(1, elapsed / MAX_RECORD_MS));
      if (recDotRef.current) recDotRef.current.textContent = `0:${String(Math.floor(elapsed / 1000)).padStart(2, '0')}`;
      if (elapsed >= MAX_RECORD_MS) stopRecording();
    }, 1000 / 30);
    r.done = new Promise((resolve) => {
      recorder.onstop = () => {
        clearInterval(timer);
        if (torch) c.track?.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
        mic?.getTracks().forEach((t) => t.stop());
        if (CANVAS_RECORDING) out.getTracks().forEach((t) => t.stop());   // never stop the camera's own track
        resolve({
          video: new Blob(chunks, { type: mime.split(';')[0] }), image: still, ms: performance.now() - startedAt,
          mirrorVideo: !CANVAS_RECORDING && mirror,   // raw camera frames: server (and preview) flip them
          audio: !!mic,
        });
      };
    });
    recorder.start(250);
    if (recDotRef.current) recDotRef.current.textContent = '0:00';
    setRecording(true);
    vibrate(18);
    return true;
  }, [stopRecording, flashOn, glOk]);

  // tap = photo, hold = record, release = stop and preview
  const onShutterDown = (e) => {
    if (e.button > 0 || preview) return;
    e.preventDefault();
    if (mode === 'booth') { if (!boothRef.current.running) runBooth(); return; }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const r = rec.current;
    r.pressing = true;
    r.holdTimer = setTimeout(async () => {
      r.holdTimer = 0;
      r.preparing = true;
      const started = await startRecording();
      r.preparing = false;
      if (started && !r.pressing) stopRecording();   // released while the recorder was starting
    }, HOLD_MS);
  };
  const release = (cancelled) => {
    if (mode === 'booth') return;
    const r = rec.current;
    if (!r.pressing) return;
    r.pressing = false;
    if (r.holdTimer) {
      clearTimeout(r.holdTimer);
      r.holdTimer = 0;
      if (!cancelled) triggerPhoto();
    } else if (!r.preparing) {
      stopRecording();
    }
  };

  // desktop: space bar takes the photo
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== ' ' || e.repeat || !activeRef.current || previewRef.current) return;
      if (e.target.closest?.('input, textarea, [contenteditable], button') || document.getElementById('layers').children.length) return;
      e.preventDefault();
      if (modeRef.current === 'booth') { if (!boothRef.current.running) runBoothRef.current(); } else triggerPhoto();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [triggerPhoto]);

  // double tap on the viewfinder flips the camera
  const lastTap = useRef(0);
  const onViewfinderUp = (e) => {
    if (preview || e.target.closest('button')) return;
    const now = performance.now();
    if (now - lastTap.current < 300) { lastTap.current = 0; flip(); } else lastTap.current = now;
  };

  /* ------------------------------------------------ gallery, crop, paste & drop */
  const onVideoFile = useCallback(async (file) => {
    if (file.size > MAX_FILE_BYTES) { ui.warning('Video quá lớn (tối đa 200 MB)'); return; }
    setLoadingFile(true);
    try {
      let clip = null;
      try { clip = await openClip(file); } catch { /* the server can still read it */ }
      const duration = clip && Number.isFinite(clip.duration) ? clip.duration : 0;
      if (clip && duration && duration < 0.5) { ui.warning('Video quá ngắn'); URL.revokeObjectURL(clip.url); return; }
      const still = clip ? await stillAt(clip.v, 0) : null;
      clipRef.current = clip;
      enterPreview({ image: still, video: file, library: true, duration, decodable: !!still, audio: true,
        seconds: duration ? Math.min(duration, CLIP_S) : CLIP_S });
    } finally {
      setLoadingFile(false);
    }
  }, [enterPreview]);

  const openPickedFile = useCallback(async (file) => {
    if (!file) return;
    if (file.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(file.name)) { onVideoFile(file); return; }
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const ctl = ui.sheet(() => (
        <CropSheet
          bitmap={bitmap}
          onCancel={() => { bitmap.close?.(); ctl.close(); }}
          onConfirm={async (rawCanvas) => {
            bitmap.close?.();
            ctl.close();
            const look = filterRef.current;
            const out = glOk && look.id !== 'none'
              ? filteredCanvas(rawCanvas, { filter: look.id, amount: look.amount, width: PHOTO_SIZE, height: PHOTO_SIZE })
              : rawCanvas;
            const image = await toBlob(out);
            if (image) enterPreview({ image, rawCanvas, initialFilterId: look.id, initialFilterAmount: look.amount });
          }}
        />
      ), { full: true, onClose: () => bitmap.close?.() });
    } catch {
      ui.warning(/hei[cf]/i.test(file.type + file.name) ? 'Trình duyệt này không đọc được ảnh HEIC. Hãy chọn ảnh JPEG/PNG hoặc mở trang bằng Safari.' : 'Không đọc được ảnh này');
    }
  }, [enterPreview, glOk, onVideoFile]);

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) openPickedFile(file);
  };

  // desktop: Ctrl+V paste an image from clipboard directly into the camera
  useEffect(() => {
    const onPaste = (e) => {
      if (!activeRef.current || previewRef.current || editorRef.current) return;
      if (e.target.closest?.('input, textarea, [contenteditable]')) return;
      const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); openPickedFile(file); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [openPickedFile]);

  /* ------------------------------------------------ send */
  const toggleRecipient = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!uid) return new Set();
      if (uid === SELF) return prev.has(SELF) ? new Set() : new Set([SELF]);
      next.delete(SELF);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });
  };

  const saveToDevice = () => {
    if (!preview) return;
    const blob = preview.video || preview.image;
    downloadBlob(blob, `locket-${Date.now()}.${preview.video ? (blob.type.includes('mp4') ? 'mp4' : 'webm') : 'jpg'}`);
  };

  const send = async () => {
    if (!preview || sending !== 'idle') return;
    stopPreviewMusic();
    setSending('sending');
    let caption = (captionRef.current?.textContent || '').trim();
    if (!caption && preset?.type === 'time') caption = preset.text || clock(Date.now());
    else if (!caption && preset?.text && ['music', 'review', 'location', 'weather', 'streak', 'star_sign', 'locket_count', 'custom'].includes(preset.type)) caption = preset.text;
    try {
      let image = preview.image;
      if (preview.library && trimStart > 0 && clipRef.current && preview.decodable) image = await stillAt(clipRef.current.v, trimStart);
      const moment = await api.postMoment({
        image, video: preview.video,
        videoStart: preview.library ? trimStart : 0, videoLength: preview.library ? CLIP_S : 0, caption, preset: preset?.key,
        overlayMeta: preset?.overlayMeta,
        isPrivate: selected.has(SELF), recipients: [...selected].filter((uid) => uid !== SELF),
        videoMirror: !!preview.mirrorVideo,
        // the upload itself is measurable; after it the server converts / stores the file (not measurable)
        onProgress: (f) => setProgress(f >= 1 ? 'processing' : f),
      });
      setSending('done');
      setProgress(null);
      vibrate([10, 40, 10]);
      if (getSettings().saveAfterSend) saveToDevice();
      if (preview.fromBooth) { setBoothShots(null); setBoothLook(null); }
      await wait(700);
      exitPreview();
      onPosted(moment);
    } catch (err) {
      setSending('idle');
      setProgress(null);
      ui.error(err.message || 'Không gửi được khoảnh khắc');
    }
  };

  // library clip preview: play only the chosen window, on a loop
  const onShotTime = (e) => {
    if (!preview?.library) return;
    const v = e.currentTarget;
    if (v.currentTime < trimStart - 0.05 || v.currentTime >= trimStart + CLIP_S) { v.currentTime = trimStart; v.play().catch(() => {}); }
  };
  const onTrim = (value) => {
    setTrimStart(value);
    const v = shotVideoRef.current;
    if (v) { v.currentTime = value; v.play().catch(() => {}); }
  };
  const toggleSound = () => {
    const v = shotVideoRef.current;
    if (!v) return;
    v.muted = soundOn;
    if (!soundOn) v.play().catch(() => {});
    setSoundOn(!soundOn);
  };

  const openStyles = () => {
    stopPreviewMusic();
    const ctl = ui.sheet(() => (
      <StylePicker current={preset} onPick={(p) => {
        setPreset(p);
        if (captionRef.current) {
          if (p && ['music', 'review', 'location', 'weather', 'streak', 'star_sign', 'locket_count', 'custom', 'time'].includes(p.type)) {
            captionRef.current.textContent = p.text || '';
          } else if (!p) {
            // keep user-typed caption when simply resetting style
          }
        }
        ctl.close();
      }} />
    ), { full: true });
  };

  const onCaptionInput = (e) => {
    const el = e.currentTarget;
    if (el.textContent.length > 120) {
      el.textContent = el.textContent.slice(0, 120);
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
    if (!el.textContent.trim()) el.textContent = '';
  };

  const placeholder = preset ? (preset.type === 'time' ? clock(Date.now()) : preset.text || 'Thêm một tin nhắn') : 'Thêm một tin nhắn';
  const zoomScale = cam.current.caps.zoom ? 1 : zoom;

  return (
    <section className="page page-camera">
      <div className="cam-title" data-when="preview">Gửi đến...
        <button type="button" className="icon-btn pressable" aria-label="Lưu vào máy" onClick={() => { saveToDevice(); ui.success('Đã lưu vào máy'); }}><Icon name="download" /></button>
      </div>
      <div ref={vfRef} className={`viewfinder ${mirrored ? 'mirror' : ''} ${switching ? 'switching' : ''} ${draggingFile ? 'dropping' : ''}`}
        style={{ '--zoom': zoomScale }} onPointerUp={onViewfinderUp}
        onDragOver={(e) => { if (!preview && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDraggingFile(true); } }}
        onDragLeave={() => setDraggingFile(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDraggingFile(false);
          if (preview) return;
          if (mode === 'booth') {
            loadBoothFiles(e.dataTransfer?.files);
            return;
          }
          const file = e.dataTransfer?.files?.[0];
          if (file) openPickedFile(file);
        }}>
        <video ref={videoRef} className="live" playsInline muted autoPlay />
        <canvas ref={glRef} className="live live-gl" hidden={!glActive || !!preview} aria-hidden="true" />
        <BoothOverlays mode={mode} preview={preview} run={run} timerCount={timerCount} booth={booth} boothRatio={boothRatio}
          onCancel={cancelBooth} onFinishEarly={finishManualBooth} onCancelTimer={cancelTimer}
          onToggleShots={() => {
            const seq = [2, 3, 4, 6];
            const idx = seq.indexOf(booth.shots);
            setBoothOpt({ shots: seq[(idx + 1) % seq.length] });
          }}
          onCycleCountdown={() => {
            const seq = [0, 2, 3, 5, 10];
            const idx = seq.indexOf(booth.countdown);
            setBoothOpt({ countdown: seq[(idx + 1) % seq.length] });
          }}
          onToggleSound={() => setBoothOpt({ sound: booth.sound === false })}
          onPickGallery={() => boothFileRef.current?.click()} />
        <FilterTray open={preview ? previewTrayOpen : trayOpen} preview={preview} previewPhoto={!!(preview && preview.rawCanvas && !preview.video)}
          filterId={preview ? previewFilterId : filterId} filterAmount={preview ? previewFilterAmount : filterAmount}
          thumbs={preview ? previewThumbs : thumbs}
          onPick={(id) => {
            if (preview) { setPreviewFilterId(id); applyPreviewFilter(id, previewFilterAmount); }
            else setFilterId(id);
          }}
          onAmount={(a) => {
            if (preview) { setPreviewFilterAmount(a); applyPreviewFilter(previewFilterId, a); }
            else setFilterAmount(a);
          }} />
        <PreviewLayers preview={preview} shotVideoRef={shotVideoRef} soundOn={soundOn} trimStart={trimStart}
          previewTrayOpen={previewTrayOpen} canFilterPreview={!!(glOk && preview?.rawCanvas && !preview?.video)}
          canEditBooth={!!(preview?.fromBooth && boothShots?.length)}
          onEditBooth={onEditBoothFromPreview}
          onTogglePreviewTray={togglePreviewTray}
          onShotTime={onShotTime} onToggleSound={toggleSound} onTrim={onTrim} />
        {draggingFile ? <div className="vf-msg drop-hint"><b>Thả ảnh hoặc video vào đây</b><span>Hỗ trợ căn khung vuông & bộ lọc</span></div> : null}
        {loadingFile ? <div className="vf-msg"><span className="spinner" /><span>Đang đọc video…</span></div> : null}
        {message && !preview ? (
          <div className="vf-msg">
            <b>{message.title}</b><span>{message.body}</span>
            {message.retry ? <button type="button" className="btn btn-dark btn-sm" onClick={() => start()}>Thử lại</button> : null}
          </div>
        ) : null}
        <div ref={flashRef} className="flash-overlay" />
        <div ref={recDotRef} className="rec-dot" hidden={!recording}>0:00</div>
        <button type="button" className={`vf-btn fx ${trayOpen || filterId !== 'none' ? 'on' : ''}`} data-when="capture" aria-label="Bộ lọc" aria-pressed={trayOpen} onClick={openTray}>
          <Icon name="filters" />
        </button>
        {mode === 'photo' ? (
          <button type="button" className={`vf-btn timer ${timerSec ? 'on' : ''}`} data-when="capture" aria-label="Hẹn giờ chụp" title="Hẹn giờ chụp"
            onClick={() => setTimerSec((s) => (s === 0 ? 3 : s === 3 ? 5 : s === 5 ? 10 : 0))}>
            {timerSec ? `${timerSec}s` : <Icon name="timer" />}
          </button>
        ) : null}
        <button type="button" className={`vf-btn flash ${flashOn ? 'on' : ''} ${trayOpen ? 'tucked' : ''}`} data-when="capture" aria-label="Đèn flash" onClick={() => setFlashOn((v) => !v)}>
          <Icon name={flashOn ? 'bolt' : 'boltOff'} />
        </button>
        <button type="button" className={`vf-btn zoom ${trayOpen ? 'tucked' : ''}`} data-when="capture" aria-label="Thu phóng" onClick={() => { const z = zoom === 1 ? 2 : 1; setZoom(z); applyZoom(z); }}>{zoom}x</button>
        <CaptionEditor preview={preview} preset={preset} placeholder={placeholder} captionRef={captionRef}
          onCaptionInput={onCaptionInput} musicPlaying={previewMusicPlaying} onToggleMusic={togglePreviewMusic} />
      </div>

      <div className="cam-modes" data-when="capture" role="tablist" aria-label="Chế độ chụp">
        <button type="button" role="tab" aria-selected={mode === 'photo'} className={mode === 'photo' ? 'on' : ''} disabled={!!run} onClick={() => setMode('photo')}>ẢNH</button>
        <button type="button" role="tab" aria-selected={mode === 'booth'} className={mode === 'booth' ? 'on' : ''} disabled={!!run} onClick={() => { setMode('booth'); loadBoothEditor().catch(() => {}); }}>PHOTOBOOTH</button>
      </div>
      <div className="cam-controls" data-when="capture">
        <button type="button" className="cam-side" aria-label={mode === 'booth' ? 'Chọn 2–6 ảnh ghép Photobooth' : 'Chọn ảnh hoặc video từ thư viện'}
          onClick={() => (mode === 'booth' ? boothFileRef.current?.click() : fileRef.current?.click())}><Icon name="gallery" /></button>
        <button ref={shutterRef} type="button" className={`shutter ${recording ? 'recording' : ''} ${mode === 'booth' ? 'booth' : ''} ${run && !run.manual ? 'running' : ''}`}
          aria-label={mode === 'booth' ? `Chụp photobooth ${booth.shots} ảnh` : 'Chạm để chụp, giữ để quay video'}
          onPointerDown={onShutterDown} onPointerUp={() => release(false)} onPointerCancel={() => release(true)}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (mode === 'booth') runBooth(); else triggerPhoto(); } }}>
          <svg className="ring" viewBox="0 0 88 88"><circle ref={ringRef} cx="44" cy="44" r="42" strokeDasharray={RING} strokeDashoffset={RING} /></svg>
        </button>
        <button type="button" key={spin} className={`cam-side flip ${spin ? 'spin' : ''}`} aria-label="Đổi camera" onClick={flip}><Icon name="flip" /></button>
      </div>
      <div className="cam-controls" data-when="preview">
        <button type="button" className="cam-side" aria-label="Chụp lại" onClick={exitPreview} disabled={sending !== 'idle'}><Icon name="close" /></button>
        <button type="button" className={`send-btn ${sending === 'done' ? 'done' : ''}`} aria-label="Gửi" onClick={send} disabled={sending !== 'idle'}>
          {sending === 'sending' ? <Spinner /> : <Icon name={sending === 'done' ? 'checkBig' : 'send'} />}
          {sending === 'sending' && typeof progress === 'number' ? (
            <svg className="send-ring" viewBox="0 0 88 88" aria-hidden="true"><circle cx="44" cy="44" r="42" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} /></svg>
          ) : null}
        </button>
        {sending === 'sending' ? (
          <span className="send-status" role="status">
            {typeof progress === 'number' ? `Đang tải lên ${Math.round(progress * 100)}%` : progress === 'processing' ? (preview?.video ? 'Đang xử lý video…' : 'Đang đăng…') : 'Đang gửi…'}
          </span>
        ) : null}
        <button type="button" className="cam-side" aria-label="Kiểu chú thích" onClick={openStyles}><Icon name="textStyle" /></button>
      </div>

      <button type="button" className="history-btn" data-when="capture" onClick={onOpenHistory}>
        <span className="row">
          {latest?.image ? <img className="thumb" src={thumb(latest.image, 128)} alt="" /> : <span className="count">0</span>}
          Lịch sử
        </span>
        <Icon name="chevDown" />
      </button>
      <RecipientsBar user={user} friends={friends} selected={selected} onToggle={toggleRecipient} onApplyGroup={(uids) => setSelected(new Set(uids))} />
      <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={onFile} />
      <input ref={boothFileRef} type="file" accept="image/*" multiple hidden onChange={onBoothFiles} />
      {editor && boothShots ? (
        <ErrorBoundary inline title="Không mở được trình chỉnh sửa Photobooth" onClose={() => setEditor(false)}>
          <Suspense fallback={<div className="booth-editor force-dark in booth-loading-screen"><Spinner size="lg" /></div>}>
          <PhotoboothEditor shots={boothShots} takenAt={boothRef.current.takenAt}
            initialFilter={boothLook?.filter ?? filterId} initialAmount={boothLook?.amount ?? filterAmount}
            options={boothStyle} onOptions={setBoothStyle} onShots={setBoothShots} onLook={onBoothLook}
            onRetake={onBoothRetake} onDiscard={() => { setBoothShots(null); setBoothLook(null); }}
            onClose={() => setEditor(false)} onPost={onBoothPost} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
    </section>
  );
}
