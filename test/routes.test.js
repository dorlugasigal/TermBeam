const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
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
});
