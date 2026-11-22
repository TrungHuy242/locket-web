// Saved recipient groups ("Close Friends" presets) stored locally per device.
import { createStore } from './createStore.js';

const KEY = 'locket.groups.v1';

function loadInitial() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (Array.isArray(raw)) {
      return raw.filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string' && Array.isArray(g.uids) && g.uids.length);
    }
  } catch { /* ignore */ }
  return [];
}

export const groupsStore = createStore({ list: loadInitial() });

function persist(list) {
  groupsStore.set({ list });
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function saveGroup(name, uids) {
  const clean = (name || '').trim().slice(0, 24);
  const uniq = [...new Set((uids || []).filter(Boolean))];
  if (!clean || !uniq.length) return null;
  const item = { id: `g${Date.now().toString(36)}`, name: clean, uids: uniq };
  const list = [...groupsStore.get().list.filter((g) => g.name.toLowerCase() !== clean.toLowerCase()), item].slice(-8);
  persist(list);
  return item;
}

export function deleteGroup(id) {
  persist(groupsStore.get().list.filter((g) => g.id !== id));
}

export const useGroups = () => groupsStore.use((s) => s.list);
