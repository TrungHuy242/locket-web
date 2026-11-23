import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Writes dist/sw.js from sw.template.js with the list of files to precache (the hashed bundles plus the
// static shell) and a version derived from them: any change to the build gives a new service worker,
// which the app offers to the user as an update.
function serviceWorker() {
  const STATIC = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
    '/icons/maskable-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png'];
  return {
    name: 'locket-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8');
      // Exclude lazy Admin chunks from SW precache so normal users never download or see Admin assets in sw.js
      const built = Object.keys(bundle)
        .filter((f) => f.startsWith('assets/') && !f.startsWith('assets/Admin-'))
        .map((f) => `/${f}`)
        .sort();
      const shell = [...STATIC, ...built];
      const version = createHash('sha256').update(template + shell.join('|')).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace("'__VERSION__'", JSON.stringify(version)).replace('__SHELL__', JSON.stringify(shell)),
      });
    },
  };
}

// `npm run dev` serves the UI on :5173 and forwards /api to the FastAPI backend on :8000.
// `npm run build` writes frontend/dist, which the backend serves in production.
export default defineConfig({
  plugins: [react(), serviceWorker()],
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false, ws: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
  },
});
