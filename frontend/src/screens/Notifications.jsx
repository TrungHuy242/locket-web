// Notifications. Locket has no inbox API (on the iPhone these are push messages), so the server builds
// the list from the real events behind those pushes: reactions on my moments, replies to my moments,
// messages, reactions to my messages, friend requests and new friends. Tapping one opens the moment,
// conversation or profile it is about.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { Icon } from '../lib/icons.jsx';
import { ago, fullDate, isDesktop, thumb } from '../lib/format.js';
import { appStore, loadNotifications, markNotificationsRead, useApp } from '../store.js';
import { Navbar, nav } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { MemoryViewer } from '../components/MemoryViewer.jsx';
import { openComments } from './Interactions.jsx';
import { friendActions } from './Friends.jsx';
import { Button, SkeletonList, StateView } from '../ui/kit.jsx';

const POLL_MS = 30000;
const FILTERS = [
  { key: 'all', label: 'Tất cả' },
  { key: 'reactions', label: 'Cảm xúc', types: ['reaction', 'message_reaction'] },
  { key: 'comments', label: 'Bình luận', types: ['comment'] },
  { key: 'messages', label: 'Tin nhắn', types: ['message'] },
  { key: 'friends', label: 'Bạn bè', types: ['friend_request', 'friend_added'] },
];

function sectionOf(ms) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= today) return 'Hôm nay';
  if (ms >= today - 86400000) return 'Hôm qua';
  if (ms >= today - 6 * 86400000) return '7 ngày qua';
  return 'Trước đó';
}

const quote = (text, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function Sentence({ n }) {
  const name = <b>{n.user.name}</b>;
  switch (n.type) {
    case 'reaction':
      return <>{name} đã thả {n.emoji} vào khoảnh khắc của bạn</>;
    case 'comment':
      return <>{name} đã trả lời khoảnh khắc của bạn: <q>{quote(n.text)}</q></>;
    case 'message_reaction':
      return <>{name} đã thả {n.emoji} vào tin nhắn của bạn{n.text ? <>: <q>{quote(n.text, 60)}</q></> : null}</>;
    case 'message':
      return n.text ? <>{name}: {quote(n.text)}</> : <>{name} đã gửi cho bạn một khoảnh khắc</>;
    case 'friend_request':
      return <>{name} muốn kết bạn với bạn</>;
    case 'friend_added':
      return <>Bạn và {name} đã trở thành bạn bè</>;
    default:
      return name;
  }
}

function Kind({ n }) {
  if (n.type === 'reaction' || n.type === 'message_reaction') return <span className="nt-kind emoji">{[...(n.emoji || '')].pop()}</span>;
  if (n.type === 'comment' || n.type === 'message') return <span className="nt-kind chat"><Icon name="chat" /></span>;
  return <span className="nt-kind friend"><Icon name="people" /></span>;
}

function Row({ n, onOpen, onRequest }) {
  const pending = n.type === 'friend_request' && appStore.get().incoming.some((u) => u.uid === n.user.uid);
  const act = (e, accept) => { e.stopPropagation(); return onRequest(n, accept); };
  return (
    // a div with a button role: the friend-request buttons inside cannot live in a real <button>
    <div role="button" tabIndex={0} className={`nt-row ${n.unread ? 'unread' : ''}`} onClick={() => onOpen(n)}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(n); } }}>
      <span className="nt-avatar"><Avatar user={n.user} size={48} /><Kind n={n} /></span>
      <span className="nt-body">
        <span className="nt-text"><Sentence n={n} /></span>
        <span className="nt-meta" title={fullDate(n.createdAt)}>
          {ago(n.createdAt)}
          {n.type === 'message' && n.count > 1 && n.unread ? ` · ${n.count} tin chưa đọc` : ''}
        </span>
        {pending ? (
          <span className="nt-actions">
            <Button variant="primary" size="sm" onClick={(e) => act(e, true)}>Chấp nhận</Button>
            <Button variant="secondary" size="sm" onClick={(e) => act(e, false)}>Từ chối</Button>
          </span>
        ) : null}
      </span>
      {n.momentImage ? (
        <span className="nt-thumb">
          <img src={thumb(n.momentImage, 128)} alt="" loading="lazy" decoding="async" />
          {n.momentVideo ? <i><Icon name="play" /></i> : null}
        </span>
      ) : null}
      {n.unread ? <i className="nt-dot" aria-label="Chưa đọc" /> : null}
    </div>
  );
}

