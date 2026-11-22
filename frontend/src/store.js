// Account-wide data shared by several screens: who I am, my friends, unread messages, navigation.
import { api } from './api.js';
import { createStore } from './lib/createStore.js';
import { getSettings } from './lib/settings.js';
import { getAppName, siteConfigStore } from './lib/siteConfig.js';
import { ui } from './ui/overlays.jsx';

export const QUICK_EMOJI = ['💛', '🔥', '😍'];
export const EMOJI_PALETTE = ['💛', '💖', '🥰', '😂', '🔥', '💋', '🫶', '❤️', '😍', '💕', '🥺', '😮', '😢', '👏', '🎉'];

const FEED_CACHE_KEY = 'locket.feedCache.v1';

export function readFeedCache(uid) {
  if (!uid) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(FEED_CACHE_KEY) || 'null');
    if (raw && raw.uid === uid && Array.isArray(raw.moments) && raw.moments.length) {
      return { moments: raw.moments.slice(0, 30), total: Number(raw.total) || raw.moments.length };
    }
  } catch { /* ignore */ }
  return null;
}

export function writeFeedCache(uid, moments, total) {
  if (!uid || !Array.isArray(moments)) return;
  try {
    localStorage.setItem(FEED_CACHE_KEY, JSON.stringify({
      uid,
      total: Number(total) || moments.length,
      moments: moments.slice(0, 30),
      savedAt: Date.now(),
    }));
  } catch { /* quota / private mode */ }
}

export function clearFeedCache() {
  try { localStorage.removeItem(FEED_CACHE_KEY); } catch { /* ignore */ }
}

// Per-peer unsent chat drafts kept in memory for the current session
const chatDrafts = new Map();
export const getChatDraft = (uid) => (uid ? chatDrafts.get(uid) || '' : '');
export const setChatDraft = (uid, text) => {
  if (!uid) return;
  if (text) chatDrafts.set(uid, text);
  else chatDrafts.delete(uid);
};

// Background desktop/browser notifications when tab is hidden
let lastMsgAlertAt = 0;
let msgAlertPrimed = false;
let lastNotifAlertId = null;
let notifAlertPrimed = false;

function fireBrowserAlert(title, body, tag) {
  if (typeof document === 'undefined' || !document.hidden) return;
  if (!getSettings().browserAlerts) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/icons/icon-192.png' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* ignore */ }
}

export const appStore = createStore({
  user: null,
  isAdmin: false,
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  friendsLoaded: false,
  conversations: null,    // cached conversation list for instant Chat tab switch (SWR)
  memoriesCache: null,    // cached first page of unfiltered Memories (SWR)
  unread: 0,
  notifications: null,    // last list from /api/notifications
  notifUnread: 0,
  notifError: null,
  homeView: 'camera',     // 'camera' | 'feed' (which part of the home pager is on screen)
});

// Sync unread count + custom appName into the browser tab title: "(3) Huy's Locket"
if (typeof document !== 'undefined') {
  const syncTitle = () => {
    const s = appStore.get();
    const appName = getAppName();
    const total = (s.unread || 0) + (s.notifUnread || 0);
    document.title = s.user && total > 0 ? `(${total > 99 ? '99+' : total}) ${appName}` : appName;
  };
  appStore.subscribe(syncTitle);
  siteConfigStore.subscribe(syncTitle);
}

export const useApp = (selector) => appStore.use(selector);

export async function loadFriends() {
  try {
    const data = await api.friends();
    appStore.set({ friends: data.friends, incoming: data.incoming, outgoing: data.outgoing, blocked: data.blocked || [], friendsLoaded: true });
  } catch (err) {
    if (err.status !== 401) ui.error(err.message);
  }
}

// My own profile, re-read so a name / avatar changed in the iPhone app reaches the web without signing in again.
export async function refreshMe() {
  try {
    const user = await api.me();
    if (user && appStore.get().user) appStore.set({ user });
  } catch { /* keep the profile we have */ }
}

export async function loadUnread() {
  try {
    const { conversations } = await api.conversations();
    const newestUnread = conversations.find((c) => c.unread > 0 && !c.lastMine);
    if (msgAlertPrimed && newestUnread && newestUnread.lastAt > lastMsgAlertAt) {
      lastMsgAlertAt = newestUnread.lastAt;
      fireBrowserAlert(newestUnread.peer?.name || 'Tin nhắn mới', newestUnread.lastText || 'Đã gửi một khoảnh khắc', `msg-${newestUnread.id}`);
    } else if (!msgAlertPrimed) {
      msgAlertPrimed = true;
      lastMsgAlertAt = newestUnread?.lastAt || Date.now();
    }
    appStore.set({
      conversations,
      unread: conversations.reduce((sum, c) => sum + (c.unread || 0), 0),
    });
    return conversations;
  } catch {
    return null;
  }
}

