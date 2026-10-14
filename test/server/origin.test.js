'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// connection.json is written on start / removed on shutdown — keep it isolated.
const CONNECTION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-origin-conn-'));
process.env.TERMBEAM_CONFIG_DIR = CONNECTION_DIR;

const {
  checkOrigin,
  createCsrfGuard,
  isLoopbackAddress,
  allowedAuthorities,
} = require('../../src/server/origin');
const { createTermBeamServer } = require('../../src/server');

const TUNNEL_HOST = 'abcd1234-3456.uks1.devtunnels.ms';

function req({ headers = {}, remoteAddress = '127.0.0.1', method = 'GET', path: p = '/' } = {}) {
  return { headers, socket: { remoteAddress }, method, path: p };
}

describe('origin.isLoopbackAddress', () => {
  it('recognises IPv4, IPv6 and IPv4-mapped loopback addresses', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      assert.equal(isLoopbackAddress(a), true, a);
    }
  });

  it('rejects everything else', () => {
    for (const a of [
      '10.0.0.1',
      '192.168.1.2',
      '::ffff:10.0.0.1',
      '1127.0.0.1',
      '',
      null,
      undefined,
      127,
    ]) {
      assert.equal(isLoopbackAddress(a), false, String(a));
    }
  });
});

describe('origin.allowedAuthorities', () => {
  it('collects Host, loopback-forwarded X-Forwarded-Host and the public URL (lowercase)', () => {
    const set = allowedAuthorities(
      req({
        headers: {
          host: 'LocalHost:3456',
          'x-forwarded-host': `${TUNNEL_HOST.toUpperCase()}, proxy.example`,
        },
      }),
      'https://Public.Example:8443/terminal',
    );
    assert.deepEqual([...set], ['localhost:3456', TUNNEL_HOST, 'public.example:8443']);
  });

  it('takes the first value of repeated headers and ignores malformed public URLs', () => {
    const set = allowedAuthorities(
      req({ headers: { host: ['a.example:1', 'b.example:2'] } }),
      'not a url',
    );
    assert.deepEqual([...set], ['a.example:1']);
  });

  it('ignores X-Forwarded-Host from non-loopback peers', () => {
    const set = allowedAuthorities(
      req({
        headers: { host: '192.168.1.5:3456', 'x-forwarded-host': 'evil.example' },
        remoteAddress: '192.168.1.77',
      }),
    );
    assert.deepEqual([...set], ['192.168.1.5:3456']);
  });
});

