/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare let self: ServiceWorkerGlobalScope;

// Precache all Vite-built assets
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Navigation requests (HTML documents) use NetworkFirst so that external auth
// redirects (e.g. DevTunnel Microsoft login) pass through to the browser
// instead of being short-circuited by the precache.
// CacheableResponsePlugin ensures only 200 OK responses are cached — prevents
// stale DevTunnel auth pages or error HTML from polluting the navigation cache.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'termbeam-navigation',
      networkTimeoutSeconds: 5,
      plugins: [new CacheableResponsePlugin({ statuses: [200] })],
    }),
  ),
);

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

// Network-only for API calls — never cache auth or session data.
// Use a fetch event listener instead of registerRoute to avoid workbox
// wrapping the fetch in a Response handler that can throw "no-response"
// when the network request fails (e.g. during SW activation race).
// By not registering a route, unmatched /api/ requests fall through to
// the browser's native fetch — more resilient than SW interception.
// (Previously used: registerRoute(({url}) => url.pathname.startsWith('/api/'), new NetworkOnly()));

// Skip waiting and claim clients immediately
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
