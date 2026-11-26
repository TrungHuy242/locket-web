// Admin System Ops, Live Diagnostics, Security Posture, CSV Reports & Vietnamese Audit Log v2.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../lib/icons.jsx';
import { ago } from '../../lib/format.js';
import { Button } from '../../ui/kit.jsx';
import { ui } from '../../ui/overlays.jsx';

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function fmtClock(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

const AUDIT_META = {
  'admin.login': { label: 'Đăng nhập Quản trị', cat: 'security', tone: 'admin' },
  'config.update': { label: 'Cập nhật Thương hiệu / Cài đặt', cat: 'config', tone: 'wl' },
  'access.update': { label: 'Cập nhật Quy tắc Truy cập', cat: 'access', tone: 'wl' },
  'access.whitelist': { label: 'Cập nhật Whitelist', cat: 'access', tone: 'online' },
  'invite.create': { label: 'Tạo mã mời mới', cat: 'access', tone: 'online' },
  'invite.revoke': { label: 'Thu hồi mã mời', cat: 'access', tone: 'banned' },
  'user.ban': { label: 'Chặn tài khoản', cat: 'users', tone: 'banned' },
  'user.unban': { label: 'Mở chặn tài khoản', cat: 'users', tone: 'online' },
  'user.gold_grant': { label: '👑 Cấp quyền Locket Gold VIP', cat: 'users', tone: 'gold' },
  'user.gold_revoke': { label: 'Thu hồi quyền Locket Gold', cat: 'users', tone: 'info' },
  'user.kick': { label: 'Đăng xuất phiên người dùng', cat: 'users', tone: 'info' },
  'user.note': { label: 'Cập nhật ghi chú người dùng', cat: 'users', tone: 'info' },
  'feedback.update': { label: 'Xử lý Hộp thư Góp ý / Gold', cat: 'users', tone: 'online' },
  'feedback.delete': { label: 'Xóa mục Hộp thư Góp ý', cat: 'users', tone: 'banned' },
  'sessions.kick_all': { label: 'Đăng xuất toàn bộ người dùng', cat: 'users', tone: 'banned' },
  'ops.clear_cache': { label: 'Dọn bộ nhớ đệm', cat: 'ops', tone: 'info' },
  'ops.prune_sessions': { label: 'Quét dọn phiên hết hạn', cat: 'ops', tone: 'info' },
  'ops.sync_now': { label: 'Sao lưu ngay lên Hugging Face', cat: 'ops', tone: 'online' },
  'ops.diagnostics': { label: 'Kiểm tra sức khỏe dịch vụ', cat: 'ops', tone: 'info' },
};

const AUDIT_FILTERS = [
  ['all', 'Tất cả'],
  ['users', 'Người dùng'],
  ['config', 'Thương hiệu'],
  ['access', 'Truy cập'],
  ['ops', 'Hệ thống'],
];

export function AdminOps({ overview, onRefreshOverview }) {
  const [logs, setLogs] = useState(null);
  const [diag, setDiag] = useState(null);
  const [busyOp, setBusyOp] = useState('');
  const [auditFilter, setAuditFilter] = useState('all');
  const [auditQuery, setAuditQuery] = useState('');

  const loadLogs = useCallback(() => {
    api.admin.logs().then(setLogs).catch((err) => ui.error(err.message));
  }, []);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const runOp = async (id, fn, msg) => {
    setBusyOp(id);
    try {
      const res = await fn();
      ui.success(typeof msg === 'function' ? msg(res) : msg);
      loadLogs();
      onRefreshOverview?.();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyOp('');
    }
  };

  const runDiagnostics = async () => {
    setBusyOp('diag');
    try {
      const res = await api.admin.diagnostics();
      setDiag(res);
      const okCount = (res.checks || []).filter((c) => c.ok).length;
      ui.success(`Chẩn đoán xong: ${okCount}/${res.checks.length} dịch vụ hoạt động tốt`);
      loadLogs();
    } catch (err) {
      ui.error(err.message);
    } finally {
      setBusyOp('');
    }
  };

  const downloadCsv = (url, label) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    ui.info(`Đang tải báo cáo ${label}…`, 1800);
  };

  const filteredAudit = useMemo(() => {
    const list = logs?.audit || [];
    const q = auditQuery.trim().toLowerCase();
    return list.filter((a) => {
      const meta = AUDIT_META[a.action] || { label: a.action, cat: 'ops' };
      if (auditFilter !== 'all' && meta.cat !== auditFilter) return false;
      if (q) {
        const hay = `${meta.label} ${a.action} ${a.target} ${a.detail} ${a.actor}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, auditFilter, auditQuery]);

  const disk = overview?.health?.disk || {};
  const sec = overview?.security || {};

  return (
    <>
      <div className="adm-page-head">
        <div>
          <h1>Hệ thống, Chẩn đoán &amp; Nhật ký</h1>
          <p>Dọn bộ nhớ đệm, kiểm tra kết nối các dịch vụ ngoài, xuất báo cáo Excel và theo dõi toàn bộ nhật ký hoạt động.</p>
        </div>
        <Button variant="primary" size="sm" icon="activity" loading={busyOp === 'diag'} onClick={runDiagnostics}>
          Kiểm tra sức khỏe dịch vụ
        </Button>
      </div>

      {diag ? (
        <section className="adm-section">
          <div className="adm-card">
            <div className="adm-section-head">
              <h3><Icon name="activity" /> Kết quả kiểm tra kết nối trực tiếp</h3>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{fmtClock(diag.checkedAt)}</span>
            </div>
            <div className="adm-diag-grid" style={{ marginTop: 0 }}>
              {(diag.checks || []).map((c) => (
                <div key={c.key} className={`adm-diag-card ${c.ok ? 'ok' : 'fail'}`}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <b style={{ fontSize: 13 }}>{c.label}</b>
                    <span className={`adm-tag ${c.ok ? 'online' : 'banned'}`}>{c.ok ? (c.ms ? `${c.ms} ms` : 'Ổn định') : 'Lỗi'}</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{c.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="adm-section">
        <div className="adm-section-head">
          <h3><Icon name="wrench" /> Vận hành &amp; Bảo trì 1 chạm</h3>
        </div>
        <div className="adm-ops-grid">
          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('thumbs', () => api.admin.clearCache('thumbs'), (r) => `Đã dọn ${r.deletedFiles} ảnh đệm (${fmtBytes(r.freedBytes)})`)}
          >
            <span className="ic"><Icon name="trash" /></span>
            <span>
              <b>Dọn cache ảnh thu nhỏ</b>
              <small>Đang chiếm {fmtBytes(disk.thumbsBytes)} ({disk.thumbsFiles ?? 0} tệp)</small>
            </span>
          </button>

          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('videos', () => api.admin.clearCache('videos'), (r) => `Đã dọn ${r.deletedFiles} video đệm (${fmtBytes(r.freedBytes)})`)}
          >
            <span className="ic"><Icon name="film" /></span>
            <span>
              <b>Dọn cache video</b>
              <small>Đang chiếm {fmtBytes(disk.videoBytes)} ({disk.videoFiles ?? 0} tệp)</small>
            </span>
          </button>

          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('all', () => api.admin.clearCache('all'), (r) => `Đã dọn toàn bộ ${r.deletedFiles} tệp (${fmtBytes(r.freedBytes)})`)}
          >
            <span className="ic"><Icon name="refresh" /></span>
            <span>
              <b>Dọn sạch toàn bộ cache</b>
              <small>Giải phóng {fmtBytes((disk.thumbsBytes || 0) + (disk.videoBytes || 0))}</small>
            </span>
          </button>

          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('prune', () => api.admin.pruneSessions(), (r) => `Đã quét dọn ${r.removed} phiên hết hạn`)}
          >
            <span className="ic"><Icon name="people" /></span>
            <span>
              <b>Quét dọn phiên hết hạn</b>
              <small>Xóa các phiên đăng nhập lỗi hoặc quá hạn</small>
            </span>
          </button>

          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('sync', () => api.admin.syncNow(), (r) => (r.synced ? 'Đã sao lưu ngay lên Hugging Face' : 'Dữ liệu HF đã ở bản mới nhất'))}
          >
            <span className="ic"><Icon name="cloud" /></span>
            <span>
              <b>Sao lưu ngay lên Hugging Face</b>
              <small>Đẩy bản chụp mã hóa AES lên đám mây</small>
            </span>
          </button>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-grid-2">
          <div className="adm-card">
            <div className="adm-section-head">
              <h3><Icon name="shield" /> Trạng thái Bảo mật</h3>
              <span className="adm-tag online">An toàn</span>
            </div>
            <div className="adm-kv-list">
              <div className="adm-kv"><span>Ẩn trang Admin trước người ngoài (Stealth 404)</span><b style={{ color: 'var(--success)' }}>Đang bật</b></div>
              <div className="adm-kv"><span>Tài khoản Chủ sở hữu đã cấp quyền</span><b>{(sec.adminEmailCount || 0) + (sec.adminUidCount || 0)} tài khoản</b></div>
              <div className="adm-kv"><span>Cổng đường dẫn bí mật dự phòng</span><b>{sec.secretPortalEnabled ? 'Đang bật' : 'Đang tắt (Khuyên dùng)'}</b></div>
              <div className="adm-kv"><span>Sao lưu mã hóa AES (Hugging Face)</span><b>{sec.hfEnabled ? (sec.hfEncrypted ? 'Đang bật (AES)' : 'Đang bật (chưa mã hóa)') : 'Chỉ lưu cục bộ'}</b></div>
            </div>
          </div>

          <div className="adm-card">
            <div className="adm-section-head">
              <h3><Icon name="download" /> Xuất Báo cáo (CSV / Excel)</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button type="button" className="adm-op-btn" onClick={() => downloadCsv('/api/admin/export/users.csv', 'Danh sách người dùng')}>
                <span className="ic"><Icon name="download" /></span>
                <span><b>Tải danh sách người dùng (.csv)</b><small>Mở trực tiếp bằng Excel tiếng Việt (UID, tên, phiên, bài đăng)</small></span>
              </button>
              <button type="button" className="adm-op-btn" onClick={() => downloadCsv('/api/admin/export/metrics.csv', 'Thống kê theo ngày')}>
                <span className="ic"><Icon name="chart" /></span>
                <span><b>Tải bảng thống kê theo ngày (.csv)</b><small>Người hoạt động, đăng nhập, khoảnh khắc, tin nhắn, công cụ</small></span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-grid-2">
          <div className="adm-card">
            <div className="adm-section-head">
              <h3><Icon name="warning" /> Lỗi Máy chủ Gần đây</h3>
              <span className={`adm-tag ${logs?.errors?.length ? 'banned' : 'online'}`}>{logs?.errors?.length ?? 0} lỗi</span>
            </div>
            {!logs ? (
              <div className="empty"><span className="spinner" /></div>
            ) : !logs.errors.length ? (
              <div className="empty" style={{ padding: '20px 8px' }}>
                <b>Không có lỗi máy chủ nào</b>
                <span>Hệ thống đang chạy mượt mà.</span>
              </div>
            ) : (
              <div className="adm-log-list">
                {logs.errors.map((err, i) => (
                  <div key={`${err.at}-${i}`} className="adm-log-item">
                    <div className="adm-log-top">
                      <span className="adm-tag banned">Mã {err.status} · {err.method}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{fmtClock(err.at)}</span>
                    </div>
                    <div className="adm-log-path" style={{ marginTop: 4 }}>{err.path}</div>
                    <div className="adm-log-detail">{err.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="adm-card">
            <div className="adm-section-head">
              <h3><Icon name="shield" /> Nhật ký Thao tác Quản trị</h3>
              <span className="adm-tag info">{filteredAudit.length} mục</span>
            </div>

            <div className="adm-chips" style={{ marginBottom: 10 }}>
              {AUDIT_FILTERS.map(([key, label]) => (
                <button key={key} type="button" className={`adm-chip ${auditFilter === key ? 'on' : ''}`} onClick={() => setAuditFilter(key)}>
                  {label}
                </button>
              ))}
            </div>

            <div className="search" style={{ marginTop: 0, marginBottom: 10, height: 38 }}>
              <Icon name="search" />
              <input
                type="search"
                placeholder="Lọc nhật ký…"
                value={auditQuery}
                onChange={(e) => setAuditQuery(e.target.value)}
              />
              {auditQuery ? <button type="button" className="x" onClick={() => setAuditQuery('')}><Icon name="closeSm" /></button> : null}
            </div>

            {!logs ? (
              <div className="empty"><span className="spinner" /></div>
            ) : !filteredAudit.length ? (
              <div className="empty" style={{ padding: '20px 8px' }}>
                <b>Không có nhật ký nào khớp</b>
                <span>Mọi thao tác quản trị của bạn sẽ được ghi lại rõ ràng tại đây.</span>
              </div>
            ) : (
              <div className="adm-log-list">
                {filteredAudit.map((a, i) => {
                  const meta = AUDIT_META[a.action] || { label: a.action, tone: 'info' };
                  return (
                    <div key={`${a.at}-${i}`} className="adm-log-item">
                      <div className="adm-log-top">
                        <span className={`adm-tag ${meta.tone}`}>{meta.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>
                          {ago(a.at)} · {(a.actor || '').replace('locket:', '')}
                        </span>
                      </div>
                      {a.target ? <div className="adm-log-path" style={{ marginTop: 4 }}>Đối tượng: {a.target}</div> : null}
                      {a.detail ? <div className="adm-log-detail">{a.detail}</div> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
