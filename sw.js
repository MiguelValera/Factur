// Cambia VERSION cada vez que subas cambios: así los dispositivos descargan la nueva versión.
const VERSION = 'facturas-v1.4.1';
const ARCHIVOS = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'activar') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const enCache = await caches.match(req, { ignoreSearch: true });
    if (enCache) return enCache;
    try {
      const resp = await fetch(req);
      if (resp.ok) (await caches.open(VERSION)).put(req, resp.clone());
      return resp;
    } catch {
      if (req.mode === 'navigate') return caches.match('./index.html');
      return Response.error();
    }
  })());
});