describe('origin.checkOrigin', () => {
  const host = 'localhost:3456';

  it('allows requests without an Origin (CLI clients, same-origin GETs)', () => {
    assert.deepEqual(checkOrigin(req({ headers: { host } })), { ok: true });
    assert.deepEqual(checkOrigin(req({ headers: { host, origin: '' } })), { ok: true });
    assert.deepEqual(checkOrigin({ headers: undefined, socket: {} }), { ok: true });
  });

  it("treats 'null' and non-http(s) origins as invalid", () => {
    for (const origin of [
      'null',
      'file://',
      'chrome-extension://abcdef',
      'ftp://localhost:3456',
      'garbage',
    ]) {
      assert.deepEqual(
        checkOrigin(req({ headers: { host, origin } })),
        { ok: false, reason: 'invalid' },
        origin,
      );
    }
  });

  it('allows an exact host[:port] match (case-insensitive)', () => {
    assert.equal(checkOrigin(req({ headers: { host, origin: 'http://localhost:3456' } })).ok, true);
    assert.equal(
      checkOrigin(req({ headers: { host: 'LOCALHOST:3456', origin: 'http://localhost:3456' } })).ok,
      true,
    );
    assert.equal(
      checkOrigin(req({ headers: { host: '[::1]:3456', origin: 'http://[::1]:3456' } })).ok,
      true,
    );
  });

  it('honours X-Forwarded-Host only when the peer is loopback (the tunnel relay)', () => {
    const headers = { host, origin: `https://${TUNNEL_HOST}`, 'x-forwarded-host': TUNNEL_HOST };
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      assert.equal(checkOrigin(req({ headers, remoteAddress })).ok, true, remoteAddress);
    }
    assert.deepEqual(checkOrigin(req({ headers, remoteAddress: '192.168.1.77' })), {
      ok: false,
      reason: 'mismatch',
    });
  });

  it('allows the configured public URL', () => {
    const r = req({
      headers: { host, origin: `https://${TUNNEL_HOST}` },
      remoteAddress: '10.0.0.9',
    });
    assert.equal(checkOrigin(r).ok, false);
    assert.equal(checkOrigin(r, { publicUrl: `https://${TUNNEL_HOST}/` }).ok, true);
    assert.equal(checkOrigin(r, { publicUrl: 'https://other.devtunnels.ms' }).ok, false);
  });

  it('treats a missing or explicit default port as the same origin (reverse proxies)', () => {
    for (const [host, origin] of [
      ['termbeam.example.com', 'https://termbeam.example.com'],
      ['termbeam.example.com:443', 'https://termbeam.example.com'],
      ['termbeam.example.com:80', 'http://termbeam.example.com'],
      ['[::1]', 'http://[::1]'],
    ]) {
      assert.equal(checkOrigin(req({ headers: { host, origin } })).ok, true, `${host} ← ${origin}`);
    }
  });

  it('rejects the same hostname on another port — cookies do not isolate ports', () => {
    // A page on http://localhost (port 80) must not drive a TermBeam on :3456.
    for (const [host, origin] of [
      ['localhost:3456', 'http://localhost'],
      ['termbeam.example.com:3456', 'https://termbeam.example.com'],
      ['[::1]:3456', 'http://[::1]'],
      ['termbeam.example.com:443', 'http://termbeam.example.com'],
      ['termbeam.example.com', 'https://termbeam.example.com:8443'],
    ]) {
      assert.deepEqual(
        checkOrigin(req({ headers: { host, origin } })),
        { ok: false, reason: 'mismatch' },
        `${host} ← ${origin}`,
      );
    }
    // --public-url / X-Forwarded-Host is the explicit way to trust a proxied origin
    assert.equal(
      checkOrigin(
        req({
          headers: { host: 'termbeam.example.com:3456', origin: 'https://termbeam.example.com' },
        }),
        { publicUrl: 'https://termbeam.example.com' },
      ).ok,
      true,
    );
  });

  it('rejects a different port on the same host and foreign hosts', () => {
    assert.deepEqual(checkOrigin(req({ headers: { host, origin: 'http://localhost:8080' } })), {
      ok: false,
      reason: 'mismatch',
    });
    assert.deepEqual(
      checkOrigin(req({ headers: { host: 'example.com:3000', origin: 'http://localhost:3000' } })),
      { ok: false, reason: 'mismatch' },
    );
    assert.equal(
      checkOrigin(
        req({ headers: { host: 'termbeam.example.com:3456', origin: 'https://evil.example' } }),
      ).ok,
      false,
    );
    assert.equal(
      checkOrigin(
        req({ headers: { host: 'example.com', origin: 'https://example.com.evil.example' } }),
      ).ok,
      false,
    );
  });

  it('rejects Sec-Fetch-Site same-site / cross-site even when the origin matches', () => {
    for (const site of ['same-site', 'cross-site', 'Cross-Site']) {
      assert.deepEqual(
        checkOrigin(
          req({ headers: { host, origin: 'http://localhost:3456', 'sec-fetch-site': site } }),
        ),
        { ok: false, reason: 'cross-site' },
        site,
      );
    }
    for (const site of ['same-origin', 'none']) {
      assert.equal(
        checkOrigin(
          req({ headers: { host, origin: 'http://localhost:3456', 'sec-fetch-site': site } }),
        ).ok,
        true,
        site,
      );
    }
  });

  it('rejects another dev tunnel page connecting through the relay', () => {
    const r = req({
      headers: {
        host: 'localhost:3456',
        origin: 'https://evil-1234.uks1.devtunnels.ms',
        'x-forwarded-host': TUNNEL_HOST,
      },
    });
    assert.deepEqual(checkOrigin(r), { ok: false, reason: 'mismatch' });
  });
});

