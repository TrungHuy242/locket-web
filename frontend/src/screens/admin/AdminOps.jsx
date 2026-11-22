// Admin System Ops, Recent 5xx Errors, Audit Log & CSV Report Exports tab.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../lib/icons.jsx';
import { ago } from '../../lib/format.js';
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

export function AdminOps({ onRefreshOverview }) {
  const [logs, setLogs] = useState(null);
  const [busyOp, setBusyOp] = useState('');

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

  const downloadCsv = (url, label) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    ui.info(`Đang tải báo cáo ${label}…`, 1800);
  };

  return (
    <>
      <section className="adm-section">
        <div className="adm-section-head">
          <h3><Icon name="wrench" /> Vận hành Hệ thống 1 chạm</h3>
        </div>
        <div className="adm-ops-grid">
          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('thumbs', () => api.admin.clearCache('thumbs'), (r) => `Đã dọn ${r.deletedFiles} ảnh đệm (${fmtBytes(r.freedBytes)})`)}
          >
            <span className="ic"><Icon name="trash" /></span>
            <span><b>Dọn cache ảnh thu nhỏ</b><small>Giải phóng thư mục thumbs/</small></span>
          </button>

          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('videos', () => api.admin.clearCache('videos'), (r) => `Đã dọn ${r.deletedFiles} video đệm (${fmtBytes(r.freedBytes)})`)}
          >
            <span className="ic"><Icon name="film" /></span>
            <span><b>Dọn cache video</b><small>Giải phóng thư mục videos/</small></span>
          </button>

          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('all', () => api.admin.clearCache('all'), (r) => `Đã dọn toàn bộ ${r.deletedFiles} tệp (${fmtBytes(r.freedBytes)})`)}
          >
            <span className="ic"><Icon name="refresh" /></span>
            <span><b>Dọn toàn bộ bộ nhớ đệm</b><small>Xóa sạch thumbs/ &amp; videos/</small></span>
          </button>

          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('prune', () => api.admin.pruneSessions(), (r) => `Đã quét dọn ${r.removed} phiên hết hạn`)}
          >
            <span className="ic"><Icon name="people" /></span>
            <span><b>Quét dọn phiên hết hạn</b><small>Xóa phiên lỗi hoặc đã hết hạn</small></span>
          </button>

          <button
            type="button"
            className="adm-op-btn"
            disabled={!!busyOp}
            onClick={() => runOp('sync', () => api.admin.syncNow(), (r) => (r.synced ? 'Đã sao lưu ngay lên Hugging Face' : 'Dữ liệu HF đã ở bản mới nhất'))}
          >
            <span className="ic"><Icon name="cloud" /></span>
            <span><b>Sao lưu ngay (Force Sync)</b><small>Đẩy bản mã hóa AES lên HF Dataset</small></span>
          </button>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-section-head">
          <h3><Icon name="download" /> Xuất Báo cáo (CSV / Excel)</h3>
        </div>
        <div className="adm-ops-grid">
          <button type="button" className="adm-op-btn" onClick={() => downloadCsv('/api/admin/export/users.csv', 'Danh sách người dùng')}>
            <span className="ic"><Icon name="download" /></span>
            <span><b>Xuất danh sách người dùng (.csv)</b><small>UID, tên, phiên, bài đăng, trạng thái</small></span>
          </button>

          <button type="button" className="adm-op-btn" onClick={() => downloadCsv('/api/admin/export/metrics.csv', 'Thống kê theo ngày')}>
            <span className="ic"><Icon name="chart" /></span>
            <span><b>Xuất thống kê theo ngày (.csv)</b><small>DAU, đăng nhập, khoảnh khắc, công cụ</small></span>
          </button>
        </div>
      </section>

      <section className="adm-section">
        <div className="adm-grid-2">
          <div className="adm-card">
            <div className="adm-section-head" style={{ marginTop: 0 }}>
              <h3><Icon name="warning" /> Lỗi Máy chủ Gần đây (5xx)</h3>
              <span className="adm-tag info">{logs?.errors?.length ?? 0}</span>
            </div>
            {!logs ? (
              <div className="empty"><span className="spinner" /></div>
            ) : !logs.errors.length ? (
              <div className="empty" style={{ padding: '18px 8px' }}>
                <b>Không có lỗi máy chủ nào</b>
                <span>Hệ thống đang vận hành ổn định.</span>
              </div>
            ) : (
              <div className="adm-log-list">
                {logs.errors.map((err, i) => (
                  <div key={`${err.at}-${i}`} className="adm-log-item">
                    <div className="adm-log-top">
                      <span className="adm-tag banned">{err.status} · {err.method}</span>
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
            <div className="adm-section-head" style={{ marginTop: 0 }}>
              <h3><Icon name="shield" /> Nhật ký Quản trị (Audit Log)</h3>
              <span className="adm-tag info">{logs?.audit?.length ?? 0}</span>
            </div>
            {!logs ? (
              <div className="empty"><span className="spinner" /></div>
            ) : !logs.audit.length ? (
              <div className="empty" style={{ padding: '18px 8px' }}>
                <b>Chưa có thao tác quản trị nào</b>
                <span>Mọi thay đổi thương hiệu, chặn/mở chặn hay tạo mã mời sẽ được ghi lại tại đây.</span>
              </div>
            ) : (
              <div className="adm-log-list">
                {logs.audit.map((a, i) => (
                  <div key={`${a.at}-${i}`} className="adm-log-item">
                    <div className="adm-log-top">
                      <span className="adm-tag admin">{a.action}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{ago(a.at)} · {a.actor}</span>
                    </div>
                    {a.target ? <div className="adm-log-path" style={{ marginTop: 3 }}>Mục tiêu: {a.target}</div> : null}
                    {a.detail ? <div className="adm-log-detail">{a.detail}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
