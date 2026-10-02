// Service worker minimo: permite instalar la app como PWA y
// abrirla como "app" en el celular. El bundle ya va dentro, asi que
// al abrir una vez la app quede util aunque regreses sin internet.

const CACHE = 'mapeo-fes-v1';
const CORE = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const peticion = event.request;
  // No hacemos cache de nada externo (mapas, tiles, Leaflet CDN):
  // solo servimos en el arranque lo que quedo cacheado.
  if (peticion.method !== 'GET') return;
  if (peticion.mode === 'navigate') {
    event.respondWith(
      fetch(peticion).catch(() => caches.match('./index.html'))
    );
  }
});