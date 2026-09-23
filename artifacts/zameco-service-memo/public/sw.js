const CACHE_NAME = 'zameco-scraper-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Simple pass-through fetch for now since it relies heavily on APIs.
  // We just want to pass the PWA install criteria.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
