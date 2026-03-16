const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createTermBeamServer } = require('../../src/server');

// --- Helpers ---

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

async function startServer(configOverrides = {}) {
  const instance = createTermBeamServer({ config: makeConfig(configOverrides) });
  await instance.start();
  const port = instance.server.address().port;
  return { ...instance, port };
}

// --- Tests ---

describe('GET /api/config', () => {
  describe('with password set', () => {
    let inst;
    after(() => inst?.shutdown());

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
    after(() => inst?.shutdown());

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
    after(() => inst?.shutdown());

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
