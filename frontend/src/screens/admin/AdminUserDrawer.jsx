// Slide-over User Detail Drawer: full metrics, active sessions, owner private note,
// 1-tap Whitelist toggle, Kick sessions, and Ban with quick reason presets.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Avatar } from '../../components/Avatar.jsx';
import { Icon } from '../../lib/icons.jsx';
import { ago } from '../../lib/format.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

const BAN_PRESETS = ['Spam / Làm phiền', 'Chưa nằm trong nhóm được mời', 'Tạm khóa để kiểm tra', 'Vi phạm quy định'];

function fmtFullDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

export function AdminUserDrawer({ user, onClose, onUpdated }) {
  const [note, setNote] = useState(user?.note || '');
  const [banReason, setBanReason] = useState(user?.banReason || '');
  const [showBanBox, setShowBanBox] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setNote(user?.note || '');
    setBanReason(user?.banReason || '');
    setShowBanBox(false);
  }, [user]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!user) return null;

  const copyText = async (txt, label) => {
    try {
      await navigator.clipboard.writeText(txt);
      ui.success(`Đã sao chép ${label}`);
    } catch {
      ui.info(`${label}: ${txt}`);
    }
  };

  const saveNote = async () => {
    setBusy('note');
    try {
      await api.admin.saveUserNote(user.uid, note.trim());
      ui.success('Đã lưu ghi chú riêng');
      onUpdated?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const toggleWhitelist = async () => {
    setBusy('wl');
    try {
      const next = !user.whitelisted;
      await api.admin.toggleUserWhitelist(user.uid, next);
      ui.success(next ? `Đã thêm ${user.name} vào Whitelist` : `Đã gỡ ${user.name} khỏi Whitelist`);
      onUpdated?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const kick = async () => {
    if (!await ui.confirm(`Đăng xuất ${user.name}?`, 'Mọi phiên đang mở của tài khoản này sẽ bị ngắt ngay.', 'Đăng xuất')) return;
    setBusy('kick');
    try {
      const r = await api.admin.kickUser(user.uid);
      ui.success(`Đã ngắt ${r.revokedSessions} phiên của ${user.name}`);
      onUpdated?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const confirmBan = async () => {
    setBusy('ban');
    try {
      await api.admin.banUser(user.uid, banReason.trim());
      ui.success(`Đã chặn tài khoản ${user.name}`);
      setShowBanBox(false);
      onUpdated?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const unban = async () => {
    setBusy('unban');
    try {
      await api.admin.unbanUser(user.uid);
      ui.success(`Đã mở chặn ${user.name}`);
      onUpdated?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const sessions = user.sessions || [];
  const noteDirty = note.trim() !== (user.note || '').trim();

  return (
    <div className="adm-drawer-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="adm-drawer" role="dialog" aria-label={`Hồ sơ ${user.name}`}>
        <div className="adm-drawer-head">
          <h3>Chi tiết Người dùng</h3>
          <button type="button" className="icon-btn sm" aria-label="Đóng" onClick={onClose}><Icon name="closeSm" /></button>
        </div>

        <div className="adm-drawer-body">
          <div className="adm-drawer-profile">
            <Avatar user={user} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <h4>{user.name}</h4>
              <div className="adm-user-meta" style={{ marginTop: 3 }}>
                {user.username ? `@${user.username}` : 'Chưa có username'}
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                {user.online ? <span className="adm-tag online">● Đang online</span> : null}
                {user.isAdmin ? <span className="adm-tag admin">Chủ sở hữu</span> : null}
                {user.whitelisted ? <span className="adm-tag wl">Whitelist</span> : null}
                {user.invited ? <span className="adm-tag info">Đã dùng mã mời</span> : null}
                {user.banned ? <span className="adm-tag banned">Đang bị chặn</span> : null}
              </div>
            </div>
          </div>

          <div className="adm-mini-grid">
            <div className="adm-mini-stat"><b>{user.photos}</b><span>Ảnh</span></div>
            <div className="adm-mini-stat"><b>{user.videos}</b><span>Video</span></div>
            <div className="adm-mini-stat"><b>{user.photobooth}</b><span>Booth</span></div>
            <div className="adm-mini-stat"><b>{user.messages}</b><span>Tin nhắn</span></div>
          </div>

          <div className="adm-card" style={{ padding: 14 }}>
            <div className="adm-kv-list">
              <div className="adm-kv">
                <span>Email</span>
                <b style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {user.email || 'Ẩn'}
                  {user.email ? <button type="button" className="link-btn" onClick={() => copyText(user.email, 'email')}>Chép</button> : null}
                </b>
              </div>
              <div className="adm-kv">
                <span>Mã UID</span>
                <b style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ fontSize: 11 }}>{user.uid}</code>
                  <button type="button" className="link-btn" onClick={() => copyText(user.uid, 'UID')}>Chép</button>
                </b>
              </div>
              <div className="adm-kv"><span>Tham gia lần đầu</span><b>{fmtFullDate(user.firstSeen)}</b></div>
              <div className="adm-kv"><span>Hoạt động gần nhất</span><b>{user.lastSeen ? ago(user.lastSeen) : '—'}</b></div>
              <div className="adm-kv"><span>Tổng lượt đăng nhập / Công cụ</span><b>{user.logins} lần · {user.tools} công cụ</b></div>
            </div>
          </div>

          <div>
            <div className="adm-section-head" style={{ marginBottom: 8 }}>
              <h3><Icon name="pencil" /> Ghi chú riêng của bạn</h3>
            </div>
            <textarea
              className="adm-textarea"
              style={{ minHeight: 68 }}
              maxLength={300}
              placeholder="Ghi chú nội bộ (chỉ mình bạn thấy, vd: Bạn cùng lớp, Nick phụ…)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {noteDirty ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <Button variant="primary" size="sm" loading={busy === 'note'} onClick={saveNote}>Lưu ghi chú</Button>
              </div>
            ) : null}
          </div>

          <div>
            <div className="adm-section-head" style={{ marginBottom: 8 }}>
              <h3><Icon name="activity" /> Phiên đăng nhập ({sessions.length})</h3>
            </div>
            {!sessions.length ? (
              <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Không có phiên nào đang mở trên máy chủ.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sessions.map((s) => (
                  <div key={s.sidHash} className="adm-session-item">
                    <span>Mã phiên <code>#{s.sidHash}</code> · {s.inMemory ? 'Đang chạy trên RAM' : 'Đang lưu trên đĩa'}</span>
                    <span style={{ color: 'var(--muted)' }}>{s.lastSeenMs ? ago(s.lastSeenMs) : '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!user.isAdmin ? (
            <div className="adm-card" style={{ padding: 14 }}>
              <div className="adm-section-head" style={{ marginBottom: 10 }}>
                <h3><Icon name="shield" /> Quyền &amp; Xử lý tài khoản</h3>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button
                  variant={user.whitelisted ? 'tinted' : 'secondary'}
                  size="sm"
                  icon="check"
                  loading={busy === 'wl'}
                  onClick={toggleWhitelist}
                >
                  {user.whitelisted ? 'Đang trong Whitelist (Gỡ)' : '+ Thêm vào Whitelist'}
                </Button>

                {user.activeSessions > 0 ? (
                  <Button variant="secondary" size="sm" icon="logout" loading={busy === 'kick'} onClick={kick}>
                    Đăng xuất ({user.activeSessions})
                  </Button>
                ) : null}

                {user.banned ? (
                  <Button variant="primary" size="sm" loading={busy === 'unban'} onClick={unban}>Mở chặn tài khoản</Button>
                ) : (
                  <Button variant="destructive-tinted" size="sm" icon="ban" onClick={() => setShowBanBox((v) => !v)}>
                    {showBanBox ? 'Ẩn khung chặn' : 'Chặn tài khoản'}
                  </Button>
                )}
              </div>

              {user.banned && user.banReason ? (
                <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: 'var(--danger)' }}>
                  Lý do đang chặn: {user.banReason}
                </div>
              ) : null}

              {showBanBox && !user.banned ? (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                  <div className="adm-field">
                    <label htmlFor="adm-drawer-ban">Lý do chặn (người dùng sẽ thấy thông báo này)</label>
                    <input
                      id="adm-drawer-ban"
                      className="adm-input"
                      type="text"
                      maxLength={180}
                      placeholder="Nhập lý do hoặc chọn nhanh bên dưới…"
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                    />
                    <div className="adm-reason-chips">
                      {BAN_PRESETS.map((p) => (
                        <button key={p} type="button" onClick={() => setBanReason(p)}>{p}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button variant="secondary" size="sm" onClick={() => setShowBanBox(false)}>Hủy</Button>
                    <Button variant="destructive" size="sm" icon="ban" loading={busy === 'ban'} onClick={confirmBan}>Xác nhận chặn ngay</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
