// Owner Admin Console v2 — 2-column SaaS layout on desktop, compact tab bar on mobile,
// Live Command Bar (status + auto-refresh + 1-tap quick actions) and unsaved-change protection.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../lib/icons.jsx';
import { applySiteConfig, useSiteConfig } from '../lib/siteConfig.js';
import { nav } from '../ui/nav.jsx';
import { Button } from '../ui/kit.jsx';
import { ui } from '../ui/overlays.jsx';
import { AdminOverview } from './admin/AdminOverview.jsx';
import { AdminUsers } from './admin/AdminUsers.jsx';
import { AdminBranding } from './admin/AdminBranding.jsx';
import { AdminFeatures } from './admin/AdminFeatures.jsx';
import { AdminAccess } from './admin/AdminAccess.jsx';
import { AdminFeedback } from './admin/AdminFeedback.jsx';
import { AdminOps } from './admin/AdminOps.jsx';
import '../styles/admin.css';

const NAV_GROUPS = [
  {
    heading: 'Giám sát',
    items: [
      { id: 'overview', label: 'Tổng quan', sub: 'Chỉ số & xu hướng', icon: 'chart' },
      { id: 'users', label: 'Người dùng & Gold', sub: 'Cấp VIP Gold, phiên & chặn', icon: 'people' },
      { id: 'feedback', label: 'Hộp thư & Yêu cầu', sub: 'Xin Gold, báo lỗi & góp ý', icon: 'inbox' },
    ],
  },
  {
    heading: 'Điều hành ứng dụng',
    items: [
      { id: 'branding', label: 'Thương hiệu & Thông báo', sub: 'Tên app, màu, banner', icon: 'sparkles' },
      { id: 'features', label: 'Tính năng & Bảo trì', sub: 'Bật/tắt module, khóa web', icon: 'gear' },
      { id: 'access', label: 'Truy cập & Mã mời', sub: 'Riêng tư, Whitelist, mã mời', icon: 'lock' },
      { id: 'ops', label: 'Hệ thống & Nhật ký', sub: 'Cache, chẩn đoán, báo cáo', icon: 'wrench' },
    ],
  },
];

const ALL_TABS = NAV_GROUPS.flatMap((g) => g.items);

function AdminGate({ status, onUnlocked, onClose }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.admin.login(password.trim());
      setPassword('');
      onUnlocked(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-gate">
      <div className="admin-gate-card">
        <div className="admin-gate-icon"><Icon name="shield" /></div>
        <h1>Cổng Quản trị Chủ sở hữu</h1>
        <p>Nhập mật khẩu quản trị riêng để truy cập bảng điều khiển, thống kê và tùy biến ứng dụng.</p>
        <form onSubmit={submit}>
          <label className="field">
            <input
              type="password"
              placeholder="Mật khẩu…"
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
            />
          </label>
          {error ? <p className="auth-error" style={{ marginTop: 0 }}>{error}</p> : null}
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!password.trim() || !status?.passwordEnabled}>
            Mở bảng điều khiển
          </Button>
        </form>
        {onClose ? (
          <button type="button" className="link" style={{ marginTop: 12 }} onClick={onClose}>
            ← Quay lại ứng dụng
          </button>
        ) : null}
      </div>
    </div>
  );
}

function fmtAgoShort(ms, nowMs) {
  if (!ms) return '';
  const diff = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diff < 5) return 'vừa xong';
  if (diff < 60) return `${diff} giây trước`;
  return `${Math.floor(diff / 60)} phút trước`;
}

