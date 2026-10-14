'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The server writes connection.json (and deletes it on shutdown) under
// TERMBEAM_CONFIG_DIR — keep that away from the developer's real ~/.termbeam.
const CONNECTION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-auth-routes-conn-'));
process.env.TERMBEAM_CONFIG_DIR = CONNECTION_DIR;

const { createTermBeamServer } = require('../../src/server');
const { ALG, SoftwareAuthenticator } = require('./webauthn-helpers');

const PASSWORD = 'pw';
const HAS_SPA = fs.existsSync(path.join(__dirname, '..', '..', 'public', 'index.html'));
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- Helpers ------------------------------------------------------------------

const dirs = [CONNECTION_DIR];

function makeConfig(overrides = {}) {
  return {
    port: 0,
    host: '127.0.0.1',
    password: PASSWORD,
    useTunnel: false,
    persistedTunnel: false,
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    shellArgs: [],
    cwd: process.cwd(),
    defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    version: '0.1.0-test',
    logLevel: 'error',
    disableRateLimit: true,
    ...overrides,
  };
}

async function startServer(overrides = {}) {
  let configDir = overrides.configDir;
  if (!configDir) {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-auth-routes-'));
    dirs.push(configDir);
  }
  const inst = createTermBeamServer({ config: makeConfig({ ...overrides, configDir }) });
  await inst.start();
  return { ...inst, port: inst.server.address().port, configDir };
}

function httpRequest(port, { method = 'GET', path: urlPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data =
      body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const h = { ...headers };
    if (data !== undefined) {
      h['content-type'] = h['content-type'] || 'application/json';
      h['content-length'] = Buffer.byteLength(data);
    }
    const req = http.request(
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
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

function setCookie(res, name = 'pty_token') {
  const raw = (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`));
  if (!raw) return null;
  const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
  return { raw, value: pair.slice(name.length + 1), attrs };
}

let ipCounter = 10;

/**
 * A tiny cookie-jar "browser". Every client gets its own X-Forwarded-For IP
 * (the server trusts loopback proxies) so the 5/min login limiter on
 * POST /api/auth is per test client.
 */
class Client {
  constructor(port, { host, origin, userAgent, ip } = {}) {
    this.port = port;
    this.host = host;
    this.origin = origin;
    this.userAgent = userAgent;
    this.ip = ip || `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
    this.token = null;
  }

  static secure(port, opts = {}) {
    return new Client(port, {
      host: `localhost:${port}`,
      origin: `http://localhost:${port}`,
      ...opts,
    });
  }

  async request(method, urlPath, body, extraHeaders = {}) {
    const headers = { 'x-forwarded-for': this.ip, ...extraHeaders };
    if (this.host) headers.host = this.host;
    if (this.origin && method !== 'GET') headers.origin = this.origin;
    if (this.userAgent) headers['user-agent'] = this.userAgent;
    if (this.token) headers.cookie = `pty_token=${this.token}`;
    const res = await httpRequest(this.port, { method, path: urlPath, headers, body });
    const c = setCookie(res);
    if (c) this.token = c.value || null;
    return res;
  }

  get(p, h) {
    return this.request('GET', p, undefined, h);
  }
  post(p, body = {}, h) {
    return this.request('POST', p, body, h);
  }
  patch(p, body = {}, h) {
    return this.request('PATCH', p, body, h);
  }
  delete(p, h) {
    return this.request('DELETE', p, undefined, h);
  }

  async signIn(extra = {}) {
    const res = await this.post('/api/auth', { password: PASSWORD, ...extra });
    assert.equal(res.status, 200, res.text);
    assert.ok(this.token, 'login should set a cookie');
    return res;
  }

  async canUseApi() {
    return (await this.get('/api/sessions')).status === 200;
  }
}

async function registerPasskey(client, authr, name = 'Test key') {
  const opts = await client.post('/api/auth/passkeys/register/options');
  assert.equal(opts.status, 200, opts.text);
  const { publicKey } = opts.json;
  const credential = authr.register({
    challenge: publicKey.challenge,
    origin: client.origin,
    rpId: publicKey.rp.id,
    userHandle: publicKey.user.id,
  });
  const res = await client.post('/api/auth/passkeys/register', { credential, name });
  assert.equal(res.status, 200, res.text);
  return { passkey: res.json.passkey, publicKey, credential };
}

async function passkeyLogin(client, authr, { remember, mutate } = {}) {
  const opts = await client.post('/api/auth/passkeys/login/options');
  assert.equal(opts.status, 200, opts.text);
  const { publicKey } = opts.json;
  let credential = authr.assert({
    challenge: publicKey.challenge,
    origin: client.origin,
    rpId: publicKey.rpId,
  });
  if (mutate) credential = mutate(credential) || credential;
  const res = await client.post('/api/auth/passkeys/login', { credential, remember });
  return { res, credential, publicKey };
}

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 4 });
});

// --- Tests --------------------------------------------------------------------

