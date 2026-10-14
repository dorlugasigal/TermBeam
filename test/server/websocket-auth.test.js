'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createAuth,
  COOKIE_NAME,
  REMEMBER_IDLE_MS,
  SESSION_ONLY_IDLE_MS,
} = require('../../src/server/auth');
const { setupWebSocket, broadcast, WS_CLOSE_UNAUTHORIZED } = require('../../src/server/websocket');

const realDateNow = Date.now;

function createMockSession(id) {
  const written = [];
  return {
    id,
    name: 'test',
    clients: new Set(),
    scrollbackBuf: '',
    hasHadClient: true,
    _lastCols: 120,
    _lastRows: 30,
    pty: {
      write(data) {
        written.push(data);
      },
      resize() {},
    },
    pendingNotifications: [],
    _written: written,
  };
}

function createMockSessions() {
  const map = new Map();
  return {
    get: (id) => map.get(id),
    _add: (s) => map.set(s.id, s),
  };
}

function createMockWs() {
  const sent = [];
  const closeCbs = [];
  return {
    readyState: 1,
    send(data) {
      sent.push(JSON.parse(data));
    },
    close(code, reason) {
      this._closed = true;
      this._closeCode = code;
      this._closeReason = reason;
      this._closeCalls = (this._closeCalls || 0) + 1;
    },
    ping() {},
    terminate() {},
    on(event, cb) {
      if (event === 'message') this._onMessage = cb;
      if (event === 'close') closeCbs.push(cb);
    },
    _sent: sent,
    _closed: false,
    _simulateMessage(obj) {
      return this._onMessage(Buffer.from(JSON.stringify(obj)));
    },
    _simulateClose() {
      closeCbs.forEach((cb) => cb());
    },
  };
}

function createMockWss() {
  return {
    clients: new Set(),
    on(event, cb) {
      if (event === 'connection') this._onConnection = cb;
    },
    connect(ws, { cookie, remoteAddress = '127.0.0.1' } = {}) {
      this.clients.add(ws);
      const headers = cookie ? { cookie } : {};
      this._onConnection(ws, { headers, socket: { remoteAddress } });
      return ws;
    },
  };
}

const errors = (ws) => ws._sent.filter((m) => m.type === 'error');

