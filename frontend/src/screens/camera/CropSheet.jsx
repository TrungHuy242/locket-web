// Interactive 1:1 square Pan / Zoom / Rotate cropper for gallery, pasted or dropped photos.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../lib/icons.jsx';
import { PHOTO_SIZE } from '../../lib/cameraMedia.js';

const PREVIEW_SIZE = 340;

export function CropSheet({ bitmap, onConfirm, onCancel }) {
  const canvasRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0); // 0, 90, 180, 270
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  const dims = (r) => (r % 180 === 0 ? { w: bitmap.width, h: bitmap.height } : { w: bitmap.height, h: bitmap.width });

  const clampOffset = (ox, oy, z, r) => {
    const { w, h } = dims(r);
    const baseScale = PREVIEW_SIZE / Math.min(w, h);
    const drawW = w * baseScale * z;
    const drawH = h * baseScale * z;
    const maxX = Math.max(0, (drawW - PREVIEW_SIZE) / 2);
    const maxY = Math.max(0, (drawH - PREVIEW_SIZE) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, ox)), y: Math.max(-maxY, Math.min(maxY, oy)) };
  };

  const renderTo = (canvas, outSize) => {
    canvas.width = canvas.height = outSize;
    const ctx = canvas.getContext('2d');
    const ratio = outSize / PREVIEW_SIZE;
    const { w, h } = dims(rot);
    const baseScale = outSize / Math.min(w, h);
    const scale = baseScale * zoom;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outSize, outSize);
    ctx.save();
    ctx.translate(outSize / 2 + offset.x * ratio, outSize / 2 + offset.y * ratio);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(bitmap, (-bitmap.width * scale) / 2, (-bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    ctx.restore();
  };

  useEffect(() => {
    if (canvasRef.current) renderTo(canvasRef.current, PREVIEW_SIZE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, rot, offset, bitmap]);

  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clampOffset(d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y), zoom, rot));
  };
  const onUp = () => { dragRef.current = null; };

  const onZoom = (next) => {
    const z = Math.max(1, Math.min(3, next));
    setZoom(z);
    setOffset((o) => clampOffset(o.x, o.y, z, rot));
  };

  const rotate = () => {
    const next = (rot + 90) % 360;
    setRot(next);
    setOffset((o) => clampOffset(o.x, o.y, zoom, next));
  };

  const confirm = () => {
    const out = document.createElement('canvas');
    renderTo(out, PHOTO_SIZE);
    onConfirm(out);
  };

  return (
    <div className="crop-sheet">
      <div className="sheet-title">Căn chỉnh ảnh</div>
      <div className="sheet-sub">Kéo để di chuyển, trượt để phóng to hoặc xoay ảnh</div>
      <div className="crop-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={(e) => { e.preventDefault(); onZoom(zoom + (e.deltaY < 0 ? 0.12 : -0.12)); }}>
        <canvas ref={canvasRef} width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
        <span className="crop-grid" aria-hidden="true" />
      </div>
      <div className="crop-controls">
        <button type="button" className="icon-btn" aria-label="Xoay 90°" title="Xoay 90°" onClick={rotate}><Icon name="rotate" /></button>
        <input type="range" min="1" max="3" step="0.02" value={zoom} aria-label="Thu phóng" onChange={(e) => onZoom(Number(e.target.value))} />
        <span className="crop-val">{zoom.toFixed(1)}x</span>
      </div>
      <div className="crop-actions">
        <button type="button" className="btn btn-dark" onClick={onCancel}>Hủy</button>
        <button type="button" className="btn btn-gold" onClick={confirm}>Dùng ảnh này</button>
      </div>
    </div>
  );
}
