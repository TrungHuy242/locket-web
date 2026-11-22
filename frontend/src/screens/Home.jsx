// Home: one vertical pager (camera on top, moments below), the Locket top bar, the reply bar,
// and on desktop the history panel. The feed is paged from the backend and polled for new moments.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { Icon } from '../lib/icons.jsx';
import { ago, downloadBlob, thumb, vibrate } from '../lib/format.js';
import { RECONNECT_EVENT } from '../components/AppStatus.jsx';
import { EMOJI_PALETTE, QUICK_EMOJI, appStore, loadFriends, loadNotifications, loadUnread, refreshMe, useApp } from '../store.js';
import { nav, useSection } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { SkeletonGrid, Spinner, StateView } from '../ui/kit.jsx';
import { CameraPage } from './Camera.jsx';
import { MomentPage } from './MomentPage.jsx';
import { openFriends } from './Friends.jsx';
import { openActivity, openComments, openEmojiPicker, sendReaction } from './Interactions.jsx';

const FEED_POLL_MS = 25000;
const NOTIF_POLL_MS = 90000;
const ACTIVITY_POLL_MS = 20000;
const PAGE = 30;
const MONTHS = ['tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5', 'tháng 6', 'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12'];

// lets the sidebar move the pager without prop drilling
export const homeBus = { go: () => {} };

const sortMoments = (list) => list.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
const sameMoment = (a, b) => a.createdAt === b.createdAt && a.image === b.image && a.video === b.video
  && a.user.name === b.user.name && a.user.avatar === b.user.avatar && a.commentCount === b.commentCount
  && JSON.stringify(a.overlay) === JSON.stringify(b.overlay);

function GridView({ list, title, total, loaded, onPick, onClose, onMore, onCamera }) {
  const [entered, setEntered] = useState(false);
  useEffect(() => { const t = setTimeout(() => setEntered(true), 20); return () => clearTimeout(t); }, []);
  const cells = [];
  let lastMonth = '';
  list.forEach((m, i) => {
    const d = new Date(m.createdAt);
    const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (label !== lastMonth) { lastMonth = label; cells.push(<div className="grid-month" key={`m-${label}`}>{label}</div>); }
    cells.push(
      <button type="button" key={m.id} onClick={() => onPick(i)}>
        <img src={thumb(m.image)} alt="" loading="lazy" decoding="async" />
        {m.video ? <span className="vid"><Icon name="play" /></span> : null}
      </button>,
    );
  });
  return (
    <div className={`grid-view ${entered ? 'in' : ''}`}>
      <header className="navbar">
        <button type="button" className="icon-btn pressable" aria-label="Kỷ niệm" title="Kỷ niệm" onClick={() => { onClose(); nav.openRoot('memories'); }}><Icon name="heart" /></button>
        <h2>{title}</h2>
        <button type="button" className="icon-btn pressable" aria-label="Đóng" onClick={onClose}><Icon name="closeSm" /></button></header>
      <div className="grid-scroll" onScroll={(e) => { const b = e.currentTarget; if (b.scrollHeight - b.scrollTop - b.clientHeight < 300) onMore(); }}>
        {list.length ? <div className="grid">{cells}</div> : <div className="empty"><b>Chưa có khoảnh khắc nào</b></div>}
        {loaded < total ? <p className="history-note">{loaded} / {total} khoảnh khắc</p> : null}
      </div>
      <button type="button" className="shutter-mini grid-fab" aria-label="Về camera" onClick={onCamera} />
    </div>
  );
}

const HistoryTile = memo(function HistoryTile({ moment: m, idx, active, onPick }) {
  return (
    <button type="button" className={active ? 'on' : ''} title={`${m.mine ? 'Bạn' : m.user.name} · ${ago(m.createdAt)}`}
      onClick={() => onPick(idx)}>
      <img src={thumb(m.image)} alt="" loading="lazy" decoding="async" draggable="false" />
      {m.video ? <span className="vid"><Icon name="play" /></span> : null}
    </button>
  );
});

