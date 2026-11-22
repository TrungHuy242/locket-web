// Routes between the sign-in page and the app shell (sidebar + home + pushed pages).
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import { appStore, resetApp, useApp } from './store.js';
import { Icon } from './lib/icons.jsx';
import { loadSiteConfig, useSiteConfig } from './lib/siteConfig.js';
import { Overlays, ui } from './ui/overlays.jsx';
import { View, nav, useNav } from './ui/nav.jsx';
import { Login } from './screens/Login.jsx';
import { Home } from './screens/Home.jsx';
import { Sidebar } from './screens/Sidebar.jsx';
import { FriendProfile, FriendsPage } from './screens/Friends.jsx';

// Pages opened on demand are split into their own chunks so the first paint (camera + feed) loads less
// JavaScript; they are prefetched once the app is idle, so opening them stays instant.
const loaders = {
  chat: () => import('./screens/Chat.jsx'),
  profile: () => import('./screens/Profile.jsx'),
  memories: () => import('./screens/Memories.jsx'),
  notifications: () => import('./screens/Notifications.jsx'),
};
const page = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const ChatList = page(loaders.chat, 'ChatList');
const ThreadPage = page(loaders.chat, 'ThreadPage');
const Profile = page(loaders.profile, 'Profile');
const Settings = page(loaders.profile, 'Settings');
const Memories = page(loaders.memories, 'Memories');
const Notifications = page(loaders.notifications, 'Notifications');
// Admin is intentionally NOT in `loaders` so normal users download 0 bytes of Admin code.
const Admin = lazy(() => import('./screens/Admin.jsx').then((m) => ({ default: m.Admin })));
const prefetchPages = () => Object.values(loaders).forEach((load) => load().catch(() => {}));
import { AppStatus, ErrorBoundary, OfflineScreen } from './components/AppStatus.jsx';

const SCREENS = {
  profile: Profile,
  settings: Settings,
  friends: FriendsPage,
  chat: ChatList,
  thread: ThreadPage,
  memories: Memories,
  friend: FriendProfile,
  notifications: Notifications,
  admin: Admin,
};

function AnnouncementBanner() {
  const ann = useSiteConfig((s) => s.announcement);
  const [dismissedKey, setDismissedKey] = useState(() => {
    try { return sessionStorage.getItem('locket.dismissBanner') || ''; } catch { return ''; }
  });
  if (!ann?.enabled || !ann.text) return null;
  const sig = `${ann.type}|${ann.text}|${ann.link || ''}`;
  if (dismissedKey === sig) return null;
  const dismiss = () => {
    setDismissedKey(sig);
    try { sessionStorage.setItem('locket.dismissBanner', sig); } catch { /* ignore */ }
  };
  return (
    <div className={`site-banner ${ann.type || 'info'}`} role="status">
      <span className="site-banner-ic"><Icon name="megaphone" /></span>
      <span className="site-banner-text">{ann.text}</span>
      {ann.link ? (
        <a
          className="site-banner-link"
          href={ann.link}
          target={ann.link.startsWith('/') ? undefined : '_blank'}
          rel={ann.link.startsWith('/') ? undefined : 'noopener noreferrer'}
        >
          {ann.linkLabel || 'Xem thêm'}
        </a>
      ) : null}
      <button type="button" className="site-banner-x" aria-label="Đóng thông báo" onClick={dismiss}>
        <Icon name="closeSm" />
      </button>
    </div>
  );
}

function MaintenanceScreen({ onRetry }) {
  const appName = useSiteConfig((s) => s.appName);
  const message = useSiteConfig((s) => s.maintenance.message);
  return (
    <div className="maint-screen">
      <div className="maint-card">
        <div className="maint-ic"><Icon name="wrench" /></div>
        <h1>{appName} đang bảo trì</h1>
        <p>{message}</p>
        <button type="button" className="btn btn-primary" onClick={onRetry}>Kiểm tra lại</button>
      </div>
    </div>
  );
}

function Shell({ onSignOut }) {
  const stack = useNav();
  const live = stack.filter((v) => !v.closing);
  // the page directly under the top one slides back a little, like iOS
  const underOf = (i) => {
    const above = stack.slice(i + 1).find((v) => !v.closing);
    return above && above.from !== 'bottom' ? above.from : null;
  };
  const homeUnder = live.length && live[0].from !== 'bottom' ? live[0].from : null;
  return (
    <>
      <Sidebar />
      <div className="screen">
        <main id="app">
          <ErrorBoundary inline title="Không hiển thị được màn hình chính">
            <Home under={homeUnder} />
          </ErrorBoundary>
          {stack.map((view, i) => {
            const Screen = SCREENS[view.type];
            const root = stack.findIndex((v) => !v.closing) === i;
            return (
              <View key={view.id} view={{ ...view, root }} under={underOf(i)} className={view.type === 'admin' ? 'admin-view' : ''}>
                <ErrorBoundary inline onClose={() => nav.pop(view.id)}>
                  <Suspense fallback={<div className="empty page-loading"><span className="spinner" /></div>}>
                    <Screen view={view} onSignOut={onSignOut} />
                  </Suspense>
                </ErrorBoundary>
              </View>
            );
          })}
        </main>
      </div>
    </>
  );
}

