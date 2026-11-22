// Friends: the list (with search), incoming / sent requests, blocked people, username lookup,
// invite link, and a profile page for each person. Phones show the list as a bottom sheet like the
// app; desktop as a page. Every action updates the lists at once, then re-reads them from Locket.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { Icon } from '../lib/icons.jsx';
import { ago, fullDate, isDesktop, thumb } from '../lib/format.js';
import { appStore, dropRelation, fold, loadFriends, useApp } from '../store.js';
import { Navbar, nav } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { Button, SkeletonList, Spinner, StateView } from '../ui/kit.jsx';
import { RECONNECT_EVENT } from '../components/AppStatus.jsx';
import { MemoryViewer } from '../components/MemoryViewer.jsx';

export const inviteLink = () => `https://locket.cam/${appStore.get().user?.username || ''}`;

export async function copyInvite(link = inviteLink()) {
  try {
    await navigator.clipboard.writeText(link);
    ui.success('Đã sao chép liên kết Locket');
  } catch {
    ui.info(link);
  }
}

export async function shareInvite() {
  if (navigator.share) {
    try { await navigator.share({ title: 'Locket', text: 'Kết bạn với mình trên Locket nhé!', url: inviteLink() }); return; } catch { /* cancelled */ }
  }
  copyInvite();
}

export function openFriends() {
  if (isDesktop()) nav.openRoot('friends');
  else ui.sheet(({ close }) => <FriendsPanel sheet close={close} />, { full: true });
}

export function openFriendProfile(user, closeSheet) {
  closeSheet?.();
  setTimeout(() => nav.push('friend', { uid: user.uid, user }), closeSheet ? 60 : 0);
}

/* ------------------------------------------------------------------ actions (shared by list and profile) */
export const friendActions = {
  async accept(u) {
    try {
      await api.acceptRequest(u.uid);
      appStore.set((s) => ({ incoming: s.incoming.filter((x) => x.uid !== u.uid), friends: [...s.friends, u].sort((a, b) => a.name.localeCompare(b.name)) }));
      ui.success(`Bạn và ${u.name} đã là bạn bè`);
      return true;
    } catch (err) { ui.error(err.message); return false; } finally { loadFriends(); }
  },
  async decline(u) {
    try { dropRelation(u.uid); await api.declineRequest(u.uid); ui.success(`Đã từ chối lời mời của ${u.name}`); return true; } catch (err) { ui.error(err.message); return false; } finally { loadFriends(); }
  },
  async cancel(u) {
    try { dropRelation(u.uid); await api.cancelRequest(u.uid); ui.success('Đã hủy lời mời'); return true; } catch (err) { ui.error(err.message); return false; } finally { loadFriends(); }
  },
  async remove(u) {
    if (!await ui.confirm(`Xóa ${u.name}?`, 'Hai bạn sẽ không còn thấy khoảnh khắc của nhau. Thay đổi đồng bộ với ứng dụng Locket.', 'Xóa bạn')) return false;
    try { dropRelation(u.uid); await api.removeFriend(u.uid); ui.success(`Đã xóa ${u.name}`); return true; } catch (err) { ui.error(err.message); return false; } finally { loadFriends(); }
  },
  async block(u) {
    if (!await ui.confirm(`Chặn ${u.name}?`, 'Người này bị xóa khỏi bạn bè và không thể gửi lời mời cho bạn nữa.', 'Chặn')) return false;
    try {
      dropRelation(u.uid);
      appStore.set((s) => ({ blocked: [...s.blocked, u] }));
      await api.block(u.uid);
      ui.success(`Đã chặn ${u.name}`);
      return true;
    } catch (err) { ui.error(err.message); return false; } finally { loadFriends(); }
  },
  async unblock(u) {
    try { dropRelation(u.uid); await api.unblock(u.uid); ui.success(`Đã bỏ chặn ${u.name}`); return true; } catch (err) { ui.error(err.message); return false; } finally { loadFriends(); }
  },
  async add(u) {
    try {
      await api.sendRequest(u.uid);
      appStore.set((s) => ({ outgoing: [u, ...s.outgoing] }));
      ui.success(`Đã gửi lời mời tới ${u.name}`);
      return true;
    } catch (err) {
      ui.alert({ title: 'Không gửi được lời mời', message: err.message,
        buttons: [{ label: 'Đóng' }, { label: 'Sao chép link mời', bold: true, value: 'copy' }] })
        .then((r) => { if (r.value === 'copy') copyInvite(); });
      return false;
    } finally { loadFriends(); }
  },
};

