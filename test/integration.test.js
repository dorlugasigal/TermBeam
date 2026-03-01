const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const WebSocket = require('ws');
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

function waitForMessage(ws, predicate, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
    function onMessage(data) {
      const msg = JSON.parse(data.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.removeListener('message', onMessage);
        resolve(msg);
      }
    }
    ws.on('message', onMessage);
  });
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function waitForOpen(ws, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), timeout);
    ws.on('open', () => { clearTimeout(timer); resolve(); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function startServer(configOverrides = {}) {
  const instance = createTermBeamServer({ config: makeConfig(configOverrides) });
  const { defaultId } = await instance.start();
  const port = instance.server.address().port;
  return { ...instance, port, defaultId };
}

// --- Tests ---

describe('Integration', () => {
  describe('Server starts and serves the hub page', () => {
    let inst;
    after(() => inst?.shutdown());

    it('GET / should return 200 with HTML containing "TermBeam"', async () => {
      inst = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.data.includes('TermBeam'), 'Response should contain "TermBeam"');
    });
  });

  describe('Server starts with password and redirects to login', () => {
    let inst;
    after(() => inst?.shutdown());

    it('GET / should redirect, POST /api/auth should authenticate, then GET / returns 200', async () => {
      inst = await startServer({ password: 'testpass123' });

      // GET / should redirect to /login
      const res1 = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/',
        method: 'GET',
        headers: { Accept: 'text/html' },
      });
      assert.strictEqual(res1.statusCode, 302);
      assert.ok(res1.headers.location.includes('/login'), 'Should redirect to /login');

      // POST /api/auth with correct password
      const authBody = JSON.stringify({ password: 'testpass123' });
      const res2 = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/auth',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(authBody) },
        },
        authBody,
      );
      assert.strictEqual(res2.statusCode, 200);
      const setCookie = res2.headers['set-cookie'];
      assert.ok(setCookie, 'Should have set-cookie header');
      const cookie = setCookie[0].split(';')[0];

      // GET / with cookie should return 200
      const res3 = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/',
        method: 'GET',
        headers: { Cookie: cookie },
      });
      assert.strictEqual(res3.statusCode, 200);
    });
  });

  describe('Full WebSocket terminal flow (no password)', () => {
    let inst;
    let ws;
    after(async () => {
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
      inst?.shutdown();
    });

    it('should attach, send input, receive output, and resize', async () => {
      inst = await startServer();

      // GET /api/sessions should return the default session
      const sessRes = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      assert.strictEqual(sessRes.statusCode, 200);
      const sessions = JSON.parse(sessRes.data);
      assert.ok(sessions.length >= 1, 'Should have at least one session');
      const defaultSessionId = sessions[0].id;

      // Connect WebSocket
      ws = new WebSocket(`ws://127.0.0.1:${inst.port}/ws`, {
        headers: { Origin: `http://127.0.0.1:${inst.port}` },
      });
      await waitForOpen(ws);

      // Attach to the default session
      const attachedPromise = waitForMessage(ws, (m) => m.type === 'attached');
      ws.send(JSON.stringify({ type: 'attach', sessionId: defaultSessionId }));
      const attachedMsg = await attachedPromise;
      assert.strictEqual(attachedMsg.type, 'attached');
      assert.strictEqual(attachedMsg.sessionId, defaultSessionId);

      // Send input and wait for output containing the echo marker
      const marker = `helloTB${Date.now()}`;
      const outputPromise = waitForMessage(ws, (m) => m.type === 'output' && m.data.includes(marker), 15000);
      ws.send(JSON.stringify({ type: 'input', data: `echo ${marker}\r` }));
      const outputMsg = await outputPromise;
      assert.ok(outputMsg.data.includes(marker), 'Output should contain the echoed marker');

      // Send resize
      ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 40 }));

      // Close WebSocket
      ws.close();
    });
  });

  describe('WebSocket requires auth when password is set', () => {
    let inst;
    let ws;
    after(async () => {
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
      inst?.shutdown();
    });

    it('should receive error and close when not authenticated', async () => {
      inst = await startServer({ password: 'securepass' });

      ws = new WebSocket(`ws://127.0.0.1:${inst.port}/ws`, {
        headers: { Origin: `http://127.0.0.1:${inst.port}` },
      });
      await waitForOpen(ws);

      const errorPromise = waitForMessage(ws, (m) => m.type === 'error');
      ws.send(JSON.stringify({ type: 'attach', sessionId: 'anything' }));
      const errorMsg = await errorPromise;
      assert.strictEqual(errorMsg.type, 'error');
      assert.strictEqual(errorMsg.message, 'Unauthorized');

      // Wait for close
      await new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.on('close', resolve);
        setTimeout(resolve, 2000);
      });
    });
  });

  describe('Session creation and deletion via REST API', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should create and delete sessions', async () => {
      inst = await startServer();

      // POST /api/sessions to create a new session
      const createBody = JSON.stringify({ name: 'Test Session' });
      const createRes = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(createBody) },
        },
        createBody,
      );
      assert.strictEqual(createRes.statusCode, 200);
      const created = JSON.parse(createRes.data);
      assert.ok(created.id, 'Created session should have an id');

      // GET /api/sessions should include both sessions
      const listRes1 = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      const list1 = JSON.parse(listRes1.data);
      assert.strictEqual(list1.length, 2, 'Should have 2 sessions');

      // DELETE /api/sessions/:id
      const deleteRes = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/api/sessions/${created.id}`,
        method: 'DELETE',
      });
      assert.strictEqual(deleteRes.statusCode, 200);

      // Wait for the PTY onExit handler to remove the session from the map
      await new Promise((resolve) => {
        const poll = setInterval(async () => {
          const r = await httpRequest({
            hostname: '127.0.0.1',
            port: inst.port,
            path: '/api/sessions',
            method: 'GET',
          });
          const list = JSON.parse(r.data);
          if (list.length <= 1) {
            clearInterval(poll);
            resolve();
          }
        }, 100);
        setTimeout(() => { clearInterval(poll); resolve(); }, 5000);
      });

      // GET /api/sessions should only have the default session
      const listRes2 = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      const list2 = JSON.parse(listRes2.data);
      assert.strictEqual(list2.length, 1, 'Should have 1 session after deletion');
    });
  });

  describe('Security headers are present', () => {
    let inst;
    after(() => inst?.shutdown());

    it('response should include security headers', async () => {
      inst = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/',
        method: 'GET',
      });
      assert.ok(res.headers['x-content-type-options'], 'Should have X-Content-Type-Options');
      assert.ok(res.headers['x-frame-options'], 'Should have X-Frame-Options');
      assert.ok(res.headers['content-security-policy'], 'Should have Content-Security-Policy');
      assert.ok(res.headers['cache-control'], 'Should have Cache-Control');
      assert.ok(res.headers['referrer-policy'], 'Should have Referrer-Policy');

      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['x-frame-options'], 'DENY');
      assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
      assert.strictEqual(res.headers['cache-control'], 'no-store');
    });
  });

  describe('Rate limiting on login', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should return 429 after 5 failed login attempts', async () => {
      inst = await startServer({ password: 'ratelimitpw' });

      const wrongBody = JSON.stringify({ password: 'wrong' });

      // Send 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        const res = await httpRequest(
          {
            hostname: '127.0.0.1',
            port: inst.port,
            path: '/api/auth',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(wrongBody) },
          },
          wrongBody,
        );
        assert.strictEqual(res.statusCode, 401, `Attempt ${i + 1} should return 401`);
      }

      // 6th attempt should return 429
      const res6 = await httpRequest(
        {
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/auth',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(wrongBody) },
        },
        wrongBody,
      );
      assert.strictEqual(res6.statusCode, 429, '6th attempt should be rate limited');
    });
  });
});
