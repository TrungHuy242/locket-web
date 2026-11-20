// Reactions & comments on a moment, shared by the feed and the Memories viewer.
//
// What Locket's API allows (checked against the live service):
//  * reactions: sending one (reactToMoment). There is no endpoint to take a reaction back.
//    Only a moment's owner can read who reacted, so on friends' moments we show the reactions
//    this account sent; on my moments, every reaction with its sender and time.
//  * comments: Locket has no public comment thread. Replying to a moment is a chat message tied to
//    it; those messages can be sent, unsent (own) and reacted to / un-reacted (friends').
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { Icon } from '../lib/icons.jsx';
import { ago, fullDate, isDesktop } from '../lib/format.js';
import { EMOJI_PALETTE, appStore } from '../store.js';
import { nav } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { SkeletonList, StateView } from '../ui/kit.jsx';

const POLL_MS = 4000;

/* ------------------------------------------------------------------ reactions */
export async function sendReaction(moment, emoji) {
  const res = await api.react(moment.id, emoji);
  return res.myReactions || [...(moment.myReactions || []), emoji];
}

// The emoji you sent, shown on the photo like the iPhone app does.
export function MyReactions({ list }) {
  if (!list?.length) return null;
  const last = list.slice(-3);
  return (
    <span className="my-react" title={`Bạn đã thả ${list.join(' ')}`}>
      {last.map((e, i) => <i key={`${e}-${i}`} style={{ '--i': i }}>{e}</i>)}
      {list.length > 3 ? <b>+{list.length - 3}</b> : null}
    </span>
  );
}

export function openEmojiPicker(anchor, onPick, { above = true } = {}) {
  ui.popover(anchor, ({ close }) => (
    <div className="emoji-pop">
      {EMOJI_PALETTE.map((e) => <button type="button" key={e} onClick={() => { close(); onPick(e); }}>{e}</button>)}
    </div>
  ), { align: 'end', above });
}

