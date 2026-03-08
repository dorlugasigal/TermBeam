/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

// Precache all Vite-built assets
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Cache-first for CDN fonts (NerdFont)
registerRoute(
  ({ url }) =>
    url.hostname === 'cdn.jsdelivr.net' && url.pathname.endsWith('.ttf'),
  new CacheFirst({
    cacheName: 'termbeam-fonts',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 5,
        maxAgeSeconds: 365 * 24 * 60 * 60,
      }),
    ],
  }),
);

// Network-only for API calls — never cache auth or session data
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkOnly(),
);

// Skip waiting and claim clients immediately
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
