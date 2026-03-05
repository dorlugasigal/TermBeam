const { describe, it, after, before } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');

// Isolate connection.json to a temp dir so tests don't collide
const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-test-'));
process.env.TERMBEAM_CONFIG_DIR = testConfigDir;

const { createTermBeamServer, getLocalIP } = require('../src/server');
const { removeConnectionConfig } = require('../src/resume');

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
    ws.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
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
  after(() => {
    fs.rmSync(testConfigDir, { recursive: true, force: true });
    delete process.env.TERMBEAM_CONFIG_DIR;
  });

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
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(authBody),
          },
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

      // Send resize first — first client is deferred until resize
      ws.send(JSON.stringify({ type: 'resize', cols: 100, rows: 40 }));

      // Send input and wait for output containing the echo marker
      const marker = `helloTB${Date.now()}`;
      const outputPromise = waitForMessage(
        ws,
        (m) => m.type === 'output' && m.data.includes(marker),
        15000,
      );
      ws.send(JSON.stringify({ type: 'input', data: `echo ${marker}\r` }));
      const outputMsg = await outputPromise;
      assert.ok(outputMsg.data.includes(marker), 'Output should contain the echoed marker');

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
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(createBody),
          },
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
        setTimeout(() => {
          clearInterval(poll);
          resolve();
        }, 5000);
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
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(wrongBody),
            },
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
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(wrongBody),
          },
        },
        wrongBody,
      );
      assert.strictEqual(res6.statusCode, 429, '6th attempt should be rate limited');
    });
  });

  describe('npx simulation: parent process is node, not a shell', () => {
    after(() => removeConnectionConfig());

    it('should start and print the banner when spawned by a node process (like npx)', async () => {
      // Clean up any stale connection config from other tests
      removeConnectionConfig();
      // This exactly reproduces the npx scenario: node (npx) → node (termbeam)
      // The parent process is "node", which is NOT a shell, so shell detection
      // must fall back to $SHELL or /bin/sh instead of trying to spawn "node" as a shell.
      const entryPoint = path.resolve(__dirname, '..', 'bin', 'termbeam.js');
      const output = await new Promise((resolve, reject) => {
        let buf = '';
        const child = spawn(
          process.execPath,
          [entryPoint, '--no-tunnel', '--no-password', '--log-level', 'debug', '--force'],
          {
            env: { ...process.env, PORT: '0' },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        child.stdout.on('data', (d) => {
          buf += d;
        });
        child.stderr.on('data', (d) => {
          buf += d;
        });
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          resolve(buf);
        }, 5000);
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        child.on('exit', (_code) => {
          clearTimeout(timer);
          // If the process crashed (non-signal exit), the test should fail
          // with the captured output for easier debugging
          resolve(buf);
        });
      });

      // Must NOT contain "posix_spawnp failed" — that means we tried to spawn
      // a non-shell process (the original bug)
      assert.ok(
        !output.includes('posix_spawnp failed'),
        'Should not crash with posix_spawnp failed, got: ' + output.slice(0, 300),
      );

      // Must contain the banner — proves the server actually started
      assert.ok(
        output.includes('Beam your terminal') || output.includes('TERMBEAM'),
        'Should print banner, got: ' + output.slice(0, 300),
      );

      // Debug output should show it detected "node" and fell back
      assert.ok(
        output.includes('not a known shell') || output.includes('Falling back'),
        'Should log shell detection fallback, got: ' + output.slice(0, 500),
      );
    });
  });

  describe('Server rejects invalid shell and falls back gracefully', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should start even when defaultShell is an invalid process name', async () => {
      // Simulate the npx bug: defaultShell is garbage but shell is a real shell
      inst = await startServer({
        defaultShell: 'npm exec termbeam@latest --log-level=debug',
      });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const sessions = JSON.parse(res.data);
      assert.ok(sessions.length >= 1, 'Should have at least one session');
    });

    it('POST /api/sessions with invalid shell should return 400', async () => {
      if (!inst) inst = await startServer();
      const body = JSON.stringify({ name: 'bad', shell: 'npm exec termbeam' });
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
  });

  describe('Server with LAN-reachable host', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should display LAN-accessible bind and LAN URL when host is 0.0.0.0', async () => {
      inst = await startServer({ host: '0.0.0.0' });
      // Just verify the server started and is accessible
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const sessions = JSON.parse(res.data);
      assert.ok(sessions.length >= 1, 'Should have at least one session');
    });
  });

  describe('Server with password shows password in banner', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should start with password and serve pages', async () => {
      inst = await startServer({ password: 'banner-test-pw', host: '0.0.0.0' });
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
        headers: { authorization: 'Bearer banner-test-pw' },
      });
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe('Server shutdown is idempotent', () => {
    it('should not throw on double shutdown', async () => {
      const inst = await startServer();
      inst.shutdown();
      inst.shutdown(); // should be a no-op
    });
  });

  describe('getLocalIP', () => {
    it('should return a valid IPv4 address', () => {
      const ip = getLocalIP();
      assert.ok(typeof ip === 'string');
      // Should be a valid IPv4 format
      assert.match(ip, /^\d+\.\d+\.\d+\.\d+$/);
    });
  });

  describe('Git info in session list', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should return git info for sessions in a git repo', async () => {
      inst = await startServer({ cwd: process.cwd() });

      // Wait for async git cache to populate (lsof + git commands)
      let sessions;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions',
          method: 'GET',
        });
        sessions = JSON.parse(res.data);
        if (sessions[0]?.git) break;
      }

      assert.ok(sessions.length >= 1, 'Should have at least one session');
      const session = sessions[0];
      assert.ok(session.git, 'Session in git repo should have git info');
      assert.ok(session.git.branch, 'Should have a branch name');
      assert.ok(session.git.status, 'Should have status info');
      assert.strictEqual(typeof session.git.status.clean, 'boolean');
      assert.strictEqual(typeof session.git.status.summary, 'string');
      assert.strictEqual(typeof session.git.status.modified, 'number');
      assert.strictEqual(typeof session.git.status.staged, 'number');
      assert.strictEqual(typeof session.git.status.untracked, 'number');
      assert.strictEqual(typeof session.git.status.ahead, 'number');
      assert.strictEqual(typeof session.git.status.behind, 'number');
    });

    it('should return git provider and repo name for repos with remotes', async () => {
      // Previous test already waited for cache — just fetch
      let session;
      for (let i = 0; i < 5; i++) {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/sessions',
          method: 'GET',
        });
        const sessions = JSON.parse(res.data);
        session = sessions[0];
        if (session?.git?.repoName) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.ok(session.git, 'Should have git info');
      assert.ok(session.git.repoName, 'Should have repo name');
      assert.ok(session.git.provider, 'Should have provider');
    });

    it('should return null git info for sessions outside a git repo', async () => {
      const os = require('os');
      // Create a session in a non-git directory
      const createBody = JSON.stringify({ name: 'Non-git Session', cwd: os.tmpdir() });
      await httpRequest(
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

      // Wait for async git cache
      await new Promise((r) => setTimeout(r, 2000));

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      const sessions = JSON.parse(res.data);
      const nonGitSession = sessions.find((s) => s.name === 'Non-git Session');
      assert.ok(nonGitSession, 'Should find the non-git session');
      assert.strictEqual(nonGitSession.git, null, 'Non-git directory should have null git info');
    });

    it('should detect live cwd changes via cd', async () => {
      // Create a session and send a cd command
      const createBody = JSON.stringify({ name: 'CD Test Session' });
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
      const { id } = JSON.parse(createRes.data);

      // Connect via WebSocket and send 'cd /tmp'
      const ws = new WebSocket(`ws://127.0.0.1:${inst.port}/ws`, {
        headers: { Origin: `http://127.0.0.1:${inst.port}` },
      });
      await waitForOpen(ws);

      const attachedPromise = waitForMessage(ws, (m) => m.type === 'attached');
      ws.send(JSON.stringify({ type: 'attach', sessionId: id }));
      await attachedPromise;
      ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));

      const tmpDir = require('os').tmpdir();
      const cdCmd = process.platform === 'win32' ? `cd /d ${tmpDir}` : `cd ${tmpDir}`;
      ws.send(JSON.stringify({ type: 'input', data: cdCmd + '\r' }));

      // Wait for cd to execute and cache to refresh
      await new Promise((r) => setTimeout(r, 7000));

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      const sessions = JSON.parse(res.data);
      const cdSession = sessions.find((s) => s.id === id);
      assert.ok(cdSession, 'Should find the cd session');
      // After cd to tmpdir, cwd should have changed and git should be null
      assert.strictEqual(cdSession.git, null, 'After cd to non-git dir, git should be null');

      ws.close();
    });
  });

  describe('Resume: sessions listing via HTTP with Bearer auth', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should list sessions with Bearer password header', async () => {
      inst = await startServer({ password: 'resumetest' });

      // Without auth → 401
      const res1 = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      assert.strictEqual(res1.statusCode, 401);

      // With Bearer password → 200
      const res2 = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
        headers: { Authorization: 'Bearer resumetest' },
      });
      assert.strictEqual(res2.statusCode, 200);
      const sessions = JSON.parse(res2.data);
      assert.ok(sessions.length >= 1, 'Should have at least one session');
      assert.ok(sessions[0].id, 'Session should have an id');
      assert.ok(sessions[0].name, 'Session should have a name');
    });
  });

  describe('Resume: WebSocket client flow with password auth', () => {
    let inst;
    let ws;
    after(async () => {
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
      inst?.shutdown();
    });

    it('should authenticate via password, list sessions, connect, and exchange data', async () => {
      inst = await startServer({ password: 'wstest' });

      // List sessions via Bearer auth
      const sessRes = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
        headers: { Authorization: 'Bearer wstest' },
      });
      const sessions = JSON.parse(sessRes.data);
      const sessionId = sessions[0].id;

      // Connect WebSocket — same flow as client.js
      ws = new WebSocket(`ws://127.0.0.1:${inst.port}/ws`, {
        headers: { Origin: `http://127.0.0.1:${inst.port}` },
      });
      await waitForOpen(ws);

      // Step 1: Send password auth
      const authPromise = waitForMessage(ws, (m) => m.type === 'auth_ok');
      ws.send(JSON.stringify({ type: 'auth', password: 'wstest' }));
      await authPromise;

      // Step 2: Send session ID (same as client.js after auth_ok)
      const attachedPromise = waitForMessage(ws, (m) => m.type === 'attached');
      ws.send(JSON.stringify({ type: 'attach', sessionId }));
      const attached = await attachedPromise;
      assert.strictEqual(attached.sessionId, sessionId);

      // Step 3: Send resize (like terminal client does)
      ws.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));

      // Step 4: Send input and verify output
      const marker = `resume_test_${Date.now()}`;
      const outputPromise = waitForMessage(
        ws,
        (m) => m.type === 'output' && m.data.includes(marker),
        15000,
      );
      ws.send(JSON.stringify({ type: 'input', data: `echo ${marker}\r` }));
      const output = await outputPromise;
      assert.ok(output.data.includes(marker));
    });
  });

  describe('Resume: connection config lifecycle', () => {
    let inst;
    after(() => {
      inst?.shutdown();
      // Clean up connection config
      const { removeConnectionConfig } = require('../src/resume');
      removeConnectionConfig();
    });

    it('should write connection.json on server start and clean up on shutdown', async () => {
      const { readConnectionConfig, removeConnectionConfig } = require('../src/resume');

      // Ensure clean state
      removeConnectionConfig();
      assert.strictEqual(readConnectionConfig(), null);

      inst = await startServer({ password: 'configtest' });
      const port = inst.port;

      // Server should have written connection.json
      const config = readConnectionConfig();
      assert.ok(config, 'connection.json should exist after start');
      assert.strictEqual(config.port, port);
      assert.strictEqual(config.password, 'configtest');
      assert.strictEqual(config.host, 'localhost');

      // Shutdown should remove it
      inst.shutdown();
      inst = null;

      // Give it a moment for cleanup
      await new Promise((r) => setTimeout(r, 100));
      const afterShutdown = readConnectionConfig();
      assert.strictEqual(afterShutdown, null, 'connection.json should be removed after shutdown');
    });
  });

  describe('Resume: session matching by name', () => {
    let inst;
    after(() => inst?.shutdown());

    it('should find sessions by name via API', async () => {
      inst = await startServer();

      // Create a named session
      const body = JSON.stringify({ name: 'my-project' });
      await httpRequest(
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

      // List sessions and find by name
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/sessions',
        method: 'GET',
      });
      const sessions = JSON.parse(res.data);
      const match = sessions.find((s) => s.name === 'my-project');
      assert.ok(match, 'Should find session by name "my-project"');

      // Also test ID prefix matching
      const prefix = match.id.slice(0, 8);
      const prefixMatch = sessions.find((s) => s.id.startsWith(prefix));
      assert.ok(prefixMatch, 'Should find session by ID prefix');
      assert.strictEqual(prefixMatch.id, match.id);
    });
  });
});
