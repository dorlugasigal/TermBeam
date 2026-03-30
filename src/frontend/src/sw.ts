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

// ---------- Push notification handling ----------

self.addEventListener('push', (event: PushEvent) => {
  let data: {
    title?: string;
    body?: string;
    tag?: string;
    url?: string;
    type?: string;
    sessionId?: string;
  } = {
    title: 'Command finished',
    body: 'TermBeam',
  };
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      // Malformed payload — use defaults
    }
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clientList) => {
        // Skip if user is actively looking at the app
        const hasFocused = clientList.some(
          (c) => c.url.includes(self.location.origin) && (c as WindowClient).focused,
        );
        if (hasFocused) return;

        const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
          body: data.body || 'A command has completed',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: data.tag || 'termbeam-cmd',
          renotify: true,
          data: {
            url: data.url || '/',
            type: data.type || 'command-complete',
            sessionId: data.sessionId,
          },
          vibrate: [200, 100, 200],
        };

        // Set app badge
        try {
          await (
            self.navigator as unknown as { setAppBadge(n: number): Promise<void> }
          ).setAppBadge(1);
        } catch {
          // Badge API not supported
        }

        return self.registration.showNotification(data.title || 'Command finished', options);
      }),
  );
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  // Clear app badge
  try {
    (self.navigator as unknown as { clearAppBadge(): Promise<void> }).clearAppBadge();
  } catch {
    // Badge API not supported
  }

  const notifData = event.notification.data || {};
  const url = (notifData.url as string) || '/';
  const type = (notifData.type as string) || '';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Find an existing window and focus it
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            // Notify the frontend about what was clicked
            if (type) {
              client.postMessage({
                type: 'NOTIFICATION_CLICKED',
                notificationType: type,
                sessionId: notifData.sessionId,
              });
            }
            return (client as WindowClient).focus();
          }
        }
        // No existing window — open a new one
        return self.clients.openWindow(url);
      }),
  );
});
