// Routes between the sign-in page and the app shell (sidebar + home + pushed pages).
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import { appStore, resetApp } from './store.js';
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
const prefetchPages = () => Object.values(loaders).forEach((load) => load().catch(() => {}));
import { AppStatus, ErrorBoundary, OfflineScreen } from './components/AppStatus.jsx';

const SCREENS = { profile: Profile, settings: Settings, friends: FriendsPage, chat: ChatList, thread: ThreadPage, memories: Memories, friend: FriendProfile, notifications: Notifications };

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
              <View key={view.id} view={{ ...view, root }} under={underOf(i)}>
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

  const signOut = useCallback(() => {
    nav.closeAll();
    ui.closeAll();
    resetApp();
    setPhase('login');
  }, []);

  const start = useCallback((session) => {
    resetApp();
    appStore.set({ user: session.user });
    setPhase('app');
    (window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(prefetchPages);
    const params = new URLSearchParams(window.location.search);
    const target = SHORTCUTS[params.get('open')];
    if (params.has('open') || params.has('source')) window.history.replaceState(window.history.state, '', '/');
    if (target) setTimeout(() => nav.openRoot(target), 60);
  }, []);

  const checkSession = useCallback(() => api.session()
    .then((s) => (s.authenticated ? start(s) : setPhase('login')))
    .catch((err) => {
      if (err.status === 0) { setPhase('offline'); return; }   // installed app opened without network
      setPhase('login');
      ui.error('Không kết nối được máy chủ.', 3200);
    }), [start]);

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

  return (
    <div className="shell">
      {phase === 'offline' ? <OfflineScreen onRetry={retry} busy={retrying} /> : null}
      {phase === 'app' ? <Shell onSignOut={signOut} /> : phase === 'offline' ? null : (
        <div className="screen">
          <main id="app">
            {phase === 'login' ? <Login onAuthenticated={start} /> : null}
          </main>
        </div>
      )}
      <AppStatus banner={phase !== 'offline'} />
      <Overlays />
    </div>
  );
}
