import { reportNetwork } from './lib/pwa.js';

// All network access goes through the same-origin backend. The browser never sees
// Locket/Firebase credentials: auth is an HttpOnly session cookie set by the server.

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body || {};
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, path, body, { quiet401 = false } = {}) {
  const init = { method, credentials: 'same-origin', headers: { 'X-Locket-Client': 'web' } };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    reportNetwork(false);
    throw new ApiError(navigator.onLine ? 'Mất kết nối tới máy chủ.' : 'Không có kết nối mạng.', 0);
  }
  reportNetwork(true);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && !quiet401) onUnauthorized();
    throw new ApiError(data?.error || `Lỗi ${res.status}`, res.status, data);
  }
  return data;
}

// Multipart upload with progress (fetch cannot report upload progress). Same errors as request().
function upload(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Locket-Client', 'web');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.upload.onload = () => onProgress?.(1);
    xhr.onerror = () => {
      reportNetwork(false);
      reject(new ApiError(navigator.onLine ? 'Mất kết nối tới máy chủ.' : 'Không có kết nối mạng.', 0));
    };
    xhr.onload = () => {
      reportNetwork(true);
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* empty body */ }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data); return; }
      if (xhr.status === 401) onUnauthorized();
      reject(new ApiError(data?.error || `Lỗi ${xhr.status}`, xhr.status, data));
    };
    xhr.send(form);
  });
}

const enc = encodeURIComponent;

export const api = {
  session: () => request('GET', '/api/session'),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }, { quiet401: true }),
  logout: () => request('POST', '/api/auth/logout'),

  me: () => request('GET', '/api/me'),
  updateName: (firstName, lastName) => request('PATCH', '/api/me', { firstName, lastName }),
  updateAvatar: (blob) => {
    const form = new FormData();
    form.append('image', blob, 'avatar.jpg');
    return request('POST', '/api/me/avatar', form);
  },
  setNotifications: (enabled) => request('POST', '/api/me/notifications', { enabled }),

  captions: () => request('GET', '/api/captions'),
  feed: ({ before, limit = 30, refresh = false } = {}) => request('GET',
    `/api/feed?limit=${limit}${before ? `&before=${enc(before)}` : ''}${refresh ? '&refresh=true' : ''}`),
  memories: ({ before, limit = 60, kind = 'all', author, q, year, month } = {}) => {
    const params = new URLSearchParams({ limit: String(limit), kind, tz: String(-new Date().getTimezoneOffset()) });
    if (before) params.set('before', before);
    if (author) params.set('author', author);
    if (q) params.set('q', q);
    if (year) params.set('year', String(year));
    if (year && month) params.set('month', String(month));
    return request('GET', `/api/memories?${params}`);
  },
  postMoment: ({ image, video, caption, preset, recipients, isPrivate = false, videoMirror = false, videoStart = 0, videoLength = 0, onProgress }) => {
    const form = new FormData();
    if (image) form.append('image', image, 'moment.jpg');
    if (video) {
      const ext = video.type.includes('mp4') ? 'mp4' : video.type.includes('quicktime') ? 'mov' : 'webm';
      form.append('video', video, `moment.${ext}`);
      form.append('video_mirror', videoMirror ? 'true' : 'false');
      form.append('video_start', String(Math.max(0, videoStart || 0)));
      form.append('video_length', String(Math.max(0, videoLength || 0)));
    }
    form.append('caption', caption || '');
    form.append('preset', preset || '');
    form.append('recipients', JSON.stringify(recipients || []));
    form.append('private', isPrivate ? 'true' : 'false');
    return upload('/api/moments', form, onProgress);
  },
  deleteMoment: (id) => request('DELETE', `/api/moments/${enc(id)}`),
  react: (id, emoji) => request('POST', `/api/moments/${enc(id)}/react`, { emoji }),
  markViewed: (id) => request('POST', `/api/moments/${enc(id)}/view`),
  activity: (id) => request('GET', `/api/moments/${enc(id)}/activity`),
  moment: (id) => request('GET', `/api/moments/${enc(id)}`),
  notifications: (refresh = false) => request('GET', `/api/notifications${refresh ? '?refresh=true' : ''}`),
  markNotifications: (ids, all = false) => request('POST', '/api/notifications/read', { ids: ids || [], all }),
  comments: (id) => request('GET', `/api/moments/${enc(id)}/comments`),
  addComment: (id, text, to) => request('POST', `/api/moments/${enc(id)}/comments`, { text, to: to || null }),

  friends: () => request('GET', '/api/friends'),
  lookup: (username) => request('GET', `/api/friends/lookup?username=${enc(username)}`),
  sendRequest: (uid) => request('POST', '/api/friends/requests', { uid }),
  acceptRequest: (uid) => request('POST', `/api/friends/${enc(uid)}/accept`),
  removeFriend: (uid) => request('DELETE', `/api/friends/${enc(uid)}`),
  block: (uid) => request('POST', `/api/friends/${enc(uid)}/block`),
  unblock: (uid) => request('POST', `/api/friends/${enc(uid)}/unblock`),
  declineRequest: (uid) => request('POST', `/api/friends/${enc(uid)}/decline`),
  cancelRequest: (uid) => request('POST', `/api/friends/${enc(uid)}/cancel`),
  friendProfile: (uid) => request('GET', `/api/friends/${enc(uid)}/profile`),

  conversations: () => request('GET', '/api/conversations'),
  messages: (peerUid, limit = 50, before) => request('GET', `/api/chats/${enc(peerUid)}?limit=${limit}${before ? `&before=${before}` : ''}`),
  sendMessage: (peerUid, text, momentId) => request('POST', `/api/chats/${enc(peerUid)}`, { text, momentId: momentId || null }),
  markRead: (peerUid, conversationId, receipt) => request('POST', `/api/chats/${enc(peerUid)}/read`, { conversationId, receipt }),
  reactMessage: (cid, mid, emoji) => request('PUT', `/api/conversations/${enc(cid)}/messages/${enc(mid)}/reaction`, { emoji }),
  deleteMessage: (cid, mid) => request('DELETE', `/api/conversations/${enc(cid)}/messages/${enc(mid)}`),
};