const HistoryPanel = memo(function HistoryPanel({ visible, index, filterLabel, feed, syncNote, loadedCount, onFilter, onPick, onMore }) {
  return (
    <aside className="history-panel" aria-label="Lịch sử">
      <div className="history-head"><h2>Lịch sử</h2>
        <button type="button" className="pill" onClick={(e) => onFilter(e.currentTarget)}>{filterLabel}<Icon name="chevDown" /></button></div>
      <div className="history-scroll" onScroll={(e) => { const b = e.currentTarget; if (b.scrollHeight - b.scrollTop - b.clientHeight < 260) onMore(); }}>
        {visible.length ? (
          <div className="history-grid">
            {visible.map((m, i) => (
              <HistoryTile key={m.id} moment={m} idx={i} active={i + 1 === index} onPick={onPick} />
            ))}
          </div>
        ) : (
          feed.error ? <StateView icon="grid" tone="error" title="Không tải được" text={feed.error} />
            : !feed.loaded ? <SkeletonGrid count={12} />
              : <StateView icon="camera" title="Chưa có khoảnh khắc nào" text="Ảnh bạn và bạn bè gửi sẽ xuất hiện ở đây." />
        )}
        {syncNote ? <p className="history-note">{syncNote}</p> : null}
        {feed.total > loadedCount ? <button type="button" className="btn btn-dark btn-sm history-more" onClick={onMore}>{feed.loadingMore ? 'Đang tải…' : 'Tải thêm'}</button> : null}
      </div>
    </aside>
  );
});