describe('WebSocket authentication with real auth sessions', () => {
  let auth;
  let wss;
  let sessions;
  let term;

  beforeEach(() => {
    auth = createAuth('pw');
    wss = createMockWss();
    sessions = createMockSessions();
    term = createMockSession('term-1');
    sessions._add(term);
    setupWebSocket(wss, { auth, sessions });
  });

  afterEach(() => {
    Date.now = realDateNow;
    for (const ws of wss.clients) ws._simulateClose();
    auth.cleanup();
  });

  function connectWithCookie(token) {
    return wss.connect(createMockWs(), { cookie: `theme=dark; ${COOKIE_NAME}=${token}` });
  }

  describe('cookie-authenticated sockets', () => {
    it('authenticates from the upgrade cookie', async () => {
      const { token } = auth.createSession({});
      const ws = connectWithCookie(token);
      assert.equal(ws._tbAuthenticated, true);
      await ws._simulateMessage({ type: 'attach', sessionId: 'term-1' });
      assert.ok(ws._sent.find((m) => m.type === 'attached'));
      assert.equal(ws._closed, false);
    });

    it('closes with 4401 and an "unauthorized" error when the session is revoked', async () => {
      const { token, session } = auth.createSession({});
      const ws = connectWithCookie(token);
      await ws._simulateMessage({ type: 'attach', sessionId: 'term-1' });

      assert.equal(auth.revokeSession(session.id), true);
      assert.equal(ws._closed, true);
      assert.equal(ws._closeCode, WS_CLOSE_UNAUTHORIZED);
      assert.equal(WS_CLOSE_UNAUTHORIZED, 4401);
      assert.deepEqual(errors(ws), [
        { type: 'error', code: 'unauthorized', message: 'Signed out' },
      ]);
      assert.equal(ws._tbAuthenticated, false);
    });

    it('stops honouring messages from a revoked socket that keeps talking', async () => {
      // `ws` keeps emitting 'message' while CLOSING (until the 30 s close
      // timeout), so a client that ignores the close frame must not be able
      // to keep typing into the terminal.
      const { token, session } = auth.createSession({});
      const ws = connectWithCookie(token);
      await ws._simulateMessage({ type: 'attach', sessionId: 'term-1' });
      await ws._simulateMessage({ type: 'input', data: 'echo before\r' });
      auth.revokeSession(session.id);

      await ws._simulateMessage({ type: 'input', data: 'rm -rf ~\r' });
      await ws._simulateMessage({ type: 'ping', t: 1 });
      assert.deepEqual(term._written, ['echo before\r']);
      assert.equal(
        ws._sent.some((m) => m.type === 'pong'),
        false,
      );
    });

    it('signs out every socket of the revoked session, and only those', async () => {
      const a = auth.createSession({});
      const b = auth.createSession({});
      const a1 = connectWithCookie(a.token);
      const a2 = connectWithCookie(a.token);
      const b1 = connectWithCookie(b.token);

      auth.revokeOtherSessions(b.session.id);
      assert.equal(a1._closeCode, 4401);
      assert.equal(a2._closeCode, 4401);
      assert.equal(b1._closed, false);
      await b1._simulateMessage({ type: 'ping', t: 7 });
      assert.deepEqual(b1._sent.at(-1), { type: 'pong', t: 7 });
    });

    it('signs out sockets when the passkey they unlocked with is removed', () => {
      auth.addPasskey({ id: 'pk', publicKey: {}, alg: -7, rpId: 'localhost', name: 'Phone' });
      const { token } = auth.createSession({ method: 'passkey', passkeyId: 'pk' });
      const ws = connectWithCookie(token);
      auth.removePasskey('pk');
      assert.equal(ws._closeCode, 4401);
    });

    it('a closed socket is forgotten (revocation later does not touch it)', () => {
      const { token, session } = auth.createSession({});
      const ws = connectWithCookie(token);
      ws._simulateClose();
      auth.revokeSession(session.id);
      assert.equal(ws._closed, false);
      assert.deepEqual(errors(ws), []);
    });

    it('treats an unknown or expired cookie as unauthenticated', async () => {
      const ws = connectWithCookie('f'.repeat(64));
      assert.equal(ws._tbAuthenticated, false);
      await ws._simulateMessage({ type: 'attach', sessionId: 'term-1' });
      assert.equal(ws._closeCode, 4401);
      assert.equal(
        ws._sent.some((m) => m.type === 'attached'),
        false,
      );
    });
  });

  describe('unauthenticated sockets', () => {
    it('closes with 4401 on the first non-auth message', async () => {
      const ws = wss.connect(createMockWs());
      assert.equal(ws._tbAuthenticated, false);
      await ws._simulateMessage({ type: 'attach', sessionId: 'term-1' });
      assert.equal(ws._closed, true);
      assert.equal(ws._closeCode, 4401);
      assert.deepEqual(errors(ws), [
        { type: 'error', code: 'unauthorized', message: 'Unauthorized' },
      ]);
      assert.equal(term.clients.size, 0);
    });

    it('rejects pings before authentication', async () => {
      const ws = wss.connect(createMockWs());
      await ws._simulateMessage({ type: 'ping', t: 1 });
      assert.equal(ws._closeCode, 4401);
      assert.equal(
        ws._sent.some((m) => m.type === 'pong'),
        false,
      );
    });

    it('can authenticate with a session token and is then tracked for revocation', async () => {
      const { token, session } = auth.createSession({});
      const ws = wss.connect(createMockWs());
      await ws._simulateMessage({ type: 'auth', token });
      assert.deepEqual(ws._sent.at(-1), { type: 'auth_ok' });
      assert.equal(ws._tbAuthenticated, true);
      auth.revokeSession(session.id);
      assert.equal(ws._closeCode, 4401);
    });

    it('can authenticate with the password (not bound to any session)', async () => {
      const { session } = auth.createSession({});
      const ws = wss.connect(createMockWs());
      await ws._simulateMessage({ type: 'auth', password: 'pw' });
      assert.deepEqual(ws._sent.at(-1), { type: 'auth_ok' });
      auth.revokeSession(session.id);
      assert.equal(ws._closed, false);
      await ws._simulateMessage({ type: 'attach', sessionId: 'term-1' });
      assert.ok(ws._sent.find((m) => m.type === 'attached'));
    });

    it('rejects a wrong password with 4401 and rate-limits repeated attempts', async () => {
      const ip = '10.9.8.7';
      for (let i = 0; i < 5; i++) {
        const ws = wss.connect(createMockWs(), { remoteAddress: ip });
        await ws._simulateMessage({ type: 'auth', password: 'nope' });
        assert.equal(ws._closeCode, 4401);
        assert.equal(errors(ws)[0].code, 'unauthorized');
      }
      const limited = wss.connect(createMockWs(), { remoteAddress: ip });
      await limited._simulateMessage({ type: 'auth', password: 'pw' });
      assert.equal(limited._closed, true);
      assert.match(errors(limited)[0].message, /Too many attempts/);
      assert.equal(
        limited._sent.some((m) => m.type === 'auth_ok'),
        false,
      );
    });
  });

  describe('periodic session re-check', () => {
    it('closes the socket once its session has expired', async () => {
      const { token } = auth.createSession({});
      const ws = connectWithCookie(token);
      await ws._simulateMessage({ type: 'attach', sessionId: 'term-1' });

      const start = realDateNow();
      Date.now = () => start + REMEMBER_IDLE_MS + 60_000;
      await ws._simulateMessage({ type: 'ping', t: 1 });
      assert.equal(ws._closed, true);
      assert.equal(ws._closeCode, 4401);
      assert.ok(errors(ws).length >= 1);
      assert.ok(errors(ws).every((e) => e.code === 'unauthorized'));
      assert.equal(
        ws._sent.some((m) => m.type === 'pong'),
        false,
      );

      await ws._simulateMessage({ type: 'input', data: 'ls\r' });
      assert.deepEqual(term._written, []);
    });

    it('expires short-lived (remember:false) sessions after their 2h idle window', async () => {
      const { token } = auth.createSession({ remember: false });
      const ws = connectWithCookie(token);
      const start = realDateNow();
      Date.now = () => start + SESSION_ONLY_IDLE_MS + 1000;
      await ws._simulateMessage({ type: 'ping' });
      assert.equal(ws._closeCode, 4401);
    });

    it('re-checks at most every 30 s and slides the idle timer while in use', async () => {
      const { token, session } = auth.createSession({});
      const ws = connectWithCookie(token);
      let lookups = 0;
      const getSession = auth.getSession;
      auth.getSession = (t) => {
        lookups++;
        return getSession(t);
      };

      const start = realDateNow();
      Date.now = () => start + 10_000;
      await ws._simulateMessage({ type: 'ping', t: 1 });
      assert.equal(lookups, 0, 'no re-check within 30 s');

      Date.now = () => start + 31_000;
      await ws._simulateMessage({ type: 'ping', t: 2 });
      assert.equal(lookups, 1);
      assert.equal(session.lastSeenAt, start + 31_000, 'idle timer slid');
      assert.deepEqual(ws._sent.at(-1), { type: 'pong', t: 2 });
      assert.equal(ws._closed, false);
    });
  });

  describe('application ping', () => {
    it('echoes numeric timestamps and nulls anything else', async () => {
      const { token } = auth.createSession({});
      const ws = connectWithCookie(token);
      await ws._simulateMessage({ type: 'ping', t: 1234.5 });
      await ws._simulateMessage({ type: 'ping', t: 'abc' });
      await ws._simulateMessage({ type: 'ping' });
      assert.deepEqual(
        ws._sent.filter((m) => m.type === 'pong'),
        [
          { type: 'pong', t: 1234.5 },
          { type: 'pong', t: null },
          { type: 'pong', t: null },
        ],
      );
    });
  });

  describe('broadcast()', () => {
    it('only reaches authenticated sockets', async () => {
      const { token } = auth.createSession({});
      const signedIn = connectWithCookie(token);
      const anonymous = wss.connect(createMockWs());
      broadcast(wss, { type: 'tunnel-status', state: 'connected' });
      assert.deepEqual(signedIn._sent.at(-1), { type: 'tunnel-status', state: 'connected' });
      assert.equal(anonymous._sent.length, 0);

      await anonymous._simulateMessage({ type: 'auth', password: 'pw' });
      broadcast(wss, { type: 'tunnel-status', state: 'reconnecting' });
      assert.deepEqual(anonymous._sent.at(-1), { type: 'tunnel-status', state: 'reconnecting' });
    });
  });
});

