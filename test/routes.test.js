const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const { createTermBeamServer } = require('../src/server');

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

function httpRequest(options, body) {
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
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function startServer(configOverrides = {}) {
  const instance = createTermBeamServer({ config: makeConfig(configOverrides) });
  const { defaultId } = await instance.start();
  const port = instance.server.address().port;
  return { ...instance, port, defaultId };
}

// --- Tests ---

describe('Routes', () => {
  // === Image upload endpoint ===
  describe('POST /api/upload', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should accept valid image upload and return opaque id', async () => {
      inst = await startServer();
      const imageData = Buffer.from('fakepngdata');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/upload',
          method: 'POST',
          headers: { 'Content-Type': 'image/png', 'Content-Length': imageData.length },
        },
        imageData,
      );
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.ok(body.id, 'Response should contain an id');
      assert.ok(body.url, 'Response should contain a url');
      assert.strictEqual(body.url, `/uploads/${body.id}`);
      assert.strictEqual(body.path, undefined, 'Response must not contain absolute path');
    });

    it('GET /uploads/:id should serve uploaded file', async () => {
      if (!inst) inst = await startServer();
      const imageData = Buffer.from('fakepngdata');
      const uploadRes = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/upload',
          method: 'POST',
          headers: { 'Content-Type': 'image/png', 'Content-Length': imageData.length },
        },
        imageData,
      );
      const body = JSON.parse(uploadRes.data);
      const getRes = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: body.url,
        method: 'GET',
      });
      assert.strictEqual(getRes.statusCode, 200);
      assert.strictEqual(getRes.data, imageData.toString());
    });

    it('GET /uploads/:id should return 404 for unknown id', async () => {
      if (!inst) inst = await startServer();
      const getRes = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/uploads/nonexistent-id',
        method: 'GET',
      });
      assert.strictEqual(getRes.statusCode, 404);
      const body = JSON.parse(getRes.data);
      assert.strictEqual(body.error, 'not found');
    });

    it('should reject non-image content-type with 400', async () => {
      if (!inst) inst = await startServer();
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/upload',
          method: 'POST',
          headers: { 'Content-Type': 'text/plain', 'Content-Length': 4 },
        },
        'test',
      );
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.data);
      assert.strictEqual(body.error, 'Invalid content type');
    });

    it('should reject empty body with 400', async () => {
      if (!inst) inst = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/upload',
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'Content-Length': 0 },
      });
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.data);
      assert.strictEqual(body.error, 'No image data');
    });
  });

  // === Directory listing ===
  describe('GET /api/dirs', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should return dirs from server cwd when no query', async () => {
      inst = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/dirs',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.ok(Array.isArray(body.dirs), 'dirs should be an array');
      assert.ok(body.base, 'base should be present');
    });

    it('should return subdirectories for a valid path', async () => {
      if (!inst) inst = await startServer();
      const cwd = process.cwd();
      const q = encodeURIComponent(cwd + path.sep);
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/dirs?q=${q}`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.ok(Array.isArray(body.dirs), 'dirs should be an array');
      // cwd has subdirectories like src, test, etc.
      assert.ok(body.dirs.length > 0, 'Should have subdirectories');
    });

    it('should return empty dirs for nonexistent path', async () => {
      if (!inst) inst = await startServer();
      const fakePath =
        process.platform === 'win32'
          ? 'C:\\nonexistent_termbeam_test_dir\\'
          : '/nonexistent_termbeam_test_dir/';
      const q = encodeURIComponent(fakePath);
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/dirs?q=${q}`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.ok(Array.isArray(body.dirs), 'dirs should be an array');
      assert.strictEqual(body.dirs.length, 0, 'Should have no dirs for nonexistent path');
    });
  });

  // === Session creation validation ===
  describe('POST /api/sessions validation', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should reject invalid shell with 400', async () => {
      inst = await startServer();
      const body = JSON.stringify({ shell: '/usr/bin/nonexistent_shell_xyz' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid shell');
    });

    it('should reject relative cwd with 400', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ cwd: 'relative/path' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'cwd must be an absolute path');
    });

    it('should reject nonexistent cwd with 400', async () => {
      if (!inst) inst = await startServer();
      const fakeCwd =
        process.platform === 'win32'
          ? 'C:\\nonexistent_dir_termbeam_xyz'
          : '/nonexistent_dir_termbeam_xyz';
      const body = JSON.stringify({ cwd: fakeCwd });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'cwd does not exist');
    });

    it('should create session with valid data', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ name: 'Valid Session' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(data.id, 'Response should contain session id');
    });
  });

  // === Version endpoint ===
  describe('GET /api/version', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should return version', async () => {
      inst = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/version',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.ok(body.version, 'Response should contain version');
    });
  });

  // === Session PATCH endpoint ===
  describe('PATCH /api/sessions/:id', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should update session color and name', async () => {
      inst = await startServer();
      const sessionId = inst.defaultId;
      const body = JSON.stringify({ color: '#ff0000', name: 'Renamed' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${sessionId}`,
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.ok, true);
    });

    it('should return 404 for nonexistent session', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ color: '#00ff00' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions/nonexistent-id',
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'not found');
    });
  });

  // === Login/Auth flow ===
  describe('Auth flow', () => {
    let inst;
    after(() => inst?.shutdown());

    it('GET /login should redirect to / when no password set', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/login',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 302);
      assert.ok(res.headers.location === '/' || res.headers.location.includes('/'));
    });

    it('GET /api/sessions without auth should return 401 JSON', async () => {
      inst?.shutdown();
      inst = await startServer({ password: 'secret123' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
        headers: { Accept: '*/*' },
      });
      assert.strictEqual(res.statusCode, 401);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'unauthorized');
    });

    it('POST /api/auth with wrong password should return 401', async () => {
      inst?.shutdown();
      inst = await startServer({ password: 'secret123' });
      const body = JSON.stringify({ password: 'wrongpassword' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/auth',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 401);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'wrong password');
    });
  });

  // === Share token auto-login ===
  describe('share token auto-login', () => {
    let inst;
    after(() => inst?.shutdown());

    it('GET /?ott=<valid> should set cookie and redirect to /', async () => {
      inst = await startServer({ password: 'secret' });
      const ott = inst.auth.generateShareToken();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/?ott=${ott}`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 302);
      assert.strictEqual(res.headers.location, '/');
      assert.ok(res.headers['set-cookie'], 'Should set a cookie');
      assert.ok(res.headers['set-cookie'].some((c) => c.startsWith('pty_token=')));
    });

    it('GET /?ott=<valid> with existing cookie should redirect without re-validating', async () => {
      if (!inst) inst = await startServer({ password: 'secret' });
      const ott = inst.auth.generateShareToken();
      // First use — get a cookie
      const first = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/?ott=${ott}`,
        method: 'GET',
      });
      const setCookie = first.headers['set-cookie'] || [];
      const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
      // Second use with cookie — should just redirect
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/?ott=${ott}`,
        method: 'GET',
        headers: { Cookie: cookieHeader },
      });
      assert.strictEqual(res.statusCode, 302);
      assert.strictEqual(res.headers.location, '/');
    });

    it('GET /?ott=<invalid> should not set cookie', async () => {
      if (!inst) inst = await startServer({ password: 'secret' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/?ott=invalid-fake-token',
        method: 'GET',
      });
      const cookies = res.headers['set-cookie'] || [];
      assert.ok(
        !cookies.some((c) => c.startsWith('pty_token=')),
        'Should not set pty_token for invalid share token',
      );
    });

    it('GET /?ott=<valid> should fail on second use (one-time token)', async () => {
      if (!inst) {
        inst?.shutdown();
        inst = await startServer({ password: 'secret' });
      }
      const ott = inst.auth.generateShareToken();
      // First use — should succeed
      const first = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/?ott=${ott}`,
        method: 'GET',
      });
      assert.strictEqual(first.statusCode, 302);
      assert.ok(first.headers['set-cookie']);

      // Second use — token already consumed, should fall through to auth middleware
      const second = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/?ott=${ott}`,
        method: 'GET',
      });
      // Should either redirect to /login (302) or serve login page — NOT set a new cookie
      const secondCookies = second.headers['set-cookie'] || [];
      assert.ok(
        !secondCookies.some((c) => c.startsWith('pty_token=')),
        'Should not set pty_token on second use of consumed token',
      );
    });

    it('GET /?ott= is ignored when no password is set', async () => {
      inst?.shutdown();
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/?ott=anything',
        method: 'GET',
      });
      // No password means page is served directly (200)
      assert.strictEqual(res.statusCode, 200);
    });
  });

  // === Cookie Secure flag ===
  describe('cookie Secure flag', () => {
    let inst;
    after(() => inst?.shutdown());

    it('POST /api/auth should set Secure cookie when X-Forwarded-Proto is https', async () => {
      inst = await startServer({ password: 'secret' });
      const body = JSON.stringify({ password: 'secret' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/auth',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-Forwarded-Proto': 'https',
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 200);
      const cookies = res.headers['set-cookie'] || [];
      const ptyCookie = cookies.find((c) => c.startsWith('pty_token='));
      assert.ok(ptyCookie, 'Should set pty_token cookie');
      assert.ok(/;\s*Secure/i.test(ptyCookie), 'Cookie should include Secure flag');
    });

    it('POST /api/auth should NOT set Secure cookie over plain HTTP', async () => {
      if (!inst) inst = await startServer({ password: 'secret' });
      const body = JSON.stringify({ password: 'secret' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/auth',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 200);
      const cookies = res.headers['set-cookie'] || [];
      const ptyCookie = cookies.find((c) => c.startsWith('pty_token='));
      assert.ok(ptyCookie, 'Should set pty_token cookie');
      assert.ok(!/;\s*Secure/i.test(ptyCookie), 'Cookie should NOT include Secure flag');
    });

    it('GET /?ott=<valid> should set Secure cookie when X-Forwarded-Proto is https', async () => {
      if (!inst) inst = await startServer({ password: 'secret' });
      const ott = inst.auth.generateShareToken();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/?ott=${ott}`,
        method: 'GET',
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.strictEqual(res.statusCode, 302);
      const cookies = res.headers['set-cookie'] || [];
      const ptyCookie = cookies.find((c) => c.startsWith('pty_token='));
      assert.ok(ptyCookie, 'Should set pty_token cookie');
      assert.ok(/;\s*Secure/i.test(ptyCookie), 'Cookie should include Secure flag');
    });
  });

  // === Share token endpoint ===
  describe('GET /api/share-token', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should return 404 when auth is disabled', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/share-token',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
    });

    it('should return a URL with share token when authenticated', async () => {
      inst?.shutdown();
      inst = await startServer({ password: 'secret' });
      // Get a session token via login first
      const loginBody = JSON.stringify({ password: 'secret' });
      const loginRes = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/auth',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(loginBody),
          },
        },
        loginBody,
      );
      assert.strictEqual(loginRes.statusCode, 200);
      const setCookie = loginRes.headers['set-cookie'] || [];
      const cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/share-token',
        method: 'GET',
        headers: { Cookie: cookieHeader },
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(data.url, 'Response should contain url');
      assert.ok(data.url.includes('?ott='), 'URL should contain share token parameter');
    });

    it('should return 401 when not authenticated', async () => {
      if (!inst) inst = await startServer({ password: 'secret' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/share-token',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 401);
    });
  });
});
