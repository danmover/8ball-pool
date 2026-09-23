import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';

/**
 * Makes the build installable and playable offline.
 *
 * Emits a web manifest and a service worker whose precache list is every file in the build, so
 * after one visit the whole game — bots included — works with no connection at all. Hand-rolled
 * rather than a plugin dependency: it is one small file and it never changes shape.
 */
export function pwaManifest(): Plugin {
  return {
    name: 'pool-pwa',
    apply: 'build',
    generateBundle(_options, bundle) {
      const manifest = {
        name: '8-Ball Pool',
        short_name: '8-Ball',
        description: 'Pool with friends on any network, or against bots offline.',
        start_url: '/',
        scope: '/',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#070b11',
        theme_color: '#070b11',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      };
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) });

      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const precache = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', ...files.map((f) => `/${f}`)];
      const unique = [...new Set(precache)];
      const version = createHash('sha1').update(unique.join('|')).digest('hex').slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(version, unique) });
    },
  };
}

function serviceWorker(version: string, precache: string[]): string {
  return `// Generated at build time. Precaches the whole game so it plays offline.
const CACHE = 'pool-${version}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pool-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/ws/') || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;

  if (req.mode === 'navigate') {
    // Network first so a new release is picked up, falling back to the cached app offline.
    event.respondWith(
      Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 3500)),
      ]).catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
`;
}
