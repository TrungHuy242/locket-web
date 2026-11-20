// Account-wide data shared by several screens: who I am, my friends, unread messages, navigation.
import { api } from './api.js';
import { createStore } from './lib/createStore.js';
import { ui } from './ui/overlays.jsx';

export const QUICK_EMOJI = ['💛', '🔥', '😍'];
export const EMOJI_PALETTE = ['💛', '💖', '🥰', '😂', '🔥', '💋', '🫶', '❤️', '😍', '💕', '🥺', '😮', '😢', '👏', '🎉'];

export const appStore = createStore({
  user: null,
  friends: [],
  incoming: [],
  outgoing: [],
  blocked: [],
  friendsLoaded: false,
  unread: 0,
  notifications: null,    // last list from /api/notifications
  notifUnread: 0,
  notifError: null,
  homeView: 'camera',     // 'camera' | 'feed' (which part of the home pager is on screen)
});

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
    appStore.set({ unread: conversations.reduce((sum, c) => sum + (c.unread || 0), 0) });
    return conversations;
  } catch {
    return null;
  }
}

// Notifications are rebuilt by the server from real Locket events; it answers from its cache and
// refreshes in the background, so polling this is cheap.
let notifSeq = 0;
export async function loadNotifications({ refresh = false } = {}) {
  const seq = ++notifSeq;
  try {
    const data = await api.notifications(refresh);
    if (seq === notifSeq) appStore.set({ notifications: data, notifUnread: data.unread, notifError: null });
    return data;
  } catch (err) {
    if (err.status !== 401 && seq === notifSeq) appStore.set({ notifError: err.message });
    return null;
  }
}

// Mark one, several or all notifications read: the UI updates at once, the server confirms.
export async function markNotificationsRead(ids, all = false) {
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

export function resetApp() {
  appStore.set({ user: null, friends: [], incoming: [], outgoing: [], blocked: [], friendsLoaded: false, unread: 0,
    notifications: null, notifUnread: 0, notifError: null, homeView: 'camera' });
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
