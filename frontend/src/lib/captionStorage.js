// Local persistence for Smart Captions: recent/favorite tracks, pinned/recent places,
// last weather location, remembered zodiac sign, and custom user-saved caption presets.

const KEYS = {
  recentMusic: 'locket.recent.music.v1',
  favMusic: 'locket.fav.music.v1',
  recentPlaces: 'locket.recent.places.v1',
  pinnedPlaces: 'locket.pinned.places.v1',
  lastWeather: 'locket.last.weather.v1',
  customPresets: 'locket.custom.presets.v1',
  zodiac: 'locket.zodiac.v1',
};

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore private mode */ }
}

/* ---------------- Music */
export const loadRecentMusic = () => (Array.isArray(read(KEYS.recentMusic, [])) ? read(KEYS.recentMusic, []).slice(0, 8) : []);
export function saveRecentMusic(track) {
  if (!track?.title) return loadRecentMusic();
  const key = `${track.title}|${track.artist || ''}`.toLowerCase();
  const next = [track, ...loadRecentMusic().filter((t) => `${t.title}|${t.artist || ''}`.toLowerCase() !== key)].slice(0, 8);
  write(KEYS.recentMusic, next);
  return next;
}

export const loadFavMusic = () => (Array.isArray(read(KEYS.favMusic, [])) ? read(KEYS.favMusic, []).slice(0, 16) : []);
export function toggleFavMusic(track) {
  if (!track?.title) return loadFavMusic();
  const key = `${track.title}|${track.artist || ''}`.toLowerCase();
  const cur = loadFavMusic();
  const exists = cur.some((t) => `${t.title}|${t.artist || ''}`.toLowerCase() === key);
  const next = exists ? cur.filter((t) => `${t.title}|${t.artist || ''}`.toLowerCase() !== key) : [track, ...cur].slice(0, 16);
  write(KEYS.favMusic, next);
  return next;
}

/* ---------------- Places */
export const loadRecentPlaces = () => (Array.isArray(read(KEYS.recentPlaces, [])) ? read(KEYS.recentPlaces, []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 6) : []);
export function saveRecentPlace(name) {
  const clean = (name || '').trim();
  if (!clean) return loadRecentPlaces();
  const next = [clean, ...loadRecentPlaces().filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
  write(KEYS.recentPlaces, next);
  return next;
}

export const loadPinnedPlaces = () => (Array.isArray(read(KEYS.pinnedPlaces, [])) ? read(KEYS.pinnedPlaces, []).filter((x) => typeof x === 'string' && x.trim()).slice(0, 8) : []);
export function togglePinnedPlace(name) {
  const clean = (name || '').trim();
  if (!clean) return loadPinnedPlaces();
  const cur = loadPinnedPlaces();
  const exists = cur.some((x) => x.toLowerCase() === clean.toLowerCase());
  const next = exists ? cur.filter((x) => x.toLowerCase() !== clean.toLowerCase()) : [clean, ...cur].slice(0, 8);
  write(KEYS.pinnedPlaces, next);
  return next;
}

/* ---------------- Weather */
export const loadLastWeather = () => read(KEYS.lastWeather, null);
export const saveLastWeather = (loc) => { if (loc) write(KEYS.lastWeather, loc); };

/* ---------------- Zodiac */
export const loadZodiac = () => read(KEYS.zodiac, null);
export const saveZodiac = (id) => write(KEYS.zodiac, id);

/* ---------------- Custom Saved Presets */
export const loadCustomPresets = () => (Array.isArray(read(KEYS.customPresets, [])) ? read(KEYS.customPresets, []).slice(0, 20) : []);
export function saveCustomPreset(entry) {
  const cur = loadCustomPresets();
  const item = { id: `cp_${Date.now().toString(36)}`, ...entry };
  const next = [item, ...cur].slice(0, 20);
  write(KEYS.customPresets, next);
  return next;
}
export function deleteCustomPreset(id) {
  const next = loadCustomPresets().filter((x) => x.id !== id);
  write(KEYS.customPresets, next);
  return next;
}
