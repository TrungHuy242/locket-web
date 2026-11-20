/* Locket Web service worker. Generated at build time from frontend/sw.template.js (vite.config.js fills
 * in VERSION and SHELL).
 *
 * What it caches: only the app shell - index.html, the hashed JS/CSS bundles and the icons. These are
 * the same for every user and contain no personal data.
 * What it never touches: /api/* (session, moments, chat, media...). Those always go to the network, so
 * tokens, messages and photos are never written to Cache Storage.
 */
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const SHELL_CACHE = `locket-shell-${VERSION}`;

self.addEventListener('install', (event) => {
  // 'reload' skips the HTTP cache so a new version never precaches stale files
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))));
  // no skipWaiting(): an update waits until the user taps "Cập nhật", so a page is never swapped mid-use
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('locket-') && n !== SHELL_CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'GET_VERSION' && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

const shellPaths = new Set(SHELL);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // fonts etc.: browser HTTP cache
  if (url.pathname.startsWith('/api/')) return;              // private data: network only, never cached
  if (url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    // network first so a deploy is picked up; offline -> the cached shell (the app then shows its offline screen)
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (shellPaths.has(url.pathname) || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/booth/')) {
    // hashed, immutable files: cache first
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      // hashed bundles and the photobooth art (stickers, textures) are kept after first use
      if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/booth/'))) cache.put(req, res.clone());
      return res;
    })());
  }
});
