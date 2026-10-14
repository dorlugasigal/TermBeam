'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const log = require('../../src/utils/logger');
const {
  createAuth,
  safeNextPath,
  describeUserAgent,
  COOKIE_NAME,
  REMEMBER_TTL_MS,
  REMEMBER_IDLE_MS,
  SESSION_ONLY_TTL_MS,
  SESSION_ONLY_IDLE_MS,
} = require('../../src/server/auth');
const {
  createAuthStore,
  passwordEpoch,
  epochMatches,
  FILE_NAME,
} = require('../../src/server/auth-store');

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  ipadChrome:
    'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  windowsOpera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/109.0.0.0',
  androidPhone:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  chromebook:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
};

const DAY = 24 * 60 * 60 * 1000;
const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

const realDateNow = Date.now;
const realWarn = log.warn;
const realInfo = log.info;

let clock = 0;
function useClock(start = realDateNow()) {
  clock = start;
  Date.now = () => clock;
}

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tb-auth-sessions-'));
}

function readAuthFile(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, FILE_NAME), 'utf8'));
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    redirectedTo: undefined,
    cookies: [],
    cleared: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
    },
    cookie(name, value, opts) {
      this.cookies.push({ name, value, opts });
    },
    clearCookie(name, opts) {
      this.cleared.push({ name, opts });
    },
  };
}

