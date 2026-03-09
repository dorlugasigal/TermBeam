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

// --- Preview Proxy Tests ---

describe('Preview proxy middleware', () => {
  let inst;
  after(() => inst?.shutdown());

  it('should return 400 for non-numeric port', async () => {
    inst = await startServer();
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: '/preview/abc/',
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.data);
    assert.ok(body.error.includes('Invalid port'));
  });

  it('should return 400 for port 0', async () => {
    if (!inst) inst = await startServer();
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: '/preview/0/',
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.data);
    assert.ok(body.error.includes('Invalid port'));
  });

  it('should return 400 for port > 65535', async () => {
    if (!inst) inst = await startServer();
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: '/preview/99999/',
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.data);
    assert.ok(body.error.includes('Invalid port'));
  });

  it('should return 502 when target server is not running', async () => {
    if (!inst) inst = await startServer();
    // Use a port unlikely to have anything running
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: '/preview/19999/',
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 502);
    const body = JSON.parse(res.data);
    assert.ok(body.error.includes('Bad gateway'));
  });

  it('should successfully proxy to a local server', async () => {
    if (!inst) inst = await startServer();

    // Start a simple upstream server
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('hello from upstream');
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = upstream.address().port;

    try {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/preview/${upstreamPort}/`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.data, 'hello from upstream');
    } finally {
      upstream.close();
    }
  });

  it('should preserve response status codes and headers', async () => {
    if (!inst) inst = await startServer();

    const upstream = http.createServer((_req, res) => {
      res.writeHead(201, { 'X-Custom-Header': 'test-value', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ created: true }));
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = upstream.address().port;

    try {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/preview/${upstreamPort}/`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.headers['x-custom-header'], 'test-value');
      const body = JSON.parse(res.data);
      assert.strictEqual(body.created, true);
    } finally {
      upstream.close();
    }
  });

  it('should rewrite absolute paths in HTML responses', async () => {
    if (!inst) inst = await startServer();

    const html = `<html><head><link href="/TermBeam/assets/style.css" rel="stylesheet">
<script src="/TermBeam/js/app.js"></script></head>
<body><a href="/TermBeam/page/">Link</a><img src="/TermBeam/img/logo.png">
<a href="//cdn.example.com/lib.js">External</a></body></html>`;

    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = upstream.address().port;

    try {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/preview/${upstreamPort}/TermBeam/`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      const prefix = `/preview/${upstreamPort}`;
      assert.ok(res.data.includes(`href="${prefix}/TermBeam/assets/style.css"`));
      assert.ok(res.data.includes(`src="${prefix}/TermBeam/js/app.js"`));
      assert.ok(res.data.includes(`href="${prefix}/TermBeam/page/"`));
      assert.ok(res.data.includes(`src="${prefix}/TermBeam/img/logo.png"`));
      // Protocol-relative URLs should NOT be rewritten
      assert.ok(res.data.includes('href="//cdn.example.com/lib.js"'));
    } finally {
      upstream.close();
    }
  });

  it('should rewrite Location header on redirects', async () => {
    if (!inst) inst = await startServer();

    const upstream = http.createServer((_req, res) => {
      res.writeHead(302, { Location: '/TermBeam/' });
      res.end();
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = upstream.address().port;

    try {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/preview/${upstreamPort}/`,
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 302);
      assert.strictEqual(res.headers.location, `/preview/${upstreamPort}/TermBeam/`);
    } finally {
      upstream.close();
    }
  });

  it('should strip /preview/:port prefix from forwarded path', async () => {
    if (!inst) inst = await startServer();

    let receivedPath;
    const upstream = http.createServer((req, res) => {
      receivedPath = req.url;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = upstream.address().port;

    try {
      // Test single segment
      await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/preview/${upstreamPort}/hello`,
        method: 'GET',
      });
      assert.strictEqual(receivedPath, '/hello');

      // Test deep nested path (Express 5 *path returns array of segments)
      await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: `/preview/${upstreamPort}/TermBeam/assets/stylesheets/main.min.css`,
        method: 'GET',
      });
      assert.strictEqual(receivedPath, '/TermBeam/assets/stylesheets/main.min.css');
    } finally {
      upstream.close();
    }
  });
});

// --- Port Detection Tests ---

describe('Port detection (detect-port)', () => {
  let inst;
  after(() => inst?.shutdown());

  it('should detect http://localhost:3000 in scrollback buffer', async () => {
    inst = await startServer();
    const sessionId = inst.defaultId;
    const session = inst.sessions.get(sessionId);
    session.scrollbackBuf = 'Server started at http://localhost:3000\r\n';

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: `/api/sessions/${sessionId}/detect-port`,
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.data);
    assert.strictEqual(body.detected, true);
    assert.strictEqual(body.port, 3000);
  });

  it('should detect http://127.0.0.1:8080 in scrollback buffer', async () => {
    if (!inst) inst = await startServer();
    const sessionId = inst.defaultId;
    const session = inst.sessions.get(sessionId);
    session.scrollbackBuf = 'Listening on http://127.0.0.1:8080\r\n';

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: `/api/sessions/${sessionId}/detect-port`,
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.data);
    assert.strictEqual(body.detected, true);
    assert.strictEqual(body.port, 8080);
  });

  it('should return the LAST match, not the first', async () => {
    if (!inst) inst = await startServer();
    const sessionId = inst.defaultId;
    const session = inst.sessions.get(sessionId);
    session.scrollbackBuf =
      'Started on http://localhost:3000\r\nRestarted on http://localhost:4567\r\n';

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: `/api/sessions/${sessionId}/detect-port`,
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.data);
    assert.strictEqual(body.detected, true);
    assert.strictEqual(body.port, 4567);
  });

  it('should return { detected: false } when no port found', async () => {
    if (!inst) inst = await startServer();
    const sessionId = inst.defaultId;
    const session = inst.sessions.get(sessionId);
    session.scrollbackBuf = 'no urls here at all\r\n';

    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: `/api/sessions/${sessionId}/detect-port`,
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.data);
    assert.strictEqual(body.detected, false);
    assert.strictEqual(body.port, undefined);
  });

  it('should return 404 for non-existent session', async () => {
    if (!inst) inst = await startServer();
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: '/api/sessions/nonexistent-session-id/detect-port',
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 404);
    const body = JSON.parse(res.data);
    assert.strictEqual(body.error, 'not found');
  });
});
