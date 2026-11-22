// Photobooth editor: native 1:1 Locket full-bleed layouts & classic strips, 21 frame templates,
// SVG + emoji + floating text stickers, undo/redo, per-cell swap/zoom/pan/flip/replace, quick retouch,
// live Locket caption-safe preview, and animated video clip export.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../lib/icons.jsx';
import { downloadBlob } from '../lib/format.js';
import { FILTERS, filteredCanvas } from '../lib/filters.js';
import { BOOTH_SIZE, drawSquare } from '../lib/cameraMedia.js';
import {
  BORDERS, EMOJI_STICKERS, FONTS, STICKER_GROUPS, TEMPLATES, TEMPLATE_GROUPS, TEXTURES,
  stickerUrl, templateById, textureUrl,
} from '../lib/boothAssets.js';
import {
  ASPECTS, BACKDROPS, DATE_FORMATS, DATE_POSITIONS, LAYOUTS, canvasToBlob, compose, composeBase,
  decorAsStickers, defaultOptions, drawStickers, geometry, isSquareNative, preloadBooth, resolved, toSquare,
} from '../lib/photobooth.js';
import { pushBack } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { Button } from '../ui/kit.jsx';
import { StickerLayer } from './booth/StickerLayer.jsx';
import { CellAdjustBar } from './booth/CellAdjustBar.jsx';

const OPTS_KEY = 'locket.booth.style.v3';
const SWATCHES = ['#ffffff', '#111111', '#fff3df', '#ffe6ee', '#e8f7ee', '#d8ecff', '#e6dcff', '#fff8d8', '#e9d9bd', '#1d2547', '#ffd1dc', '#c7d2ff'];
const INKS = ['#1c1c1e', '#ffffff', '#8a5a3b', '#d0587e', '#3f8a64', '#5a7fbf', '#5b3fd1', '#e2557a', '#c8325a', '#ff9f43', '#7a4f32', '#ffe8a3'];
const TEXT_BGS = ['none', 'rgba(0,0,0,0.62)', 'rgba(255,255,255,0.88)', '#ffc629', '#ff6b9d', '#7c5cff'];
const TABS = [
  ['frame', 'Khung'],
  ['layout', 'Bố cục'],
  ['sticker', 'Sticker'],
  ['style', 'Tùy chỉnh'],
  ['text', 'Chữ'],
  ['filter', 'Bộ lọc'],
];
const PREVIEW_CELL = 340;
const MAX_HISTORY = 25;

export function loadStyle(defaults) {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}');
    return { ...defaults, ...raw, adjust: { ...defaults.adjust, ...(raw.adjust || {}) } };
  } catch {
    return defaults;
  }
}
export function saveStyle(opts) {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch { /* private mode */ }
}
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function fileToBoothShot(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = BOOTH_SIZE;
    drawSquare(canvas.getContext('2d'), bitmap, bitmap.width, bitmap.height, BOOTH_SIZE);
    const mini = document.createElement('canvas');
    mini.width = mini.height = 96;
    mini.getContext('2d').drawImage(canvas, 0, 0, 96, 96);
    return { image: canvas, thumb: mini.toDataURL('image/jpeg', 0.7) };
  } finally {
    bitmap.close?.();
  }
}

