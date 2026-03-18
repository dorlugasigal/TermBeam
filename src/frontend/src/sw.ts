/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope;

// Precache all Vite-built assets (JS, CSS, fonts, images — NOT HTML).
// HTML is excluded from the precache manifest via globPatterns in vite.config.ts.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Navigation requests (HTML) are NOT intercepted by the service worker.
// They go directly to the server, which sets Cache-Control: no-store.
// This prevents stale/poisoned HTML (e.g. cached login pages, DevTunnel
// auth pages) from being served when the network is temporarily unavailable.

// Cache-first for CDN fonts (NerdFont)
registerRoute(
  ({ url }) => url.hostname === 'cdn.jsdelivr.net' && url.pathname.endsWith('.ttf'),
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

// API calls are NOT intercepted — they fall through to native fetch.

// Allow the app to request a full cache purge via postMessage.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_CACHES') {
    caches.keys().then((names) => {
      for (const name of names) {
        if (name !== 'workbox-precache-v2') caches.delete(name);
      }
    });
  }
});

// Skip waiting and claim clients immediately
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  // Clean up any legacy navigation caches from previous versions
  event.waitUntil(
    caches.delete('termbeam-navigation').then(() => self.clients.claim()),
  );
});
