// Admin Users v2: searchable, filterable (incl. Whitelist), sortable user directory + slide-over User Detail Drawer.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Avatar } from '../../components/Avatar.jsx';
import { Icon } from '../../lib/icons.jsx';
import { ago } from '../../lib/format.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';
import { AdminUserDrawer } from './AdminUserDrawer.jsx';

const FILTERS = [
  ['all', 'Tất cả'],
  ['online', 'Đang online'],
  ['today', 'Mới hôm nay'],
  ['gold', '👑 VIP Gold'],
  ['whitelist', 'Whitelist'],
  ['banned', 'Đã chặn'],
];

const SORTS = [
  ['recent', 'Hoạt động gần nhất'],
  ['moments', 'Nhiều khoảnh khắc nhất'],
  ['sessions', 'Nhiều phiên đang mở'],
  ['newest', 'Mới tham gia nhất'],
];

export function AdminUsers({ navIntent, onChanged }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(navIntent?.filter || 'all');
  const [sort, setSort] = useState('recent');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState('');
  const [drawerUid, setDrawerUid] = useState(navIntent?.focusUid || null);

  useEffect(() => {
    if (!navIntent) return;
    if (navIntent.filter) setFilter(navIntent.filter);
    if (navIntent.focusUid) setDrawerUid(navIntent.focusUid);
  }, [navIntent]);

  const load = useCallback(async (search = q, filt = filter, srt = sort) => {
    setLoading(true);
    try {
      const res = await api.admin.users({ q: search.trim(), filter: filt, sort: srt });
      setData(res);
    } catch (err) {
      ui.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [q, filter, sort]);

  useEffect(() => {
    const t = setTimeout(() => { load(q, filter, sort); }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [q, filter, sort, load]);

  const kickAll = async () => {
    if (!await ui.confirm(
      'Đăng xuất tất cả người dùng?',
      'Mọi phiên đăng nhập trên máy chủ (ngoại trừ tài khoản Chủ sở hữu) sẽ bị ngắt ngay lập tức.',
      'Đăng xuất tất cả',
    )) return;
    setBusyUid('__all__');
    try {
      const r = await api.admin.kickAll();
      ui.success(`Đã ngắt ${r.revokedSessions} phiên người dùng`);
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyUid('');
    }
  };

  const quickToggleWl = async (e, u) => {
    e.stopPropagation();
    setBusyUid(u.uid);
    try {
      const next = !u.whitelisted;
      await api.admin.toggleUserWhitelist(u.uid, next);
      ui.success(next ? `Đã thêm ${u.name} vào Whitelist` : `Đã gỡ ${u.name} khỏi Whitelist`);
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyUid('');
    }
  };

  const quickToggleGold = async (e, u) => {
    e.stopPropagation();
    setBusyUid(u.uid);
    try {
      const next = !u.isGold;
      await api.admin.toggleUserGold(u.uid, next);
      ui.success(next ? `👑 Đã cấp Locket Gold VIP cho ${u.name}` : `Đã thu hồi Locket Gold của ${u.name}`);
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyUid('');
    }
  };

  const counts = data?.counts || { all: 0, online: 0, today: 0, gold: 0, whitelist: 0, banned: 0 };
  const users = data?.users || [];
  const drawerUser = drawerUid ? users.find((u) => u.uid === drawerUid) || null : null;

  return (
    <>
      <div className="adm-page-head">
        <div>
          <h1>Quản lý Người dùng</h1>
          <p>Bấm vào bất kỳ tài khoản nào để xem phiên thiết bị, thêm ghi chú riêng, đưa vào Whitelist hoặc chặn truy cập.</p>
        </div>
        <Button
          variant="destructive-tinted"
          size="sm"
          icon="logout"
          loading={busyUid === '__all__'}
          onClick={kickAll}
        >
          Đăng xuất tất cả (trừ Admin)
        </Button>
      </div>

      <section className="adm-section">
        <div className="adm-toolbar">
          <div className="search" style={{ marginTop: 0 }}>
            <Icon name="search" />
            <input
              type="search"
              placeholder="Tìm theo tên, @username, email, UID hoặc ghi chú…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            {q ? <button type="button" className="x" aria-label="Xóa tìm kiếm" onClick={() => setQ('')}><Icon name="closeSm" /></button> : null}
          </div>

          <div className="adm-toolbar-row">
            <div className="adm-chips">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`adm-chip ${filter === key ? 'on' : ''}`}
                  onClick={() => setFilter(key)}
                >
                  {label} <span className="cnt">{counts[key] ?? 0}</span>
                </button>
              ))}
            </div>

            <select
              className="adm-select"
              aria-label="Sắp xếp người dùng"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              {SORTS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
        </div>

        {loading && !data ? (
          <div className="empty"><span className="spinner" /></div>
        ) : !users.length ? (
          <div className="empty">
            <b>Không có người dùng nào khớp bộ lọc</b>
            <span>{q || filter !== 'all' ? 'Thử xóa từ khóa hoặc chuyển về mục Tất cả.' : 'Người dùng đăng nhập qua web sẽ tự động xuất hiện ở đây.'}</span>
          </div>
        ) : (
          <div className="adm-user-list">
            {users.map((u) => {
              const busy = busyUid === u.uid;
              return (
                <div
                  key={u.uid}
                  className="adm-user-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setDrawerUid(u.uid)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDrawerUid(u.uid); } }}
                >
                  <Avatar user={u} goldBadge={u.isGold} />
                  <div className="adm-user-main">
                    <div className="adm-user-name">
                      <span>{u.name}</span>
                      {u.online ? <span className="adm-tag online">● Online</span> : null}
                      {u.isAdmin ? <span className="adm-tag admin">Chủ sở hữu</span> : null}
                      {u.isGold ? <span className="adm-tag gold">👑 Gold VIP</span> : null}
                      {u.whitelisted ? <span className="adm-tag wl">Whitelist</span> : null}
                      {u.banned ? <span className="adm-tag banned">Đã chặn</span> : null}
                    </div>
                    <div className="adm-user-meta">
                      {u.username ? `@${u.username} · ` : ''}{u.email || 'Ẩn email'}
                    </div>
                    <div className="adm-user-stats">
                      <span>Phiên mở: <b>{u.activeSessions}</b></span>
                      <span>Bài đăng: <b>{u.moments}</b></span>
                      <span>Tin nhắn: <b>{u.messages}</b></span>
                      {u.lastSeen ? <span>Hoạt động: {ago(u.lastSeen)}</span> : null}
                    </div>
                    {u.note ? (
                      <div className="adm-user-note"><Icon name="pencil" /> {u.note}</div>
                    ) : null}
                    {u.banned && u.banReason ? (
                      <div className="adm-user-meta" style={{ color: 'var(--danger)', marginTop: 4 }}>
                        Lý do chặn: {u.banReason}
                      </div>
                    ) : null}
                  </div>

                  <div className="adm-user-actions">
                    {!u.isAdmin ? (
                      <Button
                        variant={u.isGold ? 'primary' : 'secondary'}
                        size="sm"
                        loading={busy}
                        onClick={(e) => quickToggleGold(e, u)}
                      >
                        {u.isGold ? '👑 VIP Gold' : '+ Cấp Gold'}
                      </Button>
                    ) : null}
                    {!u.isAdmin ? (
                      <Button
                        variant={u.whitelisted ? 'tinted' : 'secondary'}
                        size="sm"
                        loading={busy}
                        onClick={(e) => quickToggleWl(e, u)}
                      >
                        {u.whitelisted ? 'Đã đặc cách' : '+ Whitelist'}
                      </Button>
                    ) : null}
                    <Button
                      variant="plain"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); setDrawerUid(u.uid); }}
                    >
                      Chi tiết →
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {drawerUser ? (
        <AdminUserDrawer
          user={drawerUser}
          onClose={() => setDrawerUid(null)}
          onUpdated={() => { load(); onChanged?.(); }}
        />
      ) : null}
    </>
  );
}
