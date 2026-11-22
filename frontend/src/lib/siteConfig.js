// Public site configuration loaded from /api/site-config (branding, banner, maintenance, feature flags).
import { api } from '../api.js';
import { createStore } from './createStore.js';

export const DEFAULT_SITE_CONFIG = {
  loaded: false,
  appName: 'Locket',
  tagline: 'Ảnh trực tiếp từ bạn bè, ngay trên màn hình chính',
  accentColor: '#ffc629',
  footerCredit: 'Ứng dụng web không chính thức. Thông tin đăng nhập chỉ được gửi tới máy chủ của bạn và không lưu trên trình duyệt.',
  announcement: {
    enabled: false,
    type: 'info',
    text: '',
    link: '',
    linkLabel: '',
  },
  maintenance: {
    enabled: false,
    message: 'Hệ thống đang bảo trì nâng cấp. Vui lòng quay lại sau ít phút nhé!',
  },
  features: {
    photobooth: true,
    boothVideo: true,
    smartCaptions: true,
    zipExport: true,
    chat: true,
  },
  inviteOnly: false,
};

export const siteConfigStore = createStore(DEFAULT_SITE_CONFIG);
export const useSiteConfig = (selector) => siteConfigStore.use(selector);

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function darkenHex(rgb, factor = 0.85) {
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * factor))));
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function applyAccentColor(hex) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const rgb = hexToRgb(hex);
  const props = [
    '--custom-gold',
    '--custom-gold-press',
    '--custom-gold-text-dark',
    '--custom-gold-text-light',
    '--custom-gold-soft-dark',
    '--custom-gold-soft-light',
    '--custom-on-gold',
  ];
  if (!rgb || hex.toLowerCase() === '#ffc629') {
    props.forEach((p) => root.style.removeProperty(p));
    return;
  }
  const [r, g, b] = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const onGold = lum > 0.62 ? '#111111' : '#ffffff';
  root.style.setProperty('--custom-gold', hex);
  root.style.setProperty('--custom-gold-press', darkenHex(rgb, 0.86));
  root.style.setProperty('--custom-gold-text-dark', hex);
  root.style.setProperty('--custom-gold-text-light', lum > 0.65 ? darkenHex(rgb, 0.64) : hex);
  root.style.setProperty('--custom-gold-soft-dark', `rgba(${r}, ${g}, ${b}, 0.17)`);
  root.style.setProperty('--custom-gold-soft-light', `rgba(${r}, ${g}, ${b}, 0.22)`);
  root.style.setProperty('--custom-on-gold', onGold);
}

export function applySiteConfig(raw) {
  if (!raw || typeof raw !== 'object') return;
  const prev = siteConfigStore.get();
  const next = {
    ...DEFAULT_SITE_CONFIG,
    ...prev,
    ...raw,
    loaded: true,
    announcement: { ...DEFAULT_SITE_CONFIG.announcement, ...(raw.announcement || {}) },
    maintenance: { ...DEFAULT_SITE_CONFIG.maintenance, ...(raw.maintenance || {}) },
    features: { ...DEFAULT_SITE_CONFIG.features, ...(raw.features || {}) },
  };
  siteConfigStore.set(next);
  applyAccentColor(next.accentColor);
}

export function getAppName() {
  return siteConfigStore.get().appName || 'Locket';
}

export async function loadSiteConfig() {
  try {
    const cfg = await api.siteConfig();
    applySiteConfig(cfg);
    return cfg;
  } catch {
    return siteConfigStore.get();
  }
}