export function PhotoboothEditor({
  shots,
  takenAt,
  initialFilter,
  initialAmount,
  options,
  onOptions,
  onShots,
  onLook,
  onRetake,
  onDiscard,
  onClose,
  onPost,
}) {
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState('frame');
  const [filter, setFilter] = useState(initialFilter || 'none');
  const [amount, setAmount] = useState(initialAmount ?? 1);
  const [selected, setSelected] = useState(null);       // tapped photo index
  const [swapping, setSwapping] = useState(false);      // waiting to tap second photo to swap
  const [target, setTarget] = useState('all');
  const [picked, setPicked] = useState(null);           // selected sticker id
  const [busy, setBusy] = useState(false);
  const [videoProg, setVideoProg] = useState(null);     // null | 0..1 while rendering video
  const [captionGhost, setCaptionGhost] = useState(true);
  const [assetsTick, setAssetsTick] = useState(0);
  const [templateThumbs, setTemplateThumbs] = useState({});
  const [box, setBox] = useState(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [hist, setHist] = useState({ past: [], future: [] });

  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const baseRef = useRef(null);
  const replaceFileRef = useRef(null);
  const bulkFileRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const opts = useMemo(() => {
    const def = defaultOptions();
    return { ...def, ...options, adjust: { ...def.adjust, ...(options?.adjust || {}) } };
  }, [options]);
  const r = resolved(opts);
  const isLocketView = opts.outputMode !== 'print';
  const sqNative = isSquareNative(opts.layout);

  const pushHistory = useCallback((prevOpts, prevShots) => {
    setHist((h) => ({
      past: [...h.past.slice(-(MAX_HISTORY - 1)), { opts: prevOpts, shots: prevShots }],
      future: [],
    }));
  }, []);

  const setOpt = useCallback((patch, { record = true } = {}) => {
    if (record) pushHistory(opts, shots);
    const next = { ...opts, ...patch };
    onOptions(next);
    saveStyle(next);
  }, [opts, shots, onOptions, pushHistory]);

  const setShotsWithHistory = useCallback((nextShots, { record = true } = {}) => {
    if (record) pushHistory(opts, shots);
    onShots(nextShots);
  }, [opts, shots, onShots, pushHistory]);

  const undo = useCallback(() => {
    setHist((h) => {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      onOptions(prev.opts);
      saveStyle(prev.opts);
      onShots(prev.shots);
      return { past: h.past.slice(0, -1), future: [{ opts, shots }, ...h.future.slice(0, MAX_HISTORY - 1)] };
    });
  }, [opts, shots, onOptions, onShots]);

  const redo = useCallback(() => {
    setHist((h) => {
      if (!h.future.length) return h;
      const next = h.future[0];
      onOptions(next.opts);
      saveStyle(next.opts);
      onShots(next.shots);
      return { past: [...h.past.slice(-(MAX_HISTORY - 1)), { opts, shots }], future: h.future.slice(1) };
    });
  }, [opts, shots, onOptions, onShots]);

  useEffect(() => { onLook?.({ filter, amount }); }, [filter, amount, onLook]);

  useEffect(() => {
    const remove = pushBack(() => onCloseRef.current());
    const t = setTimeout(() => setEntered(true), 20);
    return () => { remove(); clearTimeout(t); };
  }, []);

  // Preload assets for current selection
  const stickerKey = [...new Set((opts.stickers || []).map((s) => `${s.kind || 'svg'}:${s.a || s.font || ''}`))].join(',');
  useEffect(() => {
    let alive = true;
    preloadBooth(opts).then(() => { if (alive) setAssetsTick((n) => n + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.template, opts.texture, opts.font, stickerKey]);

  // Frame thumbnails matching current outputMode (square 1:1 vs classic strip), rendered smoothly via rAF batches
  const thumbModeKey = `${opts.outputMode}:${sqNative ? opts.layout : 'strip'}:${opts.aspect}`;
  useEffect(() => {
    let alive = true;
    let raf = 0;
    setTemplateThumbs({});
    preloadBooth(opts, TEMPLATES).then(() => {
      if (!alive) return;
      let i = 0;
      const step = () => {
        if (!alive) return;
        const batch = {};
        const end = Math.min(i + 2, TEMPLATES.length);
        for (; i < end; i++) {
          const t = TEMPLATES[i];
          const o = {
            ...defaultOptions(),
            outputMode: opts.outputMode,
            layout: opts.outputMode === 'print' ? 'strip' : (sqNative ? opts.layout : 'grid'),
            aspect: opts.aspect,
            template: t.id,
            captionSafe: opts.captionSafe,
            stickers: [],
          };
          const { canvas } = composeBase(shots, o, { cellW: 72, takenAt });
          batch[t.id] = canvas.toDataURL('image/jpeg', 0.8);
        }
        setTemplateThumbs((m) => ({ ...m, ...batch }));
        if (i < TEMPLATES.length) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    return () => { alive = false; cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, thumbModeKey, opts.captionSafe]);

  // 1) Compose base (cached while stickers are dragged)
  const baseKey = JSON.stringify({ ...opts, stickers: undefined });
  useEffect(() => {
    if (!assetsTick) return;
    baseRef.current = composeBase(shots, opts, { filter, amount, adjust: opts.adjust, cellW: PREVIEW_CELL, takenAt });
    setBaseVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, baseKey, filter, amount, takenAt, assetsTick]);

  // 2) Draw base + stickers + cell selection ring
  useEffect(() => {
    const base = baseRef.current;
    const view = canvasRef.current;
    if (!base || !view) return undefined;
    const raf = requestAnimationFrame(() => {
      const g = base.geometry;
      if (view.width !== base.canvas.width || view.height !== base.canvas.height) {
        view.width = base.canvas.width;
        view.height = base.canvas.height;
      }
      const ctx = view.getContext('2d');
      ctx.clearRect(0, 0, view.width, view.height);
      ctx.drawImage(base.canvas, 0, 0);
      drawStickers(ctx, opts.stickers, g);
      if (selected != null && g.cells[selected]) {
        const c = g.cells[selected];
        ctx.save();
        if (c.rot) {
          ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
          ctx.rotate((c.rot * Math.PI) / 180);
          ctx.translate(-(c.x + c.w / 2), -(c.y + c.h / 2));
        }
        ctx.strokeStyle = swapping ? '#5ac8fa' : '#ffc629';
        ctx.lineWidth = Math.max(4, 6 * g.s);
        ctx.strokeRect(c.x - 2 * g.s, c.y - 2 * g.s, c.w + 4 * g.s, c.h + 4 * g.s);
        ctx.restore();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [baseVersion, opts.stickers, selected, swapping, assetsTick]);

  // Keep interactive overlay aligned with canvas
  useLayoutEffect(() => {
    const view = canvasRef.current;
    const stage = stageRef.current;
    if (!view || !stage) return undefined;
    const measure = () => {
      const a = view.getBoundingClientRect();
      const b = stage.getBoundingClientRect();
      setBox({ left: a.left - b.left, top: a.top - b.top, width: a.width, height: a.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [baseVersion, isLocketView]);

  const geo = baseRef.current?.geometry;

  // Tap on canvas background: select or swap photo cell
  const onBackground = (e) => {
    setPicked(null);
    if (!geo || !box) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (((e.clientX - rect.left) / rect.width) * geo.width) % geo.stripW;
    const y = ((e.clientY - rect.top) / rect.height) * geo.height;
    const i = geo.cells.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    if (swapping && selected != null) {
      if (i >= 0 && i !== selected) {
        const next = shots.slice();
        [next[selected], next[i]] = [next[i], next[selected]];
        setShotsWithHistory(next);
        setSelected(i);
        setSwapping(false);
        ui.success(`Đã đổi chỗ Ảnh ${selected + 1} ↔ Ảnh ${i + 1}`);
        return;
      }
      setSwapping(false);
      return;
    }
    setSelected(i >= 0 && i !== selected ? i : null);
    setTarget(i >= 0 && i !== selected ? 'selected' : 'all');
  };

  /* ---------------- stickers (SVG, Emoji, Floating Text) */
  const changeSticker = useCallback((id, patch) => {
    const next = { ...opts, stickers: opts.stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
    onOptions(next);
    saveStyle(next);
  }, [opts, onOptions]);

  const removeSticker = (id) => { setOpt({ stickers: opts.stickers.filter((s) => s.id !== id) }); setPicked(null); };

  const addSvgSticker = (a) => {
    const st = { id: newId(), kind: 'svg', a, x: 0.5, y: 0.44, w: a.startsWith('tape') ? 0.3 : 0.2, rot: Math.round(Math.random() * 14 - 7) };
    setOpt({ stickers: [...opts.stickers, st] });
    setPicked(st.id);
    setSelected(null);
  };

  const addEmojiSticker = (emoji) => {
    const st = { id: newId(), kind: 'emoji', text: emoji, outline: true, x: 0.5, y: 0.44, w: 0.16, rot: Math.round(Math.random() * 16 - 8) };
    setOpt({ stickers: [...opts.stickers, st] });
    setPicked(st.id);
    setSelected(null);
  };

  const addOrEditTextSticker = async (existing = null) => {
    const res = await ui.alert({
      title: existing ? 'Sửa nhãn chữ' : 'Thêm chữ kéo thả tự do',
      message: 'Bạn có thể kéo thả, phóng to và xoay chữ đặt ở bất kỳ đâu trên ảnh.',
      input: { value: existing?.text || '', placeholder: 'Vd: đi chơi nè ✨', maxlength: 48 },
      buttons: [{ label: 'Hủy' }, { label: existing ? 'Lưu' : 'Thêm', bold: true }],
    });
    const text = res.text?.trim();
    if (res.index !== 1 || !text) return;
    if (existing) {
      setOpt({ stickers: opts.stickers.map((s) => (s.id === existing.id ? { ...s, text } : s)) });
      return;
    }
    const st = {
      id: newId(),
      kind: 'text',
      text,
      font: r.font,
      color: '#ffffff',
      bg: 'rgba(0,0,0,0.62)',
      x: 0.5,
      y: 0.48,
      w: 0.26,
      rot: 0,
    };
    setOpt({ stickers: [...opts.stickers, st] });
    setPicked(st.id);
    setSelected(null);
  };

  const pickedSticker = opts.stickers.find((s) => s.id === picked);
  const duplicate = () => {
    if (!pickedSticker) return;
    const st = { ...pickedSticker, id: newId(), x: clamp(pickedSticker.x + 0.06, 0, 1), y: clamp(pickedSticker.y + 0.04, 0, 1) };
    setOpt({ stickers: [...opts.stickers, st] });
    setPicked(st.id);
  };
  const toFront = () => { if (pickedSticker) setOpt({ stickers: [...opts.stickers.filter((s) => s.id !== picked), pickedSticker] }); };

  const keyStateRef = useRef(null);
  keyStateRef.current = { picked, stickers: opts.stickers, removeSticker, changeSticker, undo, redo };
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea')) return;
      const stRef = keyStateRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) stRef.redo(); else stRef.undo();
        return;
      }
      const { picked: id, stickers, removeSticker: del, changeSticker: upd } = stRef;
      if (!id) return;
      const st = stickers.find((s) => s.id === id);
      if (!st) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); del(id); }
      const step = e.shiftKey ? 0.02 : 0.005;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) { e.preventDefault(); upd(id, { x: st.x + moves[e.key][0], y: st.y + moves[e.key][1] }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------------- template & per-shot actions */
  const chooseTemplate = (id) => setOpt({
    template: id, bg: null, texture: null, border: 'template', radius: null, gap: null, text: null, font: null, textColor: null,
    decorDetached: false, stickers: opts.stickers.filter((s) => !s.id.startsWith('d')),
  });
  const detachDecor = () => {
    setOpt({ decorDetached: true, stickers: [...decorAsStickers(shots.length, opts), ...opts.stickers] });
    setTab('sticker');
    ui.info('Trang trí của khung giờ là sticker: kéo, xoay, phóng to hoặc xóa từng hình');
  };
  const restoreDecor = () => setOpt({ decorDetached: false, stickers: opts.stickers.filter((s) => !s.id.startsWith('d')) });

  const updateSelectedShot = (patch, { record = false } = {}) => {
    if (selected == null) return;
    setShotsWithHistory(shots.map((s, i) => (i === selected ? { ...s, ...patch } : s)), { record });
  };

  const onReplaceSingleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || selected == null) return;
    try {
      const nextShot = await fileToBoothShot(file);
      setShotsWithHistory(shots.map((s, i) => (i === selected ? { ...s, ...nextShot, zoom: 1, panX: 0, panY: 0, flip: false } : s)));
      ui.success(`Đã thay Ảnh ${selected + 1} từ thư viện`);
    } catch {
      ui.warning('Không đọc được ảnh này');
    }
  };

  const onReplaceBulkFiles = async (e) => {
    const files = [...(e.target.files || [])].slice(0, 6);
    e.target.value = '';
    if (!files.length) return;
    try {
      const loaded = await Promise.all(files.map(fileToBoothShot));
      setShotsWithHistory(loaded);
      setSelected(null);
      setSwapping(false);
      ui.success(`Đã tải ${loaded.length} ảnh từ thư viện`);
    } catch {
      ui.warning('Không đọc được một số ảnh đã chọn');
    }
  };

  /* ---------------- filters & quick retouch */
  const thumbSource = shots[selected ?? 0]?.image;
  const filterThumbs = useMemo(() => {
    if (!thumbSource || tab !== 'filter') return {};
    const out = {};
    FILTERS.forEach((f) => {
      try { out[f.id] = filteredCanvas(thumbSource, { filter: f.id, amount: 1, width: 96, height: 128 }).toDataURL('image/jpeg', 0.7); } catch { /* skip */ }
    });
    return out;
  }, [thumbSource, tab]);
  const currentFilter = target === 'selected' && selected != null ? (shots[selected]?.filter || filter) : filter;
  const currentAmount = target === 'selected' && selected != null ? (shots[selected]?.amount ?? amount) : amount;
  const chooseFilter = (id) => {
    if (target === 'selected' && selected != null) {
      setShotsWithHistory(shots.map((s, i) => (i === selected ? { ...s, filter: id, amount: s.amount ?? amount } : s)));
    } else {
      setFilter(id);
      setShotsWithHistory(shots.map((s) => ({ ...s, filter: null, amount: null })));
    }
  };
  const chooseAmount = (v) => {
    if (target === 'selected' && selected != null) {
      onShots(shots.map((s, i) => (i === selected ? { ...s, filter: s.filter || filter, amount: v } : s)));
    } else setAmount(v);
  };
  const setAdjust = (patch) => setOpt({ adjust: { ...opts.adjust, ...patch } }, { record: false });
  const hasAdjust = Math.abs(opts.adjust.brightness) > 0.005 || Math.abs(opts.adjust.contrast) > 0.005 || Math.abs(opts.adjust.warmth) > 0.005;

  /* ---------------- save / post / animated video */
  const close = async () => {
    if (!await ui.confirm('Bỏ bộ ảnh Photobooth này?', 'Các ảnh vừa chụp sẽ không được lưu.', 'Bỏ')) return;
    onDiscard();
    history.back();
  };

  const exportCanvas = async (overrideMode, cellW) => {
    const o = overrideMode ? { ...opts, outputMode: overrideMode } : opts;
    await preloadBooth(o);
    return compose(shots, o, { filter, amount, adjust: o.adjust, cellW, takenAt }).canvas;
  };

  const save = async () => {
    const choice = await ui.actionSheet({
      title: 'Lưu về thiết bị',
      actions: [
        { label: 'Bản vuông Locket 1:1 (1080×1080 JPEG)', value: 'locket' },
        { label: 'Bản dải in gốc (JPEG chất lượng cao)', value: 'print-jpg' },
        { label: 'Ảnh PNG không nén (theo chế độ đang xem)', value: 'png' },
        { label: `Từng ảnh riêng lẻ (${shots.length} ảnh)`, value: 'each' },
      ],
    });
    if (!choice) return;
    setBusy(true);
    try {
      if (choice === 'each') {
        const g = geometry(shots.length, opts, 600);
        for (let i = 0; i < shots.length; i++) {
          const s = shots[i];
          const c = filteredCanvas(s.image, {
            filter: s.filter || filter,
            amount: s.filter ? s.amount ?? amount : amount,
            width: 1080,
            height: 1080,
            mirror: !!s.flip,
            adjust: opts.adjust,
          });
          downloadBlob(await canvasToBlob(c, 'image/jpeg', 0.95), `locket-photobooth-${takenAt}-${i + 1}.jpg`);
          await new Promise((res) => setTimeout(res, 320));
        }
        void g;
        ui.success(`Đã lưu ${shots.length} ảnh riêng lẻ`);
      } else if (choice === 'locket') {
        const canvas = await exportCanvas('locket', 600);
        const sq = toSquare(canvas, opts, 1080);
        downloadBlob(await canvasToBlob(sq, 'image/jpeg', 0.96), `locket-booth-1x1-${takenAt}.jpg`);
        ui.success(`Đã lưu ảnh vuông ${sq.width}×${sq.height}`);
      } else if (choice === 'print-jpg') {
        const canvas = await exportCanvas('print', 900);
        downloadBlob(await canvasToBlob(canvas, 'image/jpeg', 0.95), `locket-booth-strip-${takenAt}.jpg`);
        ui.success(`Đã lưu dải in ${canvas.width}×${canvas.height}`);
      } else {
        const canvas = await exportCanvas(null, isLocketView ? 600 : 900);
        downloadBlob(await canvasToBlob(canvas, 'image/png', 1), `locket-booth-${takenAt}.png`);
        ui.success(`Đã lưu ảnh PNG ${canvas.width}×${canvas.height}`);
      }
    } catch {
      ui.error('Không lưu được ảnh');
    } finally {
      setBusy(false);
    }
  };

  const postPhoto = async () => {
    setBusy(true);
    try {
      const canvas = await exportCanvas('locket', 600);
      const sq = toSquare(canvas, opts, 1080);
      const blob = await canvasToBlob(sq, 'image/jpeg', 0.96);
      onPost({ image: blob, fromBooth: true });
      history.back();
    } catch {
      ui.error('Không xuất được ảnh Photobooth');
    } finally {
      setBusy(false);
    }
  };

  const postVideo = async () => {
    const mod = await import('../lib/boothVideo.js');
    if (!mod.canExportBoothVideo()) {
      ui.warning('Trình duyệt này chưa hỗ trợ xuất video động Photobooth. Bạn hãy dùng nút Đăng Locket (ảnh 1:1) nhé.');
      return;
    }
    const style = await ui.actionSheet({
      title: 'Chọn hiệu ứng Video Photobooth (1:1)',
      actions: mod.VIDEO_STYLES.map((v) => ({ label: `${v.name} — ${v.desc}`, value: v.id })),
    });
    if (!style) return;
    setBusy(true);
    setVideoProg(0);
    try {
      const res = await mod.renderBoothVideo({
        shots,
        opts,
        filter,
        amount,
        takenAt,
        style,
        size: 900,
        onProgress: (p) => setVideoProg(p),
      });
      onPost({ image: res.image, video: res.video, mirrorVideo: false, seconds: res.seconds, audio: false, fromBooth: true });
      history.back();
    } catch (err) {
      ui.error(err?.message || 'Không tạo được video động');
    } finally {
      setBusy(false);
      setVideoProg(null);
    }
  };

  const tpl = templateById(opts.template);
  const canDetachDecor = tpl.decor.length > 0 && (sqNative || !isLocketView);

  return createPortal(
    <div className={`booth-editor force-dark ${entered ? 'in' : ''}`} role="dialog" aria-label="Chỉnh sửa photobooth">
      <header className="booth-top">
        <div className="booth-top-left">
          <button type="button" className="icon-btn" aria-label="Bỏ" onClick={close}><Icon name="closeSm" /></button>
          <button type="button" className="icon-btn sm" aria-label="Hoàn tác" title="Hoàn tác (Ctrl+Z)" disabled={!hist.past.length} onClick={undo}><Icon name="undo" /></button>
          <button type="button" className="icon-btn sm" aria-label="Làm lại" title="Làm lại (Ctrl+Shift+Z)" disabled={!hist.future.length} onClick={redo}><Icon name="redo" /></button>
        </div>
        <div className="booth-mode-switch" role="group" aria-label="Chế độ khung hình">
          <button type="button" className={isLocketView ? 'on' : ''} onClick={() => setOpt({ outputMode: 'locket' })}>
            <Icon name="square" /><span>Locket 1:1</span>
          </button>
          <button type="button" className={!isLocketView ? 'on' : ''} onClick={() => setOpt({ outputMode: 'print' })}>
            <Icon name="strip" /><span>Dải gốc</span>
          </button>
        </div>
        <button type="button" className="icon-btn" aria-label="Lưu về thiết bị" disabled={busy} onClick={save}>
          {busy && videoProg == null ? <span className="spinner sm" /> : <Icon name="download" />}
        </button>
      </header>

      <div className="booth-stage" ref={stageRef}>
        <canvas ref={canvasRef} className={`booth-canvas ${isLocketView ? 'locket-card' : ''}`} aria-label="Khung ảnh photobooth" />
        {box && geo ? (
          <StickerLayer
            stickers={opts.stickers}
            box={box}
            twin={geo.twin}
            selected={picked}
            onSelect={(id) => { setPicked(id); setSelected(null); setSwapping(false); }}
            onChange={changeSticker}
            onRemove={removeSticker}
            onEditText={addOrEditTextSticker}
            onBackground={onBackground}
          />
        ) : null}
        {isLocketView && box && captionGhost ? (
          <div className="booth-caption-ghost" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} aria-hidden="true">
            <span>Vị trí caption Locket</span>
          </div>
        ) : null}
        {isLocketView ? (
          <button type="button" className={`booth-ghost-toggle ${captionGhost ? 'on' : ''}`}
            title={captionGhost ? 'Ẩn mô phỏng vùng caption Locket' : 'Hiện mô phỏng vùng caption Locket'}
            onClick={() => setCaptionGhost((v) => !v)}>
            {captionGhost ? 'Ẩn vùng caption' : 'Xem vùng caption'}
          </button>
        ) : null}
        {videoProg != null ? (
          <div className="booth-video-busy">
            <span className="spinner lg" />
            <b>Đang tạo video động… {Math.round(videoProg * 100)}%</b>
          </div>
        ) : !assetsTick ? <div className="booth-loading"><span className="spinner lg" /></div> : null}
      </div>

      <div className="booth-panel">
        {pickedSticker ? (
          <div className="booth-selected">
            {pickedSticker.kind === 'emoji' ? (
              <span className="stk-preview-emoji">{pickedSticker.text}</span>
            ) : pickedSticker.kind === 'text' ? (
              <span className="stk-preview-txt">Aa</span>
            ) : (
              <img src={stickerUrl(pickedSticker.a)} alt="" />
            )}
            <span>{pickedSticker.kind === 'text' ? 'Chạm đúp để sửa · kéo để dời' : 'Kéo để dời · góc để xoay/phóng'}</span>
            {pickedSticker.kind === 'text' ? (
              <>
                <button type="button" className="icon-btn sm" aria-label="Sửa chữ" title="Sửa chữ" onClick={() => addOrEditTextSticker(pickedSticker)}><Icon name="pencil" /></button>
                <button type="button" className="icon-btn sm" aria-label="Đổi nền chữ" title="Đổi nền chữ" onClick={() => {
                  const idx = TEXT_BGS.indexOf(pickedSticker.bg || 'none');
                  const nextBg = TEXT_BGS[(idx + 1) % TEXT_BGS.length];
                  const nextColor = nextBg === 'rgba(255,255,255,0.88)' || nextBg === '#ffc629' ? '#1c1c1e' : '#ffffff';
                  changeSticker(pickedSticker.id, { bg: nextBg, color: nextColor });
                }}><Icon name="sparkles" /></button>
              </>
            ) : null}
            {pickedSticker.kind === 'emoji' ? (
              <button type="button" className={`chip xs ${pickedSticker.outline !== false ? 'on' : ''}`}
                onClick={() => changeSticker(pickedSticker.id, { outline: pickedSticker.outline === false })}>Viền</button>
            ) : null}
            <button type="button" className="icon-btn sm" aria-label="Đưa lên trên" title="Đưa lên trên" onClick={toFront}><Icon name="arrowUp" /></button>
            <button type="button" className="icon-btn sm" aria-label="Nhân bản" title="Nhân bản" onClick={duplicate}><Icon name="copy" /></button>
            <button type="button" className="icon-btn sm danger" aria-label="Xóa sticker" title="Xóa" onClick={() => removeSticker(picked)}><Icon name="trash" /></button>
          </div>
        ) : selected != null ? (
          <CellAdjustBar
            index={selected}
            shot={shots[selected]}
            swapping={swapping}
            onRetake={() => { onRetake(selected); history.back(); }}
            onReplaceFile={() => replaceFileRef.current?.click()}
            onToggleSwap={() => setSwapping((v) => !v)}
            onUpdateShot={(patch) => updateSelectedShot(patch)}
            onResetTransform={() => updateSelectedShot({ zoom: 1, panX: 0, panY: 0, flip: false }, { record: true })}
            onDeselect={() => { setSelected(null); setSwapping(false); setTarget('all'); }}
          />
        ) : null}

        <div className="booth-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        <div className="booth-tab">
          {tab === 'frame' ? (
            <>
              {TEMPLATE_GROUPS.map((group) => (
                <section key={group} className="booth-group">
                  <h4>{group}</h4>
                  <div className="tpl-row">
                    {TEMPLATES.filter((t) => t.group === group).map((t) => (
                      <button key={t.id} type="button" className={`tpl ${isLocketView ? 'sq' : ''} ${opts.template === t.id ? 'on' : ''}`} onClick={() => chooseTemplate(t.id)}>
                        {templateThumbs[t.id] ? <img src={templateThumbs[t.id]} alt="" /> : <i className="sk" />}
                        <span>{t.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {canDetachDecor ? (
                <div className="booth-inline">
                  {opts.decorDetached
                    ? <Button variant="secondary" size="sm" onClick={restoreDecor}>Khôi phục trang trí gốc</Button>
                    : <Button variant="tinted" size="sm" icon="pencil" onClick={detachDecor}>Chỉnh trang trí của khung</Button>}
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'layout' ? (
            <>
              <section className="booth-group">
                <h4>Kiểu bố cục ({shots.length} ảnh)</h4>
                <div className="booth-toggles">
                  {LAYOUTS.map((l) => (
                    <button key={l.id} type="button" className={`chip ${opts.layout === l.id ? 'on' : ''}`} onClick={() => setOpt({ layout: l.id })}>
                      {l.name}
                    </button>
                  ))}
                </div>
              </section>

              {isLocketView ? (
                <section className="booth-group">
                  <h4>Tối ưu bảng tin Locket 1:1</h4>
                  <div className="booth-toggles">
                    <button type="button" className={`chip ${opts.captionSafe !== false ? 'on' : ''}`}
                      onClick={() => setOpt({ captionSafe: opts.captionSafe === false })}>
                      {opts.captionSafe !== false ? '✓ Chừa vùng Caption Locket' : 'Chừa vùng Caption Locket'}
                    </button>
                    {opts.layout === 'double' ? (
                      <button type="button" className={`chip ${opts.twinFan !== false ? 'on' : ''}`}
                        onClick={() => setOpt({ twinFan: opts.twinFan === false })}>
                        {opts.twinFan !== false ? '✓ Xếp nghiêng 2 dải' : 'Xếp nghiêng 2 dải'}
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {isLocketView && !sqNative ? (
                <section className="booth-group">
                  <h4>Nền khung vuông 1:1 (cho kiểu Dải)</h4>
                  <div className="booth-toggles">
                    {BACKDROPS.map((b) => (
                      <button key={b.id} type="button" className={`chip ${(opts.backdrop || 'theme') === b.id ? 'on' : ''}`} onClick={() => setOpt({ backdrop: b.id })}>
                        {b.name}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {!isLocketView || !sqNative ? (
                <section className="booth-group">
                  <h4>Tỉ lệ từng ô ảnh</h4>
                  <div className="booth-toggles">
                    {ASPECTS.map((a) => (
                      <button key={a.id} type="button" className={`chip ${opts.aspect === a.id ? 'on' : ''}`} onClick={() => setOpt({ aspect: a.id })}>{a.name}</button>
                    ))}
                  </div>
                </section>
              ) : null}

              <div className="booth-inline">
                <Button variant="secondary" size="sm" icon="gallery" onClick={() => bulkFileRef.current?.click()}>
                  Chọn bộ ảnh khác từ thư viện (2–6 ảnh)
                </Button>
              </div>
              <p className="booth-hint">Mẹo: Chạm vào bất kỳ ô ảnh nào để chụp lại, đổi ảnh từ máy, đổi vị trí (Swap), lật ngang hoặc phóng to căn mặt.</p>
            </>
          ) : null}

          {tab === 'sticker' ? (
            <>
              <div className="booth-inline">
                <Button variant="tinted" size="sm" icon="type" onClick={() => addOrEditTextSticker(null)}>Thêm chữ kéo thả tự do</Button>
              </div>
              <section className="booth-group">
                <h4>Emoji dán nhanh</h4>
                <div className="emoji-grid">
                  {EMOJI_STICKERS.map((em) => (
                    <button key={em} type="button" className="emoji-pick" aria-label={`Thêm emoji ${em}`} onClick={() => addEmojiSticker(em)}>
                      {em}
                    </button>
                  ))}
                </div>
              </section>
              {STICKER_GROUPS.map((group) => (
                <section key={group.id} className="booth-group">
                  <h4>{group.name}</h4>
                  <div className="stk-grid">
                    {group.items.map((a) => (
                      <button key={a} type="button" className="stk-pick" aria-label={`Thêm sticker ${a}`} onClick={() => addSvgSticker(a)}>
                        <img src={stickerUrl(a)} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {opts.stickers.length ? (
                <div className="booth-inline">
                  <Button variant="destructive-tinted" size="sm" icon="trash" onClick={() => { setOpt({ stickers: [] }); setPicked(null); }}>
                    Gỡ tất cả sticker ({opts.stickers.length})
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'style' ? (
            <>
              <section className="booth-group">
                <h4>Màu nền</h4>
                <div className="swatch-row">
                  <button type="button" className={`swatch reset ${!opts.bg ? 'on' : ''}`} aria-label="Màu theo khung" onClick={() => setOpt({ bg: null })}><Icon name="check" /></button>
                  {SWATCHES.map((c) => (
                    <button key={c} type="button" className={`swatch ${opts.bg === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Màu nền ${c}`} onClick={() => setOpt({ bg: c })} />
                  ))}
                  <label className="swatch custom" aria-label="Chọn màu khác"><input type="color" value={opts.bg || '#ffffff'} onChange={(e) => setOpt({ bg: e.target.value }, { record: false })} /><Icon name="plus" /></label>
                </div>
              </section>
              <section className="booth-group">
                <h4>Texture</h4>
                <div className="tex-row">
                  <button type="button" className={`tex ${opts.texture == null ? 'on' : ''}`} onClick={() => setOpt({ texture: null })}><i className="tex-auto">Aa</i><span>Theo khung</span></button>
                  {TEXTURES.map((x) => (
                    <button key={x.id} type="button" className={`tex ${opts.texture === x.id ? 'on' : ''}`} onClick={() => setOpt({ texture: x.id })}>
                      <i style={x.id === 'none' ? undefined : { backgroundImage: `url(${textureUrl(x.id)})` }} />
                      <span>{x.name}</span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="booth-group">
                <h4>Kiểu viền ảnh</h4>
                <div className="booth-toggles">
                  {BORDERS.map((b) => <button key={b.id} type="button" className={`chip ${opts.border === b.id ? 'on' : ''}`} onClick={() => setOpt({ border: b.id })}>{b.name}</button>)}
                </div>
              </section>
              <label className="booth-slider">Bo góc <input type="range" min="0" max="40" step="1" value={r.radius} onChange={(e) => setOpt({ radius: Number(e.target.value) }, { record: false })} /><b>{r.radius}</b></label>
              <label className="booth-slider">Khoảng cách <input type="range" min="4" max="48" step="1" value={r.gap} onChange={(e) => setOpt({ gap: Number(e.target.value) }, { record: false })} /><b>{r.gap}</b></label>
            </>
          ) : null}

          {tab === 'text' ? (
            <>
              <input className="booth-text" type="text" maxLength={40} placeholder={tpl.footer.text || 'Thêm chữ trên khung ảnh…'} value={opts.text ?? tpl.footer.text}
                onChange={(e) => setOpt({ text: e.target.value }, { record: false })} />
              <div className="booth-inline">
                <Button variant="tinted" size="sm" icon="type" onClick={() => addOrEditTextSticker(null)}>+ Thêm chữ kéo thả tự do</Button>
              </div>
              <section className="booth-group">
                <h4>Font chữ</h4>
                <div className="font-row">
                  {FONTS.map((f) => (
                    <button key={f.id} type="button" className={`font-chip ${r.font === f.id ? 'on' : ''}`} style={{ fontFamily: f.css, fontStyle: f.style || 'normal', fontWeight: f.weight || 400 }}
                      onClick={() => setOpt({ font: f.id })}>{f.name}</button>
                  ))}
                </div>
              </section>
              <section className="booth-group">
                <h4>Màu chữ</h4>
                <div className="swatch-row">
                  <button type="button" className={`swatch reset ${!opts.textColor ? 'on' : ''}`} aria-label="Màu chữ theo khung" onClick={() => setOpt({ textColor: null })}><Icon name="check" /></button>
                  {INKS.map((c) => <button key={c} type="button" className={`swatch ${opts.textColor === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Màu chữ ${c}`} onClick={() => setOpt({ textColor: c })} />)}
                </div>
              </section>
              <section className="booth-group">
                <h4>Ngày chụp</h4>
                <div className="booth-toggles">
                  <button type="button" className={`chip ${opts.showDate ? 'on' : ''}`} onClick={() => setOpt({ showDate: !opts.showDate })}>{opts.showDate ? 'Đang hiện' : 'Đang ẩn'}</button>
                  {DATE_FORMATS.map((d) => <button key={d.id} type="button" className={`chip ${opts.dateFormat === d.id ? 'on' : ''}`} disabled={!opts.showDate} onClick={() => setOpt({ dateFormat: d.id })}>{d.name}</button>)}
                </div>
                <div className="booth-toggles" style={{ marginTop: 8 }}>
                  {DATE_POSITIONS.map((d) => <button key={d.id} type="button" className={`chip ${opts.datePos === d.id ? 'on' : ''}`} disabled={!opts.showDate} onClick={() => setOpt({ datePos: d.id })}>{d.name}</button>)}
                </div>
              </section>
            </>
          ) : null}

          {tab === 'filter' ? (
            <>
              <div className="segmented booth-target">
                <button type="button" className={target === 'all' ? 'on' : ''} onClick={() => setTarget('all')}>Cả bộ ảnh</button>
                <button type="button" className={target === 'selected' ? 'on' : ''} disabled={selected == null}
                  onClick={() => setTarget('selected')}>{selected == null ? 'Chạm 1 ảnh để chọn' : `Ảnh ${selected + 1}`}</button>
              </div>
              <div className="filter-row">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" className={`filter-chip ${currentFilter === f.id ? 'on' : ''}`} onClick={() => chooseFilter(f.id)}>
                    {filterThumbs[f.id] ? <img src={filterThumbs[f.id]} alt="" /> : <i />}
                    <span>{f.name}</span>
                  </button>
                ))}
              </div>
              {currentFilter !== 'none' ? (
                <label className="booth-slider">Cường độ <input type="range" min="0" max="1" step="0.05" value={currentAmount} onChange={(e) => chooseAmount(Number(e.target.value))} /><b>{Math.round(currentAmount * 100)}%</b></label>
              ) : null}
              <section className="booth-group">
                <div className="booth-group-head">
                  <h4>Chỉnh ánh sáng nhanh</h4>
                  {hasAdjust ? <button type="button" className="link-btn" onClick={() => setOpt({ adjust: { brightness: 0, contrast: 0, warmth: 0 } })}>Đặt lại</button> : null}
                </div>
                <label className="booth-slider">Độ sáng <input type="range" min="-1" max="1" step="0.05" value={opts.adjust.brightness} onChange={(e) => setAdjust({ brightness: Number(e.target.value) })} /><b>{Math.round(opts.adjust.brightness * 100)}</b></label>
                <label className="booth-slider">Tương phản <input type="range" min="-1" max="1" step="0.05" value={opts.adjust.contrast} onChange={(e) => setAdjust({ contrast: Number(e.target.value) })} /><b>{Math.round(opts.adjust.contrast * 100)}</b></label>
                <label className="booth-slider">Ấm màu <input type="range" min="-1" max="1" step="0.05" value={opts.adjust.warmth} onChange={(e) => setAdjust({ warmth: Number(e.target.value) })} /><b>{Math.round(opts.adjust.warmth * 100)}</b></label>
              </section>
            </>
          ) : null}
        </div>

        <div className="booth-actions">
          <Button variant="secondary" icon="camera" disabled={busy} onClick={() => { onRetake('all'); history.back(); }}>Chụp lại</Button>
          <Button variant="tinted" icon="film" disabled={busy} onClick={postVideo}>Video động</Button>
          <Button variant="primary" icon="send" disabled={busy} onClick={postPhoto}>Đăng Locket</Button>
        </div>
      </div>

      <input ref={replaceFileRef} type="file" accept="image/*" hidden onChange={onReplaceSingleFile} />
      <input ref={bulkFileRef} type="file" accept="image/*" multiple hidden onChange={onReplaceBulkFiles} />
    </div>,
    document.getElementById('layers'),
  );
}