describe('auth sessions', () => {
  const auths = [];
  const dirs = [];

  /** createAuth that is always cleaned up after the test. */
  function newAuth(password, options) {
    const auth = createAuth(password, options);
    auths.push(auth);
    return auth;
  }

  function newDir() {
    const dir = makeDir();
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    // cleanup() may flush a pending write, so run it while mocks are still in place
    for (const auth of auths.splice(0)) auth.cleanup();
    Date.now = realDateNow;
    log.warn = realWarn;
    log.info = realInfo;
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('persistence (auth.json)', () => {
    it('persists remembered sessions to <configDir>/auth.json with mode 0600', () => {
      const dir = newDir();
      const auth = newAuth('pw', { configDir: dir });
      const { session } = auth.createSession({ userAgent: UA.iphone, ip: '10.0.0.5' });
      const file = path.join(dir, FILE_NAME);
      assert.ok(fs.existsSync(file), 'auth.json should be written');
      if (process.platform !== 'win32') {
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      }
      const data = readAuthFile(dir);
      assert.equal(data.version, 1);
      assert.equal(typeof data.userHandle, 'string');
      assert.equal(data.sessions.length, 1);
      assert.equal(data.sessions[0].id, session.id);
      assert.equal(data.sessions[0].userAgent, UA.iphone);
      assert.equal(data.sessions[0].ip, '10.0.0.5');
      assert.equal(data.sessions[0].remember, true);
      assert.deepEqual(data.passkeys, []);
      // No temp files left behind by the atomic write
      assert.deepEqual(fs.readdirSync(dir), [FILE_NAME]);
    });

    it('never stores tokens (or the password) in plaintext — only SHA-256 hashes', () => {
      const dir = newDir();
      const password = 'correct horse battery staple';
      const auth = newAuth(password, { configDir: dir });
      const a = auth.createSession({});
      const b = auth.createSession({ method: 'qr' });
      const raw = fs.readFileSync(path.join(dir, FILE_NAME), 'utf8');
      for (const { token } of [a, b]) {
        assert.equal(raw.includes(token), false, 'raw token must not be on disk');
        assert.ok(raw.includes(sha256Hex(token)), 'token hash should be on disk');
      }
      assert.equal(raw.includes(password), false, 'password must not be on disk');
      const data = JSON.parse(raw);
      for (const s of data.sessions) {
        assert.match(s.tokenHash, /^[a-f0-9]{64}$/);
        assert.equal('token' in s, false);
      }
      // The password epoch is a salted scrypt fingerprint, not the password
      assert.equal(typeof data.epoch.salt, 'string');
      assert.equal(typeof data.epoch.hash, 'string');
      assert.equal(epochMatches(data.epoch, password), true);
    });

    it('restores remembered sessions after a restart with the same password', () => {
      const dir = newDir();
      const first = newAuth('pw', { configDir: dir });
      const { token, session } = first.createSession({ userAgent: UA.macChrome });
      first.cleanup();

      const second = newAuth('pw', { configDir: dir });
      const restored = second.getSession(token);
      assert.ok(restored, 'session should survive a restart');
      assert.equal(restored.id, session.id);
      assert.equal(restored.method, 'password');
      assert.equal(second.validateToken(token), true);
      assert.equal(second.listSessions()[0].device, 'Mac · Chrome');
      assert.equal(second.userHandle, first.userHandle);
    });

    it('drops remembered sessions but keeps passkeys when the password changes', () => {
      const dir = newDir();
      const first = newAuth('old-password', { configDir: dir });
      const { token } = first.createSession({});
      first.addPasskey({
        id: 'cred-1',
        publicKey: { kty: 'OKP', crv: 'Ed25519', x: 'abc' },
        alg: -8,
        rpId: 'localhost',
        name: 'Laptop',
      });
      first.cleanup();

      const infos = [];
      log.info = (...args) => infos.push(args.join(' '));
      const second = newAuth('new-password', { configDir: dir });
      assert.equal(second.getSession(token), null, 'old sessions are signed out');
      assert.deepEqual(second.listSessions(), []);
      assert.ok(second.getPasskey('cred-1'), 'passkeys survive a password change');
      assert.ok(infos.some((m) => /password changed/.test(m)));

      // A new session is bound to the new password's epoch and survives restarts
      const fresh = second.createSession({});
      second.cleanup();
      const third = newAuth('new-password', { configDir: dir });
      assert.ok(third.getSession(fresh.token));
      assert.equal(third.getSession(token), null);
      assert.equal(epochMatches(readAuthFile(dir).epoch, 'new-password'), true);
      assert.equal(epochMatches(readAuthFile(dir).epoch, 'old-password'), false);
    });

    it('never writes session-only logins (remember:false) to disk', () => {
      const dir = newDir();
      const auth = newAuth('pw', { configDir: dir });
      const shortLived = auth.createSession({ remember: false });
      assert.equal(fs.existsSync(path.join(dir, FILE_NAME)), false);

      const remembered = auth.createSession({ remember: true });
      const data = readAuthFile(dir);
      assert.deepEqual(
        data.sessions.map((s) => s.id),
        [remembered.session.id],
      );
      assert.equal(
        fs.readFileSync(path.join(dir, FILE_NAME), 'utf8').includes(shortLived.session.id),
        false,
      );
      auth.cleanup();

      const restarted = newAuth('pw', { configDir: dir });
      assert.equal(restarted.getSession(shortLived.token), null);
      assert.ok(restarted.getSession(remembered.token));
    });

    it('session-only logins use the short TTL and idle timeout', () => {
      useClock(1_700_000_000_000);
      const auth = newAuth('pw');
      const { session } = auth.createSession({ remember: false });
      assert.equal(session.remember, false);
      assert.equal(session.expiresAt - session.createdAt, SESSION_ONLY_TTL_MS);
      assert.equal(session.idleTimeoutMs, SESSION_ONLY_IDLE_MS);
      const { session: long } = auth.createSession({ remember: true });
      assert.equal(long.expiresAt - long.createdAt, REMEMBER_TTL_MS);
      assert.equal(long.idleTimeoutMs, REMEMBER_IDLE_MS);
    });

    it('does not restore remembered sessions that expired while the server was down', () => {
      const dir = newDir();
      useClock(1_700_000_000_000);
      const first = newAuth('pw', { configDir: dir });
      const { token } = first.createSession({});
      first.cleanup();
      clock += REMEMBER_TTL_MS + 1;
      const second = newAuth('pw', { configDir: dir });
      assert.equal(second.getSession(token), null);
      assert.deepEqual(second.listSessions(), []);
    });

    it('falls back to a fresh state when auth.json is corrupted', () => {
      const dir = newDir();
      fs.writeFileSync(path.join(dir, FILE_NAME), '{ this is not json');
      const warnings = [];
      log.warn = (...args) => warnings.push(args.join(' '));
      const auth = newAuth('pw', { configDir: dir });
      assert.ok(warnings.some((m) => m.includes(`could not read ${FILE_NAME}`)));
      assert.deepEqual(auth.listSessions(), []);
      assert.deepEqual(auth.listPasskeys(), []);

      // The next write replaces the corrupted file with a valid one
      const { token } = auth.createSession({});
      assert.equal(readAuthFile(dir).sessions.length, 1);
      auth.cleanup();
      assert.ok(newAuth('pw', { configDir: dir }).getSession(token));
    });

    it('does not warn when auth.json simply does not exist yet', () => {
      const warnings = [];
      log.warn = (...args) => warnings.push(args.join(' '));
      newAuth('pw', { configDir: newDir() });
      assert.deepEqual(warnings, []);
    });

    it('ignores auth.json written by an unknown file version', () => {
      const dir = newDir();
      fs.writeFileSync(
        path.join(dir, FILE_NAME),
        JSON.stringify({ version: 99, userHandle: 'future', sessions: [], passkeys: [] }),
      );
      const auth = newAuth('pw', { configDir: dir });
      assert.notEqual(auth.userHandle, 'future');
    });

    it('sanitizes malformed session and passkey entries on load', () => {
      const dir = newDir();
      const now = realDateNow();
      const token = 'a'.repeat(64);
      const good = {
        id: 'good',
        tokenHash: sha256Hex(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + DAY,
        remember: true,
        method: 'passkey',
        userAgent: 'x'.repeat(500),
        passkeyId: 'pk',
      };
      fs.writeFileSync(
        path.join(dir, FILE_NAME),
        JSON.stringify({
          version: 1,
          epoch: passwordEpoch('pw'),
          userHandle: 'handle-123',
          sessions: [
            good,
            null,
            'nope',
            { ...good, id: 'bad-hash', tokenHash: 'not-a-hash' },
            { ...good, id: 42 },
            { ...good, id: 'session-only', tokenHash: sha256Hex('b'.repeat(64)), remember: false },
          ],
          passkeys: [
            {
              id: 'pk',
              publicKey: { kty: 'OKP' },
              alg: -8,
              rpId: 'localhost',
              name: 'n'.repeat(99),
            },
            { id: 'no-key', alg: -7, rpId: 'localhost' },
            { id: 'no-rp', publicKey: {}, alg: -7 },
            { id: 'float-alg', publicKey: {}, alg: -7.5, rpId: 'localhost' },
            null,
          ],
        }),
      );
      const auth = newAuth('pw', { configDir: dir });
      assert.equal(auth.userHandle, 'handle-123');
      assert.deepEqual(
        auth.listSessions().map((s) => s.id),
        ['good'],
      );
      const session = auth.getSession(token);
      assert.equal(session.userAgent.length, 300);
      assert.equal(session.method, 'passkey');
      assert.deepEqual(
        auth.listPasskeys().map((p) => p.id),
        ['pk'],
      );
      const pk = auth.getPasskey('pk');
      assert.equal(pk.name.length, 64);
      assert.equal(pk.signCount, 0);
      assert.deepEqual(pk.transports, []);
    });

    it('stays memory-only when no password is configured', () => {
      const dir = newDir();
      const auth = newAuth(null, { configDir: dir });
      auth.createSession({});
      auth.addPasskey({ id: 'x', publicKey: {}, alg: -7, rpId: 'localhost', name: 'x' });
      assert.deepEqual(fs.readdirSync(dir), []);
    });

    it('never lets a persistence failure break sign-in', () => {
      const dir = newDir();
      const notADir = path.join(dir, 'file');
      fs.writeFileSync(notADir, 'x');
      const warnings = [];
      log.warn = (...args) => warnings.push(args.join(' '));
      const auth = newAuth('pw', { configDir: notADir });
      const { token } = auth.createSession({});
      assert.ok(auth.getSession(token), 'session still works in memory');
      assert.ok(warnings.some((m) => m.includes(`failed to persist ${FILE_NAME}`)));
      assert.deepEqual(fs.readdirSync(dir), ['file'], 'no stray temp file');
    });

    it('debounces lastSeenAt writes and flushes them on cleanup()', () => {
      const dir = newDir();
      useClock(1_700_000_000_000);
      const auth = newAuth('pw', { configDir: dir });
      const { token, session } = auth.createSession({});
      const createdAt = session.createdAt;

      clock += 60 * 1000; // < 10 min: tracked in memory only
      auth.getSession(token);
      assert.equal(readAuthFile(dir).sessions[0].lastSeenAt, createdAt);
      auth.cleanup();
      assert.equal(readAuthFile(dir).sessions[0].lastSeenAt, clock);

      clock += 11 * 60 * 1000; // > 10 min since last touch: written straight away
      auth.getSession(token);
      assert.equal(readAuthFile(dir).sessions[0].lastSeenAt, clock);
    });
  });

  describe('expiry', () => {
    it('slides the idle timeout on every use', () => {
      useClock(1_700_000_000_000);
      const auth = newAuth('pw');
      const { token } = auth.createSession({});
      for (let i = 0; i < 3; i++) {
        clock += REMEMBER_IDLE_MS - 1000;
        assert.ok(auth.getSession(token), `use #${i + 1} within the idle window`);
      }
    });

    it('expires after the idle window and emits a revoked event', () => {
      useClock(1_700_000_000_000);
      const auth = newAuth('pw');
      const events = [];
      auth.events.on('revoked', (e) => events.push(e));
      const { token, session } = auth.createSession({});
      clock += REMEMBER_IDLE_MS + 1;
      assert.equal(auth.getSession(token), null);
      assert.deepEqual(events, [{ ids: [session.id], reason: 'expired' }]);
      assert.equal(auth.getSession(token), null, 'stays gone');
    });

    it('never outlives the absolute cap even when used continuously', () => {
      const start = 1_700_000_000_000;
      useClock(start);
      const auth = newAuth('pw');
      const { token } = auth.createSession({});
      while (clock + 6 * DAY < start + REMEMBER_TTL_MS) {
        clock += 6 * DAY;
        assert.ok(auth.getSession(token));
      }
      clock = start + REMEMBER_TTL_MS;
      assert.ok(auth.getSession(token), 'valid up to the cap');
      clock += 1;
      assert.equal(auth.getSession(token), null, 'expired past the 30-day cap');
    });

    it('session-only logins idle out after 2h and are capped at 12h', () => {
      const start = 1_700_000_000_000;
      useClock(start);
      const auth = newAuth('pw');
      const idle = auth.createSession({ remember: false });
      clock += SESSION_ONLY_IDLE_MS + 1;
      assert.equal(auth.getSession(idle.token), null);

      clock = start;
      const busy = auth.createSession({ remember: false });
      while (clock + 60 * 60 * 1000 <= start + SESSION_ONLY_TTL_MS) {
        clock += 60 * 60 * 1000;
        assert.ok(auth.getSession(busy.token));
      }
      clock = start + SESSION_ONLY_TTL_MS + 1;
      assert.equal(auth.getSession(busy.token), null);
    });

    it('rejects malformed tokens', () => {
      const auth = newAuth('pw');
      const { token } = auth.createSession({});
      for (const bad of [undefined, null, 42, '', token.slice(1), `${token}0`, 'z'.repeat(64)]) {
        assert.equal(auth.getSession(bad), null);
      }
      assert.ok(auth.getSession(token));
    });

    it('generateToken mints a remembered password session (back-compat)', () => {
      const auth = newAuth('pw');
      const token = auth.generateToken({ userAgent: UA.iphone });
      const s = auth.getSession(token);
      assert.equal(s.method, 'password');
      assert.equal(s.remember, true);
    });
  });

  describe('revocation and listing', () => {
    it('revokeSession signs one device out and emits its id', () => {
      const auth = newAuth('pw');
      const events = [];
      auth.events.on('revoked', (e) => events.push(e));
      const a = auth.createSession({});
      const b = auth.createSession({});
      assert.equal(auth.revokeSession(a.session.id), true);
      assert.equal(auth.getSession(a.token), null);
      assert.ok(auth.getSession(b.token));
      assert.deepEqual(events, [{ ids: [a.session.id], reason: 'revoked' }]);
      assert.equal(auth.revokeSession(a.session.id), false, 'already gone');
      assert.equal(auth.revokeSession('nope'), false);
      assert.equal(events.length, 1, 'no event when nothing was removed');
    });

    it('revokeSession is persisted', () => {
      const dir = newDir();
      const auth = newAuth('pw', { configDir: dir });
      const a = auth.createSession({});
      auth.revokeSession(a.session.id);
      auth.cleanup();
      assert.equal(readAuthFile(dir).sessions.length, 0);
      assert.equal(newAuth('pw', { configDir: dir }).getSession(a.token), null);
    });

    it('revokeOtherSessions keeps only the current device', () => {
      const auth = newAuth('pw');
      const events = [];
      auth.events.on('revoked', (e) => events.push(e));
      const keep = auth.createSession({});
      const others = [auth.createSession({}), auth.createSession({ remember: false })];
      assert.equal(auth.revokeOtherSessions(keep.session.id), 2);
      assert.ok(auth.getSession(keep.token));
      for (const o of others) assert.equal(auth.getSession(o.token), null);
      assert.deepEqual(events, [{ ids: others.map((o) => o.session.id), reason: 'revoked' }]);
      assert.equal(auth.revokeOtherSessions(keep.session.id), 0);
    });

    it('listSessions reports devices, most recent first, flagging the current one', () => {
      const start = 1_700_000_000_000;
      useClock(start);
      const auth = newAuth('pw');
      const phone = auth.createSession({ userAgent: UA.iphone, ip: '10.0.0.2' });
      clock += 1000;
      const laptop = auth.createSession({ userAgent: UA.macChrome, method: 'passkey' });
      clock += 1000;
      const tablet = auth.createSession({ userAgent: UA.androidTablet, remember: false });
      clock += 1000;
      auth.getSession(phone.token); // phone becomes the most recently used

      const list = auth.listSessions(laptop.session.id);
      assert.deepEqual(
        list.map((s) => s.id),
        [phone.session.id, tablet.session.id, laptop.session.id],
      );
      assert.deepEqual(
        list.map((s) => s.current),
        [false, false, true],
      );
      assert.deepEqual(
        list.map((s) => s.device),
        ['iPhone · Safari', 'Android tablet · Chrome', 'Mac · Chrome'],
      );
      const [p, t, l] = list;
      assert.equal(p.ip, '10.0.0.2');
      assert.equal(l.ip, null);
      assert.equal(l.method, 'passkey');
      assert.equal(t.remember, false);
      // expiresAt is the earlier of the absolute cap and the idle deadline
      assert.equal(p.expiresAt, clock + REMEMBER_IDLE_MS);
      assert.equal(t.expiresAt, start + 2000 + SESSION_ONLY_IDLE_MS);
      for (const s of list) assert.equal('tokenHash' in s, false);

      assert.equal(auth.listSessions().filter((s) => s.current).length, 0);
    });

    it('listSessions hides expired sessions', () => {
      useClock(1_700_000_000_000);
      const auth = newAuth('pw');
      auth.createSession({ remember: false });
      const kept = auth.createSession({});
      clock += SESSION_ONLY_IDLE_MS + 1;
      assert.deepEqual(
        auth.listSessions().map((s) => s.id),
        [kept.session.id],
      );
    });
  });

  describe('passkeys', () => {
    const record = (id, rpId = 'localhost') => ({
      id,
      publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      alg: -7,
      signCount: 0,
      rpId,
      transports: ['internal'],
      backupEligible: true,
      backedUp: true,
      aaguid: '00'.repeat(16),
      name: `Key ${id}`,
    });

    it('adds, reads, filters, updates and lists passkeys (persisted)', () => {
      const dir = newDir();
      useClock(1_700_000_000_000);
      const auth = newAuth('pw', { configDir: dir });
      const saved = auth.addPasskey(record('a'));
      assert.equal(saved.createdAt, clock);
      assert.equal(saved.lastUsedAt, null);
      auth.addPasskey(record('b', 'abcd-3456.uks1.devtunnels.ms'));

      assert.equal(auth.getPasskey('a').name, 'Key a');
      assert.equal(auth.getPasskey('zzz'), null);
      assert.deepEqual(
        auth.passkeysForRp('localhost').map((p) => p.id),
        ['a'],
      );
      assert.deepEqual(auth.passkeysForRp('nowhere.example'), []);

      const updated = auth.updatePasskey('a', { signCount: 4, lastUsedAt: clock + 5 });
      assert.equal(updated.signCount, 4);
      assert.equal(auth.updatePasskey('zzz', { name: 'x' }), null);

      assert.deepEqual(auth.listPasskeys()[0], {
        id: 'a',
        name: 'Key a',
        rpId: 'localhost',
        createdAt: clock,
        lastUsedAt: clock + 5,
        synced: true,
      });
      assert.equal('publicKey' in auth.listPasskeys()[0], false);

      auth.cleanup();
      const restarted = newAuth('pw', { configDir: dir });
      assert.equal(restarted.getPasskey('a').signCount, 4);
      assert.deepEqual(restarted.getPasskey('b').publicKey, record('b').publicKey);
    });

    it('rejects duplicate registrations and caps the number of passkeys', () => {
      const auth = newAuth('pw');
      auth.addPasskey(record('dup'));
      assert.throws(() => auth.addPasskey(record('dup')), /already registered/);
      for (let i = 1; i < 50; i++) auth.addPasskey(record(`k${i}`));
      assert.throws(() => auth.addPasskey(record('one-too-many')), /Too many passkeys/);
      assert.equal(auth.listPasskeys().length, 50);
    });

    it('removing a passkey signs out the sessions created with it', () => {
      const auth = newAuth('pw');
      const events = [];
      auth.events.on('revoked', (e) => events.push(e));
      auth.addPasskey(record('lost-phone'));
      auth.addPasskey(record('laptop'));
      const viaPhone = auth.createSession({ method: 'passkey', passkeyId: 'lost-phone' });
      const viaLaptop = auth.createSession({ method: 'passkey', passkeyId: 'laptop' });
      const viaPassword = auth.createSession({});

      assert.equal(auth.removePasskey('lost-phone'), true);
      assert.equal(auth.getPasskey('lost-phone'), null);
      assert.equal(auth.getSession(viaPhone.token), null);
      assert.ok(auth.getSession(viaLaptop.token));
      assert.ok(auth.getSession(viaPassword.token));
      assert.deepEqual(events, [{ ids: [viaPhone.session.id], reason: 'passkey-removed' }]);

      assert.equal(auth.removePasskey('lost-phone'), false);
      assert.equal(events.length, 1);
    });
  });

  describe('resetAll (termbeam --reset-auth)', () => {
    it('wipes every remembered session and passkey, on disk too', () => {
      const dir = newDir();
      const auth = newAuth('pw', { configDir: dir });
      const events = [];
      auth.events.on('revoked', (e) => events.push(e));
      const a = auth.createSession({});
      const b = auth.createSession({ remember: false });
      auth.addPasskey({ id: 'pk', publicKey: {}, alg: -7, rpId: 'localhost', name: 'pk' });

      auth.resetAll();
      assert.equal(auth.getSession(a.token), null);
      assert.equal(auth.getSession(b.token), null);
      assert.deepEqual(auth.listPasskeys(), []);
      assert.deepEqual(events, [{ ids: [a.session.id, b.session.id], reason: 'reset' }]);
      const data = readAuthFile(dir);
      assert.deepEqual(data.sessions, []);
      assert.deepEqual(data.passkeys, []);

      auth.cleanup();
      const restarted = newAuth('pw', { configDir: dir });
      assert.equal(restarted.getSession(a.token), null);
    });

    it('emits nothing when there was nothing to revoke', () => {
      const auth = newAuth('pw');
      const events = [];
      auth.events.on('revoked', (e) => events.push(e));
      auth.resetAll();
      assert.deepEqual(events, []);
    });
  });

  describe('MAX_SESSIONS eviction', () => {
    it('evicts the least recently used session beyond 200', () => {
      const dir = newDir();
      useClock(1_700_000_000_000);
      const auth = newAuth('pw', { configDir: dir });
      const events = [];
      auth.events.on('revoked', (e) => events.push(e));
      const created = [];
      for (let i = 0; i < 200; i++) {
        clock += 1;
        created.push(auth.createSession({}));
      }
      clock += 1;
      auth.getSession(created[0].token); // oldest login, but used just now

      clock += 1;
      const newest = auth.createSession({});
      assert.deepEqual(events, [{ ids: [created[1].session.id], reason: 'evicted' }]);
      assert.equal(auth.getSession(created[1].token), null);
      assert.ok(auth.getSession(created[0].token));
      assert.ok(auth.getSession(newest.token));
      assert.equal(auth.listSessions().length, 200);
      assert.equal(readAuthFile(dir).sessions.length, 200);
    });
  });

  describe('session cookies', () => {
    it('sets a persistent HttpOnly SameSite=Strict cookie for remembered sessions', () => {
      useClock(1_700_000_000_000);
      const auth = newAuth('pw');
      const { token, session } = auth.createSession({});
      const res = fakeRes();
      auth.setSessionCookie({ secure: false }, res, token, session);
      assert.deepEqual(res.cookies, [
        {
          name: COOKIE_NAME,
          value: token,
          opts: {
            httpOnly: true,
            sameSite: 'strict',
            secure: false,
            path: '/',
            maxAge: REMEMBER_TTL_MS,
          },
        },
      ]);
    });

    it('sets a browser-session cookie (no maxAge) for session-only logins', () => {
      const auth = newAuth('pw');
      const { token, session } = auth.createSession({ remember: false });
      const res = fakeRes();
      auth.setSessionCookie({ secure: true }, res, token, session);
      assert.equal('maxAge' in res.cookies[0].opts, false);
      assert.equal(res.cookies[0].opts.secure, true);
    });

    it('clears the cookie with matching attributes', () => {
      const auth = newAuth('pw');
      const res = fakeRes();
      auth.clearSessionCookie({}, res);
      assert.deepEqual(res.cleared, [
        {
          name: COOKIE_NAME,
          opts: { httpOnly: true, sameSite: 'strict', secure: false, path: '/' },
        },
      ]);
    });
  });

  describe('middleware', () => {
    let auth;
    beforeEach(() => {
      auth = newAuth('pw');
    });

    function run(req) {
      const res = fakeRes();
      let nextCalled = false;
      auth.middleware(
        { headers: {}, cookies: {}, ip: '127.0.0.1', ...req },
        res,
        () => (nextCalled = true),
      );
      return { res, nextCalled };
    }

    it('sets req.authSession for a valid cookie', () => {
      const { token, session } = auth.createSession({});
      const req = { headers: {}, cookies: { [COOKIE_NAME]: token }, path: '/api/sessions' };
      let called = false;
      auth.middleware(req, fakeRes(), () => (called = true));
      assert.ok(called);
      assert.equal(req.authSession.id, session.id);
    });

    it('redirects page requests to /login?next=… (dropping ott)', () => {
      const { res, nextCalled } = run({
        path: '/terminal',
        originalUrl: '/terminal?session=abc&ott=deadbeef#tab',
      });
      assert.equal(nextCalled, false);
      assert.equal(
        res.redirectedTo,
        `/login?next=${encodeURIComponent('/terminal?session=abc#tab')}`,
      );
    });

    it('falls back to req.url when originalUrl is missing', () => {
      const { res } = run({ path: '/agent', url: '/agent' });
      assert.equal(res.redirectedTo, '/login?next=%2Fagent');
    });

    it('keeps a plain /login redirect for the root page or no URL at all', () => {
      assert.equal(run({ path: '/', originalUrl: '/' }).res.redirectedTo, '/login');
      assert.equal(run({ path: '/' }).res.redirectedTo, '/login');
      assert.equal(run({ path: '/x', originalUrl: '//evil.example' }).res.redirectedTo, '/login');
    });

    it('answers API requests with 401 JSON instead of a redirect', () => {
      const { res } = run({ path: '/api/sessions', originalUrl: '/api/sessions' });
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: 'unauthorized' });
      assert.equal(res.redirectedTo, undefined);
    });

    it('treats an expired cookie like no cookie', () => {
      useClock(1_700_000_000_000);
      const { token } = auth.createSession({ remember: false });
      clock += SESSION_ONLY_IDLE_MS + 1;
      const { res, nextCalled } = run({
        cookies: { [COOKIE_NAME]: token },
        path: '/terminal',
        originalUrl: '/terminal',
      });
      assert.equal(nextCalled, false);
      assert.equal(res.redirectedTo, '/login?next=%2Fterminal');
    });

    it('accepts the password as a Bearer token without creating a session', () => {
      const req = { headers: { authorization: 'Bearer pw' }, cookies: {}, path: '/api/sessions' };
      let called = false;
      auth.middleware(req, fakeRes(), () => (called = true));
      assert.ok(called);
      assert.equal(req.authSession, undefined);
      assert.deepEqual(auth.listSessions(), []);
    });

    it('is a no-op when no password is configured', () => {
      const open = newAuth(null);
      let called = false;
      open.middleware({ headers: {}, path: '/api/sessions' }, fakeRes(), () => (called = true));
      assert.ok(called);
    });
  });

  describe('safeNextPath', () => {
    it('keeps same-origin paths with their query and hash', () => {
      assert.equal(safeNextPath('/'), '/');
      assert.equal(safeNextPath('/terminal'), '/terminal');
      assert.equal(safeNextPath('/terminal?session=abc'), '/terminal?session=abc');
      assert.equal(safeNextPath('/code/abc?file=a.js#L10'), '/code/abc?file=a.js#L10');
    });

    it('strips the one-time ott token', () => {
      assert.equal(safeNextPath('/?ott=abc'), '/');
      assert.equal(safeNextPath('/terminal?ott=abc&session=s1'), '/terminal?session=s1');
      assert.equal(safeNextPath('/terminal?session=s1&ott=abc#h'), '/terminal?session=s1#h');
    });

    it('rejects protocol-relative and backslash tricks', () => {
      for (const bad of [
        '//evil.example',
        '//evil.example/path',
        '/\\evil.example',
        '/\\/evil.example',
      ]) {
        assert.equal(safeNextPath(bad), null, bad);
      }
    });

    it('rejects paths that normalise into a protocol-relative URL', () => {
      // WHATWG URL resolves dot segments: "/..//evil.example" → "//evil.example",
      // which a browser treats as https://evil.example when used as a Location.
      for (const bad of [
        '/..//evil.example',
        '/.//evil.example',
        '/a/..//evil.example',
        '/%2e%2e//evil.example',
        '/.\\/evil.example',
      ]) {
        assert.equal(safeNextPath(bad), null, bad);
      }
    });

    it('rejects absolute URLs and non-path values', () => {
      for (const bad of [
        'https://evil.example',
        'http://localhost:3456/terminal',
        'javascript:alert(1)',
        'terminal',
        '',
        null,
        undefined,
        42,
        `/${'a'.repeat(2048)}`,
      ]) {
        assert.equal(safeNextPath(bad), null, String(bad).slice(0, 40));
      }
    });

    it('rejects control characters', () => {
      for (const bad of ['/ok\u0000', '/a\tb', '/a\nb', '/a\rb', '/a\u001fb', '/a\u007fb']) {
        assert.equal(safeNextPath(bad), null, JSON.stringify(bad));
      }
    });

    it('never redirects back to /login', () => {
      assert.equal(safeNextPath('/login'), null);
      assert.equal(safeNextPath('/login?next=/terminal'), null);
      assert.equal(safeNextPath('/login#x'), null);
    });
  });

  describe('describeUserAgent', () => {
    it('labels common devices and browsers', () => {
      const cases = [
        [UA.iphone, 'iPhone · Safari'],
        [UA.ipadChrome, 'iPad · Chrome'],
        [UA.macChrome, 'Mac · Chrome'],
        [UA.windowsEdge, 'Windows PC · Edge'],
        [UA.windowsOpera, 'Windows PC · Opera'],
        [UA.androidPhone, 'Android phone · Chrome'],
        [UA.androidTablet, 'Android tablet · Chrome'],
        [UA.chromebook, 'Chromebook · Chrome'],
        [UA.linuxFirefox, 'Linux · Firefox'],
        ['node', 'Device · CLI'],
        ['termbeam-cli/1.0', 'Device · CLI'],
        ['curl/8.4.0', 'Device'],
      ];
      for (const [ua, expected] of cases) assert.equal(describeUserAgent(ua), expected, ua);
    });

    it('handles missing user agents', () => {
      for (const ua of ['', null, undefined, 42]) {
        assert.equal(describeUserAgent(ua), 'Unknown device');
      }
    });
  });

  describe('auth-store helpers', () => {
    it('passwordEpoch / epochMatches bind sessions to the password', () => {
      const epoch = passwordEpoch('secret');
      assert.equal(epochMatches(epoch, 'secret'), true);
      assert.equal(epochMatches(epoch, 'Secret'), false);
      assert.equal(epochMatches(passwordEpoch('secret', epoch.salt), 'secret'), true);
      assert.notEqual(passwordEpoch('secret').salt, epoch.salt, 'fresh random salt each time');
      for (const bad of [null, {}, { salt: 1, hash: 'x' }, { salt: epoch.salt, hash: 'short' }]) {
        assert.equal(epochMatches(bad, 'secret'), false);
      }
    });

    it('a memory-only store never touches the disk', () => {
      const store = createAuthStore({});
      store.state.sessions.push({ id: 'x', remember: true });
      store.persist();
      const before = store.state.userHandle;
      store.reset();
      assert.deepEqual(store.state.sessions, []);
      assert.notEqual(store.state.userHandle, before);
      assert.deepEqual(store.limits, { MAX_SESSIONS: 200, MAX_PASSKEYS: 50 });
    });
  });
});
