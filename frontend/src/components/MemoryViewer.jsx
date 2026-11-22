// Full-screen moment viewer shared by Memories, Notifications and FriendProfile.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from './Avatar.jsx';
import { CaptionPill } from './CaptionPill.jsx';
import { Icon } from '../lib/icons.jsx';
import { downloadBlob, fullDate } from '../lib/format.js';
import { pushBack } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { MomentVideo } from '../screens/MomentPage.jsx';
import { MyReactions, openActivity, openComments, openEmojiPicker, sendReaction } from '../screens/Interactions.jsx';
import { QUICK_EMOJI } from '../store.js';

export function MemoryViewer({ list, index, hasMore, onIndex, onClose, onNeedMore, onPatch }) {
  const m = list[index];
  const [entered, setEntered] = useState(false);
  const [music, setMusic] = useState(false);
  const audio = useRef(null);
  const touch = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // the browser back button / Esc close the viewer before the page under it
  useEffect(() => {
    const remove = pushBack(() => onCloseRef.current());
    const t = setTimeout(() => setEntered(true), 20);
    return () => { remove(); clearTimeout(t); audio.current?.pause(); };
  }, []);
  const close = () => history.back();

  const go = useCallback((step) => {
    const next = index + step;
    if (next < 0) return;
    if (next >= list.length) { if (hasMore) onNeedMore(); return; }
    onIndex(next);
  }, [index, list.length, hasMore, onIndex, onNeedMore]);

  useEffect(() => { if (hasMore && index >= list.length - 4) onNeedMore(); }, [index, list.length, hasMore, onNeedMore]);
  useEffect(() => { audio.current?.pause(); setMusic(false); }, [index]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // preload neighbours so swiping feels instant
  useEffect(() => {
    [list[index + 1], list[index - 1]].forEach((x) => { if (x) { const img = new Image(); img.src = x.image; } });
  }, [index, list]);

  const [pop, setPop] = useState(null);
  if (!m) return null;

  const onPointerDown = (e) => { touch.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e) => {
    const t = touch.current;
    touch.current = null;
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) close();
  };

  const playMusic = (url) => {
    if (!audio.current) { audio.current = new Audio(); audio.current.addEventListener('ended', () => setMusic(false)); }
    if (music) { audio.current.pause(); setMusic(false); return; }
    audio.current.src = url;
    setMusic(true);
    audio.current.play().catch(() => { setMusic(false); ui.error('Không phát được đoạn nhạc này'); });
  };

  const save = async () => {
    try {
      const blob = await (await fetch(m.video || m.image, { credentials: 'same-origin' })).blob();
      downloadBlob(blob, `locket-${m.id}.${m.video ? 'mp4' : (blob.type.split('/')[1] || 'jpg')}`);
      ui.success('Đã lưu vào máy');
    } catch { ui.error('Không lưu được'); }
  };

  const react = async (emoji) => {
    const before = m.myReactions || [];
    setPop(`${emoji}-${Date.now()}`);
    onPatch(m.id, { myReactions: [...before, emoji] });
    try { onPatch(m.id, { myReactions: await sendReaction(m, emoji) }); } catch (err) { onPatch(m.id, { myReactions: before }); ui.error(err.message); }
  };
  const comments = () => openComments(m, { onCount: (n) => onPatch(m.id, { commentCount: n }) });

  return createPortal(
    <div className={`mem-viewer ${entered ? 'in' : ''}`} role="dialog" aria-label="Xem khoảnh khắc"
      onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <header className="mem-viewer-top">
        <Avatar user={m.user} size={40} />
        <div className="who">
          <b>{m.mine ? 'Bạn' : m.user.name}</b>
          <small>{m.user.username ? `@${m.user.username} · ` : ''}{m.approxDate ? '≈ ' : ''}{fullDate(m.createdAt)}</small>
        </div>
        <button type="button" className="icon-btn" aria-label="Lưu vào máy" onClick={save}><Icon name="download" /></button>
        <button type="button" className="icon-btn" aria-label="Đóng" onClick={close}><Icon name="closeSm" /></button>
      </header>

      <div className="mem-stage">
        <button type="button" className="icon-btn mem-nav prev" aria-label="Khoảnh khắc trước" disabled={index === 0} onClick={() => go(-1)}><Icon name="chevLeft" /></button>
        <div className="moment-media mem-media" key={m.id}>
          <img src={m.image} alt={m.caption || `Khoảnh khắc của ${m.user.name}`} draggable="false" />
          {m.video ? <MomentVideo src={m.video} poster={m.image} /> : null}
          <CaptionPill overlay={m.overlay} playing={music} onPlay={playMusic} />
          {!m.mine ? <MyReactions list={m.myReactions} /> : null}
          {pop ? <span key={pop} className="react-pop">{pop.split('-')[0]}</span> : null}
        </div>
        <button type="button" className="icon-btn mem-nav next" aria-label="Khoảnh khắc sau" disabled={index >= list.length - 1 && !hasMore} onClick={() => go(1)}><Icon name="chevRight" /></button>
      </div>

      <footer className="mem-viewer-bottom">
        <div className="mem-facts">
          <span className="chip-lite">{m.video ? <><Icon name="play" /> Video</> : 'Ảnh'}</span>
          {m.captionKnown === false && !m.caption ? <span className="chip-lite muted" title="Khoảnh khắc này chỉ biết qua tin nhắn, Locket không cung cấp caption">Không có dữ liệu caption</span> : null}
          {m.approxDate ? <span className="chip-lite muted" title="Thời gian ước lượng theo tin nhắn nhắc tới khoảnh khắc này">Thời gian ước lượng</span> : null}
          <span className="mem-count">{index + 1} / {list.length}{hasMore ? '+' : ''}</span>
        </div>
        <div className="mem-actions" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          {m.mine ? (
            <button type="button" className="btn btn-dark btn-sm" onClick={() => openActivity(m)}><Icon name="heart" /> Hoạt động</button>
          ) : (
            <span className="quick">
              {(m.suggestedReactions?.length ? m.suggestedReactions : QUICK_EMOJI).slice(0, 3).map((e) => (
                <button type="button" key={e} onClick={() => react(e)} aria-label={`Thả ${e}`}>{e}</button>
              ))}
              <button type="button" className="more-emoji" aria-label="Thêm cảm xúc" onClick={(e) => openEmojiPicker(e.currentTarget, react)}><Icon name="emojiAdd" /></button>
            </span>
          )}
          <button type="button" className="btn btn-dark btn-sm" onClick={comments}><Icon name="chat" /> {m.commentCount ? `${m.commentCount} bình luận` : 'Bình luận'}</button>
        </div>
      </footer>
    </div>,
    document.getElementById('layers'),
  );
}