describe('origin.createCsrfGuard (unit)', () => {
  function run(guard, r) {
    let status = null;
    let body = null;
    let nextCalled = false;
    const res = {
      status(code) {
        status = code;
        return this;
      },
      json(b) {
        body = b;
      },
    };
    guard(r, res, () => (nextCalled = true));
    return { status, body, nextCalled };
  }

  const guard = createCsrfGuard();

  it('lets safe page requests through untouched', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const out = run(
        guard,
        req({
          method,
          path: '/',
          headers: {
            host: 'localhost:3456',
            origin: 'https://evil.example',
            'sec-fetch-site': 'cross-site',
          },
        }),
      );
      assert.equal(out.nextCalled, true, method);
    }
  });

  it('lets same-origin and origin-less API reads through', () => {
    assert.equal(
      run(guard, req({ path: '/api/sessions', headers: { host: 'localhost:3456' } })).nextCalled,
      true,
    );
    assert.equal(
      run(
        guard,
        req({
          path: '/api/sessions',
          headers: { host: 'localhost:3456', 'sec-fetch-site': 'same-origin' },
        }),
      ).nextCalled,
      true,
    );
  });

  it('blocks cross-site API reads and foreign-origin writes with 403', () => {
    const blocked = [
      req({
        path: '/api/sessions',
        headers: { host: 'localhost:3456', 'sec-fetch-site': 'same-site' },
      }),
      req({
        method: 'POST',
        path: '/api/auth',
        headers: { host: 'localhost:3456', origin: 'https://evil.example' },
      }),
      req({
        method: 'DELETE',
        path: '/api/sessions/x',
        headers: { host: 'localhost:3456', origin: 'null' },
      }),
      req({
        method: 'POST',
        path: '/login',
        headers: { host: 'localhost:3456', origin: 'https://evil.example' },
      }),
    ];
    for (const r of blocked) {
      const out = run(guard, r);
      assert.equal(out.nextCalled, false, `${r.method} ${r.path}`);
      assert.equal(out.status, 403);
      assert.equal(out.body.error, 'Cross-site request blocked');
    }
  });

  it('consults the current public URL on every request', () => {
    let publicUrl = null;
    const g = createCsrfGuard(() => publicUrl);
    const r = req({
      method: 'POST',
      path: '/api/auth',
      headers: { host: 'localhost:3456', origin: `https://${TUNNEL_HOST}` },
      remoteAddress: '10.0.0.1',
    });
    assert.equal(run(g, r).status, 403);
    publicUrl = `https://${TUNNEL_HOST}`;
    assert.equal(run(g, r).nextCalled, true);
  });

  it('trusts every address in a list (tunnel URL and --public-url)', () => {
    const g = createCsrfGuard(() => [`https://${TUNNEL_HOST}`, 'https://term.example.com']);
    const post = (origin) =>
      req({
        method: 'POST',
        path: '/api/auth',
        headers: { host: '127.0.0.1:3456', origin },
        remoteAddress: '10.0.0.1',
      });
    assert.equal(run(g, post(`https://${TUNNEL_HOST}`)).nextCalled, true);
    assert.equal(run(g, post('https://term.example.com')).nextCalled, true);
    const blocked = run(g, post('https://evil.example'));
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.reason, 'mismatch');
  });

  it('explains a blocked request in the log, once a minute per origin', () => {
    const lines = [];
    const g = createCsrfGuard(() => null, { log: { warn: (m) => lines.push(m) } });
    const blocked = (origin) =>
      req({ method: 'POST', path: '/api/auth', headers: { host: '127.0.0.1:3456', origin } });
    run(g, blocked('https://term.example.com'));
    run(g, blocked('https://term.example.com'));
    run(g, blocked('https://other.example.com'));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /https:\/\/term\.example\.com/);
    assert.match(lines[0], /proxy_set_header Host \$host/);
    assert.match(lines[0], /--public-url/);
  });
});

