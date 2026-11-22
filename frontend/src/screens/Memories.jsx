// Memories: the whole synced history as a timeline, grouped by day / month / year, with type,
// author and period filters, accent-insensitive search, endless loading, multi-select ZIP export and viewer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components/Avatar.jsx';
import { MemoryViewer } from '../components/MemoryViewer.jsx';
import { Icon } from '../lib/icons.jsx';
import { downloadBlob, fullDate, thumb } from '../lib/format.js';
import { useSiteConfig } from '../lib/siteConfig.js';
import { Navbar, nav } from '../ui/nav.jsx';
import { ui } from '../ui/overlays.jsx';
import { appStore } from '../store.js';
import { RECONNECT_EVENT } from '../components/AppStatus.jsx';
import { SkeletonGrid, Spinner, StateView } from '../ui/kit.jsx';
import { openRecap } from './RecapModal.jsx';

const PAGE = 60;
const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const GROUPS = [{ key: 'day', label: 'Ngày' }, { key: 'month', label: 'Tháng' }, { key: 'year', label: 'Năm' }];

function groupOf(ms, by) {
  const d = new Date(ms);
  if (by === 'year') return { key: `${d.getFullYear()}`, label: `${d.getFullYear()}` };
  if (by === 'month') return { key: `${d.getFullYear()}-${d.getMonth()}`, label: `Tháng ${d.getMonth() + 1}, ${d.getFullYear()}` };
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const label = same(d, today) ? 'Hôm nay' : same(d, yesterday) ? 'Hôm qua'
    : `${WEEKDAYS[d.getDay()]}, ${d.getDate()} tháng ${d.getMonth() + 1}${d.getFullYear() !== today.getFullYear() ? `, ${d.getFullYear()}` : ''}`;
  return { key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, label };
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/* ------------------------------------------------------------------ page */
export function Memories({ view }) {
  const zipEnabled = useSiteConfig((s) => s.features.zipExport);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const [kind, setKind] = useState('all');
  const [author, setAuthor] = useState(view.props?.author || null);   // uid, or null for everyone
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [groupBy, setGroupBy] = useState('day');
  const [items, setItems] = useState(() => (!view.props?.author ? appStore.get().memoriesCache?.items || [] : []));
  const [state, setState] = useState(() => (!view.props?.author && appStore.get().memoriesCache?.state)
    || { status: 'loading', error: '', total: 0, cursor: null, facets: null, historyTotal: 0, loadingMore: false });
  const initialCacheRef = useRef(!view.props?.author && !!appStore.get().memoriesCache);
  const [open, setOpen] = useState(null);           // index in items of the viewer
  const [otd, setOtd] = useState(null);             // { kind, list } from /api/memories/stats
  const [otdOpen, setOtdOpen] = useState(null);     // index in otd.list
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [attempt, setAttempt] = useState(0);        // bumps to retry after an error
  useEffect(() => {
    api.memoriesStats().then((d) => {
      if (d?.onThisDay?.length) setOtd({ kind: d.onThisDayKind, list: d.onThisDay });
    }).catch(() => {});
  }, []);
  // back online after a failed load: try again by itself
  const failed = state.status === 'error';
  useEffect(() => {
    if (!failed) return undefined;
    const retry = () => setAttempt((n) => n + 1);
    window.addEventListener(RECONNECT_EVENT, retry);
    return () => window.removeEventListener(RECONNECT_EVENT, retry);
  }, [failed]);
  const scrollRef = useRef(null);
  const sentinelRef = useRef(null);
  const reqId = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => ({ kind, author, q, year, month }), [kind, author, q, year, month, attempt]);

  // any filter change starts over from the newest moment
  useEffect(() => {
    const id = ++reqId.current;
    const isUnfiltered = filters.kind === 'all' && !filters.author && !filters.q && !filters.year && !filters.month;
    const silentSwr = initialCacheRef.current && isUnfiltered;
    initialCacheRef.current = false;
    if (!silentSwr) setState((s) => ({ ...s, status: 'loading', error: '' }));
    api.memories({ ...filters, limit: PAGE })
      .then((d) => {
        if (id !== reqId.current) return;
        const nextState = { status: 'ready', error: '', total: d.total, cursor: d.nextCursor, facets: d.facets, historyTotal: d.historyTotal, loadingMore: false };
        setItems(d.moments);
        setState(nextState);
        if (isUnfiltered) appStore.set({ memoriesCache: { items: d.moments, state: nextState } });
        if (!silentSwr) scrollRef.current?.scrollTo({ top: 0 });
      })
      .catch((err) => {
        if (id !== reqId.current || err.status === 401) return;
        setState((s) => ({ ...s, status: 'error', error: err.message }));
      });
  }, [filters]);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (!s.cursor || s.loadingMore || s.status !== 'ready') return;
    const id = reqId.current;
    setState((x) => ({ ...x, loadingMore: true }));
    stateRef.current = { ...s, loadingMore: true };
    try {
      const d = await api.memories({ ...filters, before: s.cursor, limit: PAGE });
      if (id !== reqId.current) return;
      setItems((list) => {
        const seen = new Set(list.map((m) => m.id));
        return [...list, ...d.moments.filter((m) => !seen.has(m.id))];
      });
      setState((x) => ({ ...x, cursor: d.nextCursor, total: d.total, loadingMore: false }));
    } catch (err) {
      if (id === reqId.current) { setState((x) => ({ ...x, loadingMore: false })); if (err.status !== 401) ui.error(`Không tải thêm được: ${err.message}`); }
    }
  }, [filters]);

  // endless loading: fetch the next page as the end of the timeline comes into view
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); },
      { root: scrollRef.current, rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, items.length, state.status]);

  const sections = useMemo(() => {
    const out = [];
    items.forEach((m, i) => {
      const g = groupOf(m.createdAt, groupBy);
      let sec = out[out.length - 1];
      if (!sec || sec.key !== g.key) { sec = { ...g, items: [] }; out.push(sec); }
      sec.items.push({ m, i });
    });
    return out;
  }, [items, groupBy]);

  const facets = state.facets;
  const authorInfo = author && facets?.authors.find((a) => a.user.uid === author);
  const yearInfo = year && facets?.years.find((y) => y.year === year);
  const filtered = kind !== 'all' || author || q || year;

  const pickAuthor = (anchor) => {
    ui.popover(anchor, ({ close }) => (
      <div className="mem-authors">
        <button type="button" onClick={() => { setAuthor(null); close(); }}>
          <span className="avatar" style={{ '--s': '32px' }}><Icon name="people" /></span><span>Mọi người</span>
          {!author ? <span className="check"><Icon name="check" /></span> : null}
        </button>
        {(facets?.authors || []).map((a) => (
          <button type="button" key={a.user.uid} onClick={() => { setAuthor(a.user.uid); close(); }}>
            <Avatar user={a.user} size={32} /><span>{a.mine ? 'Bạn' : a.user.name}</span>
            <span className="cnt">{a.count}</span>
            {author === a.user.uid ? <span className="check"><Icon name="check" /></span> : null}
          </button>
        ))}
      </div>
    ));
  };

  const reset = () => { setQuery(''); setKind('all'); setAuthor(null); setYear(null); setMonth(null); };

  const toggleSelectMode = () => {
    setSelecting((v) => {
      if (v) setPicked(new Set());
      return !v;
    });
  };

  const togglePick = (id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 60) next.add(id);
      else ui.warning('Mỗi lần tải ZIP tối đa 60 khoảnh khắc');
      return next;
    });
  };

  const pickVisible = () => {
    setPicked(new Set(items.slice(0, 60).map((m) => m.id)));
  };

  const downloadZip = async () => {
    if (!picked.size || exporting) return;
    setExporting(true);
    try {
      ui.info(`Đang nén ${picked.size} khoảnh khắc thành ZIP…`, 2500);
      const blob = await api.exportMemories([...picked]);
      downloadBlob(blob, `locket-memories-${new Date().toISOString().slice(0, 10)}.zip`);
      ui.success(`Đã tải xong ${picked.size} khoảnh khắc`);
      setSelecting(false);
      setPicked(new Set());
    } catch (err) {
      ui.error(err.message || 'Không tải được album ZIP');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Navbar title="Kỷ niệm" onBack={() => nav.pop(view.id)}
        right={(
          <span className="nav-actions">
            <button type="button" className="icon-btn pressable" aria-label="Thống kê & Recap" title="Thống kê & Recap" onClick={openRecap}><Icon name="chart" /></button>
            {zipEnabled ? (
              <button type="button" className={`icon-btn pressable ${selecting ? 'on' : ''}`} aria-label={selecting ? 'Hủy chọn' : 'Chọn nhiều để tải ZIP'} title="Chọn nhiều để tải ZIP" onClick={toggleSelectMode}><Icon name="checkSquare" /></button>
            ) : null}
          </span>
        )} />
      <div className="view-scroll mem-scroll" ref={scrollRef}>
        <div className="mem-tools">
          <form className="search" onSubmit={(e) => { e.preventDefault(); e.currentTarget.querySelector('input').blur(); }}>
            <Icon name="search" />
            <input type="search" placeholder="Tìm theo caption, bài hát, người đăng…" value={query} onChange={(e) => setQuery(e.target.value)}
              autoComplete="off" spellCheck={false} enterKeyHint="search" />
            {query ? <button type="button" className="x" aria-label="Xóa tìm kiếm" onClick={() => setQuery('')}><Icon name="closeSm" /></button> : null}
          </form>

          <div className="mem-row">
            {[['all', 'Tất cả'], ['photo', 'Ảnh'], ['video', 'Video']].map(([k, label]) => (
              <button type="button" key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
                {k === 'video' ? <Icon name="play" /> : null}{label}{facets ? <span className="cnt">{facets.kinds[k]}</span> : null}
              </button>
            ))}
            <span className="mem-sep" />
            <button type="button" className={`chip ${author ? 'on' : ''}`} onClick={(e) => pickAuthor(e.currentTarget)}>
              {authorInfo ? <Avatar user={authorInfo.user} size={22} /> : <Icon name="people" />}
              {authorInfo ? (authorInfo.mine ? 'Bạn' : (authorInfo.user.firstName || authorInfo.user.name)) : 'Người đăng'}
              <Icon name="chevDown" />
            </button>
          </div>

          {facets?.years.length ? (
            <div className="mem-row scroll">
              <button type="button" className={`chip ${!year ? 'on' : ''}`} onClick={() => { setYear(null); setMonth(null); }}>Mọi lúc</button>
              {facets.years.map((y) => (
                <button type="button" key={y.year} className={`chip ${year === y.year ? 'on' : ''}`} onClick={() => { setYear(y.year); setMonth(null); }}>
                  {y.year}<span className="cnt">{y.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {yearInfo ? (
            <div className="mem-row scroll">
              <button type="button" className={`chip sm ${!month ? 'on' : ''}`} onClick={() => setMonth(null)}>Cả năm</button>
              {[...yearInfo.months].sort((a, b) => a.month - b.month).map((mo) => (
                <button type="button" key={mo.month} className={`chip sm ${month === mo.month ? 'on' : ''}`} onClick={() => setMonth(mo.month)}>
                  Th {mo.month}<span className="cnt">{mo.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="mem-row between">
            <span className="mem-summary">
              {state.status === 'ready' ? (filtered ? `${state.total} / ${state.historyTotal} khoảnh khắc` : `${state.total} khoảnh khắc`) : ''}
              {filtered ? <button type="button" className="link-btn" onClick={reset}>Bỏ lọc</button> : null}
            </span>
            <div className="seg" role="tablist" aria-label="Nhóm theo">
              {GROUPS.map((g) => (
                <button type="button" key={g.key} role="tab" aria-selected={groupBy === g.key} className={groupBy === g.key ? 'on' : ''} onClick={() => setGroupBy(g.key)}>{g.label}</button>
              ))}
            </div>
          </div>
        </div>

        {state.status === 'loading' && !items.length ? <div className="mem-timeline"><SkeletonGrid count={15} /></div> : null}
        {state.status === 'error' ? (
          <StateView icon="heart" tone="error" title="Không tải được kỷ niệm" text={state.error} action="Thử lại" onAction={() => setAttempt((n) => n + 1)} />
        ) : null}
        {state.status === 'ready' && !items.length ? (
          <StateView icon={filtered ? 'search' : 'camera'} title="Không có khoảnh khắc nào" text={filtered ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm.' : 'Chụp một tấm ảnh để bắt đầu.'} />
        ) : null}

        {!filtered && otd?.list?.length ? (
          <div className="mem-otd">
            <div className="mem-otd-head">
              <Icon name="sparkles" />
              <b>{otd.kind === 'year' ? 'Ngày này năm xưa' : 'Ngày này tháng trước'}</b>
              <small>{otd.list.length} kỷ niệm</small>
            </div>
            <div className="mem-otd-row">
              {otd.list.map((m, idx) => (
                <button type="button" key={m.id} className="mem-tile otd-tile" onClick={() => setOtdOpen(idx)} title={fullDate(m.createdAt)}>
                  <img src={thumb(m.image)} alt="" loading="lazy" decoding="async" draggable="false" />
                  {m.video ? <span className="vid"><Icon name="play" /></span> : null}
                  <span className="otd-yr">{otd.kind === 'year' ? new Date(m.createdAt).getFullYear() : `T${new Date(m.createdAt).getMonth() + 1}`}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className={`mem-timeline ${state.status === 'loading' && items.length ? 'stale' : ''} ${selecting ? 'selecting' : ''}`}>
          {sections.map((sec) => (
            <section key={sec.key} className="mem-section">
              <h3 className="mem-head"><span>{sec.label}</span><small>{sec.items.length}</small></h3>
              <div className={`mem-grid ${groupBy}`}>
                {sec.items.map(({ m, i }) => {
                  const isPicked = picked.has(m.id);
                  return (
                    <button type="button" key={m.id} className={`mem-tile ${isPicked ? 'picked' : ''}`}
                      onClick={() => (selecting ? togglePick(m.id) : setOpen(i))}
                      title={`${m.mine ? 'Bạn' : m.user.name} · ${fullDate(m.createdAt)}${m.caption ? ` · ${m.caption}` : ''}`}>
                      <img src={thumb(m.image)} alt="" loading="lazy" decoding="async" draggable="false" />
                      {m.video ? <span className="vid"><Icon name="play" /></span> : null}
                      {!author && !selecting ? <span className="by"><Avatar user={m.user} size={22} /></span> : null}
                      {selecting ? <span className={`mem-check ${isPicked ? 'on' : ''}`}>{isPicked ? <Icon name="check" /> : null}</span> : null}
                      {m.caption ? <span className="cap">{m.caption}</span> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div ref={sentinelRef} className="mem-end">
          {state.loadingMore ? <Spinner /> : null}
          {state.status === 'ready' && items.length && !state.cursor ? <span>Đã hiển thị tất cả {items.length} khoảnh khắc</span> : null}
          {state.cursor && !state.loadingMore ? <button type="button" className="btn btn-dark btn-sm" onClick={loadMore}>Tải thêm</button> : null}
        </div>
      </div>

      {selecting ? (
        <div className="mem-select-bar">
          <span className="sel-count"><b>{picked.size}</b> / 60</span>
          <button type="button" className="btn btn-dark btn-sm" onClick={pickVisible}>Chọn nhanh</button>
          <button type="button" className="btn btn-gold btn-sm" disabled={!picked.size || exporting} onClick={downloadZip}>
            {exporting ? 'Đang nén…' : <><Icon name="download" /> Tải ZIP</>}
          </button>
          <button type="button" className="icon-btn sm" aria-label="Đóng chọn nhiều" onClick={toggleSelectMode}><Icon name="closeSm" /></button>
        </div>
      ) : null}

      {open !== null && items[open] ? (
        <MemoryViewer list={items} index={open} hasMore={!!state.cursor} onIndex={setOpen} onClose={() => setOpen(null)} onNeedMore={loadMore}
          onPatch={(id, fields) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...fields } : x)))} />
      ) : null}
      {otdOpen !== null && otd?.list?.[otdOpen] ? (
        <MemoryViewer list={otd.list} index={otdOpen} hasMore={false} onIndex={setOtdOpen} onClose={() => setOtdOpen(null)} onNeedMore={() => {}}
          onPatch={(id, fields) => setOtd((cur) => (cur ? { ...cur, list: cur.list.map((x) => (x.id === id ? { ...x, ...fields } : x)) } : cur))} />
      ) : null}
    </>
  );
}