// Sections a home-screen shortcut (manifest "shortcuts") may open: /?open=chat etc.
const SHORTCUTS = { chat: 'chat', notifications: 'notifications', memories: 'memories', friends: 'friends' };

export function App() {
  const [phase, setPhase] = useState('boot');   // boot | login | app | offline
  const [retrying, setRetrying] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const isAdmin = useApp((s) => s.isAdmin);
  const maintenanceOn = useSiteConfig((s) => s.maintenance.enabled);

  const closePortal = useCallback(() => {
    setPortalOpen(false);
    loadSiteConfig();
  }, []);

  // Only open the standalone portal if the server redirected here from the owner's hidden path
  // AND confirms a valid server-issued HttpOnly gate cookie (outsiders probing /?_gate=1 get 404).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('_gate') !== '1') return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    api.admin.authStatus().then(() => setPortalOpen(true)).catch(() => {});
  }, []);

  const signOut = useCallback(() => {
    nav.closeAll();
    ui.closeAll();
    resetApp();
    setPhase('login');
  }, []);

  const start = useCallback((session) => {
    resetApp({ clearCache: false });
    appStore.set({ user: session.user, isAdmin: !!session.isAdmin });
    setPhase('app');
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(prefetchPages);
    const params = new URLSearchParams(window.location.search);
    const target = SHORTCUTS[params.get('open')];
    if (params.has('open') || params.has('source')) window.history.replaceState(window.history.state, '', '/');
    if (target) setTimeout(() => nav.openRoot(target), 60);
  }, []);

  const checkSession = useCallback(async () => {
    let s;
    try {
      const [sessionRes] = await Promise.all([api.session(), loadSiteConfig()]);
      s = sessionRes;
    } catch (err) {
      if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) {
        setPhase('offline');
        return;
      }
      setPhase('login');
      ui.error('Không kết nối được máy chủ.', 3200);
      return;
    }
    if (s?.authenticated) {
      start(s);
    } else {
      setPhase('login');
      if (s?.banned) {
        ui.error(`Tài khoản đã bị hạn chế truy cập.${s.reason ? ` Lý do: ${s.reason}` : ''}`, 4500);
      }
    }
  }, [start]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try { await checkSession(); } finally { setRetrying(false); }
  }, [checkSession]);

  // the launch screen in index.html stays until we know where to go
  useEffect(() => {
    if (phase === 'boot') return;
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.add('out');
    setTimeout(() => boot.remove(), 400);
  }, [phase]);

  // offline launch: try again as soon as the network is back (the `online` event is not always fired,
  // e.g. when the server comes back rather than the network), when the app returns to the foreground,
  // and every 5 s meanwhile - /api/session is a tiny request
  useEffect(() => {
    if (phase !== 'offline') return undefined;
    const again = () => { if (navigator.onLine && !document.hidden) checkSession(); };
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', again);
    const t = setInterval(again, 5000);
    return () => { window.removeEventListener('online', again); document.removeEventListener('visibilitychange', again); clearInterval(t); };
  }, [phase, checkSession]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!appStore.get().user) return;
      signOut();
      ui.warning('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 3200);
    });
    checkSession();
  }, [signOut, checkSession]);

  const showMaintenance = maintenanceOn && phase === 'app' && !isAdmin && !portalOpen;

  return (
    <div className="shell">
      {phase === 'offline' ? <OfflineScreen onRetry={retry} busy={retrying} /> : null}
      {showMaintenance ? (
        <MaintenanceScreen onRetry={retry} />
      ) : phase === 'app' ? <Shell onSignOut={signOut} /> : phase === 'offline' ? null : (
        <div className="screen">
          <main id="app">
            {phase === 'login' ? <Login onAuthenticated={start} /> : null}
          </main>
        </div>
      )}
      {!portalOpen && !showMaintenance && phase !== 'offline' ? <AnnouncementBanner /> : null}
      {portalOpen ? (
        <ErrorBoundary inline title="Không mở được trang Quản trị" onClose={closePortal}>
          <Suspense fallback={<div className="admin-standalone"><div className="empty" style={{ marginTop: 80 }}><span className="spinner lg" /></div></div>}>
            <Admin standalone onClose={closePortal} />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      <AppStatus banner={phase !== 'offline'} />
      <Overlays />
    </div>
  );
}
