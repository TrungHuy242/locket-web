// iOS-style overlays with an imperative API, rendered by <Overlays /> into #layers:
//   ui.success(text) ui.error(text) ui.warning(text) ui.info(text)   (ui.toast(text, { type }) too)
//   ui.alert({ title, message, buttons, input }) -> Promise   ui.confirm(title, message, label) -> Promise<bool>
//   ui.actionSheet({ title, actions }) -> Promise             ui.sheet(render, { full })
//   ui.popover(anchorEl, render, { align, above })
// Nothing in the app uses the browser's alert() / confirm().
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createStore } from '../lib/createStore.js';
import { Icon } from '../lib/icons.jsx';

const overlayStore = createStore({ items: [] });
let seq = 0;
const OUT_MS = 420;

function add(item) {
  const id = ++seq;
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const entry = { id, closing: false, ...item };
  entry.close = (value) => {
    const current = overlayStore.get().items.find((x) => x.id === id);
    if (!current || current.closing) return;
    overlayStore.set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, closing: true } : x)) }));
    resolve(value);
    setTimeout(() => overlayStore.set((s) => ({ items: s.items.filter((x) => x.id !== id) })), OUT_MS);
  };
  overlayStore.set((s) => ({ items: [...s.items, entry] }));
  return { close: entry.close, done };
}

// how long a toast stays: long enough to read it, errors a little longer
const toastMs = (text, type) => Math.min(6000, Math.max(type === 'error' ? 3600 : 2400, 1600 + String(text).length * 45));

export const ui = {
  toast(text, opts = {}) {
    if (!text) return;
    const { type = 'info', ms } = typeof opts === 'number' ? { ms: opts } : opts;
    overlayStore.get().items.filter((x) => x.kind === 'toast').forEach((x) => x.close());
    const ctl = add({ kind: 'toast', text: String(text), type });
    setTimeout(() => ctl.close(), ms || toastMs(text, type));
  },
  success(text, ms) { ui.toast(text, { type: 'success', ms }); },
  error(text, ms) { ui.toast(text, { type: 'error', ms }); },
  warning(text, ms) { ui.toast(text, { type: 'warning', ms }); },
  info(text, ms) { ui.toast(text, { type: 'info', ms }); },
  alert({ title, message = '', buttons = [{ label: 'OK', bold: true }], input = null, icon = null }) {
    return add({ kind: 'alert', title, message, buttons, input, icon }).done.then((r) => r || { index: -1 });
  },
  async confirm(title, message, action, destructive = true) {
    const r = await ui.alert({ title, message, icon: destructive ? 'destructive' : null,
      buttons: [{ label: 'Hủy' }, { label: action, destructive, bold: !destructive }] });
    return r.index === 1;
  },
  actionSheet({ title = '', actions }) {
    return add({ kind: 'actions', title, actions }).done.then((i) => (i == null || i < 0 ? null : actions[i].value ?? i));
  },
  sheet(render, { full = false } = {}) {
    return add({ kind: 'sheet', render, full });
  },
  popover(anchor, render, { align = 'center', above = false } = {}) {
    return add({ kind: 'popover', render, anchor, align, above });
  },
  closeAll() {
    overlayStore.get().items.filter((x) => x.kind !== 'toast').forEach((x) => x.close());
  },
  hasOpen: () => overlayStore.get().items.some((x) => x.kind !== 'toast' && !x.closing),
  closeTop() {
    const open = overlayStore.get().items.filter((x) => x.kind !== 'toast' && !x.closing);
    if (!open.length) return false;
    open[open.length - 1].close();
    return true;
  },
};

// Adds "in" one frame after mount and drops it while closing, so CSS transitions play both ways.
function useEntered(closing) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
    const fallback = setTimeout(() => setEntered(true), 80);     // background tabs pause rAF
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(fallback); };
  }, []);
  return entered && !closing;
}

function Backdrop({ item, transparent = false, dismissable = true }) {
  const on = useEntered(item.closing);
  return (
    <div className={`backdrop ${on ? 'in' : ''}`} style={transparent ? { background: 'transparent' } : undefined}
      onClick={dismissable ? () => item.close() : undefined} />
  );
}

function Sheet({ item }) {
  const on = useEntered(item.closing);
  const node = useRef(null);
  const drag = useRef(null);
  const [dy, setDy] = useState(0);
  const begin = (e) => { e.currentTarget.setPointerCapture?.(e.pointerId); drag.current = { y: e.clientY }; };
  const move = (e) => { if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y)); };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dy > 110) item.close();
    setDy(0);
  };
  return (
    <>
      <Backdrop item={item} />
      <div ref={node} role="dialog" className={`sheet ${item.full ? 'full' : ''} ${on ? 'in' : ''} ${drag.current ? 'dragging' : ''}`}
        style={dy ? { transform: `translateY(${dy}px)` } : undefined}>
        <div className="sheet-grab" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        <div className="sheet-body">{item.render({ close: item.close })}</div>
      </div>
    </>
  );
}

