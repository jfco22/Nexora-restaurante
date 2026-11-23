/* Nexora · El Taita — service worker.
 * Guarda la app en el equipo para que abra aunque no haya internet.
 * NO toca las llamadas a Supabase (otro dominio): los datos y las ventas sin internet los maneja la app.
 * Para forzar una actualización de todo lo guardado, sube el número de VERSION.
 */
const VERSION = 'nexora-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const MAX_ASSETS = 120; // tope de archivos guardados: libera memoria del equipo
const NAVIGATION_TIMEOUT_MS = 3500; // Wi‑Fi sin internet no responde: pasado este tiempo se abre la copia guardada

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icon-192.png']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

const isStaticAsset = (url) =>
  url.pathname.startsWith('/assets/') || url.pathname.startsWith('/menu/') || url.pathname.startsWith('/images/')
  || /\.(?:png|jpg|jpeg|webp|svg|ico|woff2?|css|js)$/i.test(url.pathname);

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length - max).map((key) => cache.delete(key)));
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match('/');
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone()).then(() => trimCache(ASSET_CACHE, MAX_ASSETS));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase y demás: directo a la red

  if (request.mode === 'navigate') {
    if (url.pathname.startsWith('/docs/')) return; // guías estáticas: no son la app
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  if (url.pathname === '/sw.js') return;
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
