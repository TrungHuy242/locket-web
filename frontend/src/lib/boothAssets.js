// Photobooth asset library and frame templates.
//
// Illustrations: original SVG stickers in public/booth/stickers (drawn by scripts/make_booth_assets.py in one
// consistent die-cut style). Textures: PNG tiles in public/booth/textures. Fonts: Google Fonts with Vietnamese
// support (loaded in index.html). To add a template, add an entry to TEMPLATES - positions are fractions of the
// box they are anchored to, so a template works for every layout and photo count.

export const stickerUrl = (id) => `/booth/stickers/${id}.svg`;
export const textureUrl = (id) => `/booth/textures/${id}.png`;

export const STICKER_GROUPS = [
  { id: 'pets', name: 'Thú cưng', items: ['dog', 'dog-peek', 'cat', 'cat-peek', 'bunny', 'bear', 'teddy', 'chick', 'mochi'] },
  { id: 'love', name: 'Tim & nơ', items: ['heart', 'hearts', 'chrome-heart', 'bow', 'stamp'] },
  { id: 'flowers', name: 'Hoa', items: ['daisy', 'sakura', 'tulip', 'frame-flower'] },
  { id: 'sky', name: 'Trời & sao', items: ['star', 'sparkle', 'sparkles', 'cloud', 'moon', 'rainbow', 'butterfly'] },
  { id: 'treats', name: 'Đồ ăn & dấu chân', items: ['strawberry', 'cherry', 'carrot', 'fish', 'bone', 'paw'] },
  { id: 'paper', name: 'Giấy & băng dính', items: ['tape-pink', 'tape-mint', 'banner', 'camera'] },
];
// stickers printed flat (tape, paper): no drop shadow
export const FLAT_STICKERS = new Set(['tape-pink', 'tape-mint']);

export const TEXTURES = [
  { id: 'none', name: 'Không' },
  { id: 'paper', name: 'Giấy', blend: 'multiply', alpha: 1 },
  { id: 'kraft', name: 'Giấy kraft', blend: 'multiply', alpha: .55 },
  { id: 'grain', name: 'Hạt film', blend: 'source-over', alpha: 1 },
  { id: 'linen', name: 'Vải lanh', blend: 'source-over', alpha: 1 },
  { id: 'gingham-pink', name: 'Caro hồng', blend: 'multiply', alpha: .9 },
  { id: 'gingham-blue', name: 'Caro xanh', blend: 'multiply', alpha: .9 },
  { id: 'gingham-mint', name: 'Caro bạc hà', blend: 'multiply', alpha: .9 },
  { id: 'dots', name: 'Chấm bi', blend: 'source-over', alpha: 1 },
];

export const FONTS = [
  { id: 'Itim', name: 'Itim', css: '"Itim"' },
  { id: 'Pacifico', name: 'Pacifico', css: '"Pacifico"' },
  { id: 'Dancing Script', name: 'Dancing', css: '"Dancing Script"', weight: 700 },
  { id: 'Playfair Display', name: 'Playfair', css: '"Playfair Display"', style: 'italic', weight: 700 },
  { id: 'Comfortaa', name: 'Comfortaa', css: '"Comfortaa"', weight: 700 },
  { id: 'Space Mono', name: 'Space Mono', css: '"Space Mono"', weight: 700 },
  { id: 'Nunito', name: 'Nunito', css: '"Nunito"', weight: 900 },
];
export const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];

export const BORDERS = [
  { id: 'template', name: 'Theo khung' },
  { id: 'none', name: 'Không viền' },
  { id: 'thin', name: 'Viền mảnh' },
  { id: 'thick', name: 'Viền dày' },
  { id: 'polaroid', name: 'Polaroid' },
  { id: 'stitch', name: 'Đường may' },
];

