// Admin Users tab: user directory, search/filter, kick session, ban/unban, kick all non-admins.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Avatar } from '../../components/Avatar.jsx';
import { Icon } from '../../lib/icons.jsx';
import { ago } from '../../lib/format.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

const FILTERS = [
  ['all', 'Tất cả'],
  ['online', 'Đang online'],
  ['today', 'Mới hôm nay'],
  ['banned', 'Đã chặn'],
];

export function AdminUsers({ onChanged }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyUid, setBusyUid] = useState('');

  const load = useCallback(async (search = q, filt = filter) => {
    setLoading(true);
    try {
      const res = await api.admin.users({ q: search.trim(), filter: filt });
      setData(res);
    } catch (err) {
      ui.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [q, filter]);

  useEffect(() => {
    const t = setTimeout(() => { load(q, filter); }, q ? 220 : 0);
    return () => clearTimeout(t);
  }, [q, filter, load]);

  const kick = async (u) => {
    if (!await ui.confirm(`Đăng xuất ${u.name}?`, 'Tất cả phiên đang hoạt động của người dùng này sẽ bị ngắt ngay.', 'Đăng xuất')) return;
    setBusyUid(u.uid);
    try {
      const r = await api.admin.kickUser(u.uid);
      ui.success(`Đã ngắt ${r.revokedSessions} phiên của ${u.name}`);
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyUid('');
    }
  };

  const ban = async (u) => {
    const res = await ui.alert({
      title: `Chặn ${u.name}?`,
      message: 'Tài khoản sẽ bị đăng xuất ngay và không thể dùng web này cho đến khi bạn mở chặn.',
      input: { value: '', placeholder: 'Lý do chặn (không bắt buộc)', maxlength: 180 },
      buttons: [{ label: 'Hủy' }, { label: 'Chặn ngay', destructive: true, bold: true }],
    });
    if (res.index !== 1) return;
    setBusyUid(u.uid);
    try {
      await api.admin.banUser(u.uid, (res.text || '').trim());
      ui.success(`Đã chặn ${u.name}`);
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyUid('');
    }
  };

  const unban = async (u) => {
    setBusyUid(u.uid);
    try {
      await api.admin.unbanUser(u.uid);
      ui.success(`Đã mở chặn ${u.name}`);
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyUid('');
    }
  };

  const kickAll = async () => {
    if (!await ui.confirm(
      'Đăng xuất tất cả người dùng?',
      'Mọi phiên đăng nhập trên máy chủ (ngoại trừ tài khoản Quản trị viên) sẽ bị ngắt ngay lập tức.',
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

  const counts = data?.counts || { all: 0, online: 0, today: 0, banned: 0 };
  const users = data?.users || [];

  return (
    <section className="adm-section">
      <div className="adm-toolbar">
        <div className="search" style={{ marginTop: 0 }}>
          <Icon name="search" />
          <input
            type="search"
            placeholder="Tìm theo tên, @username, email hoặc UID…"
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

          <Button
            variant="destructive-tinted"
            size="sm"
            icon="logout"
            loading={busyUid === '__all__'}
            onClick={kickAll}
          >
            Kick tất cả (trừ Admin)
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="empty"><span className="spinner" /></div>
      ) : !users.length ? (
        <div className="empty">
          <b>Không có người dùng nào</b>
          <span>{q || filter !== 'all' ? 'Thử xóa bộ lọc hoặc đổi từ khóa.' : 'Người dùng đăng nhập qua web sẽ tự động xuất hiện ở đây.'}</span>
        </div>
      ) : (
        <div className="adm-user-list">
          {users.map((u) => {
            const busy = busyUid === u.uid;
            return (
              <div key={u.uid} className="adm-user-row">
                <Avatar user={u} />
                <div className="adm-user-main">
                  <div className="adm-user-name">
                    <span>{u.name}</span>
                    {u.online ? <span className="adm-tag online">● Online</span> : null}
                    {u.isAdmin ? <span className="adm-tag admin">Chủ sở hữu</span> : null}
                    {u.banned ? <span className="adm-tag banned">Đã chặn</span> : null}
                    {u.invited ? <span className="adm-tag info">Mã mời</span> : null}
                  </div>
                  <div className="adm-user-meta">
                    {u.username ? `@${u.username} · ` : ''}{u.email || 'Ẩn email'} · UID: {u.uid}
                  </div>
                  <div className="adm-user-stats">
                    <span>Phiên: <b>{u.activeSessions}</b></span>
                    <span>Bài đăng: <b>{u.moments}</b></span>
                    <span>Tin nhắn: <b>{u.messages}</b></span>
                    <span>Đăng nhập: <b>{u.logins}</b></span>
                    {u.lastSeen ? <span>Hoạt động: {ago(u.lastSeen)}</span> : null}
                  </div>
                  {u.banned && u.banReason ? (
                    <div className="adm-user-meta" style={{ color: 'var(--danger)', marginTop: 4 }}>
                      Lý do chặn: {u.banReason}
                    </div>
                  ) : null}
                </div>

                {!u.isAdmin ? (
                  <div className="adm-user-actions">
                    {u.activeSessions > 0 ? (
                      <Button variant="secondary" size="sm" loading={busy} onClick={() => kick(u)}>Kick</Button>
                    ) : null}
                    {u.banned ? (
                      <Button variant="tinted" size="sm" loading={busy} onClick={() => unban(u)}>Mở chặn</Button>
                    ) : (
                      <Button variant="destructive-tinted" size="sm" icon="ban" loading={busy} onClick={() => ban(u)}>Chặn</Button>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