function Alert({ item }) {
  const on = useEntered(item.closing);
  const field = useRef(null);
  const column = item.buttons.length > 2;
  useEffect(() => {
    if (!item.input) return undefined;
    const t = setTimeout(() => { field.current?.focus({ preventScroll: true }); field.current?.select(); }, 280);
    return () => clearTimeout(t);
  }, [item.input]);
  const choose = (index) => item.close({ index, value: item.buttons[index].value ?? index, text: field.current?.value });
  return (
    <>
      <Backdrop item={item} dismissable={false} />
      <div className="alert-wrap">
        <div className={`alert ${on ? 'in' : ''}`} role="alertdialog">
          <div className="alert-text">
            {item.icon ? <span className={`alert-icon ${item.icon}`}><Icon name={item.icon === 'destructive' ? 'warning' : 'info'} /></span> : null}
            <h3>{item.title}</h3>
            {item.message ? <p>{item.message}</p> : null}
            {item.input ? (
              <input ref={field} className="alert-input" defaultValue={item.input.value || ''} placeholder={item.input.placeholder || ''}
                maxLength={item.input.maxlength || 40}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const bold = item.buttons.findIndex((b) => b.bold);
                  choose(bold >= 0 ? bold : 0);
                }} />
            ) : null}
          </div>
          <div className={`alert-btns ${column ? 'col' : ''}`}>
            {item.buttons.map((b, i) => (
              <button key={b.label} type="button" className={`${b.bold ? 'bold' : ''} ${b.destructive ? 'destructive' : ''}`} onClick={() => choose(i)}>{b.label}</button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function ActionSheet({ item }) {
  const on = useEntered(item.closing);
  return (
    <>
      <Backdrop item={item} />
      <div className={`actions ${on ? 'in' : ''}`}>
        <div className="actions-group">
          {item.title ? <div className="actions-title">{item.title}</div> : null}
          {item.actions.map((a, i) => (
            <button key={a.label} type="button" className={a.destructive ? 'destructive' : ''} onClick={() => item.close(i)}>{a.label}</button>
          ))}
        </div>
        <div className="actions-group"><button type="button" className="cancel" onClick={() => item.close(-1)}>Hủy</button></div>
      </div>
    </>
  );
}

function Popover({ item }) {
  const on = useEntered(item.closing);
  const node = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });
  useLayoutEffect(() => {
    const el = node.current;
    if (!el || !item.anchor?.isConnected) return;
    const r = item.anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    let left = item.align === 'center' ? r.left + r.width / 2 - width / 2 : r.right - width;
    left = Math.max(10, Math.min(left, window.innerWidth - width - 10));
    setPos(item.above
      ? { left, bottom: window.innerHeight - r.top + 8, transformOrigin: 'bottom center' }
      : { left, top: r.bottom + 8 });
  }, [item]);
  return (
    <>
      <Backdrop item={item} transparent />
      <div ref={node} className={`popover ${on ? 'in' : ''}`} style={pos}>{item.render({ close: item.close })}</div>
    </>
  );
}

const TOAST_ICONS = {
  success: <path d="M5 12.5l4.2 4.2L19 7" />,
  error: <path d="M7 7l10 10M17 7L7 17" />,
  warning: <><path d="M12 6.5v7" /><path d="M12 17.6v.1" /></>,
  info: <><path d="M12 11v6.5" /><path d="M12 6.8v.1" /></>,
};

// Tap to dismiss, or flick it up.
function Toast({ item }) {
  const on = useEntered(item.closing);
  const start = useRef(null);
  const [dy, setDy] = useState(0);
  const type = TOAST_ICONS[item.type] ? item.type : 'info';
  return (
    <div className={`toast ${type} ${on ? 'in' : ''} ${start.current != null ? 'drag' : ''}`}
      role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'}
      style={dy ? { transform: `translate(-50%, ${dy}px)` } : undefined}
      onPointerDown={(e) => { start.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (start.current != null) setDy(Math.min(0, e.clientY - start.current)); }}
      onPointerUp={() => { start.current = null; setDy(0); item.close(); }}
      onPointerCancel={() => { start.current = null; setDy(0); }}>
      <span className="toast-ic" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">{TOAST_ICONS[type]}</svg>
      </span>
      <span className="toast-text">{item.text}</span>
    </div>
  );
}

const KINDS = { sheet: Sheet, alert: Alert, actions: ActionSheet, popover: Popover, toast: Toast };

export function Overlays() {
  const items = overlayStore.use((s) => s.items);
  const host = document.getElementById('layers');
  return createPortal(items.map((item) => {
    const Comp = KINDS[item.kind];
    return <Comp key={item.id} item={item} />;
  }), host);
}