export function Home({ under }) {
  const user = useApp((s) => s.user);
  const friends = useApp((s) => s.friends);
  const unread = useApp((s) => s.unread);
  const notifUnread = useApp((s) => s.notifUnread);
  const section = useSection();
  const covered = !!section;

  const pagerRef = useRef(null);
  const replyRef = useRef(null);
  const [moments, setMoments] = useState([]);
  const [feed, setFeed] = useState({ loaded: false, error: null, total: 0, syncing: false, loadingMore: false });
  const [filterUid, setFilterUid] = useState(null);
  const [index, setIndex] = useState(0);              // 0 = camera, n = nth moment
  const [previewing, setPreviewing] = useState(false);
  const [typing, setTyping] = useState(false);
  const [grid, setGrid] = useState(false);
  const [bursts, setBursts] = useState([]);
  const [music, setMusic] = useState(null);           // id of the moment whose caption music plays
  const [activity, setActivity] = useState({});       // moment id -> { viewers, count }

  const momentsRef = useRef(moments);
  momentsRef.current = moments;
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const indexRef = useRef(index);
  indexRef.current = index;
  const previewingRef = useRef(previewing);
  previewingRef.current = previewing;
  const scrollRaf = useRef(0);
  const keepIdRef = useRef(null);
  const viewed = useRef(new Set());
  const syncTimer = useRef(0);
  const syncError = useRef(null);
  const warned = useRef(false);
  const alive = useRef(true);
  const player = useRef(null);

  const visible = useMemo(() => (filterUid ? moments.filter((m) => m.user.uid === filterUid) : moments), [moments, filterUid]);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const current = index > 0 ? visible[index - 1] : null;
  const pageCount = 1 + Math.max(1, visible.length);

  /* ------------------------------------------------ data */
  const mergeMoments = useCallback((list) => {
    const byId = new Map(momentsRef.current.map((m) => [m.id, m]));
    let changed = false;
    list.forEach((m) => {
      const old = byId.get(m.id);
      if (!old || !sameMoment(old, m)) changed = true;
      byId.set(m.id, m);
    });
    if (changed) setMoments(sortMoments([...byId.values()]));
    return changed;
  }, []);

  // Reload every page already on screen (the server-side history changed underneath it).
  const reloadLoaded = useCallback(async () => {
    const want = Math.max(PAGE, momentsRef.current.length);
    const all = [];
    let before;
    let data;
    do {
      data = await api.feed({ before, limit: 60 });
      all.push(...data.moments);
      before = data.nextCursor;
    } while (before && all.length < want);
    setMoments(sortMoments(all));
    return data.total;
  }, []);

  const loadFeed = useCallback(async ({ silent = false, refresh = false } = {}) => {
    try {
      const data = await api.feed({ refresh });
      if (!alive.current) return;
      const prev = feedRef.current;
      const grew = prev.loaded && data.total !== prev.total;
      mergeMoments(data.moments);
      let total = data.total;
      if (grew && momentsRef.current.length > data.moments.length) total = await reloadLoaded();
      if (data.syncError && data.syncError !== syncError.current) ui.warning(data.syncError, 3600);
      syncError.current = data.syncError;
      if (data.warnings?.includes('chat') && !warned.current) { warned.current = true; ui.warning('Không đọc được một số cuộc trò chuyện để lấy khoảnh khắc cũ.', 3600); }
      setFeed((f) => ({ ...f, loaded: true, error: null, total, syncing: !!data.syncing }));
      clearTimeout(syncTimer.current);
      // while the server is still pulling history from Locket, check back quickly
      if (data.syncing) syncTimer.current = setTimeout(() => loadFeed({ silent: true }), 3000);
      else if (prev.syncing && !silent) ui.success('Đã đồng bộ xong lịch sử');
    } catch (err) {
      if (err.status === 401 || !alive.current) return;
      if (!momentsRef.current.length) setFeed((f) => ({ ...f, loaded: true, error: err.message }));
      else if (!silent) ui.error(err.message);
    }
  }, [mergeMoments, reloadLoaded]);

  const loadMore = useCallback(async () => {
    const f = feedRef.current;
    const list = momentsRef.current;
    if (f.loadingMore || !f.loaded || list.length >= f.total) return;
    const last = list[list.length - 1];
    if (!last) return;
    setFeed((x) => ({ ...x, loadingMore: true }));
    feedRef.current = { ...f, loadingMore: true };
    try {
      const data = await api.feed({ before: `${last.createdAt}_${last.id}`, limit: PAGE });
      mergeMoments(data.moments);
      setFeed((x) => ({ ...x, total: data.moments.length ? data.total : list.length }));
    } catch (err) {
      if (err.status !== 401) ui.error(`Không tải thêm được: ${err.message}`);
    } finally {
      setFeed((x) => ({ ...x, loadingMore: false }));
    }
  }, [mergeMoments]);

  useEffect(() => {
    alive.current = true;
    // Stagger startup calls so the server prioritizes /api/feed + first media on constrained CPUs
    loadFeed();
    const tFriends = setTimeout(() => { if (alive.current) loadFriends(); }, 350);
    const tUnread = setTimeout(() => { if (alive.current) loadUnread(); }, 900);
    const tNotif = setTimeout(() => { if (alive.current) loadNotifications(); }, 2200);
    const poll = setInterval(() => {
      if (document.hidden) return;
      if (!replyRef.current?.matches(':focus')) loadFeed({ silent: true });
      loadUnread();
    }, FEED_POLL_MS);
    const notifPoll = setInterval(() => {
      if (!document.hidden) loadNotifications();
    }, NOTIF_POLL_MS);
    // back online (or the server answers again): refresh everything on screen at once
    const onReconnect = () => { loadFeed({ silent: true }); loadUnread(); loadNotifications(); loadFriends(); refreshMe(); };
    // back to the app after a while (e.g. from the iPhone app): pick up profile / friend changes
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 60000) { refreshMe(); loadFriends(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    const profilePoll = setInterval(() => { if (!document.hidden) refreshMe(); }, 5 * 60 * 1000);
    window.addEventListener(RECONNECT_EVENT, onReconnect);
    return () => {
      alive.current = false;
      clearTimeout(tFriends);
      clearTimeout(tUnread);
      clearTimeout(tNotif);
      cancelAnimationFrame(scrollRaf.current);
      clearInterval(poll);
      clearInterval(notifPoll);
      clearTimeout(syncTimer.current);
      window.removeEventListener(RECONNECT_EVENT, onReconnect);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(profilePoll);
    };
  }, [loadFeed]);

  /* ------------------------------------------------ paging */
  const goTo = useCallback((i, smooth = true) => {
    const pager = pagerRef.current;
    if (!pager) return;
    pager.scrollTo({ top: i * pager.clientHeight, behavior: smooth ? 'smooth' : 'instant' });
    if (!smooth) setIndex(i);
  }, []);
  homeBus.go = (target) => { if (!previewing) goTo(target === 'feed' ? 1 : 0, false); };

  const onScroll = useCallback(() => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const pager = pagerRef.current;
      if (!pager || !pager.clientHeight) return;
      const next = Math.round(pager.scrollTop / pager.clientHeight);
      if (next !== indexRef.current) { setIndex(next); replyRef.current?.blur(); }
    });
  }, []);

  const pickHistory = useCallback((i) => {
    if (!previewingRef.current) goTo(i + 1, false);
  }, [goTo]);

  // Keep the reader on the same moment when the list changes (new moments, filter, deletes).
  useLayoutEffect(() => {
    const id = keepIdRef.current;
    if (indexRef.current === 0) return;
    const at = id ? visible.findIndex((m) => m.id === id) : -1;
    const target = at >= 0 ? at + 1 : Math.min(indexRef.current, Math.max(1, visible.length));
    if (target !== indexRef.current) goTo(target, false);
    else pagerRef.current.scrollTop = target * pagerRef.current.clientHeight;
  }, [visible, goTo]);
  useEffect(() => { keepIdRef.current = current?.id ?? null; }, [current]);

  useEffect(() => { appStore.set({ homeView: index === 0 ? 'camera' : 'feed' }); }, [index]);
  useEffect(() => { if (index > 0 && index >= visible.length - 3) loadMore(); }, [index, visible.length, loadMore]);

  // desktop: drag with the mouse to page, the way a finger swipes on the phone
  useEffect(() => {
    const pager = pagerRef.current;
    let drag = null;
    const down = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || previewing) return;
      if (e.target.closest('button, input, [contenteditable], a, video')) return;
      drag = { y: e.clientY, top: pager.scrollTop, moved: false };
    };
    const move = (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) < 6) return;
      if (!drag.moved) { drag.moved = true; pager.style.scrollSnapType = 'none'; }
      pager.scrollTop = drag.top - dy;
    };
    const up = () => {
      if (!drag) return;
      const { moved, top } = drag;
      drag = null;
      if (!moved) return;
      const delta = pager.scrollTop - top;
      const from = Math.round(top / pager.clientHeight);
      const target = Math.abs(delta) > 60 ? from + Math.sign(delta) : from;
      goTo(Math.max(0, Math.min(target, pager.children.length - 1)));
      setTimeout(() => { pager.style.scrollSnapType = ''; }, 450);
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 80);
    };
    pager.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      pager.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [goTo, previewing]);

  // desktop keyboard paging
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable]') || ui.hasOpen() || nav.isOpen() || previewing) return;
      const last = pagerRef.current.children.length - 1;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); goTo(Math.min(indexRef.current + 1, last)); }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goTo(Math.max(indexRef.current - 1, 0)); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [goTo, previewing]);

  /* ------------------------------------------------ per-moment side effects */
  const loadActivity = useCallback(async (id) => {
    try {
      const data = await api.activity(id);
      setActivity((a) => ({ ...a, [id]: data }));
    } catch { /* keep what is shown */ }
  }, []);

  useEffect(() => {
    if (!current || covered) return undefined;
    if (current.mine) {
      loadActivity(current.id);
      const t = setInterval(() => { if (!document.hidden) loadActivity(current.id); }, ACTIVITY_POLL_MS);
      return () => clearInterval(t);
    }
    if (!viewed.current.has(current.id)) {
      viewed.current.add(current.id);
      api.markViewed(current.id).catch(() => {});
    }
    return undefined;
  }, [current, covered, loadActivity]);

  /* ------------------------------------------------ caption music */
  const stopMusic = useCallback(() => {
    player.current?.pause();
    setMusic(null);
  }, []);
  const toggleMusic = useCallback((id, url) => {
    if (!player.current) {
      player.current = new Audio();
      player.current.addEventListener('ended', () => setMusic(null));
    }
    const a = player.current;
    if (music === id && !a.paused) { stopMusic(); return; }
    a.src = url;
    setMusic(id);
    a.play().catch(() => { setMusic(null); ui.error('Không phát được đoạn nhạc này'); });
  }, [music, stopMusic]);
  useEffect(() => { if (music && (current?.id !== music || covered)) stopMusic(); }, [current, covered, music, stopMusic]);
  useEffect(() => () => player.current?.pause(), []);

  /* ------------------------------------------------ actions */
  const burst = (emoji) => {
    const width = pagerRef.current?.clientWidth || 360;
    const items = Array.from({ length: 14 }, (_, i) => ({
      id: `${Date.now()}-${i}`, emoji, left: (0.12 + Math.random() * 0.72) * width,
      dx: (Math.random() - 0.5) * 120, sc: (0.8 + Math.random() * 0.9).toFixed(2), rot: (Math.random() - 0.5) * 50, delay: i * 45,
    }));
    setBursts((b) => [...b, ...items]);
    setTimeout(() => setBursts((b) => b.filter((x) => !items.includes(x))), 2300);
  };

  const reactTo = async (emoji) => {
    const m = current;
    if (!m || m.mine) return;
    burst(emoji);
    vibrate(10);
    const before = m.myReactions || [];
    patchMoment(m.id, { myReactions: [...before, emoji] });          // show it right away
    try {
      patchMoment(m.id, { myReactions: await sendReaction(m, emoji) });
    } catch (err) {
      patchMoment(m.id, { myReactions: before });
      ui.error(err.message);
    }
  };

  const sendReply = async (e) => {
    e.preventDefault();
    const input = replyRef.current;
    const text = input.value.trim();
    if (!current || current.mine || !text) return;
    input.value = '';
    setTyping(false);
    input.blur();
    try {
      await api.sendMessage(current.user.uid, text, current.id);
      patchMoment(current.id, { commentCount: (current.commentCount || 0) + 1 });
      ui.success(`Đã gửi tới ${current.user.firstName || current.user.name}`);
    } catch (err) {
      input.value = text;
      setTyping(true);
      ui.error(err.message);
    }
  };

  const openFilter = useCallback((anchor) => {
    const options = [{ uid: null, name: 'Mọi người' }, ...friends.map((f) => ({ uid: f.uid, name: f.name, user: f })), { uid: user.uid, name: 'Bạn', user }];
    ui.popover(anchor, ({ close }) => (
      <div>
        {options.map((o) => (
          <button type="button" key={o.uid || 'all'} onClick={() => { keepIdRef.current = null; setFilterUid(o.uid); goTo(1, false); close(); }}>
            {o.user ? <Avatar user={o.user} size={32} /> : <span className="avatar" style={{ '--s': '32px' }}><Icon name="people" /></span>}
            <span>{o.name}</span>
            {o.uid === filterUid ? <span className="check"><Icon name="check" /></span> : null}
          </button>
        ))}
      </div>
    ));
  }, [friends, user, filterUid, goTo]);

  const patchMoment = useCallback((id, fields) => {
    setMoments((list) => list.map((m) => (m.id === id ? { ...m, ...fields } : m)));
  }, []);
  const showComments = useCallback((m) => {
    openComments(m, { onCount: (n) => patchMoment(m.id, { commentCount: n }) });
  }, [patchMoment]);

  const saveMoment = async (m) => {
    try {
      const blob = await (await fetch(m.video || m.image, { credentials: 'same-origin' })).blob();
      downloadBlob(blob, `locket-${m.id}.${m.video ? 'mp4' : (blob.type.split('/')[1] || 'jpg')}`);
      ui.success('Đã lưu vào máy');
    } catch {
      ui.error('Không lưu được');
    }
  };

  const openMore = async () => {
    const m = current;
    if (!m) return;
    const actions = [{ label: m.video ? 'Lưu video vào máy' : 'Lưu vào máy', value: 'save' }];
    if (m.mine) actions.push({ label: 'Xóa khoảnh khắc', value: 'delete', destructive: true });
    const choice = await ui.actionSheet({ actions });
    if (choice === 'save') saveMoment(m);
    if (choice === 'delete') {
      if (!await ui.confirm('Xóa khoảnh khắc này?', 'Khoảnh khắc sẽ bị gỡ khỏi Locket của bạn bè.', 'Xóa')) return;
      try {
        await api.deleteMoment(m.id);
        setMoments((list) => list.filter((x) => x.id !== m.id));
        setFeed((f) => ({ ...f, total: Math.max(0, f.total - 1) }));
        ui.success('Đã xóa khoảnh khắc');
      } catch (err) {
        ui.error(err.message);
      }
    }
  };

  const onPosted = useCallback((moment) => {
    setFeed((f) => ({ ...f, total: f.total + (momentsRef.current.some((m) => m.id === moment.id) ? 0 : 1) }));
    setMoments((list) => sortMoments([moment, ...list.filter((m) => m.id !== moment.id)]));
    ui.success('Đã gửi khoảnh khắc');
  }, []);

  /* ------------------------------------------------ render */
  const who = filterUid && (filterUid === user.uid ? { name: 'Bạn' } : friends.find((f) => f.uid === filterUid));
  const filterLabel = who ? (who.firstName || who.name) : 'Mọi người';
  const quick = (current?.suggestedReactions?.length ? current.suggestedReactions : QUICK_EMOJI).slice(0, 3);
  const view = index === 0 ? 'camera' : 'feed';
  const views = activity[current?.id]?.viewers || [];
  const loadedCount = moments.length;
  const syncNote = feed.syncing ? 'Đang đồng bộ từ Locket…' : feed.total > loadedCount ? `${loadedCount} / ${feed.total} khoảnh khắc` : loadedCount ? `${loadedCount} khoảnh khắc` : '';

  let emptyBody;
  if (!visible.length) {
    if (!feed.loaded) emptyBody = <><Spinner size="lg" className="center" /><span style={{ marginTop: 14 }}>Đang tải khoảnh khắc từ Locket…</span></>;
    else if (feed.error) emptyBody = <><b>Không tải được bảng tin</b>{feed.error}<br /><button type="button" className="btn btn-dark btn-sm" style={{ marginTop: 16 }} onClick={() => { setFeed((f) => ({ ...f, loaded: false, error: null })); loadFeed({ refresh: true }); }}>Thử lại</button></>;
    else if (filterUid && loadedCount < feed.total) emptyBody = <><b>Chưa thấy khoảnh khắc nào</b>Chưa có trong {loadedCount} khoảnh khắc đã tải.<br /><button type="button" className="btn btn-dark btn-sm" style={{ marginTop: 16 }} onClick={loadMore}>Tải thêm</button></>;
    else emptyBody = <><b>Chưa có khoảnh khắc nào</b>Chụp một tấm ảnh hoặc thêm bạn bè để bắt đầu.</>;
  }

  return (
    <div className={`home ${under ? `under-${under}` : ''}`} data-view={view} data-mode={previewing ? 'preview' : 'capture'}>
      <div className="pager" ref={pagerRef} onScroll={onScroll}>
        <CameraPage active={index === 0 && !covered} latest={moments[0]} onPreviewChange={setPreviewing} onPosted={onPosted} onOpenHistory={() => goTo(1)} />
        {visible.length
          ? visible.map((m, i) => (
            Math.abs(i + 1 - index) <= 2 ? (
              <MomentPage key={m.id} moment={m} active={i + 1 === index && !covered} playingMusic={music === m.id}
                onMusic={toggleMusic} onComments={showComments} />
            ) : (
              <section key={m.id} className="page page-moment" data-id={m.id} aria-hidden="true" />
            )
          ))
          : <section className="page page-empty"><div className="empty">{emptyBody}</div></section>}
      </div>

      <header className="topbar">
        <button type="button" className="pressable" aria-label="Hồ sơ" onClick={() => nav.openRoot('profile')}><Avatar user={user} /></button>
        <div className="topbar-center">
          <button type="button" className="pill pill-friends" onClick={openFriends}><Icon name="people" />{friends.length ? `${friends.length} người bạn` : 'Thêm bạn bè'}</button>
          <button type="button" className="pill pill-filter" onClick={(e) => openFilter(e.currentTarget)}>{filterLabel}<Icon name="chevDown" /></button>
        </div>
        <span className="topbar-right">
          <button type="button" className="icon-btn" aria-label="Thông báo" onClick={() => nav.openRoot('notifications')}>
            <Icon name="bell" />{notifUnread ? <i className="badge">{notifUnread > 9 ? '9+' : notifUnread}</i> : null}
          </button>
          <button type="button" className="icon-btn" aria-label="Tin nhắn" onClick={() => nav.openRoot('chat')}>
            <Icon name="chat" />{unread ? <i className="badge">{unread > 9 ? '9+' : unread}</i> : null}
          </button>
        </span>
      </header>

      <footer className="feedbar">
        <form className={`reply ${typing ? 'typing' : ''}`} hidden={!current || current.mine} onSubmit={sendReply}>
          <input ref={replyRef} type="text" placeholder="Gửi tin nhắn..." maxLength={300} autoComplete="off" enterKeyHint="send"
            onInput={(e) => setTyping(e.currentTarget.value.trim().length > 0)} />
          <span className="quick">
            {quick.map((e) => <button type="button" key={e} onClick={() => reactTo(e)}>{e}</button>)}
            <button type="button" className="more-emoji" aria-label="Thêm cảm xúc" onClick={(e) => openEmojiPicker(e.currentTarget, reactTo)}><Icon name="emojiAdd" /></button>
          </span>
          <button className="send" aria-label="Gửi"><Icon name="arrowUp" /></button>
        </form>
        {current?.mine ? (
          <button type="button" className="activity" onClick={() => openActivity(current)}>
            {views.length
              ? <><span className="stack">{views.slice(0, 3).map((v) => <Avatar key={v.user.uid} user={v.user} />)}</span><span>Hoạt động</span>
                {activity[current.id]?.summary?.length ? <span className="act-emojis">{activity[current.id].summary.slice(0, 4).map((x) => x.emoji).join('')}</span> : null}</>
              : <span>{activity[current.id] ? '✨ Chưa có hoạt động nào!' : '✨ Hoạt động'}</span>}
          </button>
        ) : null}
        <nav className="feednav">
          <button type="button" className="cam-side" aria-label="Tất cả khoảnh khắc" onClick={() => setGrid(true)}><Icon name="grid" /></button>
          <button type="button" className="shutter-mini" aria-label="Về camera" onClick={() => goTo(0)} />
          <button type="button" className="cam-side" aria-label="Tùy chọn" onClick={openMore}><Icon name="share" /></button>
        </nav>
      </footer>

      <div className="pager-arrows">
        <button type="button" className="icon-btn" aria-label="Trước" disabled={index === 0} onClick={() => goTo(Math.max(index - 1, 0))}><Icon name="arrowUp" /></button>
        <button type="button" className="icon-btn" aria-label="Tiếp" disabled={index >= pageCount - 1} onClick={() => goTo(Math.min(index + 1, pageCount - 1))}><Icon name="arrowDown" /></button>
      </div>

      <HistoryPanel visible={visible} index={index} filterLabel={filterLabel} feed={feed} syncNote={syncNote}
        loadedCount={loadedCount} onFilter={openFilter} onPick={pickHistory} onMore={loadMore} />

      {grid ? (
        <GridView list={visible} title={filterLabel} total={feed.total} loaded={loadedCount} onMore={loadMore}
          onPick={(i) => { goTo(i + 1, false); setGrid(false); }} onClose={() => setGrid(false)} onCamera={() => { goTo(0, false); setGrid(false); }} />
      ) : null}

      {bursts.map((b) => (
        <span key={b.id} className="fly-emoji" style={{ left: b.left, '--dx': `${b.dx}px`, '--sc': b.sc, '--rot': `${b.rot}deg`, animationDelay: `${b.delay}ms` }}>{b.emoji}</span>
      ))}
    </div>
  );
}
