const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { setupWebSocket } = require('../src/websocket');

function createMockAuth(password = null) {
  const tokens = new Set();
  return {
    password,
    generateToken() {
      const t = 'tok_' + Math.random().toString(36).slice(2);
      tokens.add(t);
      return t;
    },
    validateToken(t) {
      return tokens.has(t);
    },
    parseCookies(str) {
      const cookies = {};
      if (!str) return cookies;
      str.split(';').forEach((pair) => {
        const [k, ...v] = pair.trim().split('=');
        if (k) cookies[k.trim()] = v.join('=');
      });
      return cookies;
    },
  };
}

function createMockSession(id, opts = {}) {
  const written = [];
  const resizes = [];
  return {
    id,
    name: opts.name || 'test',
    clients: new Set(),
    scrollback: opts.scrollback || [],
    pty: {
      write(data) {
        written.push(data);
      },
      resize(cols, rows) {
        resizes.push({ cols, rows });
      },
    },
    _written: written,
    _resizes: resizes,
  };
}

function createMockSessions() {
  const map = new Map();
  return {
    get(id) {
      return map.get(id);
    },
    _add(session) {
      map.set(session.id, session);
    },
  };
}

function createMockWs() {
  const sent = [];
  const closeCbs = [];
  return {
    send(data) {
      sent.push(JSON.parse(data));
    },
    close() {
      this._closed = true;
    },
    on(event, cb) {
      if (event === 'message') this._onMessage = cb;
      if (event === 'close') closeCbs.push(cb);
    },
    _sent: sent,
    _closed: false,
    _closeCbs: closeCbs,
    _simulateMessage(obj) {
      this._onMessage(Buffer.from(JSON.stringify(obj)));
    },
    _simulateClose() {
      this._closeCbs.forEach((cb) => cb());
    },
  };
}

function createMockWss() {
  return {
    on(event, cb) {
      if (event === 'connection') this._onConnection = cb;
    },
    _simulateConnection(ws, req) {
      this._onConnection(ws, req || { headers: {} });
    },
  };
}

describe('WebSocket', () => {
  let wss, auth, sessions;

  beforeEach(() => {
    wss = createMockWss();
    auth = createMockAuth();
    sessions = createMockSessions();
    setupWebSocket(wss, { auth, sessions });
  });

  describe('no password', () => {
    it('should allow messages without auth when no password set', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const attached = ws._sent.find((m) => m.type === 'attached');
      assert.ok(attached);
      assert.strictEqual(attached.sessionId, 's1');
    });
  });

  describe('with password', () => {
    beforeEach(() => {
      auth = createMockAuth('secret');
      wss = createMockWss();
      sessions = createMockSessions();
      setupWebSocket(wss, { auth, sessions });
    });

    it('should reject unauthenticated messages', () => {
      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const err = ws._sent.find((m) => m.type === 'error');
      assert.ok(err);
      assert.strictEqual(err.message, 'Unauthorized');
      assert.ok(ws._closed);
    });

    it('should accept correct password', () => {
      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'auth', password: 'secret' });

      const ok = ws._sent.find((m) => m.type === 'auth_ok');
      assert.ok(ok);
      assert.ok(!ws._closed);
    });

    it('should reject wrong password', () => {
      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'auth', password: 'wrong' });

      const err = ws._sent.find((m) => m.type === 'error');
      assert.ok(err);
      assert.ok(ws._closed);
    });

    it('should authenticate via cookie', () => {
      const token = auth.generateToken();
      const ws = createMockWs();
      wss._simulateConnection(ws, { headers: { cookie: `pty_token=${token}` } });

      const session = createMockSession('s1');
      sessions._add(session);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const attached = ws._sent.find((m) => m.type === 'attached');
      assert.ok(attached);
    });
  });

  describe('attach', () => {
    it('should error on unknown session', () => {
      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 'nonexistent' });

      const err = ws._sent.find((m) => m.type === 'error');
      assert.ok(err);
      assert.strictEqual(err.message, 'Session not found');
    });

    it('should send scrollback on attach', () => {
      const session = createMockSession('s1', { scrollback: ['hello ', 'world'] });
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const output = ws._sent.find((m) => m.type === 'output');
      assert.ok(output);
      assert.strictEqual(output.data, 'hello world');
    });

    it('should add client to session on attach', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      assert.ok(session.clients.has(ws));
    });

    it('should remove client on close', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });
      assert.ok(session.clients.has(ws));

      ws._simulateClose();
      assert.ok(!session.clients.has(ws));
    });
  });

  describe('input (paste flow)', () => {
    it('should write data to pty', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws._simulateMessage({ type: 'input', data: 'ls -la\n' });

      assert.strictEqual(session._written.length, 1);
      assert.strictEqual(session._written[0], 'ls -la\n');
    });

    it('should handle pasted multi-line text', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws._simulateMessage({ type: 'input', data: 'line1\nline2\nline3\n' });

      assert.strictEqual(session._written.length, 1);
      assert.strictEqual(session._written[0], 'line1\nline2\nline3\n');
    });

    it('should handle input with undefined data gracefully', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });
      // Simulates the bug: key-bar sending input without data
      ws._simulateMessage({ type: 'input' });

      // pty.write is called with undefined — this is the current behavior
      // The important thing is the server doesn't crash
      assert.strictEqual(session._written.length, 1);
    });

    it('should ignore input when not attached', () => {
      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'input', data: 'hello' });

      // No crash, no error sent — silently ignored
      assert.strictEqual(ws._sent.length, 0);
    });
  });

  describe('resize', () => {
    it('should resize pty', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws._simulateMessage({ type: 'resize', cols: 120, rows: 40 });

      assert.strictEqual(session._resizes.length, 1);
      assert.deepStrictEqual(session._resizes[0], { cols: 120, rows: 40 });
    });
  });
});