describe('CSRF guard on a real server', () => {
  let inst;
  let port;
  let configDir;
  let ip = 1;

  function request(method, urlPath, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const h = { 'x-forwarded-for': `10.30.0.${ip++}`, ...headers };
      if (data !== undefined) {
        h['content-type'] = 'application/json';
        h['content-length'] = Buffer.byteLength(data);
      }
      const r = http.request(
        { hostname: '127.0.0.1', port, path: urlPath, method, headers: h },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            let json;
            try {
              json = JSON.parse(text);
            } catch {
              json = undefined;
            }
            resolve({ status: res.statusCode, headers: res.headers, json });
          });
        },
      );
      r.on('error', reject);
      if (data !== undefined) r.write(data);
      r.end();
    });
  }

  it('accepts sign-in through a Host-rewriting proxy once --public-url names it', async () => {
    const proxied = {
      body: { password: 'pw' },
      headers: { origin: 'https://term.example.com' },
    };
    assert.equal((await request('POST', '/api/auth', proxied)).status, 403);
    inst.config.publicUrl = 'https://term.example.com';
    try {
      assert.equal((await request('POST', '/api/auth', proxied)).status, 200);
    } finally {
      delete inst.config.publicUrl;
    }
  });

  async function cookie() {
    const res = await request('POST', '/api/auth', { body: { password: 'pw' } });
    assert.equal(res.status, 200);
    return res.headers['set-cookie'][0].split(';')[0];
  }

  before(async () => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-origin-'));
    inst = createTermBeamServer({
      config: {
        port: 0,
        host: '127.0.0.1',
        password: 'pw',
        useTunnel: false,
        persistedTunnel: false,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        shellArgs: [],
        cwd: process.cwd(),
        defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        version: '0.1.0-test',
        logLevel: 'error',
        disableRateLimit: true,
        configDir,
      },
    });
    await inst.start();
    port = inst.server.address().port;
  });

  after(() => {
    inst?.shutdown();
    for (const dir of [configDir, CONNECTION_DIR]) {
      if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4 });
    }
  });

  it('blocks a cross-site login POST (403)', async () => {
    const res = await request('POST', '/api/auth', {
      headers: { origin: 'https://evil.example' },
      body: { password: 'pw' },
    });
    assert.equal(res.status, 403);
    assert.deepEqual(res.json, { error: 'Cross-site request blocked', reason: 'mismatch' });
    assert.equal(res.headers['set-cookie'], undefined);
  });

  it('blocks an Origin: null POST (sandboxed iframe / data: URL)', async () => {
    const res = await request('POST', '/api/auth', {
      headers: { origin: 'null' },
      body: { password: 'pw' },
    });
    assert.equal(res.status, 403);
  });

  it('allows a same-origin login POST', async () => {
    const res = await request('POST', '/api/auth', {
      headers: { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' },
      body: { password: 'pw' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.headers['set-cookie']);
  });

  it('allows a POST without an Origin header (non-browser clients)', async () => {
    const res = await request('POST', '/api/auth', { body: { password: 'pw' } });
    assert.equal(res.status, 200);
  });

  it("allows the tunnel's own public origin forwarded by the local relay", async () => {
    const res = await request('POST', '/api/auth', {
      headers: {
        host: `localhost:${port}`,
        origin: `https://${TUNNEL_HOST}`,
        'x-forwarded-host': TUNNEL_HOST,
        'x-forwarded-proto': 'https',
      },
      body: { password: 'pw' },
    });
    assert.equal(res.status, 200);
  });

  it('blocks another tunnel page relayed with Sec-Fetch-Site: same-site', async () => {
    const res = await request('POST', '/api/auth', {
      headers: {
        host: `localhost:${port}`,
        origin: 'https://evil-1234.uks1.devtunnels.ms',
        'x-forwarded-host': TUNNEL_HOST,
        'sec-fetch-site': 'same-site',
      },
      body: { password: 'pw' },
    });
    assert.equal(res.status, 403);
  });

  it('blocks API reads marked Sec-Fetch-Site: same-site or cross-site, even with a valid cookie', async () => {
    const c = await cookie();
    for (const site of ['same-site', 'cross-site']) {
      const res = await request('GET', '/api/sessions', {
        headers: { cookie: c, 'sec-fetch-site': site },
      });
      assert.equal(res.status, 403, site);
    }
    for (const site of ['same-origin', 'none']) {
      const res = await request('GET', '/api/sessions', {
        headers: { cookie: c, 'sec-fetch-site': site },
      });
      assert.equal(res.status, 200, site);
    }
  });

  it('does not block top-level page navigations from other sites', async () => {
    const res = await request('GET', '/', { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.notEqual(res.status, 403);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/login');
    const login = await request('GET', '/login', { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.notEqual(login.status, 403);
  });

  it('blocks state-changing requests to non-API paths from foreign origins', async () => {
    const res = await request('POST', '/login', {
      headers: { origin: 'https://evil.example' },
      body: {},
    });
    assert.equal(res.status, 403);
  });
});
