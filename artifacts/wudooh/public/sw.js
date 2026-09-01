const CACHE_VERSION = 'wudooh-shell-__WUDOOH_BUILD_ID__';
const SHELL_CACHE = `${CACHE_VERSION}-static`;
const SCOPE_URL = self.registration.scope;
const INDEX_URL = new URL('index.html', SCOPE_URL).href;
const BUILD_ASSETS = /* __WUDOOH_BUILD_ASSETS__ */ [];
const APP_SHELL = [
  SCOPE_URL,
  INDEX_URL,
  new URL('manifest.webmanifest', SCOPE_URL).href,
  new URL('favicon.png', SCOPE_URL).href,
  new URL('logo.png', SCOPE_URL).href,
  new URL('logo-transparent.png', SCOPE_URL).href,
  ...BUILD_ASSETS.map((asset) => new URL(asset, SCOPE_URL).href),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('wudooh-shell-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(INDEX_URL, copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match(INDEX_URL)) || cache.match(SCOPE_URL);
        }),
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
  );
});