// Row actions: the shared Button (spinner + no double submit), without opening the row underneath.
function BusyButton({ className = '', onClick, children, ...rest }) {
  const variant = className.includes('btn-gold') ? 'primary' : className.includes('btn-dark') ? 'secondary' : 'plain';
  const extra = className.replace(/\bbtn(-gold|-dark|-sm)?\b/g, '').trim();
  return (
    <Button variant={variant} size="sm" className={extra} onClick={(e) => { e.stopPropagation(); return onClick(e); }} {...rest}>
      {children}
    </Button>
  );
}

function relationOf(uid) {
  const s = appStore.get();
  if (uid === s.user?.uid) return 'self';
  if (s.friends.some((f) => f.uid === uid)) return 'friend';
  if (s.outgoing.some((f) => f.uid === uid)) return 'outgoing';
  if (s.incoming.some((f) => f.uid === uid)) return 'incoming';
  if (s.blocked.some((f) => f.uid === uid)) return 'blocked';
  return 'none';
}

/* ------------------------------------------------------------------ list */
export function FriendsPanel({ sheet = false, close }) {
  const { friends, incoming, outgoing, blocked, friendsLoaded } = useApp((s) => s);
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState(null);   // { state: 'loading'|'found'|'error', user?, message? }
  const [showBlocked, setShowBlocked] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    loadFriends();
    // requests can be sent / accepted from the iPhone app at any time: keep the lists fresh
    const t = setInterval(() => { if (!document.hidden) loadFriends(); }, 15000);
    return () => clearInterval(t);
  }, []);

  const q = fold(query.trim().replace(/^@/, ''));
  const filtered = useMemo(() => (q ? friends.filter((f) => fold(`${f.name} ${f.username}`).includes(q)) : friends), [friends, q]);
  const username = query.trim().replace(/^@/, '').replace(/^https?:\/\/locket\.cam\//i, '');
  const canLookup = /^[A-Za-z0-9._-]{2,40}$/.test(username) && !friends.some((f) => f.username?.toLowerCase() === username.toLowerCase());

  const search = async (e) => {
    e?.preventDefault();
    if (!canLookup) return;
    inputRef.current?.blur();
    setLookup({ state: 'loading', username });
    try {
      setLookup({ state: 'found', user: await api.lookup(username) });
    } catch (err) {
      setLookup({ state: 'error', message: err.status === 404 ? `Không tìm thấy @${username} trên Locket` : err.message });
    }
  };

  const shareVia = (kind) => {
    const text = encodeURIComponent(`Kết bạn với mình trên Locket nhé! ${inviteLink()}`);
    if (kind === 'share') shareInvite();
    if (kind === 'copy') copyInvite();
    if (kind === 'sms') window.location.href = `sms:?&body=${text}`;
    if (kind === 'mail') window.location.href = `mailto:?subject=Locket&body=${text}`;
  };

  const open = (u) => openFriendProfile(u, sheet ? close : null);
  const found = lookup?.state === 'found' ? lookup.user : null;
  const rel = found ? relationOf(found.uid) : null;

  const row = (u, sub, actions) => (
    <div className="person" key={u.uid} role="button" tabIndex={0} onClick={() => open(u)} onKeyDown={(e) => { if (e.key === 'Enter') open(u); }}>
      <Avatar user={u} />
      <div className="who">{u.name}<small>{sub}</small></div>
      {actions}
    </div>
  );

  return (
    <div className="friends">
      {sheet ? <div className="sheet-title">{friends.length ? `${friends.length} người bạn của bạn` : 'Thêm bạn bè của bạn'}</div> : null}
      <div className="sheet-sub">Tìm trong bạn bè, hoặc nhập tên người dùng Locket để thêm bạn mới</div>
      <form className="search" onSubmit={search}>
        <Icon name="search" />
        <input ref={inputRef} type="search" placeholder="Tìm bạn bè hoặc @username" autoComplete="off" autoCapitalize="none" spellCheck={false}
          enterKeyHint="search" value={query} onChange={(e) => { setQuery(e.target.value); setLookup(null); }} />
        {query ? <button type="button" className="x" aria-label="Xóa" onClick={() => { setQuery(''); setLookup(null); }}><Icon name="closeSm" /></button> : null}
      </form>

      {canLookup && !lookup ? (
        <button type="button" className="lookup-cta" onClick={search}><Icon name="search" /> Tìm <b>@{username}</b> trên Locket</button>
      ) : null}
      {lookup ? (
        <div className="lookup-result">
          {lookup.state === 'loading' ? <div className="person"><span className="spinner" /><div className="who">Đang tìm @{lookup.username}…</div></div> : null}
          {lookup.state === 'error' ? <div className="empty">{lookup.message}</div> : null}
          {found ? (
            <div className="person" role="button" tabIndex={0} onClick={() => open(found)}>
              <Avatar user={found} /><div className="who">{found.name}<small>@{found.username}</small></div>
              {rel === 'none' ? <BusyButton className="btn btn-gold btn-sm" onClick={() => friendActions.add(found)}><Icon name="plus" /> Thêm</BusyButton> : null}
              {rel === 'incoming' ? <BusyButton className="btn btn-gold btn-sm" onClick={() => friendActions.accept(found)}>Chấp nhận</BusyButton> : null}
              {rel === 'friend' ? <small className="rel">Đã là bạn bè</small> : null}
              {rel === 'outgoing' ? <small className="rel">Đã gửi lời mời</small> : null}
              {rel === 'blocked' ? <small className="rel">Đã chặn</small> : null}
              {rel === 'self' ? <small className="rel">Đây là bạn</small> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!q ? (
        <>
          <div className="section-label"><Icon name="link" /> Mời bạn bè qua ứng dụng khác</div>
          <div className="apps">
            <button type="button" className="app" onClick={() => shareVia('share')}><i><Icon name="messenger" /></i>Chia sẻ</button>
            <button type="button" className="app" onClick={() => shareVia('sms')}><i><Icon name="sms" /></i>Tin nhắn</button>
            <button type="button" className="app" onClick={() => shareVia('copy')}><i><Icon name="copy" /></i>Sao chép</button>
            <button type="button" className="app" onClick={() => shareVia('mail')}><i><Icon name="mail" /></i>Email</button>
          </div>
        </>
      ) : null}

      {incoming.length && !q ? (
        <>
          <div className="section-label"><Icon name="people" /> Yêu cầu kết bạn <span className="count-pill">{incoming.length}</span></div>
          {incoming.map((u) => row(u, `@${u.username}${u.since ? ` · ${ago(u.since)}` : ''}`, (
            <>
              <BusyButton className="btn btn-gold btn-sm" onClick={() => friendActions.accept(u)}>Chấp nhận</BusyButton>
              <BusyButton className="x" aria-label={`Từ chối ${u.name}`} onClick={() => friendActions.decline(u)}><Icon name="closeSm" /></BusyButton>
            </>
          )))}
        </>
      ) : null}

      <div className="section-label"><Icon name="people" /> {q ? `Kết quả trong bạn bè (${filtered.length})` : `Bạn bè của bạn (${friends.length})`}</div>
      {!friendsLoaded && !friends.length ? <SkeletonList rows={7} avatar={50} /> : null}
      {filtered.map((u) => row(u, u.username ? `@${u.username}` : 'Locket', (
        <button type="button" className="x" aria-label={`Quản lý ${u.name}`} onClick={async (e) => {
          e.stopPropagation();
          const choice = await ui.actionSheet({ title: u.name, actions: [
            { label: 'Xem hồ sơ', value: 'profile' }, { label: 'Xóa bạn', value: 'remove', destructive: true }, { label: 'Chặn', value: 'block', destructive: true }] });
          if (choice === 'profile') open(u);
          if (choice === 'remove') friendActions.remove(u);
          if (choice === 'block') friendActions.block(u);
        }}><Icon name="closeSm" /></button>
      )))}
      {friendsLoaded && !filtered.length ? (
        <div className="empty">{q ? `Không có bạn bè nào khớp "${query.trim()}".` : 'Bạn chưa có người bạn nào. Tìm theo tên người dùng hoặc gửi liên kết mời ở trên.'}</div>
      ) : null}

      {outgoing.length && !q ? (
        <>
          <div className="section-label"><Icon name="arrowRight" /> Lời mời đã gửi</div>
          {outgoing.map((u) => row(u, `Đang chờ chấp nhận${u.since ? ` · ${ago(u.since)}` : ''}`, (
            <BusyButton className="btn btn-dark btn-sm" onClick={() => friendActions.cancel(u)}>Hủy</BusyButton>
          )))}
        </>
      ) : null}

      {!q ? (
        <>
          <button type="button" className="section-label blocked-toggle" onClick={() => setShowBlocked((v) => !v)}>
            <Icon name="eyeOff" /> Đã chặn ({blocked.length}) <span className={`chev ${showBlocked ? 'open' : ''}`}><Icon name="chevDown" /></span>
          </button>
          {showBlocked ? (blocked.length ? blocked.map((u) => row(u, u.username ? `@${u.username}` : 'Đã chặn', (
            <BusyButton className="btn btn-dark btn-sm" onClick={() => friendActions.unblock(u)}>Bỏ chặn</BusyButton>
          ))) : <div className="empty">Bạn chưa chặn ai.</div>) : null}
        </>
      ) : null}
    </div>
  );
}

export function FriendsPage({ view }) {
  const count = useApp((s) => s.friends.length);
  return (
    <>
      <Navbar title={count ? `${count} người bạn` : 'Bạn bè'} onBack={() => nav.pop(view.id)} />
      <div className="view-scroll"><FriendsPanel /></div>
    </>
  );
}

/* ------------------------------------------------------------------ profile */
const RELATION_LABEL = {
  friend: 'Bạn bè', incoming: 'Đã gửi lời mời cho bạn', outgoing: 'Đang chờ chấp nhận lời mời',
  blocked: 'Đã chặn', none: 'Chưa kết bạn', self: 'Đây là bạn',
};

export function FriendProfile({ view }) {
  const { uid } = view.props;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [viewerIdx, setViewerIdx] = useState(null);
  // the live relationship from the store wins, so the page reacts at once to any action
  const relation = useApp((s) => {
    if (uid === s.user?.uid) return 'self';
    if (s.friends.some((f) => f.uid === uid)) return 'friend';
    if (s.outgoing.some((f) => f.uid === uid)) return 'outgoing';
    if (s.incoming.some((f) => f.uid === uid)) return 'incoming';
    if (s.blocked.some((f) => f.uid === uid)) return 'blocked';
    return s.friendsLoaded ? 'none' : null;
  });

  const load = useCallback(async () => {
    try { setData(await api.friendProfile(uid)); setError(''); } catch (err) { setError(err.message); }
  }, [uid]);
  useEffect(() => {
    load();
    window.addEventListener(RECONNECT_EVENT, load);
    return () => window.removeEventListener(RECONNECT_EVENT, load);
  }, [load]);

  const user = data?.user || view.props.user;
  const rel = relation || data?.relation || 'none';
  const stats = data?.stats;

  const act = (fn) => async () => { if (await fn(user)) load(); };
  const message = () => { if (isDesktop()) nav.openRoot('chat', { peer: user }); else nav.push('thread', { peer: user }); };
  const memories = () => nav.push('memories', { author: uid });

  return (
    <>
      <Navbar title={user?.name || 'Hồ sơ'} onBack={() => nav.pop(view.id)} />
      <div className="view-scroll friend-profile">
        <div className="profile-head">
          <span className="avatar-ring"><Avatar user={user} /></span>
          <h1>{user?.name}</h1>
          <div className="handle">{user?.username ? `@${user.username}` : ''}</div>
          <div className={`rel-badge ${rel}`}>{RELATION_LABEL[rel]}{data?.since && rel !== 'none' ? ` · từ ${fullDate(data.since).split(' · ')[1]}` : ''}</div>
          {user?.badge ? <div className="rel-badge gold">{String(user.badge)}</div> : null}
        </div>

        <div className="fp-actions">
          {rel === 'friend' ? <button type="button" className="btn btn-gold btn-sm" onClick={message}><Icon name="chat" /> Nhắn tin</button> : null}
          {rel === 'incoming' ? (
            <>
              <BusyButton className="btn btn-gold btn-sm" onClick={act(friendActions.accept)}>Chấp nhận</BusyButton>
              <BusyButton className="btn btn-dark btn-sm" onClick={act(friendActions.decline)}>Từ chối</BusyButton>
            </>
          ) : null}
          {rel === 'outgoing' ? <BusyButton className="btn btn-dark btn-sm" onClick={act(friendActions.cancel)}>Hủy lời mời</BusyButton> : null}
          {rel === 'none' ? <BusyButton className="btn btn-gold btn-sm" onClick={act(friendActions.add)}><Icon name="plus" /> Kết bạn</BusyButton> : null}
          {rel === 'blocked' ? <BusyButton className="btn btn-dark btn-sm" onClick={act(friendActions.unblock)}>Bỏ chặn</BusyButton> : null}
          {data?.inviteLink ? <button type="button" className="btn btn-dark btn-sm" onClick={() => copyInvite(data.inviteLink)}><Icon name="link" /> Link</button> : null}
        </div>

        {error ? <StateView icon="info" tone="error" title="Không tải được hồ sơ" text={error} action="Thử lại" onAction={load} /> : null}
        {!data && !error ? <div className="empty"><Spinner size="lg" /></div> : null}

        {stats ? (
          <>
            <div className="fp-stats">
              <div><b>{stats.moments}</b><small>khoảnh khắc</small></div>
              <div><b>{stats.videos}</b><small>video</small></div>
              <div><b>{stats.comments}</b><small>bình luận</small></div>
            </div>
            {stats.moments ? <p className="fp-note">Từ {fullDate(stats.first).split(' · ')[1]} đến {ago(stats.last)} · theo lịch sử đã đồng bộ</p> : null}

            {data.recent.length ? (
              <>
                <div className="section-label between">
                  <span><Icon name="grid" /> Khoảnh khắc gần đây</span>
                  <button type="button" className="link-btn" onClick={memories}>Xem tất cả</button>
                </div>
                <div className="fp-grid">
                  {data.recent.map((m, i) => (
                    <button type="button" key={m.id} className="mem-tile" onClick={() => setViewerIdx(i)} title={fullDate(m.createdAt)}>
                      <img src={thumb(m.image)} alt="" loading="lazy" decoding="async" draggable="false" />
                      {m.video ? <span className="vid"><Icon name="play" /></span> : null}
                    </button>
                  ))}
                </div>
              </>
            ) : <div className="empty">Chưa có khoảnh khắc nào của {user?.firstName || user?.name} trong lịch sử đã đồng bộ.</div>}
          </>
        ) : null}

        {rel === 'friend' || rel === 'incoming' || rel === 'outgoing' || rel === 'none' ? (
          <>
            <div className="section-label" style={{ color: 'var(--danger)' }}>Quản lý</div>
            <div className="group">
              {rel === 'friend' ? <button type="button" className="cell danger" onClick={act(friendActions.remove)}><span className="ic"><Icon name="closeSm" /></span><span className="grow">Xóa khỏi bạn bè</span></button> : null}
              <button type="button" className="cell danger" onClick={act(friendActions.block)}><span className="ic"><Icon name="eyeOff" /></span><span className="grow">Chặn {user?.firstName || user?.name}</span></button>
            </div>
          </>
        ) : null}
      </div>
      {viewerIdx !== null && data?.recent?.[viewerIdx] ? (
        <MemoryViewer
          list={data.recent}
          index={viewerIdx}
          hasMore={false}
          onIndex={setViewerIdx}
          onNeedMore={() => {}}
          onClose={() => setViewerIdx(null)}
          onPatch={(id, fields) => setData((d) => (d ? { ...d, recent: d.recent.map((x) => (x.id === id ? { ...x, ...fields } : x)) } : d))}
        />
      ) : null}
    </>
  );
}
