const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTermBeamServer } = require('../../src/server');

// --- Helpers ---

async function safeCleanup(dir) {
  if (!dir) return;
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}

const baseConfig = {
  port: 0,
  host: '127.0.0.1',
  password: null,
  useTunnel: false,
  persistedTunnel: false,
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  shellArgs: [],
  cwd: process.cwd(),
  defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  version: '0.1.0-test',
  logLevel: 'error',
};

function makeConfig(overrides = {}) {
  return { ...baseConfig, ...overrides };
}

function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

const startedConfigDirs = [];

async function startServer(configOverrides = {}) {
  // Isolate per-server config dir so workspace prefs from a developer's
  // ~/.termbeam/prefs.json don't bleed into the test (would override the
  // expected default session and break unrelated assertions).
  const tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-cfg-cfg-'));
  startedConfigDirs.push(tmpConfigDir);
  const instance = createTermBeamServer({
    config: makeConfig({ configDir: tmpConfigDir, ...configOverrides }),
  });
  await instance.start();
  const port = instance.server.address().port;
  return { ...instance, port };
}

async function cleanupConfigDirs() {
  while (startedConfigDirs.length > 0) {
    await safeCleanup(startedConfigDirs.pop());
  }
}

// --- Tests ---

describe('GET /api/config', () => {
  describe('with password set', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
      await cleanupConfigDirs();
    });

    it('returns passwordRequired: true', async () => {
      inst = await startServer({ password: 'testpass' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/config',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.deepStrictEqual(body, { passwordRequired: true });
    });
  });

  describe('with no password', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
      await cleanupConfigDirs();
    });

    it('returns passwordRequired: false', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/config',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.deepStrictEqual(body, { passwordRequired: false });
    });
  });

  describe('does not require authentication', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
      await cleanupConfigDirs();
    });

    it('returns 200 without any auth cookie or token', async () => {
      inst = await startServer({ password: 'secretpass' });
      // No cookie or authorization header — should still succeed
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/config',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.strictEqual(body.passwordRequired, true);
    });
  });
});