describe('auth routes (password-protected server)', () => {
  let inst;

  before(async () => {
    inst = await startServer();
  });

  after(() => {
    inst?.shutdown();
  });

  describe('POST /api/auth', () => {
    it('signs in with the password and sets a remembered HttpOnly SameSite=Strict cookie', async () => {
      const client = new Client(inst.port, { userAgent: UA_MAC });
      const res = await client.post('/api/auth', { password: PASSWORD });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, { ok: true });
      const cookie = setCookie(res);
      assert.match(cookie.value, /^[a-f0-9]{64}$/);
      assert.ok(cookie.attrs.includes('HttpOnly'));
      assert.ok(cookie.attrs.includes('SameSite=Strict'));
      assert.ok(cookie.attrs.includes('Path=/'));
      const maxAge = cookie.attrs.find((a) => a.startsWith('Max-Age='));
      const seconds = Number(maxAge && maxAge.slice('Max-Age='.length));
      const thirtyDays = 30 * 24 * 60 * 60;
      assert.ok(seconds <= thirtyDays && seconds > thirtyDays - 60, `unexpected ${maxAge}`);
      assert.ok(cookie.attrs.some((a) => a.startsWith('Expires=')));
      assert.equal(cookie.attrs.includes('Secure'), false, 'plain-http LAN must keep working');
      assert.ok(await client.canUseApi());

      const me = (await client.get('/api/auth/sessions')).json.sessions.find((s) => s.current);
      assert.equal(me.method, 'password');
      assert.equal(me.remember, true);
      assert.equal(me.device, 'Mac · Chrome');
      assert.equal(me.ip, client.ip);
    });

    it('remember:false sets a browser-session cookie (no Max-Age / Expires)', async () => {
      const client = new Client(inst.port);
      const res = await client.post('/api/auth', { password: PASSWORD, remember: false });
      assert.equal(res.status, 200);
      const cookie = setCookie(res);
      assert.ok(cookie.value);
      assert.equal(
        cookie.attrs.some((a) => /^(Max-Age|Expires)=/i.test(a)),
        false,
      );
      assert.ok(await client.canUseApi());
      const me = (await client.get('/api/auth/sessions')).json.sessions.find((s) => s.current);
      assert.equal(me.remember, false);
    });

    it('rejects a wrong or missing password with 401 and no cookie', async () => {
      const client = new Client(inst.port);
      for (const body of [{ password: 'nope' }, {}, { password: 123 }]) {
        const res = await client.post('/api/auth', body);
        assert.equal(res.status, 401);
        assert.deepEqual(res.json, { error: 'wrong password' });
        assert.equal(setCookie(res), null);
      }
    });

    it('rate-limits login attempts per client IP', async () => {
      const client = new Client(inst.port);
      for (let i = 0; i < 5; i++) {
        assert.equal((await client.post('/api/auth', { password: 'nope' })).status, 401);
      }
      assert.equal((await client.post('/api/auth', { password: PASSWORD })).status, 429);
      // Another client (IP) is unaffected
      await new Client(inst.port).signIn();
    });

    it('accepts a one-time QR token exactly once', async () => {
      const ott = inst.auth.generateShareToken();
      const client = new Client(inst.port, { userAgent: UA_IPHONE });
      const res = await client.post('/api/auth', { ott });
      assert.equal(res.status, 200);
      assert.ok(setCookie(res).value);
      assert.ok(await client.canUseApi());
      const me = (await client.get('/api/auth/sessions')).json.sessions.find((s) => s.current);
      assert.equal(me.method, 'qr');
      assert.equal(me.device, 'iPhone · Safari');

      const replay = await new Client(inst.port).post('/api/auth', { ott });
      assert.equal(replay.status, 401, 'one-time token cannot be replayed');
      const bogus = await new Client(inst.port).post('/api/auth', { ott: 'f'.repeat(64) });
      assert.equal(bogus.status, 401);
    });
  });

  describe('GET /api/auth/status', () => {
    const status = (client, origin) =>
      client.get(`/api/auth/status${origin ? `?origin=${encodeURIComponent(origin)}` : ''}`);

    it('reports an anonymous visitor', async () => {
      const res = await status(new Client(inst.port));
      assert.equal(res.status, 200);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.deepEqual(res.json, {
        passwordRequired: true,
        authenticated: false,
        passkeys: { enabled: false, registered: false },
        session: null,
      });
    });

    it('reports a signed-in visitor and their session', async () => {
      const client = new Client(inst.port);
      await client.signIn();
      const res = await status(client);
      assert.equal(res.json.authenticated, true);
      assert.equal(res.json.session.method, 'password');
      assert.equal(typeof res.json.session.createdAt, 'number');
    });

    it('enables passkeys for http://localhost when the server is reached at localhost', async () => {
      const client = new Client(inst.port, { host: `localhost:${inst.port}` });
      const res = await status(client, `http://localhost:${inst.port}`);
      assert.deepEqual(res.json.passkeys, { enabled: true, registered: false });
    });

    it('enables passkeys for an https origin matching the Host header (reverse proxy)', async () => {
      const client = new Client(inst.port, { host: 'termbeam.example.com' });
      const res = await status(client, 'https://termbeam.example.com');
      assert.equal(res.json.passkeys.enabled, true);
    });

    it('disables passkeys for IP literals, plain-http LAN addresses and foreign hosts', async () => {
      const cases = [
        [`127.0.0.1:${inst.port}`, `http://127.0.0.1:${inst.port}`],
        ['192.168.1.20:3456', 'http://192.168.1.20:3456'],
        ['192.168.1.20:3456', 'https://192.168.1.20:3456'],
        ['[::1]:3456', 'http://[::1]:3456'],
        [`localhost:${inst.port}`, 'https://evil.example'],
        [`localhost:${inst.port}`, 'not a url'],
        [`localhost:${inst.port}`, `ftp://localhost:${inst.port}`],
        [`localhost:${inst.port}`, undefined],
      ];
      for (const [host, origin] of cases) {
        const res = await status(new Client(inst.port, { host }), origin);
        assert.equal(res.status, 200);
        assert.equal(res.json.passkeys.enabled, false, `${host} / ${origin}`);
      }
    });
  });

  describe('logout and remembered devices', () => {
    it('POST /api/auth/logout clears the cookie and revokes the session', async () => {
      const client = new Client(inst.port);
      await client.signIn();
      const token = client.token;
      const res = await client.post('/api/auth/logout');
      assert.equal(res.status, 200);
      const cleared = setCookie(res);
      assert.equal(cleared.value, '');
      assert.ok(cleared.attrs.some((a) => a.startsWith('Expires=Thu, 01 Jan 1970')));

      client.token = token; // a copy of the old cookie is useless now
      assert.equal(await client.canUseApi(), false);
      assert.equal((await client.post('/api/auth/logout')).status, 401);
    });

    it('GET /api/auth/sessions lists signed-in devices and flags the current one', async () => {
      const phone = new Client(inst.port, { userAgent: UA_IPHONE });
      const laptop = new Client(inst.port, { userAgent: UA_MAC });
      await phone.signIn();
      await laptop.signIn();
      const res = await laptop.get('/api/auth/sessions');
      assert.equal(res.status, 200);
      const current = res.json.sessions.filter((s) => s.current);
      assert.equal(current.length, 1);
      assert.equal(current[0].device, 'Mac · Chrome');
      assert.ok(res.json.sessions.some((s) => s.device === 'iPhone · Safari' && !s.current));
      for (const s of res.json.sessions) assert.equal('tokenHash' in s, false);

      assert.equal((await new Client(inst.port).get('/api/auth/sessions')).status, 401);
    });

    it('DELETE /api/auth/sessions/:id signs another device out', async () => {
      const keeper = new Client(inst.port);
      const lost = new Client(inst.port);
      await keeper.signIn();
      await lost.signIn();
      const lostId = (await lost.get('/api/auth/sessions')).json.sessions.find((s) => s.current).id;

      const res = await keeper.delete(`/api/auth/sessions/${encodeURIComponent(lostId)}`);
      assert.equal(res.status, 200);
      assert.equal(setCookie(res), null, "the caller's own cookie is untouched");
      assert.equal(await lost.canUseApi(), false);
      assert.ok(await keeper.canUseApi());
      assert.equal(
        (await keeper.delete(`/api/auth/sessions/${encodeURIComponent(lostId)}`)).status,
        404,
      );
    });

    it('DELETE of your own session also clears your cookie', async () => {
      const client = new Client(inst.port);
      await client.signIn();
      const myId = (await client.get('/api/auth/sessions')).json.sessions.find((s) => s.current).id;
      const res = await client.delete(`/api/auth/sessions/${encodeURIComponent(myId)}`);
      assert.equal(res.status, 200);
      assert.equal(setCookie(res).value, '');
    });

    it('POST /api/auth/sessions/revoke-others keeps only the caller signed in', async () => {
      const me = new Client(inst.port);
      const others = [new Client(inst.port), new Client(inst.port)];
      for (const c of [me, ...others]) await c.signIn();
      const res = await me.post('/api/auth/sessions/revoke-others');
      assert.equal(res.status, 200);
      assert.equal(res.json.ok, true);
      assert.ok(res.json.revoked >= 2);
      for (const c of others) assert.equal(await c.canUseApi(), false);
      assert.ok(await me.canUseApi());
      const remaining = (await me.get('/api/auth/sessions')).json.sessions;
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].current, true);
    });

    it('revoke-others needs a browser session, not the bearer password', async () => {
      const res = await httpRequest(inst.port, {
        method: 'POST',
        path: '/api/auth/sessions/revoke-others',
        headers: { authorization: `Bearer ${PASSWORD}`, 'x-forwarded-for': '10.99.0.1' },
        body: {},
      });
      assert.equal(res.status, 400);
    });
  });

  describe('passkeys over HTTP (software authenticator)', () => {
    it('login options are 404 while no passkey is registered for the address', async () => {
      const client = new Client(inst.port, {
        host: 'no-passkeys.example',
        origin: 'https://no-passkeys.example',
      });
      const res = await client.post('/api/auth/passkeys/login/options');
      assert.equal(res.status, 404);
      assert.match(res.json.error, /No passkeys/);
    });

    it('register options require a signed-in browser session on a secure origin', async () => {
      const anonymous = Client.secure(inst.port);
      assert.equal((await anonymous.post('/api/auth/passkeys/register/options')).status, 401);

      const bearer = await httpRequest(inst.port, {
        method: 'POST',
        path: '/api/auth/passkeys/register/options',
        headers: {
          authorization: `Bearer ${PASSWORD}`,
          host: `localhost:${inst.port}`,
          origin: `http://localhost:${inst.port}`,
        },
        body: {},
      });
      assert.equal(bearer.status, 400);
      assert.match(bearer.json.error, /Sign in from a browser/);

      const lan = new Client(inst.port, { origin: `http://127.0.0.1:${inst.port}` });
      await lan.signIn();
      const insecure = await lan.post('/api/auth/passkeys/register/options');
      assert.equal(insecure.status, 400);
      assert.match(insecure.json.error, /secure address/);
    });

    it('full flow: register on localhost, then unlock a fresh browser with the passkey', async () => {
      const owner = Client.secure(inst.port);
      await owner.signIn();
      const authr = new SoftwareAuthenticator({ alg: ALG.ES256 });

      const opts = await owner.post('/api/auth/passkeys/register/options');
      assert.equal(opts.status, 200);
      const { publicKey } = opts.json;
      assert.equal(publicKey.rp.id, 'localhost');
      assert.equal(publicKey.rp.name, 'TermBeam');
      assert.equal(publicKey.user.id, inst.auth.userHandle);
      assert.deepEqual(
        publicKey.pubKeyCredParams.map((p) => p.alg),
        [-7, -8, -257],
      );
      assert.equal(publicKey.attestation, 'none');
      assert.equal(publicKey.authenticatorSelection.userVerification, 'required');
      assert.match(publicKey.challenge, /^[A-Za-z0-9_-]{43}$/);

      const credential = authr.register({
        challenge: publicKey.challenge,
        origin: owner.origin,
        rpId: 'localhost',
        userHandle: publicKey.user.id,
      });
      const reg = await owner.post('/api/auth/passkeys/register', { credential, name: 'Test key' });
      assert.equal(reg.status, 200, reg.text);
      assert.equal(reg.json.passkey.id, authr.id);
      assert.equal(reg.json.passkey.name, 'Test key');
      assert.equal(reg.json.passkey.rpId, 'localhost');

      // The registration challenge is single-use
      const replayReg = await owner.post('/api/auth/passkeys/register', {
        credential,
        name: 'again',
      });
      assert.equal(replayReg.status, 400);
      assert.match(replayReg.json.error, /expired/);

      const list = await owner.get('/api/auth/passkeys');
      assert.ok(list.json.passkeys.some((p) => p.id === authr.id && p.name === 'Test key'));
      const st = await owner.get(`/api/auth/status?origin=${encodeURIComponent(owner.origin)}`);
      assert.deepEqual(st.json.passkeys, { enabled: true, registered: true });

      // Already-registered credentials are excluded from new registrations
      const again = await owner.post('/api/auth/passkeys/register/options');
      assert.ok(again.json.publicKey.excludeCredentials.some((c) => c.id === authr.id));

      // A brand-new browser unlocks with the passkey alone
      const fresh = Client.secure(inst.port, { userAgent: UA_IPHONE });
      assert.equal(await fresh.canUseApi(), false);
      const loginOpts = await fresh.post('/api/auth/passkeys/login/options');
      assert.equal(loginOpts.status, 200);
      assert.equal(loginOpts.json.publicKey.rpId, 'localhost');
      assert.equal(loginOpts.json.publicKey.userVerification, 'required');
      assert.ok(loginOpts.json.publicKey.allowCredentials.some((c) => c.id === authr.id));

      const assertion = authr.assert({
        challenge: loginOpts.json.publicKey.challenge,
        origin: fresh.origin,
        rpId: 'localhost',
      });
      const login = await fresh.post('/api/auth/passkeys/login', { credential: assertion });
      assert.equal(login.status, 200, login.text);
      const cookie = setCookie(login);
      assert.match(cookie.value, /^[a-f0-9]{64}$/);
      assert.ok(cookie.attrs.includes('HttpOnly'));
      assert.ok(cookie.attrs.includes('SameSite=Strict'));
      assert.ok(await fresh.canUseApi(), '/api/sessions accepts the passkey cookie');
      const me = (await fresh.get('/api/auth/sessions')).json.sessions.find((s) => s.current);
      assert.equal(me.method, 'passkey');
      assert.equal(inst.auth.getPasskey(authr.id).signCount, authr.signCount);
      assert.equal(typeof inst.auth.getPasskey(authr.id).lastUsedAt, 'number');

      // The login challenge is single-use: replaying the assertion fails
      const replay = await Client.secure(inst.port).post('/api/auth/passkeys/login', {
        credential: assertion,
      });
      assert.equal(replay.status, 400);
      assert.match(replay.json.error, /expired/);
    });

    it('registration is bound to the session that requested the options', async () => {
      const a = Client.secure(inst.port);
      const b = Client.secure(inst.port);
      await a.signIn();
      await b.signIn();
      const opts = await a.post('/api/auth/passkeys/register/options');
      const authr = new SoftwareAuthenticator();
      const credential = authr.register({
        challenge: opts.json.publicKey.challenge,
        origin: a.origin,
        rpId: 'localhost',
      });
      const res = await b.post('/api/auth/passkeys/register', { credential, name: 'hijack' });
      assert.equal(res.status, 400);
      assert.equal(inst.auth.getPasskey(authr.id), null);
    });

    it('rejects a registration whose clientData origin differs from the requesting origin', async () => {
      const owner = Client.secure(inst.port);
      await owner.signIn();
      const opts = await owner.post('/api/auth/passkeys/register/options');
      const authr = new SoftwareAuthenticator();
      const credential = authr.register({
        challenge: opts.json.publicKey.challenge,
        origin: 'https://evil.example',
        rpId: 'localhost',
      });
      const res = await owner.post('/api/auth/passkeys/register', { credential });
      assert.equal(res.status, 400);
      assert.match(res.json.error, /Passkey setup failed: origin not allowed/);
    });

    it('a login challenge cannot be used to register (and vice versa)', async () => {
      const owner = Client.secure(inst.port);
      await owner.signIn();
      const authr = new SoftwareAuthenticator();
      await registerPasskey(owner, authr);

      const loginOpts = await owner.post('/api/auth/passkeys/login/options');
      const credential = new SoftwareAuthenticator().register({
        challenge: loginOpts.json.publicKey.challenge,
        origin: owner.origin,
        rpId: 'localhost',
      });
      assert.equal((await owner.post('/api/auth/passkeys/register', { credential })).status, 400);

      const regOpts = await owner.post('/api/auth/passkeys/register/options');
      const assertion = authr.assert({
        challenge: regOpts.json.publicKey.challenge,
        origin: owner.origin,
        rpId: 'localhost',
      });
      const res = await owner.post('/api/auth/passkeys/login', { credential: assertion });
      assert.equal(res.status, 400);
    });

    it('rejects unknown credentials, foreign user handles and bad signatures', async () => {
      const owner = Client.secure(inst.port);
      await owner.signIn();
      const authr = new SoftwareAuthenticator({ alg: ALG.EDDSA });
      await registerPasskey(owner, authr);

      const stranger = new SoftwareAuthenticator();
      const unknown = await passkeyLogin(Client.secure(inst.port), stranger);
      assert.equal(unknown.res.status, 401);
      assert.match(unknown.res.json.error, /not registered/);

      const foreign = await passkeyLogin(Client.secure(inst.port), authr, {
        mutate: (c) => {
          c.response.userHandle = 'someone-else';
        },
      });
      assert.equal(foreign.res.status, 401);
      assert.match(foreign.res.json.error, /different TermBeam host/);

      const forged = await passkeyLogin(Client.secure(inst.port), authr, {
        mutate: (c) => {
          c.response.signature = c.response.signature.split('').reverse().join('');
        },
      });
      assert.equal(forged.res.status, 400);
      assert.match(forged.res.json.error, /Passkey sign-in failed: signature verification failed/);
      assert.equal(setCookie(forged.res), null);
    });

    it('rejects a replayed signature counter (cloned authenticator)', async () => {
      const owner = Client.secure(inst.port);
      await owner.signIn();
      const authr = new SoftwareAuthenticator({ alg: ALG.RS256 });
      await registerPasskey(owner, authr);
      const first = await passkeyLogin(Client.secure(inst.port), authr);
      assert.equal(first.res.status, 200);
      authr.signCount = 0; // a clone starts from an older counter
      const clone = await passkeyLogin(Client.secure(inst.port), authr);
      assert.equal(clone.res.status, 400);
      assert.match(clone.res.json.error, /signature counter did not increase/);
    });

    it('remember:false passkey sign-in gets a browser-session cookie', async () => {
      const owner = Client.secure(inst.port);
      await owner.signIn();
      const authr = new SoftwareAuthenticator();
      await registerPasskey(owner, authr);
      const { res } = await passkeyLogin(Client.secure(inst.port), authr, { remember: false });
      assert.equal(res.status, 200);
      assert.equal(
        setCookie(res).attrs.some((a) => /^(Max-Age|Expires)=/i.test(a)),
        false,
      );
    });

    it('PATCH /api/auth/passkeys/:id renames (sanitised) and validates', async () => {
      const owner = Client.secure(inst.port);
      await owner.signIn();
      const authr = new SoftwareAuthenticator();
      const { passkey } = await registerPasskey(owner, authr);
      const url = `/api/auth/passkeys/${encodeURIComponent(passkey.id)}`;

      const res = await owner.patch(url, { name: '  <b>Work\u0007 laptop</b>  ' });
      assert.equal(res.status, 200);
      const renamed = (await owner.get('/api/auth/passkeys')).json.passkeys.find(
        (p) => p.id === passkey.id,
      );
      assert.equal(renamed.name, 'bWork laptop/b');
      assert.equal((await owner.patch(url, { name: '   ' })).status, 400);
      assert.equal((await owner.patch(url, {})).status, 400);
      assert.equal((await owner.patch('/api/auth/passkeys/nope', { name: 'x' })).status, 404);
      assert.equal((await Client.secure(inst.port).patch(url, { name: 'x' })).status, 401);
    });

    it('DELETE /api/auth/passkeys/:id removes it and signs its sessions out', async () => {
      const owner = Client.secure(inst.port);
      await owner.signIn();
      const authr = new SoftwareAuthenticator();
      const { passkey } = await registerPasskey(owner, authr);
      const phone = Client.secure(inst.port);
      assert.equal((await passkeyLogin(phone, authr)).res.status, 200);
      assert.ok(await phone.canUseApi());

      const url = `/api/auth/passkeys/${encodeURIComponent(passkey.id)}`;
      assert.equal((await Client.secure(inst.port).delete(url)).status, 401);
      const res = await owner.delete(url);
      assert.equal(res.status, 200);
      assert.equal(await phone.canUseApi(), false, 'sessions unlocked with it are revoked');
      assert.ok(await owner.canUseApi(), 'the password session survives');
      assert.equal(inst.auth.getPasskey(passkey.id), null);
      assert.equal((await owner.delete(url)).status, 404);

      // The deleted credential is no longer offered or accepted
      const next = Client.secure(inst.port);
      const opts = await next.post('/api/auth/passkeys/login/options');
      if (opts.status === 200) {
        const offered = opts.json.publicKey.allowCredentials.map((c) => c.id);
        assert.equal(offered.includes(passkey.id), false);
        const credential = authr.assert({
          challenge: opts.json.publicKey.challenge,
          origin: next.origin,
          rpId: 'localhost',
        });
        assert.equal((await next.post('/api/auth/passkeys/login', { credential })).status, 401);
      } else {
        assert.equal(opts.status, 404);
      }
    });
  });

  describe('GET /login', () => {
    it('serves the SPA to signed-out visitors', async () => {
      const res = await new Client(inst.port).get('/login');
      if (HAS_SPA) {
        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /text\/html/);
      } else {
        assert.ok(res.status < 500, `unexpected ${res.status}`);
      }
    });

    it('bounces signed-in visitors to a safe next path, or /', async () => {
      const client = new Client(inst.port);
      await client.signIn();
      const cases = [
        ['/login', '/'],
        [`/login?next=${encodeURIComponent('/terminal?session=abc')}`, '/terminal?session=abc'],
        [
          `/login?next=${encodeURIComponent('/terminal?ott=x&session=abc')}`,
          '/terminal?session=abc',
        ],
        [`/login?next=${encodeURIComponent('//evil.example')}`, '/'],
        [`/login?next=${encodeURIComponent('/..//evil.example')}`, '/'],
        [`/login?next=${encodeURIComponent('https://evil.example/')}`, '/'],
        [`/login?next=${encodeURIComponent('/login')}`, '/'],
      ];
      for (const [url, location] of cases) {
        const res = await client.get(url);
        assert.equal(res.status, 302, url);
        assert.equal(res.headers.location, location, url);
      }
    });
  });

  describe('QR auto-login (?ott=)', () => {
    it('signs in and redirects to the same page without the token', async () => {
      const ott = inst.auth.generateShareToken();
      const client = new Client(inst.port);
      const res = await client.get(`/?ott=${ott}&session=abc`);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/?session=abc');
      const cookie = setCookie(res);
      assert.match(cookie.value, /^[a-f0-9]{64}$/);
      assert.ok(cookie.attrs.includes('HttpOnly'));
      assert.ok(await client.canUseApi());
      const me = (await client.get('/api/auth/sessions')).json.sessions.find((s) => s.current);
      assert.equal(me.method, 'qr');
    });

    it('keeps /terminal and drops a lone ott', async () => {
      const t1 = inst.auth.generateShareToken();
      const res = await new Client(inst.port).get(`/terminal?session=s1&ott=${t1}`);
      assert.equal(res.headers.location, '/terminal?session=s1');
      const t2 = inst.auth.generateShareToken();
      assert.equal((await new Client(inst.port).get(`/?ott=${t2}`)).headers.location, '/');
    });

    it('an already signed-in browser is just redirected to the clean URL', async () => {
      const client = new Client(inst.port);
      await client.signIn();
      const ott = inst.auth.generateShareToken();
      const res = await client.get(`/terminal?ott=${ott}&session=abc`);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, '/terminal?session=abc');
      assert.equal(setCookie(res), null);
    });

    it('an invalid token falls through to the login redirect (without the token)', async () => {
      const res = await new Client(inst.port).get(`/?ott=${'0'.repeat(64)}&session=abc`);
      assert.equal(res.status, 302);
      assert.equal(res.headers.location, `/login?next=${encodeURIComponent('/?session=abc')}`);
      assert.equal(setCookie(res), null);
    });
  });
});

