// Device-local preferences. Nothing sensitive is ever put in localStorage.
import { createStore } from './createStore.js';

const KEY = 'locket.settings.v1';
const DEFAULTS = { mirrorFront: true, saveAfterSend: false, ghostRead: false, notifications: true, recordAudio: false, theme: 'system' };

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* storage unavailable */ }

export const settingsStore = createStore({ ...DEFAULTS, ...saved });

export function setSetting(key, value) {
  settingsStore.set({ [key]: value });
  try { localStorage.setItem(KEY, JSON.stringify(settingsStore.get())); } catch { /* ignore */ }
}

export const getSettings = () => settingsStore.get();

// Appearance: 'system' follows the OS (prefers-color-scheme), or force 'light' / 'dark'.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
export function applyTheme() {
  const pref = settingsStore.get().theme;
  const theme = pref === 'light' || pref === 'dark' ? pref : (darkQuery.matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
  // status bar / browser chrome colour
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f2f2f7' : '#000000');
}
darkQuery.addEventListener?.('change', () => { if (settingsStore.get().theme === 'system') applyTheme(); });
settingsStore.subscribe(applyTheme);
export const useSettings = () => settingsStore.use();
