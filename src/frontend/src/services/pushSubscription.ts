import { fetchVapidKey, subscribePush, unsubscribePush } from './api';

const PUSH_STATE_KEY = 'termbeam-push-subscribed';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/**
 * Initialize a push notification subscription.
 * Returns true if a push subscription is active after this call.
 */
export async function initPushSubscription(): Promise<boolean> {
  try {
    if (!('PushManager' in window)) return false;
    if (!('serviceWorker' in navigator)) return false;

    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) return false;

    // Fetch current VAPID public key from server
    const { publicKey } = await fetchVapidKey();
    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    // Check for existing subscription
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      // Verify the subscription was created with the current VAPID key.
      // If VAPID keys were regenerated (server restart with new config),
      // the old subscription is invalid and must be replaced.
      const existingKey = existing.options?.applicationServerKey;
      let keyMatches = true;
      if (existingKey) {
        const existingArr = new Uint8Array(existingKey);
        keyMatches =
          existingArr.length === applicationServerKey.length &&
          existingArr.every((b, i) => b === applicationServerKey[i]);
      }

      if (keyMatches) {
        // Key matches — just re-register with backend (in-memory store)
        try {
          await subscribePush(existing.toJSON());
        } catch {
          // Backend not reachable
        }
        setPushState(true);
        return true;
      }

      // Key mismatch — unsubscribe old and create new below
      await existing.unsubscribe();
    }

    // Subscribe with current VAPID key
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    const json = subscription.toJSON();
    await subscribePush(json);

    setPushState(true);
    return true;
  } catch {
    setPushState(false);
    return false;
  }
}

/** Remove the current push subscription from browser and backend. */
export async function removePushSubscription(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription();
    if (!subscription) {
      setPushState(false);
      return;
    }

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    try {
      await unsubscribePush(endpoint);
    } catch {
      // Backend cleanup is best-effort
    }
  } catch {
    // Ignore cleanup errors
  }
  setPushState(false);
}

/** Quick synchronous check for push subscription state (from localStorage cache). */
export function isPushSubscribedSync(): boolean {
  try {
    return localStorage.getItem(PUSH_STATE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Async check — queries the actual PushManager. */
export async function isPushSubscribed(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription();
    const active = !!subscription;
    setPushState(active);
    return active;
  } catch {
    return false;
  }
}

/**
 * Ensure push subscription is active on page load.
 * Call this early in the app lifecycle — it re-registers the subscription
 * with the backend (which stores them in memory and loses them on restart).
 */
export async function ensurePushSubscription(): Promise<void> {
  try {
    if (!isPushSubscribedSync()) return;
    if (Notification.permission !== 'granted') return;
    await initPushSubscription();
  } catch {
    // Best-effort — don't break the app if push re-subscribe fails
  }
}

function setPushState(active: boolean): void {
  try {
    localStorage.setItem(PUSH_STATE_KEY, String(active));
  } catch {
    // Storage unavailable
  }
}
