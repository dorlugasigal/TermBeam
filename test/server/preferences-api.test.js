const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let createTermBeamServer;
let tmpConfigDir;

const baseConfig = {
  port: 0,
  host: '127.0.0.1',
  password: 'testpw',
  useTunnel: false,
  persistedTunnel: false,
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  shellArgs: [],
  cwd: process.cwd(),
  defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  version: '0.1.0-test',
  logLevel: 'error',
};

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
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

async function login(port) {
  const res = await httpRequest(
    {
      hostname: '127.0.0.1',
      port,
      method: 'POST',
      path: '/api/auth',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({ password: 'testpw' }),
  );
  assert.strictEqual(res.statusCode, 200, `auth failed: ${res.statusCode} ${res.data}`);
  // Capture set-cookie header(s) to forward in subsequent requests.
  const set = res.headers['set-cookie'];
  if (!set) throw new Error('login did not set cookie');
  return set.map((c) => c.split(';')[0]).join('; ');
}

describe('Preferences API', () => {
  let inst;
  let port;
  let cookie;

  before(async () => {
    tmpConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-api-'));
    process.env.TERMBEAM_CONFIG_DIR = tmpConfigDir;
    delete require.cache[require.resolve('../../src/server')];
    delete require.cache[require.resolve('../../src/server/index')];
    ({ createTermBeamServer } = require('../../src/server'));
  });

  beforeEach(async () => {
    inst = createTermBeamServer({ config: { ...baseConfig } });
    await inst.start();
    port = inst.server.address().port;
    cookie = await login(port);
  });

  afterEach(async () => {
    await inst?.shutdown();
    // wipe prefs.json between tests
    try {
      fs.rmSync(path.join(tmpConfigDir, 'prefs.json'), { force: true });
    } catch {
      /* noop */
    }
  });

  after(async () => {
    delete process.env.TERMBEAM_CONFIG_DIR;
    fs.rmSync(tmpConfigDir, { recursive: true, force: true });
  });

  it('GET /api/preferences requires auth', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/preferences',
    });
    assert.strictEqual(res.statusCode, 401);
  });

  it('GET returns defaults when no prefs.json exists', async () => {
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/preferences',
      headers: { Cookie: cookie },
    });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.data);
    assert.strictEqual(body.version, 0);
    assert.strictEqual(body.prefs.themeId, 'dark');
    assert.strictEqual(body.prefs.fontSize, 14);
  });

  it('PUT persists prefs and writes prefs.json with mode 0o600', async () => {
    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        method: 'PUT',
        path: '/api/preferences',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      },
      JSON.stringify({ prefs: { themeId: 'nord', fontSize: 18 } }),
    );
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.data);
    assert.strictEqual(body.version, 1);
    assert.strictEqual(body.prefs.themeId, 'nord');
    assert.strictEqual(body.prefs.fontSize, 18);

    const file = path.join(tmpConfigDir, 'prefs.json');
    assert.ok(fs.existsSync(file));
    const stat = fs.statSync(file);
    // POSIX file modes aren't meaningfully enforced on Windows.
    if (process.platform !== 'win32') {
      assert.strictEqual(stat.mode & 0o777, 0o600);
    }
  });

  it('PUT then GET round-trips the value and increments version', async () => {
    await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        method: 'PUT',
        path: '/api/preferences',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      },
      JSON.stringify({ prefs: { themeId: 'monokai' } }),
    );
    await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        method: 'PUT',
        path: '/api/preferences',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      },
      JSON.stringify({ prefs: { themeId: 'monokai', haptics: false } }),
    );
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port,
      method: 'GET',
      path: '/api/preferences',
      headers: { Cookie: cookie },
    });
    const body = JSON.parse(res.data);
    assert.strictEqual(body.version, 2);
    assert.strictEqual(body.prefs.themeId, 'monokai');
    assert.strictEqual(body.prefs.haptics, false);
  });

  it('PUT rejects non-object body with 400', async () => {
    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        method: 'PUT',
        path: '/api/preferences',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      },
      JSON.stringify({ wrong: true }),
    );
    assert.strictEqual(res.statusCode, 400);
  });

  it('PUT silently drops unknown keys (forward compat)', async () => {
    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        method: 'PUT',
        path: '/api/preferences',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
      },
      JSON.stringify({ prefs: { themeId: 'nord', futureField: 42 } }),
    );
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.data);
    assert.strictEqual(body.prefs.themeId, 'nord');
    assert.strictEqual('futureField' in body.prefs, false);
  });
});
