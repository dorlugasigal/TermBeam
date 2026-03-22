const webpush = require('web-push');
const { getOrCreateVapidKeys } = require('../utils/vapid');
const log = require('../utils/logger');

class PushManager {
  constructor(configDir) {
    this.configDir = configDir;
    this.subscriptions = new Map(); // endpoint -> subscription object
    this.vapidKeys = null;
  }

  /**
   * Initialize VAPID keys and configure web-push.
   * Call once during server start.
   */
  async init() {
    this.vapidKeys = getOrCreateVapidKeys(this.configDir);
    webpush.setVapidDetails(
      this.vapidKeys.subject,
      this.vapidKeys.publicKey,
      this.vapidKeys.privateKey,
    );
    log.info('Push notification manager initialized');
  }

  /**
   * Register a push subscription.
   * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} subscription
   */
  subscribe(subscription) {
    if (!this.vapidKeys) {
      log.warn('Push subscription rejected — VAPID not initialized');
      return;
    }
    this.subscriptions.set(subscription.endpoint, subscription);
    log.info(`Push subscription registered (${this.subscriptions.size} total)`);
  }

  /**
   * Remove a push subscription by endpoint.
   * @param {string} endpoint
   */
  unsubscribe(endpoint) {
    const removed = this.subscriptions.delete(endpoint);
    if (removed) {
      log.debug(`Push subscription removed (${this.subscriptions.size} total)`);
    }
  }

  /**
   * Send a push notification to all registered subscriptions.
   * Removes subscriptions that return 410 Gone or 404 Not Found.
   * @param {{ title: string, body: string, tag?: string, sessionId?: string }} payload
   */
  async notify(payload) {
    if (this.subscriptions.size === 0) {
      log.debug('Push: no subscriptions registered, skipping notification');
      return;
    }

    if (!this.vapidKeys) {
      log.debug('Push: VAPID not initialized, skipping');
      return;
    }

    log.info(`Push: sending to ${this.subscriptions.size} subscription(s): ${payload.title}`);

    const body = JSON.stringify(payload);
    const stale = [];

    const results = await Promise.allSettled(
      [...this.subscriptions.entries()].map(async ([endpoint, sub]) => {
        try {
          await webpush.sendNotification(sub, body, {
            TTL: 300,
            urgency: 'normal',
          });
          log.debug(`Push sent successfully to ${endpoint.slice(0, 50)}...`);
          sub._failCount = 0;
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            stale.push(endpoint);
            log.debug(`Removing stale push subscription (${err.statusCode})`);
          } else {
            sub._failCount = (sub._failCount || 0) + 1;
            log.warn(
              `Push notification failed (attempt ${sub._failCount}): ${err.message}` +
                (err.statusCode ? ` (HTTP ${err.statusCode})` : '') +
                (err.body ? ` — ${String(err.body).slice(0, 200)}` : ''),
            );
            if (sub._failCount >= 5) {
              stale.push(endpoint);
              log.warn(`Push subscription removed after ${sub._failCount} consecutive failures`);
            }
          }
        }
      }),
    );

    for (const endpoint of stale) {
      this.subscriptions.delete(endpoint);
    }

    log.debug(
      `Push notifications sent: ${results.length} attempted, ${stale.length} stale removed`,
    );
  }

  /**
   * Return the VAPID public key for frontend subscription.
   * @returns {string}
   */
  getPublicKey() {
    return this.vapidKeys ? this.vapidKeys.publicKey : null;
  }
}

module.exports = { PushManager };
