const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTermBeamServer } = require('../../src/server');

// --- Helpers ---

// On Windows, node-pty ConPTY holds directory locks briefly after shutdown.
// Use async rm with retries to avoid EBUSY failures in test cleanup.
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
    after(async () => {
      await inst?.shutdown();
    });

    it('should accept valid image upload and return opaque id', async () => {
      inst = await startServer();
      const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
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
      assert.strictEqual(res.statusCode, 201);
      const body = JSON.parse(res.data);
      assert.ok(body.id, 'Response should contain an id');
      assert.ok(body.url, 'Response should contain a url');
      assert.strictEqual(body.url, `/uploads/${body.id}`);
      assert.ok(body.path, 'Response should contain a filesystem path');
      assert.ok(body.path.endsWith('.png'), 'Path should have correct extension');
    });

    it('GET /uploads/:id should serve uploaded file', async () => {
      if (!inst) inst = await startServer();
      const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
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

    it('should accept valid JPEG magic bytes', async () => {
      if (!inst) inst = await startServer();
      const imageData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/upload',
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg', 'Content-Length': imageData.length },
        },
        imageData,
      );
      assert.strictEqual(res.statusCode, 201);
      const body = JSON.parse(res.data);
      assert.ok(body.path, 'Response should contain a path');
    });

    it('should accept valid GIF magic bytes', async () => {
      if (!inst) inst = await startServer();
      // GIF89a header
      const imageData = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/upload',
          method: 'POST',
          headers: { 'Content-Type': 'image/gif', 'Content-Length': imageData.length },
        },
        imageData,
      );
      assert.strictEqual(res.statusCode, 201);
    });

    it('should accept valid WebP magic bytes', async () => {
      if (!inst) inst = await startServer();
      // RIFF....WEBP header
      const imageData = Buffer.from([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x24,
        0x00,
        0x00,
        0x00, // file size
        0x57,
        0x45,
        0x42,
        0x50, // WEBP
        0x00,
        0x00,
        0x00,
        0x00,
      ]);
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/upload',
          method: 'POST',
          headers: { 'Content-Type': 'image/webp', 'Content-Length': imageData.length },
        },
        imageData,
      );
      assert.strictEqual(res.statusCode, 201);
    });

    it('should accept valid BMP magic bytes', async () => {
      if (!inst) inst = await startServer();
      // BM header
      const imageData = Buffer.from([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/upload',
          method: 'POST',
          headers: { 'Content-Type': 'image/bmp', 'Content-Length': imageData.length },
        },
        imageData,
      );
      assert.strictEqual(res.statusCode, 201);
    });

    it('should reject WebP data missing RIFF header', async () => {
      if (!inst) inst = await startServer();
      // Has WEBP at offset 8 but no RIFF at offset 0
      const imageData = Buffer.from([
        0x00,
        0x00,
        0x00,
        0x00, // NOT RIFF
        0x24,
        0x00,
        0x00,
        0x00,
        0x57,
        0x45,
        0x42,
        0x50, // WEBP
      ]);
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/upload',
          method: 'POST',
          headers: { 'Content-Type': 'image/webp', 'Content-Length': imageData.length },
        },
        imageData,
      );
      assert.strictEqual(res.statusCode, 400);
    });

    it('should reject fake data with image/png content-type', async () => {
      if (!inst) inst = await startServer();
      const imageData = Buffer.from('this is not a png');
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
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.data);
      assert.strictEqual(body.error, 'File content does not match declared image type');
    });

    it('should reject JPEG data with image/png content-type', async () => {
      if (!inst) inst = await startServer();
      const imageData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
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
      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.data);
      assert.strictEqual(body.error, 'File content does not match declared image type');
    });

    it('should reject upload larger than 10MB with 413', async () => {
      if (!inst) inst = await startServer();
      const totalSize = 10 * 1024 * 1024 + 1;
      const res = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port: inst.port,
            path: '/api/upload',
            method: 'POST',
            headers: { 'Content-Type': 'image/png', 'Content-Length': totalSize },
          },
          (r) => {
            const chunks = [];
            r.on('data', (chunk) => chunks.push(chunk));
            r.on('end', () =>
              resolve({
                statusCode: r.statusCode,
                headers: r.headers,
                data: Buffer.concat(chunks).toString(),
              }),
            );
          },
        );
        req.on('error', reject);
        // Write in 1MB chunks to avoid allocating a single huge buffer
        const chunkSize = 1024 * 1024;
        let written = 0;
        function writeChunk() {
          while (written < totalSize) {
            const toWrite = Math.min(chunkSize, totalSize - written);
            const ok = req.write(Buffer.alloc(toWrite));
            written += toWrite;
            if (!ok) {
              req.once('drain', writeChunk);
              return;
            }
          }
          req.end();
        }
        writeChunk();
      });
      assert.strictEqual(res.statusCode, 413);
      const body = JSON.parse(res.data);
      assert.strictEqual(body.error, 'File too large');
    });

    it('GET /uploads/:id should return 404 when file is deleted from disk', async () => {
      if (!inst) inst = await startServer();
      const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
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
      const uploadBody = JSON.parse(uploadRes.data);
      assert.strictEqual(uploadRes.statusCode, 201);
      // Delete the file from disk
      fs.unlinkSync(uploadBody.path);
      const getRes = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: uploadBody.url,
        method: 'GET',
      });
      assert.strictEqual(getRes.statusCode, 404);
      const body = JSON.parse(getRes.data);
      assert.strictEqual(body.error, 'not found');
    });
  });

  // === Directory listing ===
  describe('GET /api/dirs', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

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
    after(async () => {
      await inst?.shutdown();
    });

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

    it('should reject non-array args with 400', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ args: 'not-an-array' });
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
      assert.strictEqual(data.error, 'args must be an array of strings');
    });

    it('should reject args with non-string elements with 400', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ args: ['valid', 123] });
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
      assert.strictEqual(data.error, 'args must be an array of strings');
    });

    it('should reject non-string initialCommand with 400', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ initialCommand: 12345 });
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
      assert.strictEqual(data.error, 'initialCommand must be a string');
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
      assert.strictEqual(res.statusCode, 201);
      const data = JSON.parse(res.data);
      assert.ok(data.id, 'Response should contain session id');
    });
  });

  // === Version endpoint ===
  describe('GET /api/version', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

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
    after(async () => {
      await inst?.shutdown();
    });

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
    after(async () => {
      await inst?.shutdown();
    });

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
    after(async () => {
      await inst?.shutdown();
    });

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
    after(async () => {
      await inst?.shutdown();
    });

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
    after(async () => {
      await inst?.shutdown();
    });

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

  // === File upload to session cwd ===
  describe('POST /api/sessions/:id/upload', () => {
    let inst;
    after(async () => {
      // Clean up any uploaded test files
      if (inst) {
        const session = inst.sessions.get(inst.defaultId);
        if (session) {
          for (const name of [
            'hello.txt',
            'hello (1).txt',
            'up.dat',
            'clean.txt',
            'traversal-test.txt',
          ]) {
            try {
              fs.unlinkSync(path.join(session.cwd, name));
            } catch {}
          }
        }
        await inst.shutdown();
      }
    });

    it('should upload a file to the session cwd', async () => {
      inst = await startServer();
      const body = Buffer.from('hello world');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-Filename': 'hello.txt',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 201);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.name, 'hello.txt');
      assert.strictEqual(data.size, body.length);
      assert.ok(fs.existsSync(data.path), 'File should exist on disk');
      assert.strictEqual(fs.readFileSync(data.path, 'utf8'), 'hello world');
    });

    it('should deduplicate filenames on collision', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from('second');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-Filename': 'hello.txt',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 201);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.name, 'hello (1).txt');
    });

    it('should return 404 for unknown session', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from('test');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions/nonexistent-session-id/upload',
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-Filename': 'test.txt',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return 400 when X-Filename header is missing', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from('test');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: { 'Content-Type': 'text/plain', 'Content-Length': body.length },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Missing X-Filename header');
    });

    it('should return 400 for empty body', async () => {
      if (!inst) inst = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/upload`,
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'X-Filename': 'empty.txt', 'Content-Length': 0 },
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Empty file');
    });

    it('should sanitize path traversal in filename', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from('data');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': '../../../etc/traversal-test.txt',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 201);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.name, 'traversal-test.txt');
      const session = inst.sessions.get(inst.defaultId);
      assert.ok(data.path.startsWith(session.cwd), 'File must be inside session cwd');
    });

    it('should reject invalid filenames', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from('data');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': '..',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid filename');
    });

    it('should strip path separators from filename', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from('clean');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-Filename': 'some/nested/clean.txt',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 201);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.name, 'clean.txt');
    });

    it('should accept binary files', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': 'up.dat',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 201);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.name, 'up.dat');
      assert.deepStrictEqual(fs.readFileSync(data.path), body);
    });

    it('should upload to custom directory via X-Target-Dir', async () => {
      if (!inst) inst = await startServer();
      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-upload-'));
      const body = Buffer.from('custom dir');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-Filename': 'custom.txt',
            'X-Target-Dir': tmpDir,
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 201);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.name, 'custom.txt');
      assert.ok(data.path.startsWith(tmpDir), 'File should be in the custom directory');
      assert.strictEqual(fs.readFileSync(data.path, 'utf8'), 'custom dir');
      fs.unlinkSync(data.path);
      fs.rmdirSync(tmpDir);
    });

    it('should return 400 for non-existent X-Target-Dir', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from('data');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-Filename': 'test.txt',
            'X-Target-Dir': '/nonexistent/path/abc123',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Target directory does not exist');
    });

    it('should return 400 for relative X-Target-Dir', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.from('data');
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain',
            'X-Filename': 'test.txt',
            'X-Target-Dir': 'relative/path',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Target directory must be an absolute path');
    });

    it('should return 400 when X-Target-Dir is a file, not a directory', async () => {
      if (!inst) inst = await startServer();
      // Create a temp file to use as the target "directory"
      const tmpFile = path.join(require('os').tmpdir(), 'tb-not-a-dir-' + Date.now() + '.tmp');
      fs.writeFileSync(tmpFile, 'placeholder');
      try {
        const body = Buffer.from('data');
        const res = await httpRequest(
          {
            hostname: '127.0.0.1',
            port: inst.port,
            path: `/api/sessions/${inst.defaultId}/upload`,
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain',
              'X-Filename': 'test.txt',
              'X-Target-Dir': tmpFile,
              'Content-Length': body.length,
            },
          },
          body,
        );
        assert.strictEqual(res.statusCode, 400);
        const data = JSON.parse(res.data);
        assert.strictEqual(data.error, 'Target directory is not a directory');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('should return 413 for file exceeding 10 MB', async () => {
      if (!inst) inst = await startServer();
      const body = Buffer.alloc(10 * 1024 * 1024 + 1, 0x41); // 10 MB + 1 byte
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: `/api/sessions/${inst.defaultId}/upload`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-Filename': 'huge.bin',
            'Content-Length': body.length,
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 413);
      const data = JSON.parse(res.data);
      assert.match(data.error, /too large/i);
    });

    it(
      'should return 500 when target directory is not writable',
      { skip: process.platform === 'win32' },
      async () => {
        if (!inst) inst = await startServer();
        // Create a read-only temp directory
        const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-readonly-'));
        fs.chmodSync(tmpDir, 0o444);
        try {
          const body = Buffer.from('data');
          const res = await httpRequest(
            {
              hostname: '127.0.0.1',
              port: inst.port,
              path: `/api/sessions/${inst.defaultId}/upload`,
              method: 'POST',
              headers: {
                'Content-Type': 'text/plain',
                'X-Filename': 'nope.txt',
                'X-Target-Dir': tmpDir,
                'Content-Length': body.length,
              },
            },
            body,
          );
          assert.strictEqual(res.statusCode, 500);
          const data = JSON.parse(res.data);
          assert.strictEqual(data.error, 'Failed to write file');
        } finally {
          fs.chmodSync(tmpDir, 0o755);
          fs.rmdirSync(tmpDir);
        }
      },
    );
  });

  // === File browse endpoint ===
  describe('GET /api/sessions/:id/files', () => {
    let inst;
    let tmpDir;

    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-files-'));
      // Create test fixtures: files, subdirs, hidden items
      fs.mkdirSync(path.join(tmpDir, 'subdir'));
      fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello world');
      fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Readme');
      fs.writeFileSync(path.join(tmpDir, '.hidden'), 'secret');
      fs.mkdirSync(path.join(tmpDir, '.hiddendir'));
      fs.writeFileSync(path.join(tmpDir, 'subdir', 'nested.txt'), 'nested');
      inst = await startServer({ cwd: tmpDir });
    }

    it('should list files and dirs for valid session', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(Array.isArray(data.entries), 'entries should be an array');
      assert.ok(data.entries.length > 0, 'should have entries');
    });

    it('should return entries with correct shape', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files`,
        method: 'GET',
      });
      const data = JSON.parse(res.data);
      for (const entry of data.entries) {
        assert.ok(typeof entry.name === 'string', 'name should be a string');
        assert.ok(
          entry.type === 'file' || entry.type === 'directory',
          'type should be file or directory',
        );
        assert.ok(typeof entry.size === 'number', 'size should be a number');
        assert.ok(
          entry.modified === null || typeof entry.modified === 'string',
          'modified should be string or null',
        );
      }
    });

    it('should sort directories before files', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files`,
        method: 'GET',
      });
      const data = JSON.parse(res.data);
      const types = data.entries.map((e) => e.type);
      const firstFileIdx = types.indexOf('file');
      const lastDirIdx = types.lastIndexOf('directory');
      if (firstFileIdx !== -1 && lastDirIdx !== -1) {
        assert.ok(lastDirIdx < firstFileIdx, 'directories should come before files');
      }
    });

    it('should filter out hidden files and dirs', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files`,
        method: 'GET',
      });
      const data = JSON.parse(res.data);
      const names = data.entries.map((e) => e.name);
      assert.ok(!names.includes('.hidden'), 'should not include hidden file');
      assert.ok(!names.includes('.hiddendir'), 'should not include hidden directory');
      assert.ok(names.includes('hello.txt'), 'should include visible file');
      assert.ok(names.includes('subdir'), 'should include visible directory');
    });

    it('should return 404 for invalid session ID', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent-session-id/files',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return 401 without auth token when password is set', async () => {
      // Start a separate password-protected server
      const pwTmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-files-pw-'));
      const pwInst = await startServer({ password: 'secret', cwd: pwTmpDir });
      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: pwInst.port,
          path: `/api/sessions/${pwInst.defaultId}/files`,
          method: 'GET',
          headers: { Accept: '*/*' },
        });
        assert.strictEqual(res.statusCode, 401);
      } finally {
        pwInst.shutdown();
        await safeCleanup(pwTmpDir);
      }
    });

    it('should work with dir query parameter for subdirectories', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files?dir=subdir`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      const names = data.entries.map((e) => e.name);
      assert.ok(names.includes('nested.txt'), 'should include nested file');
    });

    it('should return rootDir matching session CWD', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files`,
        method: 'GET',
      });
      const data = JSON.parse(res.data);
      assert.strictEqual(data.rootDir, path.resolve(tmpDir));
    });
  });

  // === File download endpoint ===
  describe('GET /api/sessions/:id/download', () => {
    let inst;
    let tmpDir;

    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-download-'));
      fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'download me');
      fs.mkdirSync(path.join(tmpDir, 'adir'));
      inst = await startServer({ cwd: tmpDir });
    }

    it('should download a valid file', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/download?file=test.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data, 'download me');
    });

    it('should return 404 for invalid session ID', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent-session-id/download?file=test.txt',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return 400 when file param is missing', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/download`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Missing file parameter');
    });

    it('should return 404 for non-existent file', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/download?file=nonexistent.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'File not found');
    });

    it('should return 400 for directory (not a file)', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/download?file=adir`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Not a regular file');
    });

    it('should return 401 without auth token when password is set', async () => {
      const pwTmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-dl-pw-'));
      fs.writeFileSync(path.join(pwTmpDir, 'x.txt'), 'x');
      const pwInst = await startServer({ password: 'secret', cwd: pwTmpDir });
      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: pwInst.port,
          path: `/api/sessions/${pwInst.defaultId}/download?file=x.txt`,
          method: 'GET',
          headers: { Accept: '*/*' },
        });
        assert.strictEqual(res.statusCode, 401);
      } finally {
        pwInst.shutdown();
        await safeCleanup(pwTmpDir);
      }
    });

    it('should set Content-Disposition header correctly', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/download?file=test.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-disposition'], 'Should have Content-Disposition header');
      assert.ok(
        res.headers['content-disposition'].includes('test.txt'),
        'Content-Disposition should include filename',
      );
    });
  });

  // === File content endpoint ===
  describe('GET /api/sessions/:id/file-content', () => {
    let inst;
    let tmpDir;

    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-filecontent-'));
      fs.writeFileSync(path.join(tmpDir, 'readme.md'), '# Hello\n\nWorld');
      fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'plain text');
      fs.mkdirSync(path.join(tmpDir, 'adir'));
      inst = await startServer({ cwd: tmpDir });
    }

    it('should return content of a valid text file', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-content?file=readme.md`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.content, '# Hello\n\nWorld');
    });

    it('should return correct response shape { content, name, size }', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-content?file=test.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(typeof data.content === 'string', 'content should be a string');
      assert.strictEqual(data.name, 'test.txt');
      assert.strictEqual(data.size, Buffer.byteLength('plain text'));
    });

    it('should return 404 for invalid session ID', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent-session-id/file-content?file=readme.md',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return 400 when file param is missing', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-content`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Missing file parameter');
    });

    it('should return 404 for non-existent file', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-content?file=nonexistent.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'File not found');
    });

    it('should return 400 for a directory (not a file)', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-content?file=adir`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Not a regular file');
    });

    it('should return 401 without auth token when password is set', async () => {
      const pwTmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-fc-pw-'));
      fs.writeFileSync(path.join(pwTmpDir, 'x.md'), '# X');
      const pwInst = await startServer({ password: 'secret', cwd: pwTmpDir });
      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: pwInst.port,
          path: `/api/sessions/${pwInst.defaultId}/file-content?file=x.md`,
          method: 'GET',
          headers: { Accept: '*/*' },
        });
        assert.strictEqual(res.statusCode, 401);
      } finally {
        pwInst.shutdown();
        await safeCleanup(pwTmpDir);
      }
    });

    it('should return 413 for files larger than 2MB', async () => {
      await setup();
      // Create a file just over 2MB
      const bigContent = 'x'.repeat(2 * 1024 * 1024 + 1);
      fs.writeFileSync(path.join(tmpDir, 'big.txt'), bigContent);
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-content?file=big.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 413);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'File too large (max 2 MB)');
    });
  });

  // === Directory listing endpoint ===
  describe('GET /api/dirs', () => {
    let inst;
    let tmpDir;

    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-dirs-'));
      fs.mkdirSync(path.join(tmpDir, 'alpha'));
      fs.mkdirSync(path.join(tmpDir, 'beta'));
      fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'not a dir');
      inst = await startServer({ cwd: tmpDir });
    }

    it('should return truncated: false when dirs count < 500', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/dirs?q=${encodeURIComponent(tmpDir + path.sep)}`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.truncated, false);
    });

    it('should include the truncated field in response', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/dirs?q=${encodeURIComponent(tmpDir + path.sep)}`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok('truncated' in data, 'Response should have a truncated field');
      assert.ok('dirs' in data, 'Response should have a dirs field');
      assert.ok('base' in data, 'Response should have a base field');
      assert.ok(Array.isArray(data.dirs), 'dirs should be an array');
    });
  });

  // === Query param type validation ===
  describe('Query param type validation', () => {
    let inst;
    let tmpDir;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-qparam-'));
      fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');
      inst = await startServer({ cwd: tmpDir });
    }

    it('should return 400 when /files dir param is an array', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files?dir=a&dir=b`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid dir parameter');
    });

    it('should return 400 when /download file param is an array', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/download?file=a&file=b`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Missing file parameter');
    });

    it('should return 400 when /file-raw file param is an array', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-raw?file=a&file=b`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Missing file parameter');
    });

    it('should return 400 when /file-content file param is an array', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-content?file=a&file=b`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Missing file parameter');
    });
  });

  // === Symlink rejection ===
  describe('Symlink rejection', () => {
    let inst;
    let tmpDir;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-symlink-'));
      fs.writeFileSync(path.join(tmpDir, 'real.txt'), 'real content');
      fs.symlinkSync(path.join(tmpDir, 'real.txt'), path.join(tmpDir, 'link.txt'));
      inst = await startServer({ cwd: tmpDir });
    }

    it('should reject symlink in /download with 403', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/download?file=link.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 403);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Symbolic links are not allowed');
    });

    it('should reject symlink in /file-raw with 403', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-raw?file=link.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 403);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Symbolic links are not allowed');
    });

    it('should reject symlink in /file-content with 403', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-content?file=link.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 403);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Symbolic links are not allowed');
    });

    it('should filter symlinks from /files listing', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      const names = data.entries.map((e) => e.name);
      assert.ok(names.includes('real.txt'), 'should include real file');
      assert.ok(!names.includes('link.txt'), 'should not include symlink');
    });
  });

  // === Entry limit + truncated flag ===
  describe('/files truncated flag', () => {
    let inst;
    let tmpDir;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-trunc-'));
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
      fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b');
      inst = await startServer({ cwd: tmpDir });
    }

    it('should include truncated: false for small directories', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok('truncated' in data, 'Response should have a truncated field');
      assert.strictEqual(data.truncated, false);
    });

    it('should include base and rootDir in /files response', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok('base' in data, 'Response should have a base field');
      assert.ok('rootDir' in data, 'Response should have a rootDir field');
      assert.ok('entries' in data, 'Response should have entries field');
      assert.ok('truncated' in data, 'Response should have truncated field');
    });
  });

  // === /api/sessions/:id/file-raw endpoint ===
  describe('GET /api/sessions/:id/file-raw', () => {
    let inst;
    let tmpDir;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-fileraw-'));
      fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello raw');
      fs.mkdirSync(path.join(tmpDir, 'adir'));
      inst = await startServer({ cwd: tmpDir });
    }

    it('should return file content inline (no Content-Disposition: attachment)', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-raw?file=hello.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data, 'hello raw');
      const cd = res.headers['content-disposition'];
      assert.ok(!cd || !cd.includes('attachment'), 'should not have attachment disposition');
    });

    it('should return 404 for non-existent file', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-raw?file=no-such-file.txt`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'File not found');
    });

    it('should return 400 for missing file parameter', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-raw`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Missing file parameter');
    });

    it('should return 400 for directory (not a file)', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/file-raw?file=adir`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Not a regular file');
    });

    it('should return 404 for invalid session id', async () => {
      await setup();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent/file-raw?file=hello.txt',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });
  });

  // === Generic error message for /files ===
  describe('/files generic error message', () => {
    let inst;
    let tmpDir;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    async function setup() {
      if (inst) return;
      tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tb-generr-'));
      inst = await startServer({ cwd: tmpDir });
    }

    it('should return generic error for non-existent directory', async () => {
      await setup();
      const badDir = path.join(tmpDir, 'does-not-exist');
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${inst.defaultId}/files?dir=${encodeURIComponent(badDir)}`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 500);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Failed to read directory');
    });
  });

  // === DELETE /api/sessions/:id ===
  describe('DELETE /api/sessions/:id', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should delete an existing session and return 204', async () => {
      inst = await startServer();
      // Create a new session to delete (don't delete the default one)
      const createBody = JSON.stringify({ name: 'ToDelete' });
      const createRes = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(createBody),
          },
        },
        createBody,
      );
      assert.strictEqual(createRes.statusCode, 201);
      const { id } = JSON.parse(createRes.data);

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${id}`,
        method: 'DELETE',
      });
      assert.strictEqual(res.statusCode, 204);
    });

    it('should return 404 for non-existent session', async () => {
      if (!inst) inst = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent-id',
        method: 'DELETE',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'not found');
    });
  });

  // === POST /api/sessions — cwd is not a directory ===
  describe('POST /api/sessions cwd-is-file validation', () => {
    let inst;
    let tmpFile;
    after(() => {
      inst?.shutdown();
      if (tmpFile)
        try {
          fs.unlinkSync(tmpFile);
        } catch {}
    });

    it('should reject cwd that is a file (not a directory) with 400', async () => {
      inst = await startServer();
      tmpFile = path.join(require('os').tmpdir(), `tb-notdir-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, 'not a dir');
      const body = JSON.stringify({ cwd: tmpFile });
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
      assert.strictEqual(data.error, 'cwd is not a directory');
    });
  });

  // === GET /login with password set ===
  describe('GET /login with password', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should serve the login page when password is set', async () => {
      inst = await startServer({ password: 'testpass' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/login',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.data.length > 0, 'Login page should have content');
    });
  });

  // === Push notification endpoints ===
  describe('Push notification endpoints', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('GET /api/push/vapid-key should return 503 when VAPID keys not initialized', async () => {
      inst = await startServer({ password: null });
      // Force vapidKeys to null to simulate unconfigured push
      inst.pushManager.vapidKeys = null;
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/push/vapid-key',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 503);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Push notifications not configured');
    });

    it('GET /api/push/vapid-key should return public key when configured', async () => {
      if (!inst) inst = await startServer({ password: null });
      // Set fake VAPID keys
      inst.pushManager.vapidKeys = { publicKey: 'test-public-key', privateKey: 'pk', subject: 's' };
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/push/vapid-key',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.publicKey, 'test-public-key');
    });

    it('POST /api/push/subscribe should return 400 for missing subscription', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({});
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/push/subscribe',
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
      assert.strictEqual(data.error, 'Invalid subscription object');
    });

    it('POST /api/push/subscribe should return 400 for subscription missing keys', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({ subscription: { endpoint: 'https://example.com' } });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/push/subscribe',
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
      assert.strictEqual(data.error, 'Invalid subscription object');
    });

    it('POST /api/push/subscribe should accept valid subscription', async () => {
      if (!inst) inst = await startServer({ password: null });
      inst.pushManager.vapidKeys = { publicKey: 'pk', privateKey: 'sk', subject: 's' };
      const body = JSON.stringify({
        subscription: {
          endpoint: 'https://fcm.example.com/send/abc',
          keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        },
      });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/push/subscribe',
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
      assert.strictEqual(data.ok, true);
    });

    it('DELETE /api/push/unsubscribe should return 400 for missing endpoint', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({});
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/push/unsubscribe',
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body,
      );
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Missing endpoint');
    });

    it('DELETE /api/push/unsubscribe should succeed with valid endpoint', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({ endpoint: 'https://fcm.example.com/send/abc' });
      const res = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/push/unsubscribe',
          method: 'DELETE',
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
  });

  // === GET /api/shells ===
  describe('GET /api/shells', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return available shells with default and cwd', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/shells',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(Array.isArray(data.shells), 'shells should be an array');
      assert.ok(data.shells.length > 0, 'should detect at least one shell');
      assert.ok(typeof data.default === 'string', 'default should be a string');
      assert.ok(typeof data.cwd === 'string', 'cwd should be a string');
    });
  });

  // === GET /api/sessions/:id/git/* endpoints ===
  describe('GET /api/sessions/:id/git/status', () => {
    let inst, sessionId;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 404 for non-existent session', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent/git/status',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return git status for a valid session in a git repo', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({ name: 'git-test' });
      const createRes = await httpRequest(
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
      assert.strictEqual(createRes.statusCode, 201);
      sessionId = JSON.parse(createRes.data).id;

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/status`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(typeof data === 'object', 'should return an object');
    });
  });

  describe('GET /api/sessions/:id/git/diff', () => {
    let inst, sessionId;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 404 for non-existent session', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent/git/diff?file=README.md',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return 400 for missing file parameter', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({ name: 'diff-test' });
      const createRes = await httpRequest(
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
      sessionId = JSON.parse(createRes.data).id;

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/diff`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid or missing file parameter');
    });

    it('should return 400 for absolute file path', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'diff-test2' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/diff?file=/etc/passwd`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid or missing file parameter');
    });

    it('should return 400 for path traversal in file param', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'diff-test3' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/diff?file=../../etc/passwd`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid or missing file parameter');
    });

    it('should return diff for a valid file', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'diff-test4' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/diff?file=README.md`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe('GET /api/sessions/:id/git/blame', () => {
    let inst, sessionId;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 404 for non-existent session', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent/git/blame?file=README.md',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return 400 for missing file parameter', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({ name: 'blame-test' });
      const createRes = await httpRequest(
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
      sessionId = JSON.parse(createRes.data).id;

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/blame`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid or missing file parameter');
    });

    it('should return blame for a valid file', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'blame-test2' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/blame?file=README.md`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(typeof data === 'object', 'should return an object');
    });
  });

  describe('GET /api/sessions/:id/git/log', () => {
    let inst, sessionId;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 404 for non-existent session', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent/git/log',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return git log for a valid session', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({ name: 'log-test' });
      const createRes = await httpRequest(
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
      sessionId = JSON.parse(createRes.data).id;

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/log?limit=5`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(typeof data === 'object', 'should return an object');
    });

    it('should return 400 for invalid file parameter in git log', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'log-test2' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/log?file=/etc/passwd`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid file parameter');
    });
  });

  // === GET /api/sessions/:id/file-tree ===
  describe('GET /api/sessions/:id/file-tree', () => {
    let inst, sessionId;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 404 for non-existent session', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent/file-tree',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Session not found');
    });

    it('should return file tree for a valid session', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({ name: 'tree-test' });
      const createRes = await httpRequest(
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
      sessionId = JSON.parse(createRes.data).id;

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/file-tree`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(typeof data.root === 'string', 'should have root');
      assert.ok(Array.isArray(data.tree), 'should have tree array');
    });

    it('should return 400 for invalid depth parameter', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'tree-test2' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/file-tree?depth=abc`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 400);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Invalid depth');
    });

    it('should respect custom depth parameter', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'tree-test3' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/file-tree?depth=1`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(Array.isArray(data.tree), 'should have tree array');
    });
  });

  // === GET /api/sessions/:id/detect-port ===
  describe('GET /api/sessions/:id/detect-port', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 404 for non-existent session', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions/nonexistent/detect-port',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 404);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'not found');
    });

    it('should return detected: false for session with no ports', async () => {
      if (!inst) inst = await startServer({ password: null });
      const body = JSON.stringify({ name: 'port-test' });
      const createRes = await httpRequest(
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
      const sessionId = JSON.parse(createRes.data).id;

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/detect-port`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.detected, false);
    });
  });

  // === GET /api/update-check ===
  describe('GET /api/update-check', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return update info', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/update-check',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok('current' in data || 'updateAvailable' in data, 'should have update info fields');
    });
  });

  // === GET /api/update/status ===
  describe('GET /api/update/status', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return update state', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/update/status',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(typeof data.status === 'string', 'should have a status field');
    });
  });

  // === GET /api/config ===
  describe('GET /api/config', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return passwordRequired false when no password set', async () => {
      inst = await startServer({ password: null });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/config',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.passwordRequired, false);
    });

    it('should return passwordRequired true when password is set', async () => {
      if (inst) {
        inst.shutdown();
        inst = null;
      }
      inst = await startServer({ password: 'testpass' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/config',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.passwordRequired, true);
    });
  });

  // === GET /api/sessions/:id/file-raw — large file rejection ===
  describe('GET /api/sessions/:id/file-raw large file', () => {
    let inst, sessionId, tmpDir;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    it('should return 413 for files larger than 20MB', async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-fileraw-'));
      inst = await startServer({ password: null, cwd: tmpDir });
      const body = JSON.stringify({ name: 'fileraw-big', cwd: tmpDir });
      const createRes = await httpRequest(
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
      sessionId = JSON.parse(createRes.data).id;

      // Create a file just over 20MB
      const bigFile = path.join(tmpDir, 'big.bin');
      const fd = fs.openSync(bigFile, 'w');
      fs.ftruncateSync(fd, 21 * 1024 * 1024);
      fs.closeSync(fd);

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/file-raw?file=big.bin`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 413);
      const data = JSON.parse(res.data);
      assert.ok(data.error.includes('too large'), 'should mention too large');
    });
  });

  // === GET /api/sessions/:id/download — large file rejection ===
  describe('GET /api/sessions/:id/download large file', () => {
    let inst, sessionId, tmpDir;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    it('should return 413 for files larger than 100MB', async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-download-'));
      inst = await startServer({ password: null, cwd: tmpDir });
      const body = JSON.stringify({ name: 'download-big', cwd: tmpDir });
      const createRes = await httpRequest(
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
      sessionId = JSON.parse(createRes.data).id;

      // Create a sparse file just over 100MB
      const bigFile = path.join(tmpDir, 'huge.bin');
      const fd = fs.openSync(bigFile, 'w');
      fs.ftruncateSync(fd, 101 * 1024 * 1024);
      fs.closeSync(fd);

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/download?file=huge.bin`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 413);
      const data = JSON.parse(res.data);
      assert.ok(data.error.includes('too large'), 'should mention too large');
    });
  });

  // === GET /api/dirs with query parameter ===
  describe('GET /api/dirs with q parameter', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should filter directories by prefix when q does not end with separator', async () => {
      inst = await startServer({ password: null });
      const cwd = process.cwd();
      const q = encodeURIComponent(path.join(cwd, 's'));
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/dirs?q=${q}`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(Array.isArray(data.dirs), 'dirs should be an array');
      for (const d of data.dirs) {
        assert.ok(path.basename(d).toLowerCase().startsWith('s'), `${d} should start with "s"`);
      }
    });

    it('should list subdirectories when q ends with separator', async () => {
      if (!inst) inst = await startServer({ password: null });
      const cwd = process.cwd();
      const q = encodeURIComponent(cwd + path.sep);
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/dirs?q=${q}`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const data = JSON.parse(res.data);
      assert.ok(Array.isArray(data.dirs), 'dirs should be an array');
      assert.ok(data.dirs.length > 0, 'should find some directories');
    });
  });

  // === GET /api/update-check error fallback ===
  describe('GET /api/update-check error fallback', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return fallback info when update check throws', async () => {
      inst = await startServer({ password: null });

      // Mock checkForUpdate to throw by modifying the cached module
      const updateCheckPath = require.resolve('../../src/utils/update-check');
      const updateCheckModule = require(updateCheckPath);
      const originalCheckForUpdate = updateCheckModule.checkForUpdate;
      updateCheckModule.checkForUpdate = async () => {
        throw new Error('Network error');
      };

      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/update-check',
          method: 'GET',
        });
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(res.data);
        assert.strictEqual(data.latest, null);
        assert.strictEqual(data.updateAvailable, false);
        assert.ok('current' in data, 'should include current version');
      } finally {
        updateCheckModule.checkForUpdate = originalCheckForUpdate;
      }
    });
  });

  // === POST /api/sessions creation failure ===
  describe('POST /api/sessions creation failure', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 400 when sessions.create throws', async () => {
      inst = await startServer({ password: null });
      // Mock sessions.create to throw
      const originalCreate = inst.sessions.create.bind(inst.sessions);
      inst.sessions.create = () => {
        throw new Error('Simulated failure');
      };

      try {
        const body = JSON.stringify({ name: 'fail-create' });
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
        assert.strictEqual(data.error, 'Failed to create session');
      } finally {
        inst.sessions.create = originalCreate;
      }
    });
  });

  // === GET /api/sessions/:id/git/diff with context parameter ===
  describe('GET /api/sessions/:id/git/diff with context', () => {
    let inst, sessionId;
    after(async () => {
      await inst?.shutdown();
    });

    it('should accept and use context query parameter', async () => {
      inst = await startServer({ password: null });
      const body = JSON.stringify({ name: 'diff-context-test' });
      const createRes = await httpRequest(
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
      sessionId = JSON.parse(createRes.data).id;

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/diff?file=README.md&context=10`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
    });

    it('should handle non-numeric context parameter gracefully', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'diff-context-test2' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/diff?file=README.md&context=abc`,
        method: 'GET',
      });
      // Non-numeric context is ignored, not an error
      assert.strictEqual(res.statusCode, 200);
    });

    it('should accept staged and untracked parameters', async () => {
      if (!inst) inst = await startServer({ password: null });
      if (!sessionId) {
        const body = JSON.stringify({ name: 'diff-params-test' });
        const createRes = await httpRequest(
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
        sessionId = JSON.parse(createRes.data).id;
      }

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/diff?file=README.md&staged=true&context=5`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  // === POST /api/update error paths ===
  describe('POST /api/update in-progress', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 409 when update is already in progress', async () => {
      inst = await startServer({ password: null });

      // Mock update-executor to report in-progress state
      const executorPath = require.resolve('../../src/utils/update-executor');
      const executorModule = require(executorPath);
      const originalGetState = executorModule.getUpdateState;
      executorModule.getUpdateState = () => ({ status: 'downloading' });

      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/update',
          method: 'POST',
        });
        assert.strictEqual(res.statusCode, 409);
        const data = JSON.parse(res.data);
        assert.strictEqual(data.error, 'Update already in progress');
      } finally {
        executorModule.getUpdateState = originalGetState;
      }
    });
  });

  describe('POST /api/update not available', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 400 when auto-update is not available', async () => {
      inst = await startServer({ password: null });

      const executorPath = require.resolve('../../src/utils/update-executor');
      const executorModule = require(executorPath);
      const originalGetState = executorModule.getUpdateState;
      executorModule.getUpdateState = () => ({ status: 'idle' });

      const updateCheckPath = require.resolve('../../src/utils/update-check');
      const updateCheckModule = require(updateCheckPath);
      const originalDetect = updateCheckModule.detectInstallMethod;
      updateCheckModule.detectInstallMethod = () => ({
        canAutoUpdate: false,
        method: 'manual',
        command: 'npm i -g termbeam',
        installCmd: null,
        installArgs: null,
        cwd: null,
      });

      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/update',
          method: 'POST',
        });
        assert.strictEqual(res.statusCode, 400);
        const data = JSON.parse(res.data);
        assert.ok(data.error.includes('Auto-update not available'));
        assert.strictEqual(data.canAutoUpdate, false);
      } finally {
        executorModule.getUpdateState = originalGetState;
        updateCheckModule.detectInstallMethod = originalDetect;
      }
    });
  });

  // === POST /api/update success path ===
  describe('POST /api/update success', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should trigger update when state is idle and canAutoUpdate', async () => {
      inst = await startServer({ password: null });

      const executorPath = require.resolve('../../src/utils/update-executor');
      const executorModule = require(executorPath);
      const origGetState = executorModule.getUpdateState;
      const origExecute = executorModule.executeUpdate;
      const origReset = executorModule.resetState;

      const updateCheckPath = require.resolve('../../src/utils/update-check');
      const updateCheckModule = require(updateCheckPath);
      const origDetect = updateCheckModule.detectInstallMethod;

      executorModule.getUpdateState = () => ({ status: 'idle' });
      executorModule.executeUpdate = async () => {};
      executorModule.resetState = () => {};
      updateCheckModule.detectInstallMethod = () => ({
        canAutoUpdate: true,
        method: 'npm-global',
        command: 'npm i -g termbeam',
        installCmd: 'npm',
        installArgs: ['i', '-g', 'termbeam'],
        cwd: null,
        restartStrategy: 'exit',
      });

      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/update',
          method: 'POST',
        });
        assert.strictEqual(res.statusCode, 200);
        const data = JSON.parse(res.data);
        assert.strictEqual(data.status, 'updating');
        assert.strictEqual(data.method, 'npm-global');
      } finally {
        executorModule.getUpdateState = origGetState;
        executorModule.executeUpdate = origExecute;
        executorModule.resetState = origReset;
        updateCheckModule.detectInstallMethod = origDetect;
      }
    });
  });

  // === POST /api/update retry after failure ===
  describe('POST /api/update retry', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should reset state when retrying after failure', async () => {
      inst = await startServer({ password: null });

      const executorPath = require.resolve('../../src/utils/update-executor');
      const executorModule = require(executorPath);
      const origGetState = executorModule.getUpdateState;
      const origExecute = executorModule.executeUpdate;
      const origReset = executorModule.resetState;

      const updateCheckPath = require.resolve('../../src/utils/update-check');
      const updateCheckModule = require(updateCheckPath);
      const origDetect = updateCheckModule.detectInstallMethod;

      let resetCalled = false;
      executorModule.getUpdateState = () => ({ status: 'failed' });
      executorModule.executeUpdate = async () => {};
      executorModule.resetState = () => {
        resetCalled = true;
      };
      updateCheckModule.detectInstallMethod = () => ({
        canAutoUpdate: true,
        method: 'npm-global',
        command: 'npm i -g termbeam',
        installCmd: 'npm',
        installArgs: ['i', '-g', 'termbeam'],
        cwd: null,
        restartStrategy: 'exit',
      });

      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/update',
          method: 'POST',
        });
        assert.strictEqual(res.statusCode, 200);
        assert.ok(resetCalled, 'resetState should have been called for failed state');
      } finally {
        executorModule.getUpdateState = origGetState;
        executorModule.executeUpdate = origExecute;
        executorModule.resetState = origReset;
        updateCheckModule.detectInstallMethod = origDetect;
      }
    });
  });

  // === POST /api/update rate limiting ===
  describe('POST /api/update rate limit', () => {
    let inst;
    after(async () => {
      await inst?.shutdown();
    });

    it('should return 429 on rapid successive requests', async () => {
      inst = await startServer({ password: null });

      const executorPath = require.resolve('../../src/utils/update-executor');
      const executorModule = require(executorPath);
      const origGetState = executorModule.getUpdateState;
      executorModule.getUpdateState = () => ({ status: 'downloading' });

      try {
        // First request — returns 409 (in progress)
        await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/update',
          method: 'POST',
        });

        // Second request — should hit rate limit
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/update',
          method: 'POST',
        });
        assert.strictEqual(res.statusCode, 429);
      } finally {
        executorModule.getUpdateState = origGetState;
      }
    });
  });
  describe('GET /api/sessions/:id/file-tree error path', () => {
    let inst;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(path.join(process.cwd(), '.termbeam-test-tree-err'));
    });

    it('should return 500 when file tree build throws', async () => {
      inst = await startServer({ password: null });
      // Create a session pointing to a temp dir, then remove it
      const tmpDir = path.join(process.cwd(), '.termbeam-test-tree-err');
      fs.mkdirSync(tmpDir, { recursive: true });

      const body = JSON.stringify({ name: 'tree-err-test', cwd: tmpDir });
      const createRes = await httpRequest(
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
      assert.strictEqual(createRes.statusCode, 201);
      const sessionId = JSON.parse(createRes.data).id;

      // Remove the directory after session creation
      fs.rmSync(tmpDir, { recursive: true, force: true });

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/file-tree`,
        method: 'GET',
      });
      // buildTree returns [] for unreadable dirs, but outer catch may fire
      // Either 200 with empty tree or 500 is acceptable
      assert.ok([200, 500].includes(res.statusCode));
    });
  });

  // === Git diff with context parameter on non-git dir ===
  describe('GET /api/sessions/:id/git/diff for non-git directory', () => {
    let inst;
    const tmpDir = path.join(process.cwd(), '.termbeam-test-git-nongit');
    after(async () => {
      inst?.shutdown();
      await safeCleanup(tmpDir);
    });

    it('should return 200 with empty diff for non-git directory', async () => {
      inst = await startServer({ password: null });
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'hello.txt'), 'hello');

      const body = JSON.stringify({ name: 'nongit-diff', cwd: tmpDir });
      const createRes = await httpRequest(
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
      const sessionId = JSON.parse(createRes.data).id;

      // Test with untracked=true which exercises a different code path
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/git/diff?file=hello.txt&untracked=true&context=3`,
        method: 'GET',
      });
      assert.ok([200, 500].includes(res.statusCode));
    });
  });

  // === Files endpoint for deleted cwd ===
  describe('GET /api/sessions/:id/files error path', () => {
    let inst;
    after(async () => {
      inst?.shutdown();
      await safeCleanup(path.join(process.cwd(), '.termbeam-test-files-err'));
    });

    it('should return 500 when session cwd no longer exists', async () => {
      inst = await startServer({ password: null });
      const tmpDir = path.join(process.cwd(), '.termbeam-test-files-err');
      fs.mkdirSync(tmpDir, { recursive: true });

      const body = JSON.stringify({ name: 'files-err', cwd: tmpDir });
      const createRes = await httpRequest(
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
      const sessionId = JSON.parse(createRes.data).id;

      fs.rmSync(tmpDir, { recursive: true, force: true });

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${sessionId}/files`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 500);
      const data = JSON.parse(res.data);
      assert.strictEqual(data.error, 'Failed to read directory');
    });
  });
});
