// Camera "Diện mạo" Bottom Sheet (matching iOS Locket Looks drawer) + "✦ Tạo diện mạo" Custom Studio
// + Interactive Live Viewfinder Look Overlay (supports Face Tracking + touch/mouse drag, scale & rotate).
import { useMemo, useRef, useState } from 'react';
import {
  BUILTIN_LOOKS,
  LOOK_CATEGORIES,
  createCustomLookFromEmoji,
  createCustomLookFromFile,
  deleteCustomLook,
  getLookThumbUrl,
  loadCustomLooks,
  resolveLookPlacement,
} from '../../lib/cameraLooks.js';
import { vibrate } from '../../lib/format.js';
import { Icon } from '../../lib/icons.jsx';
import { ui } from '../../ui/overlays.jsx';

const ANCHOR_OPTIONS = [
  ['crown', 'Đầu / Tóc / Mũ'],
  ['eyes', 'Mắt / Kính'],
  ['cheeks', 'Má / Dễ thương'],
  ['mouth', 'Miệng / Môi'],
  ['chin', 'Cằm / Râu'],
  ['free', 'Tự do giữa khung'],
];

function CreateLookModal({ onCreated, onClose }) {
  const [tab, setTab] = useState('photo'); // photo | emoji
  const [name, setName] = useState('');
  const [anchor, setAnchor] = useState('crown');
  const [removeBg, setRemoveBg] = useState(true);
  const [emojiText, setEmojiText] = useState('👑');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const created = await createCustomLookFromFile(file, {
        name: name.trim() || file.name.replace(/\.[^.]+$/, '').slice(0, 22) || 'Diện mạo riêng',
        anchor,
        removeBg,
      });
      vibrate(14);
      ui.success(`Đã tạo diện mạo "${created.name}"!`);
      onCreated?.(created);
      onClose?.();
    } catch {
      ui.error('Không đọc được ảnh này, hãy thử ảnh PNG/JPG khác');
    } finally {
      setBusy(false);
    }
  };

  const handleEmoji = (e) => {
    e.preventDefault();
    if (!emojiText.trim()) return;
    const created = createCustomLookFromEmoji(emojiText.trim(), {
      name: name.trim() || emojiText.trim(),
      anchor,
    });
    vibrate(14);
    ui.success(`Đã tạo diện mạo "${created.name}"!`);
    onCreated?.(created);
    onClose?.();
  };

  return (
    <div className="gold-sheet create-look-sheet">
      <div className="gold-sheet-head">
        <h2>✦ Tạo diện mạo</h2>
        <p>Tự tạo sticker cắt viền trắng bám theo khuôn mặt từ ảnh riêng hoặc chữ/emoji</p>
      </div>

      <div className="segmented" style={{ marginBottom: 14 }}>
        <button type="button" className={tab === 'photo' ? 'on' : ''} onClick={() => setTab('photo')}>Từ ảnh trong máy</button>
        <button type="button" className={tab === 'emoji' ? 'on' : ''} onClick={() => setTab('emoji')}>Từ Emoji / Chữ</button>
      </div>

      <div className="fb-form">
        <label className="fb-field">
          <span>Tên diện mạo</span>
          <input type="text" maxLength={28} placeholder="Ví dụ: Nón lá, Mèo ngầu…" value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="fb-field">
          <span>Vị trí bám trên khuôn mặt</span>
          <select value={anchor} onChange={(e) => setAnchor(e.target.value)} className="look-select">
            {ANCHOR_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
          </select>
        </label>

        {tab === 'photo' ? (
          <>
            <label className="look-check-row">
              <input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />
              <span>Tự động tách nền đồng màu & bo viền trắng sticker</span>
            </label>
            <button type="button" className="btn btn-gold-cta" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Đang cắt viền diện mạo…' : '🖼️ Chọn ảnh để tạo diện mạo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
          </>
        ) : (
          <form onSubmit={handleEmoji} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="fb-field">
              <span>Nhập Emoji hoặc chữ ngắn (tối đa 8 ký tự)</span>
              <input type="text" maxLength={8} value={emojiText} onChange={(e) => setEmojiText(e.target.value)} />
            </label>
            <button type="submit" className="btn btn-gold-cta">✦ Tạo sticker ngay</button>
          </form>
        )}
      </div>
    </div>
  );
}

