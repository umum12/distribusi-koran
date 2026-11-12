/* sw.js — cache aset aplikasi agar berjalan offline.
 *
 * - Naikkan CACHE_VERSION setiap kali ada perubahan file aplikasi.
 * - Service worker HANYA menyentuh Cache Storage. IndexedDB (data foto) tidak pernah disentuh,
 *   sehingga pembaruan aplikasi tidak menghapus data.
 * - Strategi sederhana: cache-first untuk aset aplikasi, jaringan hanya sebagai cadangan.
 */
const CACHE_VERSION = 'v1.0.0';
const CACHE_PREFIX = 'distribusi-koran-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './pdf.js',
  './backup.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './vendor/pdf-lib.min.js',
  './vendor/jszip.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') {
          const fallback = await cache.match('./index.html');
          if (fallback) return fallback;
        }
        return new Response('Anda sedang offline.', { status: 503, statusText: 'Offline' });
      }
    })()
  );
});