export function Notifications({ view }) {
  const data = useApp((s) => s.notifications);
  const error = useApp((s) => s.notifError);
  const [filter, setFilter] = useState('all');
  const [viewer, setViewer] = useState(null);
  const [opening, setOpening] = useState(null);

  const refresh = useCallback((force = false) => loadNotifications({ refresh: force }), []);

  useEffect(() => {
    refresh(false);
    const poll = setInterval(() => { if (!document.hidden) refresh(false); }, POLL_MS);
    const onShow = () => { if (!document.hidden) refresh(false); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onShow); };
  }, [refresh]);

  const list = useMemo(() => data?.notifications || [], [data]);
  const unreadOf = (f) => list.filter((n) => n.unread && (!f.types || f.types.includes(n.type))).length;
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter);
    return f.types ? list.filter((n) => f.types.includes(n.type)) : list;
  }, [list, filter]);

  const sections = [];
  shown.forEach((n) => {
    const label = sectionOf(n.createdAt);
    if (!sections.length || sections[sections.length - 1].label !== label) sections.push({ label, items: [] });
    sections[sections.length - 1].items.push(n);
  });

  const open = async (n) => {
    if (n.unread) markNotificationsRead([n.id]);
    if (n.type === 'message' || n.type === 'message_reaction') {
      const peer = n.user;
      if (isDesktop()) nav.openRoot('chat', { peer }); else nav.push('thread', { peer });
      return;
    }
    if (n.type === 'friend_request' || n.type === 'friend_added') {
      nav.push('friend', { uid: n.user.uid, user: n.user });
      return;
    }
    if (!n.momentId || opening) return;
    setOpening(n.id);
    try {
      const moment = await api.moment(n.momentId);
      setViewer(moment);
      if (n.type === 'comment') setTimeout(() => openComments(moment, { onCount: (c) => setViewer((v) => (v ? { ...v, commentCount: c } : v)) }), 380);
    } catch (err) {
      ui.error(err.message);
    } finally {
      setOpening(null);
    }
  };

  const onRequest = async (n, accept) => {
    const ok = accept ? await friendActions.accept(n.user) : await friendActions.decline(n.user);
    if (ok) {
      markNotificationsRead([n.id]);
      refresh(true);
    }
  };

  const unread = data?.unread || 0;
  const loading = !data || (data.loading && !list.length);
  const readAll = () => { if (unread) markNotificationsRead(null, true); };

  return (
    <>
      <Navbar title="Thông báo" onBack={() => nav.pop(view.id)}
        right={<button type="button" className="icon-btn pressable" aria-label="Đánh dấu tất cả đã đọc" title="Đánh dấu tất cả đã đọc" disabled={!unread} onClick={readAll}><Icon name="check" /></button>} />
      <div className="view-scroll nt-scroll">
        <div className="nt-filters">
          {FILTERS.map((f) => {
            const count = unreadOf(f);
            return (
              <button type="button" key={f.key} className={`chip ${filter === f.key ? 'on' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}{count ? <span className="cnt">{count}</span> : null}
              </button>
            );
          })}
        </div>

        {data?.warnings?.length ? <div className="nt-warn">{data.warnings.map((w) => <p key={w}>{w}</p>)}</div> : null}

        {loading && !error ? <SkeletonList rows={8} avatar={48} thumb /> : null}
        {!data && error ? <StateView icon="bell" tone="error" title="Không tải được thông báo" text={error} action="Thử lại" onAction={() => refresh(true)} /> : null}
        {!loading && !shown.length ? (
          <div className="empty nt-empty"><span className="nt-empty-ic"><Icon name="bell" /></span>
            <b>{filter === 'all' ? 'Chưa có thông báo nào' : 'Không có thông báo loại này'}</b>
            <p>Cảm xúc, câu trả lời, tin nhắn và lời mời kết bạn trong {data.windowDays} ngày gần nhất sẽ hiện ở đây.</p></div>
        ) : null}

        {sections.map((s) => (
          <section key={s.label} className="nt-section">
            <h3>{s.label}</h3>
            <div className="nt-list">
              {s.items.map((n) => <Row key={n.id} n={n} onOpen={open} onRequest={onRequest} />)}
            </div>
          </section>
        ))}

        {data && !data.loading && data.updatedAt ? (
          <p className="nt-note">
            Locket không có hộp thư thông báo riêng. Danh sách được ghép từ dữ liệu thật trong {data.windowDays} ngày,
            cập nhật lúc {fullDate(data.updatedAt).split(' · ')[0]}. Tin nhắn và câu trả lời đã đọc trong ứng dụng Locket
            tự tính là đã đọc; các mục khác được đánh dấu đã đọc trên web.
          </p>
        ) : null}
      </div>
      {viewer ? (
        <MemoryViewer list={[viewer]} index={0} hasMore={false} onIndex={() => {}} onNeedMore={() => {}}
          onClose={() => setViewer(null)} onPatch={(id, patch) => setViewer((v) => (v && v.id === id ? { ...v, ...patch } : v))} />
      ) : null}
    </>
  );
}
