// A single versioned shell prevents new HTML loading old cached modules.
// Scope-qualified cache names isolate multiple Pages projects on the same origin.
const PREFIX = `bug-book-shell:${self.registration.scope}:`;
const CACHE = PREFIX + 'v4';
const ASSETS = ['./index.html', './style.css', './app.js', './core.js', './storage.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const assetURLs = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    ASSETS.map(path => new Request(new URL(path, self.registration.scope), {cache: 'reload'}))
  )));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const shellURL = new URL('./index.html', self.registration.scope).href;
  const isAppNavigation = event.request.mode === 'navigate' &&
    (url.pathname === new URL(self.registration.scope).pathname || url.pathname === new URL(shellURL).pathname);
  const assetURL = new URL(url); assetURL.search = ''; assetURL.hash = '';
  if (!isAppNavigation && !assetURLs.has(assetURL.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(isAppNavigation ? shellURL : assetURL.href);
    return cached || fetch(event.request);
  }));
});
