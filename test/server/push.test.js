const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('PushManager', () => {
  let tmpDir;
  let PushManager;
  let originalWebPush;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-test-'));

    // Clear require cache to get fresh modules
    delete require.cache[require.resolve('../../src/server/push')];

    // Mock web-push before requiring PushManager
    const webpushPath = require.resolve('web-push');
    originalWebPush = require.cache[webpushPath];
    require.cache[webpushPath] = {
      id: webpushPath,
      filename: webpushPath,
      loaded: true,
      exports: {
        generateVAPIDKeys: () => ({
          publicKey: 'test-public-key-base64',
          privateKey: 'test-private-key-base64',
        }),
        setVapidDetails: () => {},
        sendNotification: async () => ({ statusCode: 201 }),
      },
    };

    // Also clear vapid cache so it picks up mocked web-push
    delete require.cache[require.resolve('../../src/utils/vapid')];

    ({ PushManager } = require('../../src/server/push'));
  });

  afterEach(() => {
    // Restore web-push
    const webpushPath = require.resolve('web-push');
    if (originalWebPush) {
      require.cache[webpushPath] = originalWebPush;
    } else {
      delete require.cache[webpushPath];
    }
    delete require.cache[require.resolve('../../src/server/push')];
    delete require.cache[require.resolve('../../src/utils/vapid')];

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes without error', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    assert.ok(pm.getPublicKey(), 'should have a public key after init');
  });

  it('getPublicKey returns null before init', () => {
    const pm = new PushManager(tmpDir);
    assert.strictEqual(pm.getPublicKey(), null);
  });

  it('getPublicKey returns key after init', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    assert.strictEqual(pm.getPublicKey(), 'test-public-key-base64');
  });

  it('subscribe adds a subscription', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    const sub = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    };
    pm.subscribe(sub);
    assert.strictEqual(pm.subscriptions.size, 1);
  });

  it('subscribe replaces duplicate endpoint', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    const sub1 = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    };
    const sub2 = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key2', auth: 'auth2' },
    };
    pm.subscribe(sub1);
    pm.subscribe(sub2);
    assert.strictEqual(pm.subscriptions.size, 1);
  });

  it('unsubscribe removes a subscription', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    const sub = {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'key1', auth: 'auth1' },
    };
    pm.subscribe(sub);
    pm.unsubscribe('https://push.example.com/sub1');
    assert.strictEqual(pm.subscriptions.size, 0);
  });

  it('unsubscribe is a no-op for unknown endpoint', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    pm.unsubscribe('https://push.example.com/unknown');
    assert.strictEqual(pm.subscriptions.size, 0);
  });

  it('notify sends to all subscriptions', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    let sendCount = 0;
    const webpushPath = require.resolve('web-push');
    require.cache[webpushPath].exports.sendNotification = async () => {
      sendCount++;
      return { statusCode: 201 };
    };
    pm.subscribe({
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'k1', auth: 'a1' },
    });
    pm.subscribe({
      endpoint: 'https://push.example.com/sub2',
      keys: { p256dh: 'k2', auth: 'a2' },
    });
    await pm.notify({ title: 'Test', body: 'Hello' });
    assert.strictEqual(sendCount, 2);
  });

  it('notify does nothing when no subscriptions', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    // Should not throw
    await pm.notify({ title: 'Test', body: 'Hello' });
  });

  it('notify removes stale 410 subscriptions', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    const webpushPath = require.resolve('web-push');
    require.cache[webpushPath].exports.sendNotification = async (sub) => {
      if (sub.endpoint.includes('stale')) {
        const err = new Error('Gone');
        err.statusCode = 410;
        throw err;
      }
      return { statusCode: 201 };
    };
    pm.subscribe({
      endpoint: 'https://push.example.com/good',
      keys: { p256dh: 'k', auth: 'a' },
    });
    pm.subscribe({
      endpoint: 'https://push.example.com/stale',
      keys: { p256dh: 'k', auth: 'a' },
    });
    await pm.notify({ title: 'Test', body: 'Hello' });
    assert.strictEqual(pm.subscriptions.size, 1);
    assert.ok(pm.subscriptions.has('https://push.example.com/good'));
  });

  it('notify removes 404 subscriptions', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    const webpushPath = require.resolve('web-push');
    require.cache[webpushPath].exports.sendNotification = async () => {
      const err = new Error('Not Found');
      err.statusCode = 404;
      throw err;
    };
    pm.subscribe({
      endpoint: 'https://push.example.com/invalid',
      keys: { p256dh: 'k', auth: 'a' },
    });
    await pm.notify({ title: 'Test', body: 'Hello' });
    assert.strictEqual(pm.subscriptions.size, 0);
  });

  it('notify does not throw on general send errors', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    const webpushPath = require.resolve('web-push');
    require.cache[webpushPath].exports.sendNotification = async () => {
      const err = new Error('Network error');
      err.statusCode = 500;
      throw err;
    };
    pm.subscribe({
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'k', auth: 'a' },
    });
    // Should not throw
    await pm.notify({ title: 'Test', body: 'Hello' });
    // Subscription should NOT be removed for non-410/404 errors
    assert.strictEqual(pm.subscriptions.size, 1);
  });

  it('subscribe rejects when VAPID keys not initialized', () => {
    const pm = new PushManager(tmpDir);
    // Do NOT call pm.init()
    pm.subscribe({
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'k', auth: 'a' },
    });
    assert.strictEqual(pm.subscriptions.size, 0);
  });

  it('notify skips when VAPID keys not initialized', async () => {
    const pm = new PushManager(tmpDir);
    // Do NOT call pm.init() — vapidKeys stays null
    // Manually add a subscription to bypass subscribe() guard
    pm.subscriptions.set('https://push.example.com/sub1', {
      endpoint: 'https://push.example.com/sub1',
      keys: { p256dh: 'k', auth: 'a' },
    });
    assert.strictEqual(pm.subscriptions.size, 1);
    // Should return early without error
    await pm.notify({ title: 'Test', body: 'Hello' });
    // Subscription should still be there (not processed)
    assert.strictEqual(pm.subscriptions.size, 1);
  });

  it('notify removes subscription after 5 consecutive failures', async () => {
    const pm = new PushManager(tmpDir);
    await pm.init();
    const webpushPath = require.resolve('web-push');
    require.cache[webpushPath].exports.sendNotification = async () => {
      const err = new Error('Server Error');
      err.statusCode = 500;
      throw err;
    };
    pm.subscribe({
      endpoint: 'https://push.example.com/flaky',
      keys: { p256dh: 'k', auth: 'a' },
    });
    // Send 4 times — subscription should survive
    for (let i = 0; i < 4; i++) {
      await pm.notify({ title: 'Test', body: `attempt ${i + 1}` });
      assert.strictEqual(pm.subscriptions.size, 1, `should survive after ${i + 1} failures`);
    }
    // 5th failure should trigger removal
    await pm.notify({ title: 'Test', body: 'attempt 5' });
    assert.strictEqual(pm.subscriptions.size, 0, 'should be removed after 5 consecutive failures');
  });
});