// side / top: margins (px at a 600px-wide cell) - decorated frames leave room for their art.
// decor: { a: sticker, at: 'strip' | 'cell' | 'footer' | 'header', cell: 'first'|'last'|'each'|index,
//          x, y (centre, 0..1 of the anchor box), w (width, fraction of the strip - or of the cell for 'cell'),
//          rot (deg), ay (vertical anchor of the sticker, default .5), under (draw behind the photos) }
export const TEMPLATES = [
  {
    id: 'puppy', name: 'Puppy Love', group: 'Thú cưng', bg: '#fff3df', texture: 'paper', side: 80, top: 190,
    cell: { radius: 16, border: 8, borderColor: '#ffffff', shadow: true },
    footer: { h: 260, text: 'puppy love', font: 'Itim', color: '#8a5a3b', size: 66, date: '#b98a66' },
    decor: [
      { a: 'dog-peek', at: 'cell', cell: 'first', x: .5, y: .01, w: .56, ay: .92 },
      { a: 'hearts', at: 'strip', x: .11, y: .045, w: .2, rot: -12 },
      { a: 'paw', at: 'strip', x: .9, y: .05, w: .13, rot: 18 },
      { a: 'paw', at: 'strip', x: .055, y: .36, w: .12, rot: -20 },
      { a: 'heart', at: 'cell', cell: 1, x: .98, y: .07, w: .2, rot: 14 },
      { a: 'bone', at: 'strip', x: .955, y: .6, w: .22, rot: 72 },
      { a: 'paw', at: 'strip', x: .06, y: .74, w: .11, rot: -14 },
      { a: 'dog', at: 'footer', x: .17, y: .5, w: .28, rot: -6 },
      { a: 'bone', at: 'footer', x: .84, y: .62, w: .25, rot: -18 },
      { a: 'hearts', at: 'footer', x: .88, y: .24, w: .14, rot: 10 },
    ],
  },
  {
    id: 'kitty', name: 'Kitty Café', group: 'Thú cưng', bg: '#ffe6ee', pattern: 'gingham-pink', side: 80, top: 190,
    cell: { radius: 16, border: 8, borderColor: '#ffffff', shadow: true },
    footer: { h: 260, text: 'meow meow', font: 'Itim', color: '#d0587e', size: 66, date: '#e28aa6' },
    decor: [
      { a: 'cat-peek', at: 'cell', cell: 'first', x: .5, y: .01, w: .56, ay: .92 },
      { a: 'bow', at: 'strip', x: .12, y: .05, w: .22, rot: -14 },
      { a: 'heart', at: 'strip', x: .9, y: .05, w: .12, rot: 12 },
      { a: 'paw', at: 'strip', x: .945, y: .34, w: .12, rot: 18 },
      { a: 'fish', at: 'strip', x: .055, y: .5, w: .24, rot: -72 },
      { a: 'heart', at: 'cell', cell: 2, x: .02, y: .06, w: .17, rot: -12 },
      { a: 'paw', at: 'strip', x: .94, y: .78, w: .1, rot: 12 },
      { a: 'cat', at: 'footer', x: .17, y: .5, w: .27, rot: -6 },
      { a: 'fish', at: 'footer', x: .84, y: .6, w: .28, rot: 12 },
    ],
  },
  {
    id: 'bunny', name: 'Bunny Garden', group: 'Thú cưng', bg: '#e8f7ee', pattern: 'gingham-mint', side: 80, top: 120,
    cell: { radius: 18, border: 8, borderColor: '#ffffff', shadow: true },
    footer: { h: 270, text: 'hop hop', font: 'Comfortaa', color: '#3f8a64', size: 60, date: '#6fae8c' },
    decor: [
      { a: 'daisy', at: 'strip', x: .09, y: .03, w: .22, rot: -10 },
      { a: 'sakura', at: 'strip', x: .91, y: .035, w: .15, rot: 12 },
      { a: 'tulip', at: 'strip', x: .06, y: .42, w: .14, rot: -10 },
      { a: 'daisy', at: 'strip', x: .95, y: .6, w: .15, rot: 20 },
      { a: 'sakura', at: 'cell', cell: 'last', x: .98, y: .97, w: .22, rot: 15 },
      { a: 'bunny', at: 'footer', x: .16, y: .46, w: .22, rot: -4 },
      { a: 'carrot', at: 'footer', x: .84, y: .5, w: .16, rot: 26 },
      { a: 'daisy', at: 'footer', x: .7, y: .3, w: .09, rot: -8 },
    ],
  },
  {
    id: 'teddy', name: 'Teddy Bear', group: 'Thú cưng', bg: ['#f7e7d3', '#ecd2b4'], texture: 'paper', side: 80, top: 160,
    cell: { radius: 12, border: 9, borderColor: '#fff8ee', shadow: true },
    footer: { h: 270, text: 'beary happy', font: 'Dancing Script', color: '#7a4f32', size: 72, date: '#a47b5a' },
    decor: [
      { a: 'bow', at: 'strip', x: .5, y: .05, w: .36 },
      { a: 'hearts', at: 'strip', x: .1, y: .05, w: .17, rot: -12 },
      { a: 'heart', at: 'strip', x: .9, y: .055, w: .11, rot: 12 },
      { a: 'bear', at: 'cell', cell: 1, x: .99, y: .5, w: .27, rot: 14 },
      { a: 'bear', at: 'cell', cell: 'last', x: .02, y: .88, w: .25, rot: -12 },
      { a: 'teddy', at: 'footer', x: .17, y: .48, w: .24, rot: -6 },
      { a: 'hearts', at: 'footer', x: .84, y: .52, w: .22, rot: 10 },
    ],
  },
  {
    id: 'friends', name: 'Animal Friends', group: 'Thú cưng', bg: '#fff8d8', pattern: 'dots', side: 80, top: 130,
    cell: { radius: 16, border: 8, borderColor: '#ffffff', shadow: true },
    footer: { h: 270, text: 'happy day', font: 'Itim', color: '#d9922e', size: 66, date: '#e0ac5c' },
    decor: [
      { a: 'chick', at: 'cell', cell: 'first', x: .04, y: .03, w: .3, rot: -14 },
      { a: 'star', at: 'strip', x: .9, y: .05, w: .15, rot: 14 },
      { a: 'bear', at: 'cell', cell: 1, x: .97, y: .92, w: .28, rot: 12 },
      { a: 'bunny', at: 'cell', cell: 2, x: .03, y: .14, w: .2, rot: -10 },
      { a: 'sparkle', at: 'strip', x: .95, y: .74, w: .09 },
      { a: 'cat', at: 'footer', x: .17, y: .5, w: .26, rot: -6 },
      { a: 'dog', at: 'footer', x: .84, y: .5, w: .26, rot: 6 },
    ],
  },
  {
    id: 'mochi', name: 'Mochi Friends', group: 'Cute', bg: ['#ffe0f0', '#e6dcff'], texture: 'dots', side: 80,
    cell: { radius: 22, border: 10, borderColor: '#ffffff', shadow: true },
    header: { h: 180, text: 'best friends', font: 'Itim', color: '#d0588f', size: 52, banner: 'banner' },
    footer: { h: 260, text: 'sweet moments', font: 'Itim', color: '#a777d9', size: 56, date: '#c39be8' },
    decor: [
      { a: 'bow', at: 'cell', cell: 'first', x: .03, y: .02, w: .32, rot: -22 },
      { a: 'sparkles', at: 'strip', x: .93, y: .3, w: .17, rot: 8 },
      { a: 'cloud', at: 'strip', x: .07, y: .52, w: .21, rot: -6 },
      { a: 'star', at: 'cell', cell: 2, x: .98, y: .07, w: .19, rot: 12 },
      { a: 'heart', at: 'strip', x: .94, y: .73, w: .1, rot: 10 },
      { a: 'strawberry', at: 'footer', x: .15, y: .5, w: .18, rot: -14 },
      { a: 'mochi', at: 'footer', x: .83, y: .5, w: .3, rot: 6 },
    ],
  },
  {
    id: 'strawberry', name: 'Strawberry Milk', group: 'Cute', bg: '#fff0f4', pattern: 'gingham-pink', side: 80, top: 160,
    cell: { radius: 16, border: 10, borderColor: '#ffffff', shadow: true },
    footer: { h: 270, text: 'strawberry milk', font: 'Pacifico', color: '#e2557a', size: 54, date: '#ec8aa4' },
    decor: [
      { a: 'bow', at: 'strip', x: .5, y: .045, w: .34 },
      { a: 'cherry', at: 'strip', x: .1, y: .06, w: .18, rot: -12 },
      { a: 'strawberry', at: 'strip', x: .9, y: .06, w: .14, rot: 16 },
      { a: 'heart', at: 'strip', x: .95, y: .48, w: .11, rot: 12 },
      { a: 'strawberry', at: 'cell', cell: 'last', x: .03, y: .95, w: .23, rot: -16 },
      { a: 'cherry', at: 'footer', x: .15, y: .5, w: .21, rot: -10 },
      { a: 'strawberry', at: 'footer', x: .86, y: .5, w: .18, rot: 12 },
    ],
  },
  {
    id: 'love', name: 'Love Letter', group: 'Cute', bg: ['#ffd9e0', '#ffc2cf'], texture: 'linen', side: 80,
    cell: { radius: 10, border: 8, borderColor: '#ffffff', shadow: true },
    header: { h: 170, text: 'with love', font: 'Dancing Script', color: '#c8325a', size: 74 },
    footer: { h: 230, text: 'xoxo', font: 'Dancing Script', color: '#c8325a', size: 60, date: '#d9607f' },
    decor: [
      { a: 'hearts', at: 'header', x: .13, y: .5, w: .2, rot: -12 },
      { a: 'heart', at: 'header', x: .88, y: .5, w: .13, rot: 14 },
      { a: 'frame-flower', at: 'strip', x: .95, y: .42, w: .15, rot: 10 },
      { a: 'heart', at: 'cell', cell: 1, x: .02, y: .1, w: .15, rot: -14 },
      { a: 'stamp', at: 'footer', x: .86, y: .5, w: .17, rot: 8 },
      { a: 'bow', at: 'footer', x: .15, y: .5, w: .25, rot: -10 },
    ],
  },
  {
    id: 'cloud', name: 'Pastel Cloud', group: 'Pastel', bg: ['#d8ecff', '#fdeefe'], side: 84, top: 140,
    cell: { radius: 24, border: 10, borderColor: '#ffffff', shadow: true },
    footer: { h: 270, text: 'head in the clouds', font: 'Comfortaa', color: '#5a7fbf', size: 46, date: '#8aa6d9' },
    decor: [
      { a: 'cloud', at: 'strip', x: .17, y: .04, w: .32, rot: -4 },
      { a: 'sparkle', at: 'strip', x: .88, y: .045, w: .12, rot: 10 },
      { a: 'moon', at: 'strip', x: .95, y: .47, w: .15, rot: 12 },
      { a: 'star', at: 'cell', cell: 1, x: .02, y: .08, w: .17, rot: -12 },
      { a: 'cloud', at: 'cell', cell: 'last', x: .9, y: .97, w: .4 },
      { a: 'rainbow', at: 'footer', x: .19, y: .5, w: .3 },
      { a: 'star', at: 'footer', x: .86, y: .5, w: .15, rot: 14 },
    ],
  },
  {
    id: 'y2k', name: 'Y2K Chrome', group: 'Y2K', bg: ['#c7d2ff', '#ffd1f3'], side: 78,
    cell: { radius: 8, border: 6, borderColor: '#ffffff', shadow: true },
    header: { h: 160, text: 'Y2K FOREVER', font: 'Space Mono', color: '#5b3fd1', size: 46 },
    footer: { h: 220, text: '', font: 'Space Mono', color: '#5b3fd1', size: 36, date: '#6d55d8' },
    decor: [
      { a: 'chrome-heart', at: 'header', x: .1, y: .52, w: .18, rot: -14 },
      { a: 'sparkles', at: 'header', x: .9, y: .5, w: .17, rot: 8 },
      { a: 'butterfly', at: 'strip', x: .06, y: .4, w: .2, rot: -18 },
      { a: 'sparkle', at: 'strip', x: .945, y: .6, w: .11 },
      { a: 'chrome-heart', at: 'cell', cell: 'last', x: .97, y: .95, w: .22, rot: 14 },
      { a: 'star', at: 'footer', x: .15, y: .5, w: .15, rot: -10 },
      { a: 'butterfly', at: 'footer', x: .86, y: .5, w: .2, rot: 12 },
    ],
  },
  {
    id: 'vintage', name: 'Vintage Paper', group: 'Vintage & Film', bg: '#e9d9bd', pattern: 'kraft', texture: 'paper', side: 76, top: 110,
    cell: { radius: 2, inset: 14, insetColor: '#fffaf0', shadow: true },
    footer: { h: 240, text: 'memories', font: 'Playfair Display', color: '#5c3d24', size: 64, date: '#8b6a4a' },
    decor: [
      { a: 'tape-pink', at: 'cell', cell: 'each', x: .1, y: .02, w: .44, rot: -28 },
      { a: 'tape-mint', at: 'cell', cell: 'each', x: .9, y: .98, w: .38, rot: -24 },
      { a: 'stamp', at: 'footer', x: .86, y: .5, w: .17, rot: 9 },
      { a: 'daisy', at: 'footer', x: .14, y: .5, w: .17, rot: -12 },
    ],
  },
  {
    id: 'film', name: 'Retro Film', group: 'Vintage & Film', bg: '#141414', texture: 'grain', film: true, top: 64,
    cell: { radius: 2 },
    footer: { h: 180, text: 'FILM 400', font: 'Space Mono', color: '#ff9f43', size: 36, date: '#ff9f43' },
    decor: [{ a: 'camera', at: 'footer', x: .84, y: .5, w: .17, rot: 8 }],
  },
  {
    id: 'night', name: 'Sweet Dreams', group: 'Vintage & Film', bg: ['#1d2547', '#3b3170'], texture: 'grain', side: 80, top: 150,
    cell: { radius: 12, border: 4, borderColor: '#ffe8a3' },
    footer: { h: 260, text: 'sweet dreams', font: 'Pacifico', color: '#ffe8a3', size: 52, date: '#c9c3ff' },
    decor: [
      { a: 'moon', at: 'strip', x: .88, y: .05, w: .18, rot: 10 },
      { a: 'sparkles', at: 'strip', x: .11, y: .05, w: .17, rot: -8 },
      { a: 'sparkle', at: 'strip', x: .945, y: .55, w: .1 },
      { a: 'star', at: 'cell', cell: 1, x: .02, y: .1, w: .17, rot: -12 },
      { a: 'cloud', at: 'cell', cell: 'last', x: .1, y: .97, w: .36 },
      { a: 'star', at: 'footer', x: .15, y: .5, w: .16, rot: -12 },
      { a: 'cloud', at: 'footer', x: .85, y: .56, w: .26 },
    ],
  },
  {
    id: 'mono-white', name: 'Minimal White', group: 'Minimal', bg: '#fbfbfa', line: '#1c1c1e', side: 50, top: 60,
    cell: { radius: 0 },
    footer: { h: 180, text: 'a little moment', font: 'Playfair Display', color: '#1c1c1e', size: 48, date: '#8e8e93' },
    decor: [{ a: 'sparkle', at: 'footer', x: .86, y: .34, w: .07 }],
  },
  {
    id: 'mono-black', name: 'Minimal Black', group: 'Minimal', bg: '#111111', texture: 'grain', line: '#f2f2f7', side: 50, top: 60,
    cell: { radius: 0 },
    footer: { h: 180, text: 'PHOTO BOOTH', font: 'Space Mono', color: '#f2f2f7', size: 38, date: '#8e8e93' },
    decor: [],
  },
];

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
export const TEMPLATE_GROUPS = [...new Set(TEMPLATES.map((t) => t.group))];
