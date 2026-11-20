// Photobooth editor: frame templates with real illustrations, draggable / scalable / rotatable SVG stickers,
// textures, borders, fonts, date, filters and layout. The preview and the export use the same renderer
// (lib/photobooth.js), so the saved file matches the screen. Posting hands a square version to the camera's
// normal send flow (caption, recipients, postMomentV2).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../lib/icons.jsx';
import { downloadBlob } from '../lib/format.js';
import { FILTERS, filteredCanvas } from '../lib/filters.js';
import { BORDERS, FONTS, STICKER_GROUPS, TEMPLATES, TEMPLATE_GROUPS, TEXTURES, stickerUrl, templateById, textureUrl } from '../lib/boothAssets.js';
import {
  ASPECTS, DATE_FORMATS, DATE_POSITIONS, LAYOUTS, canvasToBlob, compose, composeBase, decorAsStickers, defaultOptions,
  drawStickers, geometry, preloadBooth, resolved, stickerImage, toSquare,
} from '../lib/photobooth.js';
import { pushBack } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { Button } from '../ui/kit.jsx';

const OPTS_KEY = 'locket.booth.style.v2';
const SWATCHES = ['#ffffff', '#111111', '#fff3df', '#ffe6ee', '#e8f7ee', '#d8ecff', '#e6dcff', '#fff8d8', '#e9d9bd', '#1d2547', '#ffd1dc', '#c7d2ff'];
const INKS = ['#1c1c1e', '#ffffff', '#8a5a3b', '#d0587e', '#3f8a64', '#5a7fbf', '#5b3fd1', '#e2557a', '#c8325a', '#ff9f43', '#7a4f32', '#ffe8a3'];
const TABS = [['frame', 'Khung'], ['sticker', 'Sticker'], ['style', 'Tùy chỉnh'], ['text', 'Chữ'], ['filter', 'Bộ lọc'], ['layout', 'Bố cục']];
const PREVIEW_CELL = 360;