export function LooksSheet({ activeLook, onSelect, onClose }) {
  const [customs, setCustoms] = useState(() => loadCustomLooks());

  const grouped = useMemo(() => {
    const out = [];
    LOOK_CATEGORIES.forEach((cat) => {
      const items = cat.id === 'custom'
        ? customs
        : BUILTIN_LOOKS.filter((x) => x.cat === cat.id);
      if (items.length) out.push({ ...cat, items });
    });
    return out;
  }, [customs]);

  const openCreator = () => {
    const ctl = ui.sheet(() => (
      <CreateLookModal
        onCreated={(item) => {
          setCustoms(loadCustomLooks());
          onSelect?.(item);
          onClose?.();
        }}
        onClose={() => ctl.close()}
      />
    ));
  };

  const removeCustom = (e, item) => {
    e.stopPropagation();
    const next = deleteCustomLook(item.id);
    setCustoms(next);
    if (activeLook?.id === item.id) onSelect?.(null);
    ui.info(`Đã xóa "${item.name}"`, 1200);
  };

  return (
    <div className="looks-drawer">
      <div className="looks-drawer-head">
        <h3>Diện mạo</h3>
        {activeLook ? (
          <button type="button" className="looks-clear-btn" onClick={() => { onSelect?.(null); onClose?.(); }}>
            Gỡ diện mạo
          </button>
        ) : null}
      </div>

      <div className="looks-scroll">
        {grouped.map((group) => (
          <section key={group.id} className="looks-group">
            <h4>{group.label}</h4>
            <div className="looks-row">
              {group.items.map((item) => {
                const on = activeLook?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`look-tile pressable ${on ? 'on' : ''}`}
                    onClick={() => {
                      vibrate(10);
                      onSelect?.(on ? null : item);
                      onClose?.();
                    }}
                  >
                    <span className="look-art">
                      <img src={getLookThumbUrl(item)} alt={item.name} loading="lazy" />
                      {group.id === 'custom' ? (
                        <i
                          role="button"
                          tabIndex={0}
                          className="look-del"
                          title="Xóa diện mạo"
                          onClick={(e) => removeCustom(e, item)}
                          onKeyDown={(e) => { if (e.key === 'Enter') removeCustom(e, item); }}
                        >
                          ×
                        </i>
                      ) : null}
                    </span>
                    <span className="look-label">{item.name}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="looks-cta-wrap">
        <button type="button" className="looks-create-cta pressable" onClick={openCreator}>
          <span>✦</span> Tạo diện mạo
        </button>
      </div>
    </div>
  );
}

export function openLooksSheet({ activeLook, onSelect }) {
  const ctl = ui.sheet(() => (
    <LooksSheet activeLook={activeLook} onSelect={onSelect} onClose={() => ctl.close()} />
  ));
  return ctl;
}

// Live interactive overlay rendered inside .viewfinder when a Look is active.
// Tracks `faceBox` automatically AND lets the user drag, resize, or rotate with touch/mouse!
export function LiveLookOverlay({ look, faceBox, manual, onChangeManual, onClear }) {
  const wrapRef = useRef(null);
  const dragRef = useRef(null);
  const [editing, setEditing] = useState(false);

  if (!look) return null;
  const p = resolveLookPlacement(look, faceBox, manual);
  const imgUrl = getLookThumbUrl(look);

  const onDown = (e, mode = 'move') => {
    e.stopPropagation();
    e.preventDefault();
    const box = wrapRef.current?.parentElement?.getBoundingClientRect();
    if (!box || !box.width) return;
    setEditing(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      boxW: box.width,
      boxH: box.height,
      centerPxX: box.left + p.cx * box.width,
      centerPxY: box.top + p.cy * box.height,
      origDx: manual?.dx || 0,
      origDy: manual?.dy || 0,
      origScale: manual?.scale || 1,
      origRot: manual?.rot || 0,
      startDist: Math.hypot(e.clientX - (box.left + p.cx * box.width), e.clientY - (box.top + p.cy * box.height)) || 40,
      startAng: Math.atan2(e.clientY - (box.top + p.cy * box.height), e.clientX - (box.left + p.cx * box.width)),
    };
  };

  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    if (d.mode === 'move') {
      const ndx = d.origDx + (e.clientX - d.startX) / d.boxW;
      const ndy = d.origDy + (e.clientY - d.startY) / d.boxH;
      onChangeManual({
        ...manual,
        dx: Math.max(-0.45, Math.min(0.45, ndx)),
        dy: Math.max(-0.45, Math.min(0.45, ndy)),
      });
    } else {
      const dist = Math.hypot(e.clientX - d.centerPxX, e.clientY - d.centerPxY) || 10;
      const ang = Math.atan2(e.clientY - d.centerPxY, e.clientX - d.centerPxX);
      const nextScale = Math.max(0.45, Math.min(2.2, d.origScale * (dist / d.startDist)));
      const nextRot = d.origRot + (ang - d.startAng);
      onChangeManual({ ...manual, scale: nextScale, rot: nextRot });
    }
  };

  const onUp = (e) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className={`live-look-prop ${editing ? 'editing' : ''}`}
      style={{
        left: `${p.cx * 100}%`,
        top: `${p.cy * 100}%`,
        width: `${p.size * 100}%`,
        height: `${p.size * 100}%`,
        transform: `translate(-50%, -50%) rotate(${(p.rot * 180) / Math.PI}deg)`,
      }}
      onPointerDown={(e) => onDown(e, 'move')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={(e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.07 : 0.93;
        onChangeManual({ ...manual, scale: Math.max(0.45, Math.min(2.2, (manual?.scale || 1) * factor)) });
      }}
    >
      <img src={imgUrl} alt={look.name} draggable="false" />
      <button
        type="button"
        className="look-handle close"
        aria-label="Gỡ diện mạo"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onClear?.(); }}
      >
        <Icon name="closeSm" />
      </button>
      <span
        className="look-handle transform"
        title="Kéo để xoay & phóng to"
        onPointerDown={(e) => onDown(e, 'transform')}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        ↻
      </span>
    </div>
  );
}
