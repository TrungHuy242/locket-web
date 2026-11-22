// Photobooth settings the camera needs before the editor is loaded: layouts, photo aspects, default
// options and the saved style. Kept apart from lib/photobooth.js (the renderer) and screens/Photobooth.jsx
// (the editor) so those load only when a photobooth is opened.

const OPTS_KEY = 'locket.booth.style.v3';

export const LAYOUTS = [
  { id: 'grid', name: 'Lưới Full', cols: 2, squareNative: true },
  { id: 'editorial', name: 'Tạp chí', cols: 2, squareNative: true },
  { id: 'polaroid', name: 'Polaroid', cols: 2, squareNative: true },
  { id: 'split', name: 'Chia ngang', cols: 1, squareNative: true },
  { id: 'strip', name: 'Dải dọc', cols: 1 },
  { id: 'double', name: 'Dải đôi', cols: 1, twin: true },
  { id: 'row', name: 'Dải ngang', cols: 0 },
];

export const BACKDROPS = [
  { id: 'theme', name: 'Theo khung' },
  { id: 'blur', name: 'Nền ảnh mờ' },
  { id: 'solid', name: 'Màu trơn' },
];

export const ASPECTS = [
  { id: '1:1', name: 'Vuông 1:1', ratio: 1 },
  { id: '3:4', name: 'Dọc 3:4', ratio: 3 / 4 },
  { id: '4:3', name: 'Ngang 4:3', ratio: 4 / 3 },
];

export const DATE_FORMATS = [
  { id: 'dot', name: '19.11.2026' },
  { id: 'film', name: "'26 11 19" },
  { id: 'time', name: '19.11.2026 21:05' },
];

export const DATE_POSITIONS = [
  { id: 'footer', name: 'Cùng chữ' },
  { id: 'photo', name: 'Trên ảnh (film)' },
  { id: 'header', name: 'Đầu khung' },
];

export const isSquareNative = (layoutId) => !!LAYOUTS.find((l) => l.id === layoutId)?.squareNative;

// null = use the template's value
export function defaultOptions() {
  return {
    outputMode: 'locket',   // 'locket' (1:1 feed) | 'print' (original printable ratio)
    layout: 'grid',
    aspect: '1:1',
    template: 'puppy',
    bg: null,
    texture: null,
    gap: null,
    border: 'template',
    radius: null,
    text: null,
    font: null,
    textColor: null,
    showDate: true,
    dateFormat: 'dot',
    datePos: 'footer',
    captionSafe: true,
    backdrop: 'theme',
    twinFan: true,
    adjust: { brightness: 0, contrast: 0, warmth: 0 },
    stickers: [],
    decorDetached: false,
  };
}

export function loadStyle(defaults) {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTS_KEY) || '{}');
    return { ...defaults, ...raw, adjust: { ...defaults.adjust, ...(raw.adjust || {}) } };
  } catch {
    return defaults;
  }
}
export function saveStyle(opts) {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)); } catch { /* private mode */ }
}