export function Admin({ view, standalone = false, onClose }) {
  const appName = useSiteConfig((s) => s.appName);
  const [auth, setAuth] = useState(null);
  const [tab, setTab] = useState('overview');
  const [userNavIntent, setUserNavIntent] = useState(null); // { filter?, focusUid?, seq }
  const [overview, setOverview] = useState(null);
  const [loadingOv, setLoadingOv] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [dirtyTab, setDirtyTab] = useState(false);
  const [quickBusy, setQuickBusy] = useState('');
  const mainRef = useRef(null);

  const loadOverview = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoadingOv(true);
    try {
      const data = await api.admin.overview();
      setOverview(data);
      setLastUpdated(Date.now());
    } catch (err) {
      if (err.status === 403 || err.status === 404) setAuth((a) => (a ? { ...a, isAdmin: false } : a));
      else if (!silent) ui.error(err.message);
    } finally {
      if (!silent) setLoadingOv(false);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const st = await api.admin.authStatus();
      setAuth(st);
      if (st.isAdmin) loadOverview();
    } catch {
      if (standalone) onClose?.();
      else if (view?.id) nav.pop(view.id);
    }
  }, [loadOverview, standalone, onClose, view]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  // Auto-refresh every 30s while visible & admin authenticated
  useEffect(() => {
    if (!auth?.isAdmin || !autoRefresh) return undefined;
    const t = setInterval(() => {
      if (!document.hidden) loadOverview({ silent: true });
    }, 30000);
    return () => clearInterval(t);
  }, [auth?.isAdmin, autoRefresh, loadOverview]);

  // Keep "Cập nhật X giây trước" fresh
  useEffect(() => {
    if (!lastUpdated) return undefined;
    const t = setInterval(() => setNowTick(Date.now()), 5000);
    return () => clearInterval(t);
  }, [lastUpdated]);

  const switchTab = async (nextTab, intent = null) => {
    if (nextTab === tab && !intent) return;
    if (dirtyTab && nextTab !== tab) {
      const ok = await ui.confirm(
        'Bạn có thay đổi chưa lưu',
        'Nếu rời khỏi mục này ngay bây giờ, các chỉnh sửa chưa lưu sẽ bị bỏ qua.',
        'Rời khỏi mục',
      );
      if (!ok) return;
      setDirtyTab(false);
    }
    if (intent) setUserNavIntent({ ...intent, seq: Date.now() });
    setTab(nextTab);
    mainRef.current?.scrollTo({ top: 0 });
  };

  const handleClose = async () => {
    if (dirtyTab) {
      const ok = await ui.confirm(
        'Đóng trang Quản trị?',
        'Bạn vẫn còn thay đổi chưa lưu. Bạn có chắc muốn đóng không?',
        'Đóng luôn',
      );
      if (!ok) return;
    }
    if (standalone) onClose?.();
    else if (view?.id) nav.pop(view.id);
  };

  const quickToggleMaintenance = async () => {
    const cur = !!overview?.siteState?.maintenanceEnabled;
    if (!cur) {
      const ok = await ui.confirm(
        'Bật Chế độ Bảo trì ngay?',
        'Người dùng thường sẽ tạm thời thấy màn hình bảo trì. Tài khoản Quản trị của bạn vẫn sử dụng bình thường.',
        'Bật bảo trì',
      );
      if (!ok) return;
    }
    setQuickBusy('maint');
    try {
      const saved = await api.admin.saveConfig({ maintenance: { enabled: !cur } });
      applySiteConfig(saved);
      ui.success(!cur ? 'Đã bật Chế độ Bảo trì' : 'Đã tắt Chế độ Bảo trì — Web hoạt động trở lại!');
      loadOverview({ silent: true });
    } catch (err) {
      ui.error(err.message);
    } finally {
      setQuickBusy('');
    }
  };

  const quickSyncHf = async () => {
    setQuickBusy('sync');
    try {
      const r = await api.admin.syncNow();
      ui.success(r.synced ? 'Đã sao lưu ngay lên Hugging Face' : 'Dữ liệu trên Hugging Face đã ở bản mới nhất');
      loadOverview({ silent: true });
    } catch (err) {
      ui.error(err.message);
    } finally {
      setQuickBusy('');
    }
  };

  const logoutAdminCookie = async () => {
    try {
      await api.admin.logout();
      ui.info('Đã khóa phiên quản trị');
      await checkAuth();
    } catch (err) {
      ui.error(err.message);
    }
  };

  const siteState = overview?.siteState || {};
  const kpi = overview?.kpi || {};
  const errCount = overview?.health?.recentErrorCount || 0;

  const badgeOf = (id) => {
    if (id === 'users' && kpi.onlineNow > 0) return { text: String(kpi.onlineNow), tone: 'ok' };
    if (id === 'feedback' && kpi.openFeedback > 0) return { text: String(kpi.openFeedback), tone: 'danger' };
    if (id === 'features' && siteState.maintenanceEnabled) return { text: 'Bảo trì', tone: 'danger' };
    if (id === 'access' && siteState.inviteOnly) return { text: 'Riêng tư', tone: '' };
    if (id === 'ops' && errCount > 0) return { text: String(errCount), tone: 'danger' };
    return null;
  };

  const inner = !auth ? (
    <div className="empty" style={{ marginTop: 60 }}><span className="spinner lg" /><span>Đang xác thực quyền quản trị…</span></div>
  ) : !auth.isAdmin ? (
    <AdminGate
      status={auth}
      onUnlocked={(res) => {
        setAuth((a) => ({ ...(a || {}), isAdmin: true, via: res.via || 'password' }));
        loadOverview();
      }}
      onClose={handleClose}
    />
  ) : (
    <div className="adm-shell">
      <header className="adm-topbar">
        <div className="adm-topbar-left">
          <span className="adm-brand-badge"><Icon name="shield" /></span>
          <div className="adm-topbar-title">
            <h2>Quản trị · {appName}</h2>
            <div className="adm-live-strip">
              {siteState.maintenanceEnabled ? (
                <span className="adm-status-pill danger"><i /> Đang bảo trì</span>
              ) : siteState.inviteOnly ? (
                <span className="adm-status-pill warn"><i /> Chế độ Riêng tư</span>
              ) : (
                <span className="adm-status-pill ok"><i /> Hoạt động ổn định</span>
              )}
              <span><b>{kpi.onlineNow ?? 0}</b> đang online</span>
              {lastUpdated ? <span className="adm-cmd-hide-sm">· Cập nhật {fmtAgoShort(lastUpdated, nowTick)}</span> : null}
            </div>
          </div>
        </div>

        <div className="adm-topbar-right">
          <button
            type="button"
            className={`adm-cmd-pill adm-cmd-hide-sm ${siteState.maintenanceEnabled ? 'warn' : ''}`}
            disabled={!!quickBusy}
            onClick={quickToggleMaintenance}
            title="Bật hoặc tắt nhanh Chế độ Bảo trì"
          >
            <Icon name="wrench" />{siteState.maintenanceEnabled ? 'Tắt bảo trì' : 'Bảo trì'}
          </button>

          <button
            type="button"
            className="adm-cmd-pill adm-cmd-hide-sm"
            disabled={!!quickBusy}
            onClick={quickSyncHf}
            title="Đẩy sao lưu mã hóa AES lên Hugging Face ngay"
          >
            <Icon name="cloud" />Sao lưu HF
          </button>

          <button
            type="button"
            className={`adm-cmd-pill ${autoRefresh ? 'on' : ''}`}
            onClick={() => setAutoRefresh((v) => !v)}
            title="Tự động cập nhật số liệu mỗi 30 giây"
          >
            <Icon name="activity" />{autoRefresh ? 'Tự động 30s' : 'Thủ công'}
          </button>

          <button
            type="button"
            className="icon-btn sm pressable"
            aria-label="Làm mới số liệu"
            title="Làm mới số liệu"
            onClick={() => loadOverview()}
          >
            <span className={loadingOv ? 'adm-spin' : ''} style={{ display: 'grid', placeItems: 'center' }}>
              <Icon name="refresh" />
            </span>
          </button>

          {auth.via === 'password' ? (
            <button type="button" className="icon-btn sm pressable" aria-label="Khóa phiên quản trị" title="Khóa phiên quản trị" onClick={logoutAdminCookie}>
              <Icon name="logout" />
            </button>
          ) : null}

          <button type="button" className="icon-btn sm pressable" aria-label="Đóng" title="Đóng trang Quản trị" onClick={handleClose}>
            <Icon name="closeSm" />
          </button>
        </div>
      </header>

      <div className="adm-workspace">
        {/* Desktop left navigation rail */}
        <aside className="adm-rail" aria-label="Danh mục quản trị">
          {NAV_GROUPS.map((grp) => (
            <div key={grp.heading}>
              <div className="adm-rail-group">{grp.heading}</div>
              {grp.items.map((item) => {
                const badge = badgeOf(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`adm-rail-item ${tab === item.id ? 'on' : ''}`}
                    onClick={() => switchTab(item.id)}
                  >
                    <span className="ic"><Icon name={item.icon} /></span>
                    <span className="adm-rail-text">
                      <b>{item.label}</b>
                      <small>{item.sub}</small>
                    </span>
                    {badge ? <span className={`adm-mtab-badge ${badge.tone}`}>{badge.text}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}

          <div className="adm-rail-foot">
            <b><Icon name="shield" /> Bảo mật ẩn 404 đang bật</b>
            <span>{auth.via === 'password' ? 'Phiên mật khẩu chủ sở hữu' : (auth.via || '').replace('locket:', '')}</span>
          </div>
        </aside>

        {/* Mobile horizontal tab strip */}
        <div className="adm-mobile-tabs" role="tablist" aria-label="Mục quản trị">
          {ALL_TABS.map((item) => {
            const badge = badgeOf(item.id);
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={`adm-mtab ${tab === item.id ? 'on' : ''}`}
                onClick={() => switchTab(item.id)}
              >
                <Icon name={item.icon} />
                {item.label}
                {badge ? <span className={`adm-mtab-badge ${badge.tone}`}>{badge.text}</span> : null}
              </button>
            );
          })}
        </div>

        {/* Active module pane */}
        <main ref={mainRef} className="adm-main">
          {tab === 'overview' ? (
            <AdminOverview
              data={overview}
              loading={loadingOv}
              onNavigate={(targetTab, intent) => switchTab(targetTab, intent)}
            />
          ) : null}
          {tab === 'users' ? (
            <AdminUsers
              navIntent={userNavIntent}
              onChanged={() => loadOverview({ silent: true })}
            />
          ) : null}
          {tab === 'feedback' ? (
            <AdminFeedback
              onChanged={() => loadOverview({ silent: true })}
              onOpenUser={(uid) => switchTab('users', { focusUid: uid })}
            />
          ) : null}
          {tab === 'branding' ? (
            <AdminBranding
              onDirtyChange={setDirtyTab}
              onSaved={() => loadOverview({ silent: true })}
            />
          ) : null}
          {tab === 'features' ? (
            <AdminFeatures
              onDirtyChange={setDirtyTab}
              onSaved={() => loadOverview({ silent: true })}
            />
          ) : null}
          {tab === 'access' ? (
            <AdminAccess onChanged={() => loadOverview({ silent: true })} />
          ) : null}
          {tab === 'ops' ? (
            <AdminOps
              overview={overview}
              onRefreshOverview={() => loadOverview({ silent: true })}
            />
          ) : null}
        </main>
      </div>
    </div>
  );

  if (standalone) {
    return (
      <div className="admin-standalone" role="dialog" aria-label="Bảng điều khiển Quản trị">
        {inner}
      </div>
    );
  }

  return inner;
}
