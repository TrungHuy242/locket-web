// SVG icons (static markup, never user data), rendered through <Icon name="..." />.
const svg = (body, size = 24, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const ICONS = {
  people: svg('<circle cx="9" cy="8" r="3.4" fill="currentColor" stroke="none"/><path d="M2.500 19.500c0-3.400 2.900-5.700 6.500-5.700s6.500 2.300 6.500 5.700z" fill="currentColor" stroke="none"/><circle cx="17.300" cy="8.800" r="2.700" fill="currentColor" stroke="none"/><path d="M17 13.600c3 0 5 1.900 5 4.900h-4.300c-.2-1.900-1-3.500-2.400-4.600.5-.2 1.100-.3 1.700-.3z" fill="currentColor" stroke="none"/>', 22),
  chat: svg('<path d="M12 3.500c5 0 9 3.500 9 7.900s-4 7.900-9 7.900c-.9 0-1.800-.1-2.600-.3L5 20.800l.9-3.500C4.100 15.800 3 13.700 3 11.400c0-4.400 4-7.900 9-7.900z" fill="currentColor" stroke="none"/>'),
  chevDown: svg('<path d="m6 9 6 6 6-6"/>', 20, 'stroke-width="2.8"'),
  chevLeft: svg('<path d="m15 5-7 7 7 7"/>', 26, 'stroke-width="2.6"'),
  chevRight: svg('<path d="m9 5 7 7-7 7"/>', 18, 'stroke-width="2.6"'),
  bolt: svg('<path d="M13.500 2 5 13.500h6L10 22l9-12h-6z" fill="currentColor" stroke="none"/>', 20),
  boltOff: svg('<path d="M13.500 2 5 13.500h6L10 22l9-12h-6z"/>', 20, 'stroke-width="1.8"'),
  flip: svg('<path d="M20 11a8 8 0 0 0-14.300-4.500L4 8.500"/><path d="M4 4v4.500h4.500"/><path d="M4 13a8 8 0 0 0 14.300 4.500l1.700-2"/><path d="M20 20v-4.500h-4.500"/>', 34),
  gallery: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="8.500" cy="8.500" r="1.600" fill="currentColor"/><path d="m4 17 5-5 4 4 2.500-2.500L20 18"/>', 32),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>', 30, 'stroke-width="2.6"'),
  closeSm: svg('<path d="M6 6l12 12M18 6 6 18"/>', 18, 'stroke-width="2.8"'),
  send: svg('<path d="M21.500 3 10.400 13.600M21.500 3l-6.700 18-4.400-7.400L3 9.200z" fill="currentColor" stroke-width="1.6"/>', 36),
  textStyle: svg('<path d="M3 18 8 6l5 12M4.800 14h6.400"/><path d="M21 18v-7M21 14.500a3 3 0 1 1-3-3.300c1.700 0 3 1.300 3 3.300z"/>', 32),
  download: svg('<path d="M12 4v11M7.500 11l4.500 4.500 4.500-4.500M5 20h14"/>', 22),
  grid: svg('<rect x="3.500" y="3.500" width="7" height="7" rx="2"/><rect x="13.500" y="3.500" width="7" height="7" rx="2"/><rect x="3.500" y="13.500" width="7" height="7" rx="2"/><rect x="13.500" y="13.500" width="7" height="7" rx="2"/>', 30),
  share: svg('<path d="M12 15V3.500M7.500 7.500 12 3l4.500 4.500M5 12v6a2.500 2.500 0 0 0 2.500 2.500h9A2.500 2.500 0 0 0 19 18v-6"/>', 28),
  search: svg('<circle cx="11" cy="11" r="6.500"/><path d="m20 20-4-4"/>', 20, 'stroke-width="2.6"'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 18, 'stroke-width="3"'),
  check: svg('<path d="m5 12.500 4.500 4.500L19 7.500"/>', 20, 'stroke-width="3"'),
  checkBig: svg('<path d="m5 12.500 4.500 4.500L19 7.500"/>', 38, 'stroke-width="2.6"'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.400 13.500a7.600 7.600 0 0 0 0-3l2-1.500-2-3.500-2.400 1a7.600 7.600 0 0 0-2.600-1.500L14 2.500h-4L9.600 5A7.600 7.600 0 0 0 7 6.500l-2.400-1-2 3.500 2 1.500a7.600 7.600 0 0 0 0 3l-2 1.500 2 3.500 2.400-1a7.600 7.600 0 0 0 2.600 1.500l.4 2.500h4l.4-2.500a7.600 7.600 0 0 0 2.600-1.500l2.400 1 2-3.500z"/>', 22, 'stroke-width="1.9"'),
  pencil: svg('<path d="M4 20h4L19.500 8.500a2.800 2.800 0 0 0-4-4L4 16z"/>', 16),
  link: svg('<path d="M10 14a4.500 4.500 0 0 0 6.400 0l3-3a4.500 4.500 0 0 0-6.400-6.400l-1 1"/><path d="M14 10a4.500 4.500 0 0 0-6.400 0l-3 3a4.500 4.500 0 0 0 6.400 6.400l1-1"/>', 22),
  bell: svg('<path d="M6 16.500V11a6 6 0 1 1 12 0v5.500l1.500 2h-15zM10 20.500a2 2 0 0 0 4 0"/>', 18),
  eyeOff: svg('<path d="M3 3l18 18M10.500 6.200A9.800 9.800 0 0 1 12 6c5 0 8.500 4 9.500 6a13 13 0 0 1-2.600 3.400M6.300 7.700A13.400 13.400 0 0 0 2.500 12c1 2 4.500 6 9.500 6 1.300 0 2.500-.3 3.600-.7"/>', 18),
  camera: svg('<path d="M4 8h3l1.500-2.500h7L17 8h3a1.500 1.500 0 0 1 1.500 1.500v8A1.500 1.500 0 0 1 20 19H4a1.500 1.500 0 0 1-1.500-1.500v-8A1.500 1.500 0 0 1 4 8z"/><circle cx="12" cy="13" r="3.300"/>', 18),
  logout: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h9"/>', 18),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 20.500c0-4 3.600-6.500 8-6.500s8 2.500 8 6.500"/>', 18),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7.500 8 6 8-6"/>', 18),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.1"/>', 18),
  emojiAdd: svg('<circle cx="11" cy="13" r="8"/><path d="M8 15c.8 1 1.800 1.500 3 1.500s2.200-.5 3-1.500M8.500 10.500v.1M13.500 10.500v.1M20 2v6M17 5h6"/>', 24, 'stroke-width="2"'),
  arrowUp: svg('<path d="M12 19V5M5.500 11.500 12 5l6.500 6.500"/>', 20, 'stroke-width="3"'),
  arrowDown: svg('<path d="M12 5v14M5.500 12.500 12 19l6.500-6.500"/>', 20, 'stroke-width="3"'),
  play: svg('<path d="M8 5.500v13l11-6.500z" fill="currentColor" stroke="none"/>', 12),
  arrowRight: svg('<path d="M5 12h14M12.500 5.500 19 12l-6.500 6.500"/>', 22, 'stroke-width="2.8"'),
  sound: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500zM16 9a4 4 0 0 1 0 6M18.500 6.500a7.500 7.500 0 0 1 0 11"/>', 18),
  mute: svg('<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500zM16.500 9.500l5 5M21.500 9.500l-5 5"/>', 18),
  heart: svg('<path d="M12 20.500c-.4 0-.8-.1-1.100-.4C6.800 16.600 3 13.400 3 9.300 3 6.300 5.300 4 8.200 4c1.500 0 2.800.6 3.800 1.700C13 4.600 14.300 4 15.800 4 18.700 4 21 6.300 21 9.300c0 4.100-3.800 7.300-7.900 10.800-.3.300-.7.400-1.100.4z" fill="currentColor" stroke="none"/>', 26),
  messenger: svg('<path d="M12 3c5 0 9 3.700 9 8.400s-4 8.400-9 8.400c-.9 0-1.800-.1-2.600-.4L6 21v-3.200c-1.900-1.500-3-3.800-3-6.400C3 6.700 7 3 12 3z"/><path d="m7.500 13.500 3-3.300 2.500 2 3.500-2.700-3 3.500-2.500-2z" fill="currentColor"/>', 26, 'stroke-width="1.8"'),
  copy: svg('<rect x="8.500" y="8.500" width="12" height="12" rx="3"/><path d="M15.500 8.500V6a2.500 2.500 0 0 0-2.500-2.500H6A2.500 2.500 0 0 0 3.500 6v7A2.500 2.500 0 0 0 6 15.500h2.500"/>', 24, 'stroke-width="2"'),
  sms: svg('<path d="M12 4c5 0 9 3.300 9 7.500S17 19 12 19c-.9 0-1.700-.1-2.500-.3L5.500 20.500l.8-3.300C4.300 15.800 3 13.800 3 11.500 3 7.300 7 4 12 4z"/>', 26, 'stroke-width="2"'),
  trash: svg('<path d="M4 7h16M9.500 7V4.500h5V7M6.500 7l1 12.500h9l1-12.500"/>', 18),
  filters: svg('<circle cx="9" cy="9.500" r="5"/><circle cx="15" cy="9.500" r="5"/><circle cx="12" cy="14.500" r="5"/>', 22),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.500v2M12 19.500v2M4.600 4.600l1.400 1.400M18 18l1.400 1.400M2.500 12h2M19.500 12h2M4.600 19.400L6 18M18 6l1.400-1.400"/>', 20),
  warning: svg('<path d="M12 4 2.800 19.500h18.400z"/><path d="M12 10v4.200M12 17v.1"/>', 22),
  music: svg('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>', 18),
  star: svg('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>', 18),
  pin: svg('<path d="M12 21s-6-5.3-6-10.5a6 6 0 1 1 12 0C18 15.7 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.2"/>', 18),
  cloud: svg('<path d="M6.5 19h11a4 4 0 0 0 .6-7.9A5.5 5.5 0 0 0 7.2 9.4 3.8 3.8 0 0 0 6.5 19z"/>', 18),
  timer: svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/>', 20),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.5 4.5l1.5-2M20 20v-4.5h-4.5"/>', 18),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', 18),
  rotate: svg('<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>', 20),
  checkSquare: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12.2 2.8 2.8 5.2-5.5"/>', 19),
  sparkles: svg('<path d="m10 3 1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8zM18 14l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/>', 18),
};

