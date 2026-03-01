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
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        data: Buffer.concat(chunks).toString(),
      }));
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

    it('should accept valid image upload and return path', async () => {
      inst = await startServer();
      const imageData = Buffer.from('fakepngdata');
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/upload',
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'Content-Length': imageData.length },
      }, imageData);
      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.data);
      assert.ok(body.path, 'Response should contain a path');
      assert.ok(body.path.includes('termbeam-'), 'Path should contain termbeam prefix');
    });

    it('should reject non-image content-type with 400', async () => {
      if (!inst) inst = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/upload',
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Content-Length': 4 },
      }, 'test');
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
      const fakePath = process.platform === 'win32'
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
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body);
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid shell');
    });

    it('should reject relative cwd with 400', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ cwd: 'relative/path' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body);
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'cwd must be an absolute path');
    });

    it('should reject nonexistent cwd with 400', async () => {
      if (!inst) inst = await startServer();
      const fakeCwd = process.platform === 'win32'
        ? 'C:\\nonexistent_dir_termbeam_xyz'
        : '/nonexistent_dir_termbeam_xyz';
      const body = JSON.stringify({ cwd: fakeCwd });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body);
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'cwd does not exist');
    });

    it('should create session with valid data', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ name: 'Valid Session' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body);
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
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}`,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body);
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.ok, true);
    });

    it('should return 404 for nonexistent session', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ color: '#00ff00' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent-id',
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body);
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

    it('POST /api/auth with wrong password should return 401', async () => {
      inst?.shutdown();
      inst = await startServer({ password: 'secret123' });
      const body = JSON.stringify({ password: 'wrongpassword' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/auth',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body);
      assert.strictEqual(res.statusCode, 401);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'wrong password');
    });
  });
});
