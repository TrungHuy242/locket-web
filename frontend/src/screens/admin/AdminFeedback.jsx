// Admin Feedback & Locket Gold VIP Request Inbox ("Hộp thư & Gold"):
// Manage user bug reports, feature suggestions, and Locket Gold upgrade requests with 1-tap Gold approval.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Avatar } from '../../components/Avatar.jsx';
import { ago } from '../../lib/format.js';
import { Icon } from '../../lib/icons.jsx';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

const CAT_BADGES = {
  gold_request: { label: '👑 Yêu cầu Locket Gold', tone: 'gold' },
  bug: { label: '🐛 Báo cáo sự cố', tone: 'banned' },
  suggestion: { label: '💡 Đề xuất cải tiến', tone: 'wl' },
  feature: { label: '✨ Yêu cầu tính năng', tone: 'online' },
};

export function AdminFeedback({ onChanged, onOpenUser }) {
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState('all');
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState({});

  const load = useCallback(async (st = status, cat = category, query = q) => {
    setLoading(true);
    try {
      const res = await api.admin.feedback({ status: st, category: cat, q: query.trim() });
      setData(res);
    } catch (err) {
      ui.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, category, q]);

  useEffect(() => {
    const t = setTimeout(() => { load(status, category, q); }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [status, category, q, load]);

  const grantGoldAndResolve = async (item) => {
    if (!item.uid) { ui.warning('Mục này không có UID người dùng'); return; }
    setBusyId(item.id);
    try {
      await api.admin.toggleUserGold(item.uid, true, 'Duyệt từ Hộp thư yêu cầu Gold');
      await api.admin.updateFeedback(item.id, { status: 'resolved', adminNote: notes[item.id] ?? (item.adminNote || 'Đã duyệt cấp Locket Gold VIP') });
      ui.success(`👑 Đã cấp Locket Gold VIP cho ${item.name || item.username || item.uid}!`);
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyId('');
    }
  };

  const toggleStatus = async (item) => {
    const nextStatus = item.status === 'open' ? 'resolved' : 'open';
    setBusyId(item.id);
    try {
      await api.admin.updateFeedback(item.id, {
        status: nextStatus,
        adminNote: notes[item.id] !== undefined ? notes[item.id] : item.adminNote,
      });
      ui.success(nextStatus === 'resolved' ? 'Đã đánh dấu hoàn tất' : 'Đã mở lại yêu cầu');
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyId('');
    }
  };

  const saveNote = async (item) => {
    setBusyId(item.id);
    try {
      await api.admin.updateFeedback(item.id, { adminNote: notes[item.id] ?? '' });
      ui.success('Đã lưu ghi chú xử lý');
      await load();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyId('');
    }
  };

  const remove = async (item) => {
    if (!await ui.confirm('Xóa phản hồi này?', 'Thao tác này sẽ xóa vĩnh viễn mục góp ý khỏi hộp thư.', 'Xóa')) return;
    setBusyId(item.id);
    try {
      await api.admin.deleteFeedback(item.id);
      ui.info('Đã xóa mục phản hồi');
      await load();
      onChanged?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyId('');
    }
  };

  const counts = data?.counts || { all: 0, open: 0, resolved: 0, gold_request: 0, bug: 0, suggestion: 0 };
  const items = data?.items || [];

  return (
    <>
      <div className="adm-page-head">
        <div>
          <h1>Hộp thư Góp ý &amp; Locket Gold</h1>
          <p>Nơi nhận trực tiếp yêu cầu nâng cấp Locket Gold VIP, báo cáo sự cố và đề xuất tính năng từ người dùng.</p>
        </div>
      </div>

      <section className="adm-section">
        <div className="adm-toolbar">
          <div className="search" style={{ marginTop: 0 }}>
            <Icon name="search" />
            <input
              type="search"
              placeholder="Tìm người gửi, tiêu đề hoặc nội dung góp ý…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q ? <button type="button" className="x" aria-label="Xóa" onClick={() => setQ('')}><Icon name="closeSm" /></button> : null}
          </div>

          <div className="adm-toolbar-row">
            <div className="adm-chips">
              <button type="button" className={`adm-chip ${category === 'all' && status === 'all' ? 'on' : ''}`} onClick={() => { setCategory('all'); setStatus('all'); }}>
                Tất cả <span className="cnt">{counts.all}</span>
              </button>
              <button type="button" className={`adm-chip ${status === 'open' ? 'on' : ''}`} onClick={() => setStatus(status === 'open' ? 'all' : 'open')}>
                Chờ xử lý <span className="cnt">{counts.open}</span>
              </button>
              <button type="button" className={`adm-chip ${category === 'gold_request' ? 'on' : ''}`} onClick={() => setCategory(category === 'gold_request' ? 'all' : 'gold_request')}>
                👑 Xin cấp Gold <span className="cnt">{counts.gold_request}</span>
              </button>
              <button type="button" className={`adm-chip ${category === 'bug' ? 'on' : ''}`} onClick={() => setCategory(category === 'bug' ? 'all' : 'bug')}>
                🐛 Báo lỗi <span className="cnt">{counts.bug}</span>
              </button>
              <button type="button" className={`adm-chip ${category === 'suggestion' ? 'on' : ''}`} onClick={() => setCategory(category === 'suggestion' ? 'all' : 'suggestion')}>
                ✨ Đề xuất <span className="cnt">{counts.suggestion}</span>
              </button>
            </div>
          </div>
        </div>

        {loading && !data ? (
          <div className="empty"><span className="spinner" /></div>
        ) : !items.length ? (
          <div className="empty">
            <b>Hộp thư hiện đang trống</b>
            <span>Khi người dùng bấm &ldquo;Báo cáo sự cố&rdquo;, &ldquo;Gửi đề xuất&rdquo; hoặc &ldquo;Đăng ký Locket Gold&rdquo;, thư sẽ hiện ngay tại đây.</span>
          </div>
        ) : (
          <div className="adm-user-list">
            {items.map((item) => {
              const badge = CAT_BADGES[item.category] || CAT_BADGES.suggestion;
              const busy = busyId === item.id;
              const curNote = notes[item.id] !== undefined ? notes[item.id] : (item.adminNote || '');
              const noteChanged = curNote.trim() !== (item.adminNote || '').trim();
              return (
                <div key={item.id} className="adm-card adm-fb-card" style={{ padding: 16 }}>
                  <div className="adm-fb-top">
                    <div className="adm-fb-author" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <Avatar user={item} size={42} goldBadge={item.isGold} />
                      <div style={{ minWidth: 0 }}>
                        <div className="adm-user-name">
                          <span>{item.name || item.username || 'Người dùng'}</span>
                          <span className={`adm-tag ${badge.tone}`}>{badge.label}</span>
                          {item.isGold ? <span className="adm-tag gold">👑 Đang có Gold</span> : null}
                          <span className={`adm-tag ${item.status === 'open' ? 'info' : 'online'}`}>
                            {item.status === 'open' ? '● Chờ xử lý' : '✓ Đã giải quyết'}
                          </span>
                        </div>
                        <div className="adm-user-meta">
                          {item.username ? `@${item.username} · ` : ''}{item.email || item.uid} · {ago(item.createdAt)}
                        </div>
                      </div>
                    </div>

                    {item.uid ? (
                      <Button variant="plain" size="sm" onClick={() => onOpenUser?.(item.uid)}>
                        Mở hồ sơ →
                      </Button>
                    ) : null}
                  </div>

                  <div className="adm-fb-body">
                    {item.title ? <b className="adm-fb-title">{item.title}</b> : null}
                    <p className="adm-fb-msg">{item.message}</p>
                    {item.meta && (item.meta.platform || item.meta.cameraTheme || item.meta.appIcon) ? (
                      <div className="adm-user-stats" style={{ marginTop: 6 }}>
                        {item.meta.platform ? <span>Thiết bị: <b>{item.meta.platform}</b></span> : null}
                        {item.meta.appIcon ? <span>Icon: <b>{item.meta.appIcon}</b></span> : null}
                        {item.meta.cameraTheme ? <span>Chủ đề cam: <b>{item.meta.cameraTheme}</b></span> : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="adm-fb-note-row">
                    <input
                      type="text"
                      className="adm-input"
                      maxLength={300}
                      placeholder="Ghi chú xử lý nội bộ của Admin…"
                      value={curNote}
                      onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                    />
                    {noteChanged ? (
                      <Button variant="secondary" size="sm" loading={busy} onClick={() => saveNote(item)}>Lưu ghi chú</Button>
                    ) : null}
                  </div>

                  <div className="adm-fb-actions">
                    {!item.isGold && item.uid ? (
                      <Button variant="primary" size="sm" loading={busy} onClick={() => grantGoldAndResolve(item)}>
                        👑 Duyệt cấp Locket Gold
                      </Button>
                    ) : null}
                    <Button variant={item.status === 'open' ? 'tinted' : 'secondary'} size="sm" loading={busy} onClick={() => toggleStatus(item)}>
                      {item.status === 'open' ? '✓ Đánh dấu Đã xử lý' : 'Mở lại yêu cầu'}
                    </Button>
                    <Button variant="destructive-tinted" size="sm" icon="trash" loading={busy} onClick={() => remove(item)}>
                      Xóa
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