export function loadStyle(defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(OPTS_KEY) || '{}') }; } catch { return defaults; }
}
export function saveStyle(opts) {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch { /* private mode */ }
}
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ sticker layer (drag / pinch / rotate) */
function StickerLayer({ stickers, box, twin, selected, onSelect, onChange, onRemove, onBackground }) {
  const gesture = useRef(null);
  const sw = box.width / twin;
  const sh = box.height;

  const startMove = (e, st) => {
    e.stopPropagation();
    onSelect(st.id);
    const g = gesture.current?.id === st.id ? gesture.current : { id: st.id, pointers: new Map(), start: { ...st } };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g.start = { ...st };
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.pinch = { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    } else {
      g.origin = { x: e.clientX, y: e.clientY };
      g.pinch = null;
    }
    gesture.current = g;
  };
  const move = (e, st) => {
    const g = gesture.current;
    if (!g || g.id !== st.id || !g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (g.pinch && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      onChange(st.id, { w: clamp(g.start.w * (d / g.pinch.d), 0.04, 1.4), rot: g.start.rot + ((ang - g.pinch.ang) * 180) / Math.PI });
    } else if (g.origin) {
      onChange(st.id, {
        x: clamp(g.start.x + (e.clientX - g.origin.x) / sw, -0.1, 1.1),
        y: clamp(g.start.y + (e.clientY - g.origin.y) / sh, -0.05, 1.05),
      });
    }
  };
  const end = (e) => {
    const g = gesture.current;
    if (!g) return;
    g.pointers.delete(e.pointerId);
    if (!g.pointers.size) gesture.current = null;
    else { g.pinch = null; g.origin = null; }
  };
  // corner handle: distance from the centre scales, angle rotates
  const startHandle = (e, st, center) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const d0 = Math.hypot(e.clientX - center.x, e.clientY - center.y) || 1;
    const a0 = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    gesture.current = { id: st.id, handle: { center, d0, a0, start: { ...st } }, pointers: new Map([[e.pointerId, {}]]) };
  };
  const moveHandle = (e, st) => {
    const g = gesture.current;
    if (!g?.handle || g.id !== st.id) return;
    const { center, d0, a0, start } = g.handle;
    const d = Math.hypot(e.clientX - center.x, e.clientY - center.y);
    const a = Math.atan2(e.clientY - center.y, e.clientX - center.x);
    onChange(st.id, { w: clamp(start.w * (d / d0), 0.04, 1.4), rot: start.rot + ((a - a0) * 180) / Math.PI });
  };

  return (
    <div className="stk-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onBackground(e); }}>
      {stickers.map((st) => {
        const img = stickerImage(st.a);
        const ratio = img ? img.naturalHeight / img.naturalWidth : 1;
        const w = st.w * sw;
        const h = w * ratio;
        const on = selected === st.id;
        return (
          <div key={st.id} className={`stk ${on ? 'on' : ''}`}
            style={{ left: st.x * sw, top: st.y * sh, width: w, height: h, transform: `translate(-50%, -50%) rotate(${st.rot}deg)` }}
            onPointerDown={(e) => startMove(e, st)} onPointerMove={(e) => move(e, st)} onPointerUp={end} onPointerCancel={end}
            onWheel={(e) => { e.preventDefault(); onSelect(st.id); onChange(st.id, { w: clamp(st.w * (e.deltaY < 0 ? 1.06 : 0.94), 0.04, 1.4) }); }}>
            {on ? (
              <>
                <button type="button" className="stk-del" aria-label="Xóa sticker" onPointerDown={(e) => e.stopPropagation()} onClick={() => onRemove(st.id)}><Icon name="closeSm" /></button>
                <span className="stk-handle" aria-label="Phóng to, thu nhỏ hoặc xoay"
                  onPointerDown={(e) => {
                    const r = e.currentTarget.parentElement.getBoundingClientRect();
                    startHandle(e, st, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
                  }}
                  onPointerMove={(e) => moveHandle(e, st)} onPointerUp={end} onPointerCancel={end}><Icon name="arrowRight" /></span>
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ editor */
export function PhotoboothEditor({ shots, takenAt, initialFilter, initialAmount, options, onOptions, onShots, onLook, onRetake, onDiscard, onClose, onPost }) {
  const [entered, setEntered] = useState(false);
  const [tab, setTab] = useState('frame');
  const [filter, setFilter] = useState(initialFilter || 'none');
  const [amount, setAmount] = useState(initialAmount ?? 1);
  const [selected, setSelected] = useState(null);       // tapped photo
  const [target, setTarget] = useState('all');
  const [picked, setPicked] = useState(null);           // selected sticker id
  const [busy, setBusy] = useState(false);
  const [assetsTick, setAssetsTick] = useState(0);
  const [templateThumbs, setTemplateThumbs] = useState({});
  const [box, setBox] = useState(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const baseRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const opts = useMemo(() => ({ ...defaultOptions(), ...options }), [options]);
  const setOpt = useCallback((patch) => {
    const next = { ...opts, ...patch };
    onOptions(next);
    saveStyle(next);
  }, [opts, onOptions]);
  useEffect(() => { onLook?.({ filter, amount }); }, [filter, amount, onLook]);
  const r = resolved(opts);

  useEffect(() => {
    const remove = pushBack(() => onCloseRef.current());
    const t = setTimeout(() => setEntered(true), 20);
    return () => { remove(); clearTimeout(t); };
  }, []);

  // assets (SVG illustrations, textures, fonts) for what is on screen
  const stickerKey = [...new Set(opts.stickers.map((s) => s.a))].join(',');
  useEffect(() => {
    let alive = true;
    preloadBooth(opts).then(() => { if (alive) setAssetsTick((n) => n + 1); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.template, opts.texture, opts.font, stickerKey]);

  // frame thumbnails, rendered from the real shots (once all templates' assets are in)
  useEffect(() => {
    let alive = true;
    const timers = [];
    preloadBooth(opts, TEMPLATES).then(() => {
      TEMPLATES.forEach((t, i) => {
        timers.push(setTimeout(() => {
          if (!alive) return;
          const o = { ...defaultOptions(), template: t.id, layout: 'strip', aspect: opts.aspect, stickers: [] };
          const { canvas } = composeBase(shots, o, { cellW: 64, takenAt });
          setTemplateThumbs((m) => ({ ...m, [t.id]: canvas.toDataURL('image/jpeg', 0.82) }));
        }, 40 * i));
      });
    });
    return () => { alive = false; timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, opts.aspect]);

  // 1) everything except stickers -> cached base (photos are filtered here, the slow part)
  const baseKey = JSON.stringify({ ...opts, stickers: undefined });
  useEffect(() => {
    if (!assetsTick) return;
    baseRef.current = composeBase(shots, opts, { filter, amount, cellW: PREVIEW_CELL, takenAt });
    setBaseVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots, baseKey, filter, amount, takenAt, assetsTick]);

  // 2) base + stickers -> on screen (cheap, runs while dragging)
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
        ctx.strokeStyle = '#ffc629';
        ctx.lineWidth = 6 * g.s;
        ctx.strokeRect(c.x - 3 * g.s, c.y - 3 * g.s, c.w + 6 * g.s, c.h + 6 * g.s);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [baseVersion, opts.stickers, selected, assetsTick]);

  // keep the sticker layer exactly over the canvas
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
  }, [baseVersion]);

  const geo = baseRef.current?.geometry;

  // tap on the strip (not on a sticker): select a photo for filter / retake
  const onBackground = (e) => {
    setPicked(null);
    if (!geo || !box) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * geo.width % geo.stripW;
    const y = ((e.clientY - rect.top) / rect.height) * geo.height;
    const i = geo.cells.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    setSelected(i >= 0 && i !== selected ? i : null);
    setTarget(i >= 0 && i !== selected ? 'selected' : 'all');
  };

  /* ---------------- stickers */
  const changeSticker = useCallback((id, patch) => setOpt({ stickers: opts.stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), [opts.stickers, setOpt]);
  const removeSticker = (id) => { setOpt({ stickers: opts.stickers.filter((s) => s.id !== id) }); setPicked(null); };
  const addSticker = (a) => {
    const st = { id: newId(), a, x: 0.5, y: 0.42, w: a.startsWith('tape') ? 0.34 : 0.24, rot: Math.round(Math.random() * 16 - 8) };
    setOpt({ stickers: [...opts.stickers, st] });
    setPicked(st.id);
  };
  const pickedSticker = opts.stickers.find((s) => s.id === picked);
  const duplicate = () => {
    if (!pickedSticker) return;
    const st = { ...pickedSticker, id: newId(), x: clamp(pickedSticker.x + 0.06, 0, 1), y: clamp(pickedSticker.y + 0.03, 0, 1) };
    setOpt({ stickers: [...opts.stickers, st] });
    setPicked(st.id);
  };
  const toFront = () => { if (pickedSticker) setOpt({ stickers: [...opts.stickers.filter((s) => s.id !== picked), pickedSticker] }); };
  const keyStateRef = useRef(null);
  keyStateRef.current = { picked, stickers: opts.stickers, removeSticker, changeSticker };
  useEffect(() => {
    const onKey = (e) => {
      const { picked: id, stickers, removeSticker: del, changeSticker: upd } = keyStateRef.current;
      if (!id || e.target.closest?.('input, textarea')) return;
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

  /* ---------------- template */
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

  /* ---------------- filters */
  const thumbSource = shots[selected ?? 0]?.image;
  const filterThumbs = useMemo(() => {
    if (!thumbSource || tab !== 'filter') return {};
    const out = {};
    FILTERS.forEach((f) => { try { out[f.id] = filteredCanvas(thumbSource, { filter: f.id, amount: 1, width: 96, height: 128 }).toDataURL('image/jpeg', 0.7); } catch { /* no webgl */ } });
    return out;
  }, [thumbSource, tab]);
  const currentFilter = target === 'selected' && selected != null ? (shots[selected].filter || filter) : filter;
  const currentAmount = target === 'selected' && selected != null ? (shots[selected].amount ?? amount) : amount;
  const chooseFilter = (id) => {
    if (target === 'selected' && selected != null) onShots(shots.map((s, i) => (i === selected ? { ...s, filter: id, amount: s.amount ?? amount } : s)));
    else { setFilter(id); onShots(shots.map((s) => ({ ...s, filter: null, amount: null }))); }
  };
  const chooseAmount = (v) => {
    if (target === 'selected' && selected != null) onShots(shots.map((s, i) => (i === selected ? { ...s, filter: s.filter || filter, amount: v } : s)));
    else setAmount(v);
  };

  /* ---------------- save / post */
  const close = async () => {
    if (!await ui.confirm('Bỏ dải ảnh này?', 'Các ảnh vừa chụp sẽ không được lưu.', 'Bỏ')) return;
    onDiscard();
    history.back();
  };
  const exportStrip = async (cellW) => { await preloadBooth(opts); return compose(shots, opts, { filter, amount, cellW, takenAt }).canvas; };
  const save = async () => {
    const choice = await ui.actionSheet({ title: 'Lưu về thiết bị', actions: [
      { label: 'Ảnh ghép JPEG (chất lượng cao)', value: 'jpg' }, { label: 'Ảnh ghép PNG (không nén)', value: 'png' },
      { label: `Từng ảnh riêng lẻ (${shots.length} ảnh)`, value: 'each' }] });
    if (!choice) return;
    setBusy(true);
    try {
      if (choice === 'each') {
        const g = geometry(shots.length, opts, 1200);
        for (let i = 0; i < shots.length; i++) {
          const s = shots[i];
          const c = filteredCanvas(s.image, { filter: s.filter || filter, amount: s.filter ? s.amount ?? amount : amount, width: g.cellW, height: g.cellH });
          downloadBlob(await canvasToBlob(c, 'image/jpeg', 0.95), `locket-photobooth-${takenAt}-${i + 1}.jpg`);
          await new Promise((res) => setTimeout(res, 350));   // browsers drop rapid back-to-back downloads
        }
        ui.success(`Đã lưu ${shots.length} ảnh riêng lẻ`);
      } else {
        const canvas = await exportStrip(1000);
        const blob = await canvasToBlob(canvas, choice === 'png' ? 'image/png' : 'image/jpeg', 0.95);
        downloadBlob(blob, `locket-photobooth-${takenAt}.${choice}`);
        ui.success(`Đã lưu ảnh ghép ${canvas.width}×${canvas.height}`);
      }
    } catch { ui.error('Không lưu được ảnh'); } finally { setBusy(false); }
  };
  const post = async () => {
    const canvas = await exportStrip(800);
    const blob = await canvasToBlob(toSquare(canvas, opts, 1020), 'image/jpeg', 0.96);
    onPost(blob);
    history.back();
  };

  const tpl = templateById(opts.template);

  return createPortal(
    <div className={`booth-editor force-dark ${entered ? 'in' : ''}`} role="dialog" aria-label="Chỉnh sửa photobooth">
      <header className="booth-top">
        <button type="button" className="icon-btn" aria-label="Bỏ" onClick={close}><Icon name="closeSm" /></button>
        <b>Photobooth</b>
        <button type="button" className="icon-btn" aria-label="Lưu về thiết bị" disabled={busy} onClick={save}>{busy ? <span className="spinner sm" /> : <Icon name="download" />}</button>
      </header>

      <div className="booth-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="booth-canvas" aria-label="Dải ảnh photobooth" />
        {box && geo ? (
          <StickerLayer stickers={opts.stickers} box={box} twin={geo.twin} selected={picked}
            onSelect={(id) => { setPicked(id); setSelected(null); }} onChange={changeSticker} onRemove={removeSticker} onBackground={onBackground} />
        ) : null}
        {!assetsTick ? <div className="booth-loading"><span className="spinner lg" /></div> : null}
      </div>

      <div className="booth-panel">
        {pickedSticker ? (
          <div className="booth-selected">
            <img src={stickerUrl(pickedSticker.a)} alt="" />
            <span>Kéo để di chuyển · góc để xoay/phóng</span>
            <button type="button" className="icon-btn sm" aria-label="Đưa lên trên" title="Đưa lên trên" onClick={toFront}><Icon name="arrowUp" /></button>
            <button type="button" className="icon-btn sm" aria-label="Nhân bản" title="Nhân bản" onClick={duplicate}><Icon name="copy" /></button>
            <button type="button" className="icon-btn sm danger" aria-label="Xóa sticker" title="Xóa" onClick={() => removeSticker(picked)}><Icon name="trash" /></button>
          </div>
        ) : selected != null ? (
          <div className="booth-selected">
            <span>Ảnh {selected + 1} đã chọn</span>
            <Button variant="tinted" size="sm" icon="camera" onClick={() => { onRetake(selected); history.back(); }}>Chụp lại ảnh này</Button>
            <button type="button" className="link-btn" onClick={() => { setSelected(null); setTarget('all'); }}>Bỏ chọn</button>
          </div>
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
                      <button key={t.id} type="button" className={`tpl ${opts.template === t.id ? 'on' : ''}`} onClick={() => chooseTemplate(t.id)}>
                        {templateThumbs[t.id] ? <img src={templateThumbs[t.id]} alt="" /> : <i className="sk" />}
                        <span>{t.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {tpl.decor.length ? (
                <div className="booth-inline">
                  {opts.decorDetached
                    ? <Button variant="secondary" size="sm" onClick={restoreDecor}>Khôi phục trang trí gốc</Button>
                    : <Button variant="tinted" size="sm" icon="pencil" onClick={detachDecor}>Chỉnh trang trí của khung</Button>}
                </div>
              ) : null}
            </>
          ) : null}

          {tab === 'sticker' ? (
            <>
              {STICKER_GROUPS.map((group) => (
                <section key={group.id} className="booth-group">
                  <h4>{group.name}</h4>
                  <div className="stk-grid">
                    {group.items.map((a) => (
                      <button key={a} type="button" className="stk-pick" aria-label={`Thêm sticker ${a}`} onClick={() => addSticker(a)}>
                        <img src={stickerUrl(a)} alt="" loading="lazy" />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {opts.stickers.length ? (
                <div className="booth-inline"><Button variant="destructive-tinted" size="sm" icon="trash" onClick={() => { setOpt({ stickers: [] }); setPicked(null); }}>Gỡ tất cả sticker ({opts.stickers.length})</Button></div>
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
                  <label className="swatch custom" aria-label="Chọn màu khác"><input type="color" value={opts.bg || '#ffffff'} onChange={(e) => setOpt({ bg: e.target.value })} /><Icon name="plus" /></label>
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
              <label className="booth-slider">Bo góc <input type="range" min="0" max="40" step="1" value={r.radius} onChange={(e) => setOpt({ radius: Number(e.target.value) })} /><b>{r.radius}</b></label>
              <label className="booth-slider">Khoảng cách <input type="range" min="6" max="60" step="1" value={r.gap} onChange={(e) => setOpt({ gap: Number(e.target.value) })} /><b>{r.gap}</b></label>
            </>
          ) : null}

          {tab === 'text' ? (
            <>
              <input className="booth-text" type="text" maxLength={40} placeholder={tpl.footer.text || 'Thêm chữ dưới dải ảnh…'} value={opts.text ?? tpl.footer.text}
                onChange={(e) => setOpt({ text: e.target.value })} />
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
                <button type="button" className={target === 'all' ? 'on' : ''} onClick={() => setTarget('all')}>Cả dải ảnh</button>
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
            </>
          ) : null}

          {tab === 'layout' ? (
            <>
              <div className="booth-toggles">
                {LAYOUTS.map((l) => <button key={l.id} type="button" className={`chip ${opts.layout === l.id ? 'on' : ''}`} onClick={() => setOpt({ layout: l.id })}>{l.name}</button>)}
              </div>
              <div className="booth-toggles">
                {ASPECTS.map((a) => <button key={a.id} type="button" className={`chip ${opts.aspect === a.id ? 'on' : ''}`} onClick={() => setOpt({ aspect: a.id })}>{a.name}</button>)}
              </div>
              <p className="booth-hint">Ảnh được lưu khung vuông khi chụp, nên đổi tỉ lệ ở đây chỉ cắt lại, không mất chất lượng. Sticker giữ vị trí theo tỉ lệ dải ảnh.</p>
            </>
          ) : null}
        </div>

        <div className="booth-actions">
          <Button variant="secondary" icon="camera" onClick={() => { onRetake('all'); history.back(); }}>Chụp lại tất cả</Button>
          <Button variant="primary" icon="send" onClick={post}>Đăng lên Locket</Button>
        </div>
      </div>
    </div>,
    document.getElementById('layers'),
  );
}
