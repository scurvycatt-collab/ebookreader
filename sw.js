/* Stacks service worker — caches the app shell so the reader (and your
   already-imported books, which live in IndexedDB, not here) work offline.
   CDN libraries are cache-first with network fallback so first load needs
   internet once, then everything works offline. */
const CACHE_NAME = 'stacks-shell-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/library.js',
  './js/reader-epub.js',
  './js/reader-pdf.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // opportunistically cache same-origin and CDN library files
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