describe('broadcast() (unit)', () => {
  function client(readyState, authenticated, send) {
    const got = [];
    return {
      readyState,
      _tbAuthenticated: authenticated,
      send: send || ((m) => got.push(m)),
      got,
    };
  }

  it('sends only to open (readyState 1) and authenticated clients', () => {
    const open = client(1, true);
    const anonymous = client(1, false);
    const closing = client(2, true);
    const closed = client(3, true);
    const thrower = client(1, true, () => {
      throw new Error('socket went away');
    });
    const after = client(1, true);
    const wss = { clients: new Set([open, anonymous, closing, closed, thrower, after]) };

    broadcast(wss, { type: 'tunnel-status', state: 'failed' });
    assert.deepEqual(open.got, [JSON.stringify({ type: 'tunnel-status', state: 'failed' })]);
    assert.deepEqual(anonymous.got, []);
    assert.deepEqual(closing.got, []);
    assert.deepEqual(closed.got, []);
    assert.equal(after.got.length, 1, 'a throwing client does not abort the broadcast');
  });

  it('passes pre-serialised strings through unchanged', () => {
    const c = client(1, true);
    broadcast({ clients: new Set([c]) }, '{"type":"raw"}');
    assert.deepEqual(c.got, ['{"type":"raw"}']);
  });

  it('tolerates a missing server or client list', () => {
    assert.doesNotThrow(() => broadcast(null, { type: 'x' }));
    assert.doesNotThrow(() => broadcast({}, { type: 'x' }));
  });
});

describe('WebSocket without a password', () => {
  it('marks sockets authenticated so broadcasts reach them', () => {
    const auth = createAuth(null);
    try {
      const wss = createMockWss();
      setupWebSocket(wss, { auth, sessions: createMockSessions() });
      const ws = wss.connect(createMockWs());
      assert.equal(ws._tbAuthenticated, true);
      broadcast(wss, { type: 'hello' });
      assert.deepEqual(ws._sent, [{ type: 'hello' }]);
      ws._simulateClose();
    } finally {
      auth.cleanup();
    }
  });
});
