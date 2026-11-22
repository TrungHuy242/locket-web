// Messages: conversation list and threads with realtime updates (Locket's WebSocket, relayed by the backend),
// cursor-paged history, delivery / read status, reactions, unsend, and moments sent into the chat.
// Phones push the thread over the list; desktop shows list and thread side by side.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { RECONNECT_EVENT } from '../components/AppStatus.jsx';
import { SkeletonBubbles, SkeletonGrid, SkeletonList, StateView } from '../ui/kit.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Icon } from '../lib/icons.jsx';
import { ago, clock, fullDate, isDesktop, thumb } from '../lib/format.js';
import { MomentVideo } from './MomentPage.jsx';
import { getSettings } from '../lib/settings.js';
import { EMOJI_PALETTE, appStore, loadUnread, useApp } from '../store.js';
import { Navbar, nav } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';

const LIST_POLL_MS = 8000;
const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️){1,6}$/u;

const dayLabel = (ms) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? `Hôm nay ${clock(ms)}` : `${d.getDate()} thg ${d.getMonth() + 1}, ${clock(ms)}`;
};

export function ChatList({ view }) {
  const friends = useApp((s) => s.friends);
  const [split, setSplit] = useState(isDesktop);
  const [rows, setRows] = useState(() => appStore.get().conversations);
  const [error, setError] = useState(null);
  const [peer, setPeer] = useState(() => view.props?.peer || (isDesktop() && appStore.get().conversations?.length ? appStore.get().conversations[0].peer : null));   // thread shown in the desktop pane

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 769px)');
    const onChange = (e) => setSplit(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const load = useCallback(async () => {
    try {
      const { conversations } = await api.conversations();
      setRows(conversations);
      setError(null);
      appStore.set({ conversations, unread: conversations.reduce((sum, c) => sum + (c.unread || 0), 0) });
      return conversations;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    load().then((list) => { if (split && list?.length) setPeer((p) => p || list[0].peer); });
    const t = setInterval(() => { if (!document.hidden) load(); }, LIST_POLL_MS);
    window.addEventListener(RECONNECT_EVENT, load);           // back online: refresh at once
    return () => { clearInterval(t); window.removeEventListener(RECONNECT_EVENT, load); };
  }, [load, split]);

  const open = (p) => {
    if (split) setPeer(p);
    else nav.push('thread', { peer: p, onClose: load });
  };

  const withChat = new Set((rows || []).map((c) => c.peer.uid));
  const others = friends.filter((f) => !withChat.has(f.uid));

  return (
    <div className={split ? 'chat-split' : ''} style={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: split ? 'row' : 'column' }}>
      <div className="chat-list">
        <Navbar title="Tin nhắn" onBack={() => nav.pop(view.id)} />
        <div className="view-scroll">
          {!rows && !error ? <SkeletonList rows={8} avatar={56} /> : null}
          {!rows && error ? <StateView icon="chat" tone="error" title="Không tải được tin nhắn" text={error} action="Thử lại" onAction={load} /> : null}
          {rows?.map((c) => (
            <button type="button" key={c.id} className={`conv ${c.unread ? 'unread' : ''} ${peer?.uid === c.peer.uid ? 'sel' : ''}`} onClick={() => open(c.peer)}>
              <Avatar user={c.peer} />
              <div className="grow"><b>{c.peer.name}<span>{ago(c.lastAt)}</span></b><p>{c.lastMine ? 'Bạn: ' : ''}{c.lastText || 'Đã gửi một khoảnh khắc'}</p></div>
              {c.unread ? <i className="dot" /> : <span className="chev"><Icon name="chevRight" /></span>}
            </button>
          ))}
          {rows && !rows.length ? <StateView icon="chat" title="Chưa có tin nhắn" text="Trả lời một khoảnh khắc của bạn bè để bắt đầu trò chuyện." /> : null}
          {rows && others.length ? (
            <>
              <div className="section-label">Bạn bè</div>
              {others.map((f) => (
                <button type="button" key={f.uid} className={`conv ${peer?.uid === f.uid ? 'sel' : ''}`} onClick={() => open(f)}>
                  <Avatar user={f} /><div className="grow"><b>{f.name}</b><p>Nhấn để nhắn tin</p></div><span className="chev"><Icon name="chevRight" /></span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      </div>
      {split ? (
        <div className="chat-pane">
          {peer ? <Thread key={peer.uid} peer={peer} onChange={load} embedded /> : <div className="empty" style={{ margin: 'auto' }}><b>Tin nhắn của bạn</b>Chọn một cuộc trò chuyện để bắt đầu.</div>}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadPage({ view }) {
  useEffect(() => () => view.props.onClose?.(), [view]);
  return <Thread peer={view.props.peer} onBack={() => nav.pop(view.id)} />;
}

/* ------------------------------------------------------------------ realtime */
// Locket's chat socket is relayed by the backend (the token stays on the server). Its event format is
// not documented, so every event is treated as "something changed" and the newest messages are re-read.
function useLiveChat(peerUid, onEvent) {
  const [state, setState] = useState('connecting');   // connecting | live | offline
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    let ws = null;
    let alive = true;
    let retry = 0;
    let retryTimer = 0;
    let ping = 0;
    const connect = () => {
      if (!alive) return;
      setState('connecting');
      try {
        ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/chats/${encodeURIComponent(peerUid)}/live`);
      } catch {
        schedule();
        return;
      }
      ws.onmessage = (e) => {
        let msg = null;
        try { msg = JSON.parse(e.data); } catch { /* ignore */ }
        if (msg?.type === 'ready') { retry = 0; setState('live'); }
        if (msg?.type === 'event') handler.current(msg.data);
      };
      ws.onclose = () => { clearInterval(ping); if (alive) { setState('offline'); schedule(); } };
      ws.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
      ping = setInterval(() => { if (ws?.readyState === 1) ws.send('ping'); }, 25000);
    };
    const schedule = () => {
      clearTimeout(retryTimer);
      const delay = [2000, 5000, 10000, 20000, 30000][Math.min(retry, 4)];
      retry += 1;
      retryTimer = setTimeout(connect, delay);
    };
    connect();
    return () => { alive = false; clearTimeout(retryTimer); clearInterval(ping); try { ws?.close(); } catch { /* ignore */ } };
  }, [peerUid]);
  return state;
}

/* ------------------------------------------------------------------ moments inside chat */
function openMoment(moment) {
  ui.sheet(() => (
    <div className="chat-moment-view">
      <div className="moment-media chat-moment-media">
        <img src={moment.image} alt="" draggable="false" />
        {moment.video ? <MomentVideo src={moment.video} poster={moment.image} /> : null}
      </div>
      {moment.caption ? <p className="chat-moment-cap">{moment.caption}</p> : null}
      {moment.createdAt ? <p className="chat-moment-date">{fullDate(moment.createdAt)}</p> : null}
    </div>
  ));
}

function MomentPicker({ onPick }) {
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [state, setState] = useState('loading');
  const load = async (before) => {
    setState('loading');
    try {
      const d = await api.memories({ author: 'me', limit: 30, before });
      setItems((list) => [...list, ...d.moments.filter((m) => !list.some((x) => x.id === m.id))]);
      setCursor(d.nextCursor);
      setState('ready');
    } catch (err) { setState('error'); ui.error(err.message); }
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="moment-picker">
      <div className="sheet-title">Gửi khoảnh khắc</div>
      <div className="sheet-sub">Locket gửi ảnh và video trong chat dưới dạng khoảnh khắc. Chọn một khoảnh khắc của bạn.</div>
      <div className="fp-grid">
        {items.map((m) => (
          <button type="button" key={m.id} className="mem-tile" onClick={() => onPick(m)} title={fullDate(m.createdAt)}>
            <img src={thumb(m.image)} alt="" loading="lazy" decoding="async" draggable="false" />
            {m.video ? <span className="vid"><Icon name="play" /></span> : null}
          </button>
        ))}
      </div>
      {state === 'loading' ? <SkeletonGrid count={9} /> : null}
      {state === 'ready' && !items.length ? <div className="empty">Bạn chưa có khoảnh khắc nào.</div> : null}
      {cursor && state === 'ready' ? <button type="button" className="btn btn-dark btn-sm history-more" onClick={() => load(cursor)}>Tải thêm</button> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ thread */
export function Thread({ peer, onBack, onChange = () => {}, embedded = false }) {
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [outbox, setOutbox] = useState([]);          // { id, text, moment, createdAt, status: 'sending'|'failed' }
  const [meta, setMeta] = useState({ conversationId: null, read: 0, delivered: 0 });
  const [older, setOlder] = useState({ hasMore: false, before: null, loading: false });
  const [status, setStatus] = useState('loading');   // loading | ready | error
  const [error, setError] = useState('');
  const [canSend, setCanSend] = useState(false);
  const stick = useRef(true);
  const keepHeight = useRef(0);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const olderRef = useRef(older);
  olderRef.current = older;
  const inflight = useRef(false);

  // Newest window from Locket: within that window the server is the truth (new, unsent, re-reacted
  // messages); anything older that is already on screen is kept as it is.
  const loadLatest = useCallback(async (first = false) => {
    if (inflight.current && !first) return;
    inflight.current = true;
    try {
      const data = await api.messages(peer.uid, first ? 50 : 30);
      const prev = messagesRef.current;
      let list = data.messages;
      if (!first && prev.length) {
        const edge = list.length ? list[0].createdAt : Infinity;
        const fresh = new Set(list.map((m) => m.id));
        list = [...prev.filter((m) => m.createdAt < edge && !fresh.has(m.id)), ...list];
      }
      const hadNew = list.length && (!prev.length || list[list.length - 1].id !== prev[prev.length - 1]?.id);
      setMessages(list);
      setMeta({ conversationId: data.conversationId, read: data.peerReadAt || 0, delivered: data.peerDeliveredAt || 0 });
      if (first) setOlder({ hasMore: data.hasMore, before: data.nextBefore, loading: false });
      setOutbox((box) => box.filter((t) => t.status === 'failed'
        || !list.some((m) => m.mine && m.text === t.text && m.createdAt >= t.createdAt - 10000)));
      setStatus('ready');
      if (!first && hadNew) onChange();
      if ((first || hadNew) && list.some((m) => !m.mine)) {
        api.markRead(peer.uid, data.conversationId, !getSettings().ghostRead).then(() => { loadUnread(); onChange(); }).catch(() => {});
      }
    } catch (err) {
      if (first) { setStatus('error'); setError(err.message); }
    } finally {
      inflight.current = false;
    }
  }, [peer.uid, onChange]);

  const loadOlder = useCallback(async () => {
    const o = olderRef.current;
    if (!o.hasMore || o.loading || !o.before) return;
    setOlder({ ...o, loading: true });
    olderRef.current = { ...o, loading: true };
    try {
      const data = await api.messages(peer.uid, 50, o.before);
      keepHeight.current = threadRef.current?.scrollHeight || 0;
      setMessages((list) => {
        const have = new Set(list.map((m) => m.id));
        return [...data.messages.filter((m) => !have.has(m.id)), ...list];
      });
      setOlder({ hasMore: data.hasMore, before: data.nextBefore, loading: false });
    } catch (err) {
      setOlder((x) => ({ ...x, loading: false }));
      ui.error(`Không tải được tin cũ: ${err.message}`);
    }
  }, [peer.uid]);

  const live = useLiveChat(peer.uid, () => { setTimeout(() => loadLatest(), 250); });

  useEffect(() => {
    loadLatest(true);
    if (isDesktop()) setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 350);
    return () => loadUnread();
  }, [loadLatest]);

  // safety net: poll fast while the realtime socket is down, slowly while it is up
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) loadLatest(); }, live === 'live' ? 20000 : 3500);
    return () => clearInterval(t);
  }, [live, loadLatest]);

  useLayoutEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (keepHeight.current) { el.scrollTop = el.scrollHeight - keepHeight.current; keepHeight.current = 0; return; }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, outbox, meta.read]);

  const onScroll = () => {
    const el = threadRef.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 140) loadOlder();
  };

  const deliver = async (item) => {
    setOutbox((box) => box.map((x) => (x.id === item.id ? { ...x, status: 'sending' } : x)));
    try {
      await api.sendMessage(peer.uid, item.text, item.moment?.id);
      await loadLatest();
      setOutbox((box) => box.filter((x) => x.id !== item.id || x.status === 'failed'));
      if (item.moment) setOutbox((box) => box.filter((x) => x.id !== item.id));
    } catch (err) {
      setOutbox((box) => box.map((x) => (x.id === item.id ? { ...x, status: 'failed', error: err.message } : x)));
      ui.error(err.message);
    }
  };

  const send = (e) => {
    e.preventDefault();
    const text = inputRef.current.value.trim();
    if (!text) return;
    inputRef.current.value = '';
    setCanSend(false);
    stick.current = true;
    const item = { id: `tmp-${Date.now()}`, text, createdAt: Date.now(), status: 'sending' };
    setOutbox((box) => [...box, item]);
    deliver(item);
  };

  const pickMoment = () => {
    const ctl = ui.sheet(() => (
      <MomentPicker onPick={(m) => {
        ctl.close();
        stick.current = true;
        const item = { id: `tmp-${Date.now()}`, text: '', moment: { id: m.id, image: m.image, video: m.video, caption: m.caption, createdAt: m.createdAt }, createdAt: Date.now(), status: 'sending' };
        setOutbox((box) => [...box, item]);
        deliver(item);
      }} />
    ), { full: true });
  };

  const onMessage = async (e, m) => {
    if (getSelection().toString() || !metaRef.current.conversationId) return;
    if (e.target.closest('.ref')) { openMoment(m.moment); return; }
    const cid = metaRef.current.conversationId;
    if (m.mine) {
      const actions = [{ label: 'Thu hồi tin nhắn', value: 'unsend', destructive: true }];
      if (m.text) actions.unshift({ label: 'Sao chép', value: 'copy' });
      const choice = await ui.actionSheet({ title: fullDate(m.createdAt), actions });
      if (choice === 'copy') navigator.clipboard?.writeText(m.text).then(() => ui.success('Đã sao chép'));
      if (choice === 'unsend') {
        setMessages((list) => list.filter((x) => x.id !== m.id));
        try { await api.deleteMessage(cid, m.id); } catch (err) { ui.error(err.message); }
        loadLatest();
      }
      return;
    }
    const anchor = e.currentTarget.querySelector('.bubble, .ref') || e.currentTarget;
    const above = e.currentTarget.getBoundingClientRect().top > 320;
    ui.popover(anchor, ({ close }) => (
      <div className="emoji-pop">
        {EMOJI_PALETTE.slice(0, 10).map((x) => (
          <button type="button" key={x} className={m.reaction === x ? 'sel' : ''} onClick={async () => {
            close();
            const next = m.reaction === x ? null : x;
            setMessages((list) => list.map((y) => (y.id === m.id ? { ...y, reaction: next } : y)));
            try { await api.reactMessage(cid, m.id, next); } catch (err) { ui.error(err.message); }
            loadLatest();
          }}>{x}</button>
        ))}
      </div>
    ), { align: 'center', above });
  };

  const all = [...messages, ...outbox];
  const lastMine = [...messages].reverse().find((m) => m.mine);
  const receipt = lastMine && !outbox.length && all[all.length - 1] === lastMine
    ? (lastMine.createdAt <= meta.read ? 'Đã xem' : lastMine.createdAt <= meta.delivered ? 'Đã nhận' : 'Đã gửi') : null;
  let last = 0;

  return (
    <div className={embedded ? 'thread-view' : ''} style={embedded ? undefined : { display: 'contents' }}>
      <header className="navbar">
        <button type="button" className="icon-btn bare pressable" data-back aria-label="Quay lại" onClick={onBack}><Icon name="chevLeft" /></button>
        <button type="button" className="peer-title" title="Xem hồ sơ" onClick={() => nav.push('friend', { uid: peer.uid, user: peer })}>
          <Avatar user={peer} />
          <span className="peer-name">{peer.name}
            <small className={`live-state ${live}`}>{live === 'live' ? 'Trực tiếp' : live === 'connecting' ? 'Đang kết nối…' : 'Tự động cập nhật'}</small>
          </span>
        </button>
        <span className="spacer" />
      </header>
      <div className="thread" ref={threadRef} onScroll={onScroll}>
        {status === 'loading' ? <SkeletonBubbles count={9} /> : null}
        {status === 'error' ? <StateView icon="chat" tone="error" title="Không tải được cuộc trò chuyện" text={error} /> : null}
        {older.hasMore ? (
          <button type="button" className="btn btn-dark btn-sm older" onClick={loadOlder}>{older.loading ? 'Đang tải…' : 'Tải tin nhắn cũ hơn'}</button>
        ) : status === 'ready' && messages.length ? <div className="stamp">Bắt đầu cuộc trò chuyện</div> : null}
        {all.map((m, i) => {
          const stamp = m.createdAt - last > 30 * 60 * 1000 ? <div className="stamp">{dayLabel(m.createdAt)}</div> : null;
          last = m.createdAt;
          const next = all[i + 1];
          const endOfRun = !next || next.mine !== m.mine || next.createdAt - m.createdAt > 5 * 60 * 1000 || !!m.status !== !!next.status;
          const big = !m.moment && m.text && ONLY_EMOJI.test(m.text);
          const mine = m.mine || !!m.status;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {stamp}
              <div className={`msg-row ${mine ? 'mine' : ''} ${endOfRun ? 'end' : ''}`}>
                {!mine ? <span className="msg-avatar">{endOfRun ? <Avatar user={peer} /> : null}</span> : null}
                <div className={`msg ${mine ? 'mine' : ''} ${m.status ? `pending ${m.status}` : ''}`} title={fullDate(m.createdAt)} onClick={m.status ? undefined : (e) => onMessage(e, m)}>
                  {m.moment?.image ? (
                    <span className="ref">
                      <img src={thumb(m.moment.image)} alt="Khoảnh khắc" loading="lazy" />
                      {m.moment.video ? <span className="vid"><Icon name="play" /></span> : null}
                    </span>
                  ) : null}
                  {m.momentDeleted ? <span className="ref gone">Khoảnh khắc đã bị xóa</span> : null}
                  {m.text ? <div className={`bubble ${big ? 'big' : ''}`}>{m.text}</div> : null}
                  {m.reaction ? <span className="react">{m.reaction}</span> : null}
                </div>
              </div>
              {m.status === 'sending' && endOfRun ? <div className="seen">Đang gửi…</div> : null}
              {m.status === 'failed' ? (
                <div className="seen failed">Không gửi được · <button type="button" className="link-btn" onClick={() => deliver(m)}>Thử lại</button>
                  {' · '}<button type="button" className="link-btn muted" onClick={() => setOutbox((box) => box.filter((x) => x.id !== m.id))}>Bỏ</button></div>
              ) : null}
            </div>
          );
        })}
        {receipt ? <div className="seen">{receipt}{lastMine ? ` · ${clock(lastMine.createdAt)}` : ''}</div> : null}
        {status === 'ready' && !all.length ? <div className="empty" style={{ marginTop: 'auto' }}><b>{peer.name}</b>Gửi lời chào đầu tiên nào 👋</div> : null}
      </div>
      <div className="composer">
        <form onSubmit={send}>
          <button type="button" className="attach" aria-label="Gửi khoảnh khắc" title="Gửi khoảnh khắc" onClick={pickMoment}><Icon name="gallery" /></button>
          <input ref={inputRef} type="text" placeholder="Gửi tin nhắn..." maxLength={1000} autoComplete="off" enterKeyHint="send"
            onInput={(e) => setCanSend(!!e.currentTarget.value.trim())} />
          <button className="send" disabled={!canSend} aria-label="Gửi"><Icon name="arrowUp" /></button>
        </form>
      </div>
    </div>
  );
}
