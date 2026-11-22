// Interactive overlay layer for SVG stickers, die-cut emojis, and draggable floating text labels.
import { useRef } from 'react';
import { Icon } from '../../lib/icons.jsx';
import { measureStickerBox } from '../../lib/photobooth.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function StickerLayer({ stickers, box, twin, selected, onSelect, onChange, onRemove, onEditText, onBackground }) {
  const gesture = useRef(null);
  const lastTap = useRef({ id: null, t: 0 });
  const sw = box.width / twin;
  const sh = box.height;

  const startMove = (e, st) => {
    e.stopPropagation();
    onSelect(st.id);
    if (st.kind === 'text') {
      const now = performance.now();
      if (lastTap.current.id === st.id && now - lastTap.current.t < 320) {
        lastTap.current = { id: null, t: 0 };
        onEditText?.(st);
        return;
      }
      lastTap.current = { id: st.id, t: now };
    }
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
      onChange(st.id, { w: clamp(g.start.w * (d / g.pinch.d), 0.05, 1.4), rot: g.start.rot + ((ang - g.pinch.ang) * 180) / Math.PI });
    } else if (g.origin) {
      onChange(st.id, {
        x: clamp(g.start.x + (e.clientX - g.origin.x) / sw, -0.05, 1.05),
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
    onChange(st.id, { w: clamp(start.w * (d / d0), 0.05, 1.4), rot: start.rot + ((a - a0) * 180) / Math.PI });
  };

  return (
    <div className="stk-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onBackground(e); }}>
      {(stickers || []).map((st) => {
        const { w, h } = measureStickerBox(st, sw);
        const on = selected === st.id;
        return (
          <div key={st.id} className={`stk ${on ? 'on' : ''}`}
            style={{ left: st.x * sw, top: st.y * sh, width: Math.max(28, w), height: Math.max(28, h), transform: `translate(-50%, -50%) rotate(${st.rot || 0}deg)` }}
            onPointerDown={(e) => startMove(e, st)} onPointerMove={(e) => move(e, st)} onPointerUp={end} onPointerCancel={end}
            onWheel={(e) => { e.preventDefault(); onSelect(st.id); onChange(st.id, { w: clamp(st.w * (e.deltaY < 0 ? 1.06 : 0.94), 0.05, 1.4) }); }}>
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