// SF Symbols that Locket captions reference by name. Unknown names render no icon rather than a guess.
const sym = (body) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">${body}</svg>`;
export const SYMBOLS = {
  'clock.fill': sym('<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v4.600l3.200 1.900-1 1.700L11 12.700V7z"/>'),
  'location.fill': sym('<path d="M20.500 3.500 3 10.800l7.300 2.900 2.900 7.300z"/>'),
  'mappin': sym('<path d="M12 2a6 6 0 0 0-1 11.900V22h2v-8.100A6 6 0 0 0 12 2z"/>'),
  'eye.fill': sym('<path d="M12 5C6.500 5 2.700 9.300 1.500 12c1.200 2.700 5 7 10.500 7s9.300-4.300 10.500-7C21.300 9.300 17.500 5 12 5zm0 3.200a3.800 3.800 0 1 1 0 7.600 3.800 3.800 0 0 1 0-7.600z"/>'),
  'music.note': sym('<path d="M9 4v10.600A3.500 3.500 0 1 0 11 18V8h7V4z"/>'),
  'star.fill': sym('<path d="m12 2 3 6.500 7 .800-5.200 4.800 1.500 7L12 17.500 5.700 21.100l1.500-7L2 9.300l7-.800z"/>'),
  'flame.fill': sym('<path d="M12 2c1 3.500 5.500 5.500 5.500 11A5.500 5.500 0 0 1 12 22a5.500 5.500 0 0 1-5.500-5.500c0-2 1-3.500 2-4.500.300 1.500 1 2.500 2 3-.500-3.500 0-7.500 1.500-9.500z"/>'),
  'heart.fill': sym('<path d="M12 21C6.500 16.500 3 13.300 3 9.300 3 6.300 5.300 4 8.200 4c1.500 0 2.800.600 3.800 1.700C13 4.600 14.300 4 15.800 4 18.700 4 21 6.300 21 9.300c0 4-3.500 7.200-9 11.700z"/>'),
  'sun.max.fill': sym('<circle cx="12" cy="12" r="4.500"/><path d="M11 1.500h2v3.500h-2zM11 19h2v3.500h-2zM1.500 11H5v2H1.500zM19 11h3.500v2H19zM4.200 5.600l1.400-1.400 2.500 2.500-1.400 1.400zM16 17.400l1.400-1.400 2.500 2.500-1.400 1.400zM4.200 18.400l2.500-2.500 1.400 1.400-2.500 2.500zM16 6.600l2.500-2.500 1.400 1.400-2.500 2.500z"/>'),
  'cloud.fill': sym('<path d="M7 19a5 5 0 0 1-.600-9.960A6 6 0 0 1 18 9.500 4.800 4.800 0 0 1 17.500 19z"/>'),
  'moon.fill': sym('<path d="M20 14.500A8.500 8.500 0 0 1 9.500 4 8.500 8.500 0 1 0 20 14.500z"/>'),
  'sparkles': sym('<path d="m10 3 1.800 5.200L17 10l-5.200 1.800L10 17l-1.800-5.200L3 10l5.200-1.800zM18 14l.900 2.600 2.600.900-2.600.900L18 21l-.900-2.600-2.600-.900 2.600-.900z"/>'),
};
['cloud.sun.fill', 'cloud.rain.fill', 'cloud.bolt.fill', 'cloud.snow.fill'].forEach((n) => { SYMBOLS[n] = SYMBOLS['cloud.fill']; });
SYMBOLS['sun.min.fill'] = SYMBOLS['sun.max.fill'];
SYMBOLS['moon.stars.fill'] = SYMBOLS['moon.fill'];
SYMBOLS['mappin.and.ellipse'] = SYMBOLS.mappin;

export function Icon({ name }) {
  const markup = ICONS[name];
  if (!markup) return null;
  return <span className="ic" style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: markup }} />;
}

export function SymbolIcon({ name }) {
  const markup = SYMBOLS[name];
  if (!markup) return null;
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: markup }} />;
}