describe('auth persistence across server restarts', () => {
  it('remembered devices and passkeys survive a restart; --reset-auth wipes them', async () => {
    const first = await startServer();
    let second;
    let third;
    try {
      const owner = Client.secure(first.port);
      await owner.signIn();
      const authr = new SoftwareAuthenticator();
      await registerPasskey(owner, authr, 'Survivor');
      const raw = fs.readFileSync(path.join(first.configDir, 'auth.json'), 'utf8');
      assert.equal(raw.includes(owner.token), false, 'cookie value never hits the disk');
      first.shutdown();

      second = await startServer({ configDir: first.configDir });
      owner.port = second.port;
      assert.ok(await owner.canUseApi(), 'remembered cookie still valid after restart');
      const phone = Client.secure(second.port);
      assert.equal((await passkeyLogin(phone, authr)).res.status, 200, 'passkey still works');
      second.shutdown();

      third = await startServer({ configDir: first.configDir, resetAuth: true });
      owner.port = third.port;
      phone.port = third.port;
      assert.equal(await owner.canUseApi(), false);
      assert.equal(await phone.canUseApi(), false);
      assert.deepEqual(third.auth.listPasskeys(), []);
    } finally {
      first.shutdown();
      second?.shutdown();
      third?.shutdown();
    }
  });
});