/* ------------------------------------------------------------------ activity (my moments) */
function useLive(load, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const run = useCallback(async () => {
    try {
      const d = await load();
      if (alive.current) { setData(d); setError(''); }
    } catch (err) {
      if (alive.current && err.status !== 401) setError(err.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    alive.current = true;
    run();
    const t = setInterval(() => { if (!document.hidden) run(); }, POLL_MS);
    return () => { alive.current = false; clearInterval(t); };
  }, [run]);
  return [data, error, run, setData];
}

function ActivityBody({ moment, close }) {
  const [data, error] = useLive(() => api.activity(moment.id), [moment.id]);
  const [tab, setTab] = useState('reactions');
  if (!data && !error) return <SkeletonList rows={4} avatar={46} />;
  if (!data) return <StateView icon="heart" tone="error" title="Không tải được hoạt động" text={error} />;
  const reactions = data.reactions || [];
  const viewers = data.viewers || [];
  return (
    <div className="activity-sheet">
      <div className="sheet-title">Hoạt động</div>
      <div className="sheet-sub">{viewers.length} người đã xem · {reactions.length} cảm xúc</div>
      {data.summary?.length ? (
        <div className="react-summary">
          {data.summary.map((s) => <span key={s.emoji} className="react-chip"><i>{s.emoji}</i>{s.count}</span>)}
        </div>
      ) : null}
      <div className="seg act-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'reactions'} className={tab === 'reactions' ? 'on' : ''} onClick={() => setTab('reactions')}>Cảm xúc {reactions.length}</button>
        <button type="button" role="tab" aria-selected={tab === 'views'} className={tab === 'views' ? 'on' : ''} onClick={() => setTab('views')}>Đã xem {viewers.length}</button>
        <button type="button" role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>Bình luận</button>
      </div>
      {tab === 'reactions' ? (
        reactions.length ? reactions.map((r, i) => (
          <div className="viewer-row" key={`${r.user.uid}-${r.createdAt}-${i}`}>
            <Avatar user={r.user} />
            <div className="grow">{r.user.name}<small title={fullDate(r.createdAt)}>{ago(r.createdAt)}</small></div>
            <span className="emo pop">{r.emoji}</span>
          </div>
        )) : <div className="empty">Chưa ai thả cảm xúc cho khoảnh khắc này.</div>
      ) : null}
      {tab === 'views' ? (
        viewers.length ? viewers.map((v) => (
          <div className="viewer-row" key={v.user.uid}>
            <Avatar user={v.user} />
            <div className="grow">{v.user.name}<small title={fullDate(v.viewedAt)}>{v.viewedAt ? `Đã xem ${ago(v.viewedAt)}` : 'Đã xem'}</small></div>
            <span className="emo">{v.emoji}</span>
          </div>
        )) : <div className="empty">Chưa ai xem khoảnh khắc này.</div>
      ) : null}
      {tab === 'comments' ? <CommentsBody moment={moment} close={close} embedded /> : null}
    </div>
  );
}

export function openActivity(moment) {
  ui.sheet(({ close }) => <ActivityBody moment={moment} close={close} />, { full: true });
}

/* ------------------------------------------------------------------ comments */
function CommentRow({ c, moment, onUnsend, onReact }) {
  const mineReaction = c.reactions?.find((r) => r.mine);
  const click = async (e) => {
    if (c.pending) return;
    if (c.mine) {
      const choice = await ui.actionSheet({ actions: [
        { label: 'Sao chép', value: 'copy' }, { label: 'Thu hồi bình luận', value: 'unsend', destructive: true }] });
      if (choice === 'copy') navigator.clipboard?.writeText(c.text).then(() => ui.success('Đã sao chép'));
      if (choice === 'unsend') onUnsend(c);
      return;
    }
    const anchor = e.currentTarget;
    ui.popover(anchor, ({ close }) => (
      <div className="emoji-pop">
        {EMOJI_PALETTE.slice(0, 10).map((x) => (
          <button type="button" key={x} className={mineReaction?.emoji === x ? 'sel' : ''} onClick={() => { close(); onReact(c, mineReaction?.emoji === x ? null : x); }}>{x}</button>
        ))}
        {mineReaction ? <button type="button" className="remove" onClick={() => { close(); onReact(c, null); }} title="Gỡ cảm xúc"><Icon name="closeSm" /></button> : null}
      </div>
    ), { align: 'center', above: anchor.getBoundingClientRect().top > 300 });
  };
  return (
    <div className={`comment ${c.mine ? 'mine' : ''} ${c.pending ? 'pending' : ''}`}>
      <Avatar user={c.user} />
      <div className="comment-body">
        <div className="comment-head">
          <b>{c.mine ? 'Bạn' : c.user.name}</b>
          {moment.mine && c.mine ? <span className="to">→ {c.peer.firstName || c.peer.name}</span> : null}
          <small title={fullDate(c.createdAt)}>{c.pending ? 'Đang gửi…' : ago(c.createdAt)}</small>
        </div>
        <button type="button" className="comment-text" onClick={click}>{c.text}</button>
        {c.reactions?.length ? (
          <div className="comment-reacts">
            {c.reactions.map((r, i) => <span key={`${r.user.uid}-${i}`} className={r.mine ? 'mine' : ''} title={r.user.name}>{r.emoji}</span>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CommentsBody({ moment, close, embedded = false, onCount }) {
  const me = appStore.get().user;
  const [data, error, reload, setData] = useLive(() => api.comments(moment.id), [moment.id]);
  const [pending, setPending] = useState([]);
  const [to, setTo] = useState(null);
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const comments = data?.comments || [];

  // On my own moment a reply goes to one friend: default to whoever wrote last.
  const people = moment.mine ? [...new Map(comments.filter((c) => !c.mine).map((c) => [c.user.uid, c.user])).values()] : [];
  const target = moment.mine ? (to || people[people.length - 1]?.uid || null) : moment.user.uid;

  useEffect(() => { onCount?.(comments.length); }, [comments.length, onCount]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [comments.length, pending.length]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !target) return;
    const temp = { id: `tmp-${Date.now()}`, text: body, createdAt: Date.now(), mine: true, pending: true, user: me,
      peer: moment.mine ? people.find((p) => p.uid === target) || { name: '' } : moment.user, reactions: [] };
    setPending((p) => [...p, temp]);
    setText('');
    try {
      const fresh = await api.addComment(moment.id, body, moment.mine ? target : null);
      setData(fresh);
    } catch (err) {
      setText(body);
      ui.error(err.message);
    } finally {
      setPending((p) => p.filter((x) => x !== temp));
    }
  };

  const unsend = async (c) => {
    if (!c.conversationId) return;
    if (!await ui.confirm('Thu hồi bình luận?', 'Tin nhắn sẽ bị gỡ khỏi cuộc trò chuyện ở cả hai phía.', 'Thu hồi')) return;
    setData((d) => ({ ...d, comments: d.comments.filter((x) => x.id !== c.id) }));
    try { await api.deleteMessage(c.conversationId, c.id); } catch (err) { ui.error(err.message); }
    reload();
  };

  const react = async (c, emoji) => {
    if (!c.conversationId) return;
    setData((d) => ({ ...d, comments: d.comments.map((x) => (x.id !== c.id ? x : {
      ...x, reactions: [...x.reactions.filter((r) => !r.mine), ...(emoji ? [{ user: me, emoji, mine: true }] : [])],
    })) }));
    try { await api.reactMessage(c.conversationId, c.id, emoji); } catch (err) { ui.error(err.message); }
    reload();
  };

  const openChat = (peer) => {
    close();
    if (isDesktop()) nav.openRoot('chat', { peer }); else nav.push('thread', { peer });
  };

  const all = [...comments, ...pending];
  return (
    <div className={`comments ${embedded ? 'embedded' : ''}`}>
      {!embedded ? (
        <>
          <div className="sheet-title">Bình luận</div>
          <div className="sheet-sub">Trả lời khoảnh khắc được gửi dưới dạng tin nhắn riêng, như trên ứng dụng Locket.</div>
        </>
      ) : null}
      <div className="comment-list" ref={listRef}>
        {!data && !error ? <SkeletonList rows={3} avatar={38} /> : null}
        {!data && error ? <StateView icon="chat" tone="error" title="Không tải được bình luận" text={error} /> : null}
        {data && !all.length ? <div className="empty">{moment.mine ? 'Chưa có ai trả lời khoảnh khắc này.' : `Hãy là người đầu tiên trả lời ${moment.user.firstName || moment.user.name}.`}</div> : null}
        {all.map((c) => <CommentRow key={c.id} c={c} moment={moment} onUnsend={unsend} onReact={react} />)}
      </div>
      {moment.mine && people.length > 1 ? (
        <div className="reply-to">
          <span>Trả lời</span>
          {people.map((p) => (
            <button type="button" key={p.uid} className={`chip ${target === p.uid ? 'on' : ''}`} onClick={() => setTo(p.uid)}>
              <Avatar user={p} size={20} />{p.firstName || p.name}
            </button>
          ))}
        </div>
      ) : null}
      {target ? (
        <form className="comment-composer" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} autoComplete="off" enterKeyHint="send"
            placeholder={moment.mine ? `Trả lời ${(people.find((p) => p.uid === target) || {}).firstName || ''}…` : `Trả lời ${moment.user.firstName || moment.user.name}…`} />
          <button className="send" disabled={!text.trim()} aria-label="Gửi bình luận"><Icon name="arrowUp" /></button>
        </form>
      ) : moment.mine ? <p className="comment-note">Chưa có ai bình luận nên chưa có người để trả lời.</p> : null}
      {all.length ? (
        <button type="button" className="link-btn open-chat" onClick={() => openChat(moment.mine ? (people.find((p) => p.uid === target) || comments[0].peer) : moment.user)}>
          Mở cuộc trò chuyện
        </button>
      ) : null}
    </div>
  );
}

export function openComments(moment, { onCount } = {}) {
  ui.sheet(({ close }) => <CommentsBody moment={moment} close={close} onCount={onCount} />, { full: true });
}
