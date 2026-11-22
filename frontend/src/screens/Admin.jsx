// Owner Admin Dashboard shell — lazy-loaded chunk so normal users download 0 bytes of Admin code.
// Supports both pushed view inside the app (Sidebar/Profile) and standalone `/#admin` portal overlay.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from '../lib/icons.jsx';
import { useSiteConfig } from '../lib/siteConfig.js';
import { nav } from '../ui/nav.jsx';
import { Button } from '../ui/kit.jsx';
import { ui } from '../ui/overlays.jsx';
import { AdminOverview } from './admin/AdminOverview.jsx';
import { AdminUsers } from './admin/AdminUsers.jsx';
import { AdminBranding } from './admin/AdminBranding.jsx';
import { AdminAccess } from './admin/AdminAccess.jsx';
import { AdminOps } from './admin/AdminOps.jsx';
import '../styles/admin.css';

const TABS = [
  ['overview', 'Tổng quan', 'chart'],
  ['users', 'Người dùng', 'people'],
  ['branding', 'Thương hiệu', 'sparkles'],
  ['access', 'Truy cập', 'lock'],
  ['ops', 'Hệ thống', 'wrench'],
];

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

export function Admin({ view, standalone = false, onClose }) {
  const appName = useSiteConfig((s) => s.appName);
  const [auth, setAuth] = useState(null);       // null = loading
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [loadingOv, setLoadingOv] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoadingOv(true);
    try {
      const data = await api.admin.overview();
      setOverview(data);
    } catch (err) {
      if (err.status === 403 || err.status === 404) setAuth((a) => (a ? { ...a, isAdmin: false } : a));
      else ui.error(err.message);
    } finally {
      setLoadingOv(false);
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

  const handleClose = () => {
    if (standalone) onClose?.();
    else if (view?.id) nav.pop(view.id);
  };

  const logoutAdminCookie = async () => {
    try {
      await api.admin.logout();
      ui.info('Đã đăng xuất phiên mật khẩu quản trị');
      await checkAuth();
    } catch (err) {
      ui.error(err.message);
    }
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
    <>
      <header className="admin-head">
        <div className="admin-head-title">
          <span className="admin-head-badge"><Icon name="shield" /></span>
          <div>
            <h2>Quản trị · {appName}</h2>
            <small>{auth.via === 'password' ? 'Phiên mật khẩu chủ sở hữu' : `Tài khoản chủ sở hữu (${(auth.via || '').replace('locket:', '')})`}</small>
          </div>
        </div>
        <div className="admin-head-actions">
          <button
            type="button"
            className="icon-btn sm pressable"
            aria-label="Làm mới số liệu"
            title="Làm mới số liệu"
            onClick={loadOverview}
          >
            <Icon name="refresh" />
          </button>
          {auth.via === 'password' ? (
            <button
              type="button"
              className="icon-btn sm pressable"
              aria-label="Khóa phiên quản trị"
              title="Khóa phiên quản trị"
              onClick={logoutAdminCookie}
            >
              <Icon name="logout" />
            </button>
          ) : null}
          <button type="button" className="icon-btn sm pressable" aria-label="Đóng" title="Đóng" onClick={handleClose}>
            <Icon name="closeSm" />
          </button>
        </div>
      </header>

      <div className="admin-tabs-wrap">
        <div className="admin-tabs" role="tablist" aria-label="Mục quản trị">
          {TABS.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`admin-tab ${tab === id ? 'on' : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon name={icon} />{label}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-body">
        {tab === 'overview' ? <AdminOverview data={overview} loading={loadingOv} /> : null}
        {tab === 'users' ? <AdminUsers onChanged={loadOverview} /> : null}
        {tab === 'branding' ? <AdminBranding /> : null}
        {tab === 'access' ? <AdminAccess /> : null}
        {tab === 'ops' ? <AdminOps onRefreshOverview={loadOverview} /> : null}
      </div>
    </>
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