describe('setupAuthRoutes on a lightweight app (tunnel URL, challenge lifetime)', () => {
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const { createAuth } = require('../../src/server/auth');
  const { setupAuthRoutes } = require('../../src/server/auth-routes');
  const webauthn = require('../../src/server/webauthn');

  const TUNNEL_ORIGIN = 'https://abcd1234-3456.uks1.devtunnels.ms';
  const realDateNow = Date.now;
  let server;
  let port;
  let auth;
  const state = { publicUrl: null };
  const authr = new SoftwareAuthenticator();

  before(async () => {
    auth = createAuth(PASSWORD);
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json());
    app.use(cookieParser());
    setupAuthRoutes(app, { auth, config: { disableRateLimit: true }, state });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    // A passkey for http://localhost, registered out of band
    const challenge = 'setup-challenge';
    const record = webauthn.verifyRegistration(
      authr.register({ challenge, origin: `http://localhost:${port}`, rpId: 'localhost' }),
      { challenge, rpId: 'localhost', isOriginAllowed: () => true },
    );
    auth.addPasskey({ ...record, name: 'out-of-band' });
  });

  after(async () => {
    Date.now = realDateNow;
    auth.cleanup();
    await new Promise((resolve) => server.close(resolve));
  });

  it('offers passkeys on the public tunnel URL while the relay presents Host: localhost', async () => {
    const relay = new Client(port, { host: `localhost:${port}` });
    const status = () => relay.get(`/api/auth/status?origin=${encodeURIComponent(TUNNEL_ORIGIN)}`);
    state.publicUrl = null;
    assert.equal((await status()).json.passkeys.enabled, false);
    state.publicUrl = `${TUNNEL_ORIGIN}/`;
    assert.deepEqual((await status()).json.passkeys, { enabled: true, registered: false });
    state.publicUrl = 'not a url';
    assert.equal((await status()).json.passkeys.enabled, false);
    state.publicUrl = null;
  });

  it('runs passkey ceremonies on the tunnel origin although the relay rewrites Origin', async () => {
    // The relay rewrites a same-origin Origin header to http://localhost:<port>;
    // the page reports its real origin in the request body instead.
    const viaRelay = () =>
      new Client(port, { host: `localhost:${port}`, origin: `http://localhost:${port}` });
    const rpId = new URL(TUNNEL_ORIGIN).hostname;
    const phone = new SoftwareAuthenticator();
    state.publicUrl = `${TUNNEL_ORIGIN}/`;
    try {
      const owner = viaRelay();
      await owner.signIn();
      const reg = await owner.post('/api/auth/passkeys/register/options', {
        origin: TUNNEL_ORIGIN,
      });
      assert.equal(reg.status, 200, reg.text);
      assert.equal(reg.json.publicKey.rp.id, rpId);
      const saved = await owner.post('/api/auth/passkeys/register', {
        name: 'Phone',
        credential: phone.register({
          challenge: reg.json.publicKey.challenge,
          origin: TUNNEL_ORIGIN,
          rpId,
        }),
      });
      assert.equal(saved.status, 200, saved.text);

      const fresh = viaRelay();
      const opts = await fresh.post('/api/auth/passkeys/login/options', { origin: TUNNEL_ORIGIN });
      assert.equal(opts.status, 200, opts.text);
      assert.equal(opts.json.publicKey.rpId, rpId);
      const res = await fresh.post('/api/auth/passkeys/login', {
        credential: phone.assert({
          challenge: opts.json.publicKey.challenge,
          origin: TUNNEL_ORIGIN,
          rpId,
        }),
      });
      assert.equal(res.status, 200, res.text);
      assert.ok(fresh.token, 'passkey sign-in should set a session cookie');
    } finally {
      state.publicUrl = null;
    }
  });

  it('refuses a claimed ceremony origin the server is not reachable at', async () => {
    state.publicUrl = `${TUNNEL_ORIGIN}/`;
    try {
      const relay = new Client(port, {
        host: `localhost:${port}`,
        origin: `http://localhost:${port}`,
      });
      const res = await relay.post('/api/auth/passkeys/login/options', {
        origin: 'https://evil-1234.uks1.devtunnels.ms',
      });
      assert.equal(res.status, 400);
    } finally {
      state.publicUrl = null;
    }
  });

  it('treats X-Forwarded-Host from a loopback reverse proxy as a passkey host', async () => {
    const origin = 'https://box.tail1234.ts.net';
    const proxied = new Client(port, { host: `localhost:${port}` });
    const res = await proxied.get(`/api/auth/status?origin=${encodeURIComponent(origin)}`, {
      'x-forwarded-host': 'box.tail1234.ts.net',
    });
    assert.deepEqual(res.json.passkeys, { enabled: true, registered: false });
  });

  it('rejects an assertion for a challenge older than 3 minutes', async () => {
    const client = Client.secure(port);
    const start = realDateNow();
    Date.now = () => start;
    try {
      const opts = await client.post('/api/auth/passkeys/login/options');
      assert.equal(opts.status, 200);
      const credential = authr.assert({
        challenge: opts.json.publicKey.challenge,
        origin: client.origin,
        rpId: 'localhost',
      });
      Date.now = () => start + 3 * 60 * 1000 + 1;
      const res = await client.post('/api/auth/passkeys/login', { credential });
      assert.equal(res.status, 400);
      assert.match(res.json.error, /expired/);
    } finally {
      Date.now = realDateNow;
    }
  });

  it('bounds pending challenges: the oldest is evicted beyond 500', async () => {
    const client = Client.secure(port);
    const first = await client.post('/api/auth/passkeys/login/options');
    let last;
    for (let i = 0; i < 500; i++) last = await client.post('/api/auth/passkeys/login/options');

    const stale = authr.assert({
      challenge: first.json.publicKey.challenge,
      origin: client.origin,
      rpId: 'localhost',
    });
    assert.equal(
      (await client.post('/api/auth/passkeys/login', { credential: stale })).status,
      400,
    );

    const fresh = authr.assert({
      challenge: last.json.publicKey.challenge,
      origin: client.origin,
      rpId: 'localhost',
    });
    const res = await client.post('/api/auth/passkeys/login', { credential: fresh });
    assert.equal(res.status, 200, res.text);
    assert.ok(setCookie(res).value);
  });
});

