// Installable-app plumbing: service worker registration and updates, the install prompt, and the
// network state shown by the offline banner.
import { createStore } from './createStore.js';

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// on iOS only Safari (and, since iOS 16.4, other browsers' share sheet) can add to the home screen
export const isIOSSafari = isIOS && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);

export const pwaStore = createStore({
  installed: standalone(),
  installEvent: null,        // deferred beforeinstallprompt (Chrome, Edge, Android)
  updateReady: false,        // a new service worker is waiting
  version: null,
  supported: 'serviceWorker' in navigator,
  online: navigator.onLine,
  serverDown: false,         // the network is up but our backend did not answer
});

let registration = null;
let updating = false;

function watch(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    // "installed" while another worker controls the page = an update is waiting
    if (worker.state === 'installed' && navigator.serviceWorker.controller) pwaStore.set({ updateReady: true });
  });
}

function askVersion(worker) {
  if (!worker) return;
  const channel = new MessageChannel();
  channel.port1.onmessage = (e) => pwaStore.set({ version: e.data?.version || null });
  worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
    registration = reg;
    if (reg.waiting && navigator.serviceWorker.controller) pwaStore.set({ updateReady: true });
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    askVersion(reg.active);
    // look for a new version when the app comes back to the foreground, and every 30 minutes
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => { /* not fatal: the site works without offline support */ });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // only reload for an update the user asked for (the very first install also fires this)
    if (updating) window.location.reload();
    else askVersion(navigator.serviceWorker.controller);
  });
}

export function applyUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) { window.location.reload(); return; }
  updating = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export async function checkForUpdate() {
  if (!registration) return 'unsupported';
  await registration.update();
  if (registration.waiting || registration.installing) {
    if (registration.installing) await new Promise((r) => { registration.installing.addEventListener('statechange', r); setTimeout(r, 8000); });
    if (registration.waiting) { pwaStore.set({ updateReady: true }); return 'update'; }
  }
  return 'latest';
}

export async function promptInstall() {
  const event = pwaStore.get().installEvent;
  if (!event) return null;
  event.prompt();
  const { outcome } = await event.userChoice;
  pwaStore.set({ installEvent: null });
  return outcome;
}

// network state: browser events plus what API calls actually see
let probe = 0;
export function reportNetwork(ok) {
  const s = pwaStore.get();
  if (ok && (s.serverDown || !s.online)) pwaStore.set({ serverDown: false, online: true });
  if (!ok && !s.serverDown) pwaStore.set({ serverDown: navigator.onLine, online: navigator.onLine });
  // while the server is unreachable, check it every 5 s so the app recovers as soon as it is back
  // (instead of waiting for the next screen poll)
  if (!ok && !probe) {
    probe = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (res.ok) { clearInterval(probe); probe = 0; reportNetwork(true); }
      } catch { /* still down */ }
    }, 5000);
  }
  if (ok && probe) { clearInterval(probe); probe = 0; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwaStore.set({ installEvent: e }); });
  window.addEventListener('appinstalled', () => pwaStore.set({ installed: true, installEvent: null }));
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', (e) => pwaStore.set({ installed: e.matches }));
  window.addEventListener('online', () => pwaStore.set({ online: true }));
  window.addEventListener('offline', () => pwaStore.set({ online: false }));
}