// Notifications are rebuilt by the server from real Locket events; it answers from its cache and
// refreshes in the background, so polling this is cheap. When the server is still doing its first
// cold build (`loading: true`), follow up shortly so the badge & list appear without manual reload.
let notifSeq = 0;
let notifRetryTimer = 0;
export async function loadNotifications({ refresh = false, _attempt = 0 } = {}) {
  clearTimeout(notifRetryTimer);
  notifRetryTimer = 0;
  const seq = ++notifSeq;
  try {
    const data = await api.notifications(refresh);
    if (seq === notifSeq) {
      const topUnread = data?.notifications?.find((n) => n.unread);
      if (notifAlertPrimed && topUnread && topUnread.id !== lastNotifAlertId) {
        lastNotifAlertId = topUnread.id;
        const name = topUnread.user?.name || 'Bạn bè';
        const body = topUnread.type === 'reaction' ? `${name} đã thả ${topUnread.emoji} vào khoảnh khắc của bạn`
          : topUnread.type === 'comment' ? `${name} trả lời: ${topUnread.text}`
            : topUnread.type === 'friend_request' ? `${name} muốn kết bạn với bạn`
              : `${name} có hoạt động mới trên Locket`;
        fireBrowserAlert('Locket', body, `notif-${topUnread.id}`);
      } else if (!notifAlertPrimed && !data?.loading) {
        notifAlertPrimed = true;
        lastNotifAlertId = topUnread?.id || null;
      }
      appStore.set({ notifications: data, notifUnread: data.unread, notifError: null });
      if (data?.loading && _attempt < 8 && appStore.get().user) {
        notifRetryTimer = setTimeout(() => {
          if (seq === notifSeq && appStore.get().user) {
            loadNotifications({ refresh: false, _attempt: _attempt + 1 });
          }
        }, 3500);
      }
    }
    return data;
  } catch (err) {
    if (err.status !== 401 && seq === notifSeq) appStore.set({ notifError: err.message });
    return null;
  }
}

// Mark one, several or all notifications read: the UI updates at once, the server confirms.
export async function markNotificationsRead(ids, all = false) {
  clearTimeout(notifRetryTimer);
  notifRetryTimer = 0;
  const wanted = new Set(ids || []);
  appStore.set((s) => {
    if (!s.notifications) return {};
    const list = s.notifications.notifications.map((n) => (all || wanted.has(n.id) ? { ...n, unread: false } : n));
    const unread = list.filter((n) => n.unread).length;
    return { notifications: { ...s.notifications, notifications: list, unread }, notifUnread: unread };
  });
  ++notifSeq;                                  // a poll already in flight must not bring old flags back
  try {
    const data = await api.markNotifications(ids, all);
    appStore.set({ notifications: data, notifUnread: data.unread });
  } catch (err) {
    if (err.status !== 401) ui.error(`Không lưu được trạng thái đã đọc: ${err.message}`);
    loadNotifications();
  }
}

export function resetApp({ clearCache = true } = {}) {
  clearTimeout(notifRetryTimer);
  notifRetryTimer = 0;
  ++notifSeq;
  msgAlertPrimed = false;
  notifAlertPrimed = false;
  lastMsgAlertAt = 0;
  lastNotifAlertId = null;
  chatDrafts.clear();
  if (clearCache) clearFeedCache();
  appStore.set({
    user: null, isAdmin: false, friends: [], incoming: [], outgoing: [], blocked: [], friendsLoaded: false,
    conversations: null, memoriesCache: null, unread: 0,
    notifications: null, notifUnread: 0, notifError: null, homeView: 'camera',
  });
}

// Remove someone from every relationship list right away; loadFriends() then confirms with Locket.
export function dropRelation(uid) {
  appStore.set((st) => ({
    friends: st.friends.filter((u) => u.uid !== uid), incoming: st.incoming.filter((u) => u.uid !== uid),
    outgoing: st.outgoing.filter((u) => u.uid !== uid), blocked: st.blocked.filter((u) => u.uid !== uid),
  }));
}

// Accent-insensitive text for searching names ("tuan" finds "Tuấn").
export const fold = (text) => (text || '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '');