describe('auth routes without a password', () => {
  let inst;

  before(async () => {
    inst = await startServer({ password: null });
  });

  after(() => {
    inst?.shutdown();
  });

  it('GET /login redirects to /', async () => {
    const res = await new Client(inst.port).get('/login');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/');
  });

  it('GET /api/auth/status reports open access and no passkeys', async () => {
    const res = await new Client(inst.port, { host: `localhost:${inst.port}` }).get(
      `/api/auth/status?origin=${encodeURIComponent(`http://localhost:${inst.port}`)}`,
    );
    assert.deepEqual(res.json, {
      passwordRequired: false,
      authenticated: true,
      passkeys: { enabled: false, registered: false },
      session: null,
    });
  });

  it('passkey endpoints explain that authentication is disabled', async () => {
    const client = Client.secure(inst.port);
    const login = await client.post('/api/auth/passkeys/login/options');
    assert.equal(login.status, 400);
    assert.match(login.json.error, /disabled/);
    const register = await client.post('/api/auth/passkeys/register/options');
    assert.equal(register.status, 400);
    assert.match(register.json.error, /password/);
  });

  it('POST /api/auth cannot mint sessions and QR tokens are ignored', async () => {
    const client = new Client(inst.port);
    assert.equal((await client.post('/api/auth', { password: '' })).status, 401);
    assert.equal((await client.post('/api/auth', { ott: 'x' })).status, 401);
    assert.equal((await client.get('/?ott=abc')).status < 500, true);
    assert.equal((await client.post('/api/auth/sessions/revoke-others')).status, 400);
    assert.deepEqual((await client.post('/api/auth/logout')).json, { ok: true });
  });
});
