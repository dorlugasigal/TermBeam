const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('vapid', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vapid-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates new VAPID keys when none exist', () => {
    const { getOrCreateVapidKeys } = require('../../src/utils/vapid');
    const keys = getOrCreateVapidKeys(tmpDir);
    assert.ok(keys.publicKey, 'should have publicKey');
    assert.ok(keys.privateKey, 'should have privateKey');
    assert.strictEqual(keys.subject, 'https://termbeam.dev');
    assert.ok(keys.publicKey.length > 20, 'publicKey should be a non-trivial string');
  });

  it('persists keys to vapid.json', () => {
    const { getOrCreateVapidKeys } = require('../../src/utils/vapid');
    getOrCreateVapidKeys(tmpDir);
    const vapidPath = path.join(tmpDir, 'vapid.json');
    assert.ok(fs.existsSync(vapidPath), 'vapid.json should exist');
    const saved = JSON.parse(fs.readFileSync(vapidPath, 'utf8'));
    assert.ok(saved.publicKey);
    assert.ok(saved.privateKey);
  });

  it('loads existing keys from vapid.json', () => {
    const { getOrCreateVapidKeys } = require('../../src/utils/vapid');
    const first = getOrCreateVapidKeys(tmpDir);
    const second = getOrCreateVapidKeys(tmpDir);
    assert.strictEqual(second.publicKey, first.publicKey);
    assert.strictEqual(second.privateKey, first.privateKey);
  });

  it('creates configDir if it does not exist', () => {
    const { getOrCreateVapidKeys } = require('../../src/utils/vapid');
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    const keys = getOrCreateVapidKeys(nested);
    assert.ok(keys.publicKey);
    assert.ok(fs.existsSync(path.join(nested, 'vapid.json')));
  });

  it('regenerates keys if vapid.json is corrupt', () => {
    const { getOrCreateVapidKeys } = require('../../src/utils/vapid');
    const vapidPath = path.join(tmpDir, 'vapid.json');
    fs.writeFileSync(vapidPath, 'not json');
    const keys = getOrCreateVapidKeys(tmpDir);
    assert.ok(keys.publicKey);
    assert.ok(keys.privateKey);
  });

  it('regenerates keys if vapid.json has missing fields', () => {
    const { getOrCreateVapidKeys } = require('../../src/utils/vapid');
    const vapidPath = path.join(tmpDir, 'vapid.json');
    fs.writeFileSync(vapidPath, JSON.stringify({ publicKey: 'abc' }));
    const keys = getOrCreateVapidKeys(tmpDir);
    assert.ok(keys.publicKey);
    assert.ok(keys.privateKey);
    // New keys should be generated, not the partial ones
    assert.notStrictEqual(keys.publicKey, 'abc');
  });
});
