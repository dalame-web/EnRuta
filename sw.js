const CACHE = 'enruta-v40';
const PRECACHE = [
  './', './index.html', './horario.html', './manifest.webmanifest',
  './gps-tracking.js', './boxann.js', './data.js', './registro.js', './app.js', './app-logger.js',
  './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  // No llamamos skipWaiting() aquí: el SW nuevo queda "esperando" hasta que el
  // usuario pulse "Actualizar" en el banner (el cliente envía SKIP_WAITING).
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks =>
      Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
