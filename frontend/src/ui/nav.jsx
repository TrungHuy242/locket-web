// Pushed pages (profile, settings, friends, chat, thread). On phones they slide like a
// UINavigationController; on desktop they become centred pages (see layout.css).
// The browser back button / Android back gesture closes the top overlay or page.
import { useEffect, useState } from 'react';
import { createStore } from '../lib/createStore.js';
import { Icon } from '../lib/icons.jsx';
import { ui } from './overlays.jsx';

export const navStore = createStore({ stack: [] });
let seq = 0;
const OUT_MS = 480;

function removeLater(id) {
  setTimeout(() => navStore.set((s) => ({ stack: s.stack.filter((v) => v.id !== id) })), OUT_MS);
}

export const nav = {
  push(type, props = {}, from = 'right') {
    const id = ++seq;
    navStore.set((s) => ({ stack: [...s.stack, { id, type, props, from, closing: false }] }));
    try { history.pushState({ locketView: id }, ''); } catch { /* sandboxed */ }
    return id;
  },
  pop(id) {
    const live = navStore.get().stack.filter((v) => !v.closing);
    const target = id ? live.find((v) => v.id === id) : live[live.length - 1];
    if (!target) return;
    navStore.set((s) => ({ stack: s.stack.map((v) => (v.id === target.id ? { ...v, closing: true } : v)) }));
    removeLater(target.id);
  },
  // Open a top-level section, replacing whatever was open (like following a link on a website).
  openRoot(type, props = {}, from) {
    ui.closeAll();
    navStore.set({ stack: [] });
    nav.push(type, props, from ?? (type === 'profile' ? 'left' : 'right'));
  },
  closeAll() {
    ui.closeAll();
    const live = navStore.get().stack.filter((v) => !v.closing);
    if (!live.length) return;
    navStore.set((s) => ({ stack: s.stack.map((v) => ({ ...v, closing: true })) }));
    live.forEach((v) => removeLater(v.id));
  },
  isOpen: () => navStore.get().stack.some((v) => !v.closing),
};

export const useNav = () => navStore.use((s) => s.stack);
// Top-level section currently open (drives the sidebar highlight), or null for the home screen.
export const useSection = () => navStore.use((s) => s.stack.find((v) => !v.closing)?.type ?? null);

// Full-screen layers that are not pages (e.g. the Memories viewer) register here so the browser
// back button and Esc close them first. They close through history.back() so entries stay balanced.
const backHandlers = [];
export function pushBack(fn) {
  backHandlers.push(fn);
  try { history.pushState({ locketBack: true }, ''); } catch { /* sandboxed */ }
  return () => {
    const i = backHandlers.indexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (backHandlers.length) { backHandlers.pop()(); return; }
    if (ui.closeTop()) return;
    nav.pop();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ui.closeTop()) return;
    if (backHandlers.length) { history.back(); return; }
    nav.pop();
  });
}

// One pushed page with its enter/leave transition.
export function View({ view, under, className = '', children }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
    const fallback = setTimeout(() => setEntered(true), 80);
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); clearTimeout(fallback); };
  }, []);
  const state = entered && !view.closing ? 'in' : '';
  const behind = under ? `under-${under}` : '';
  return <div className={`view from-${view.from} ${state} ${behind} ${view.root ? 'root' : ''} ${className}`}>{children}</div>;
}

export function Navbar({ title, back = 'left', right = null, onBack }) {
  const backBtn = (
    <button type="button" className="icon-btn bare pressable" data-back aria-label="Quay lại" onClick={onBack}>
      <Icon name={back === 'right' ? 'chevRight' : 'chevLeft'} />
    </button>
  );
  return (
    <header className="navbar">
      {back === 'right' ? (right || <span className="spacer" />) : backBtn}
      <h2>{title}</h2>
      {back === 'right' ? backBtn : (right || <span className="spacer" />)}
    </header>
  );
}
