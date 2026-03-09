const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  setupWebSocket,
  ACTIVE_THRESHOLD,
  sanitizeForReplay,
} = require('../../src/server/websocket');

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
    scrollbackBuf: opts.scrollbackBuf || (opts.scrollback ? opts.scrollback.join('') : ''),
    hasHadClient: opts.hasHadClient !== undefined ? opts.hasHadClient : false,
    // Default spawn size mirrors sessions.js defaults (120×30)
    _lastCols: opts._lastCols !== undefined ? opts._lastCols : 120,
    _lastRows: opts._lastRows !== undefined ? opts._lastRows : 30,
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
    readyState: 1,
    send(data) {
      sent.push(JSON.parse(data));
    },
    close(code, reason) {
      this._closed = true;
      this._closeCode = code;
      this._closeReason = reason;
    },
    ping() {},
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
      const defaultReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
      this._onConnection(ws, req ? { ...defaultReq, ...req } : defaultReq);
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

  describe('origin validation', () => {
    it('should allow connections with no Origin header', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws, { headers: { host: 'example.com:3000' } });
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const attached = ws._sent.find((m) => m.type === 'attached');
      assert.ok(attached);
      assert.ok(!ws._closed);
    });

    it('should allow connections with matching Origin', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws, {
        headers: { host: 'example.com:3000', origin: 'https://example.com' },
      });
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const attached = ws._sent.find((m) => m.type === 'attached');
      assert.ok(attached);
      assert.ok(!ws._closed);
    });

    it('should reject connections with mismatched Origin', () => {
      const ws = createMockWs();
      wss._simulateConnection(ws, {
        headers: { host: 'example.com:3000', origin: 'https://evil.com' },
      });

      assert.ok(ws._closed);
      assert.strictEqual(ws._closeCode, 1008);
      assert.strictEqual(ws._closeReason, 'Origin not allowed');
    });

    it('should allow connections when origin is localhost', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws, {
        headers: { host: 'example.com:3000', origin: 'http://localhost:3000' },
      });
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const attached = ws._sent.find((m) => m.type === 'attached');
      assert.ok(attached);
      assert.ok(!ws._closed);
    });

    it('should allow connections when host is localhost', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws, {
        headers: { host: 'localhost:3000', origin: 'http://192.168.1.1:3000' },
      });
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const attached = ws._sent.find((m) => m.type === 'attached');
      assert.ok(attached);
      assert.ok(!ws._closed);
    });

    it('should reject connections with invalid Origin URL', () => {
      const ws = createMockWs();
      wss._simulateConnection(ws, {
        headers: { host: 'example.com:3000', origin: 'not-a-valid-url' },
      });

      assert.ok(ws._closed);
      assert.strictEqual(ws._closeCode, 1008);
      assert.strictEqual(ws._closeReason, 'Invalid origin');
    });
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

    it('should authenticate via token in auth message', () => {
      const token = auth.generateToken();
      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'auth', token });

      const ok = ws._sent.find((m) => m.type === 'auth_ok');
      assert.ok(ok);
      assert.ok(!ws._closed);
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

    it('should send scrollback on attach for returning clients', () => {
      const session = createMockSession('s1', {
        scrollback: ['hello ', 'world'],
        hasHadClient: true,
      });
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const output = ws._sent.find((m) => m.type === 'output');
      assert.ok(output);
      assert.strictEqual(output.data, 'hello world');
    });

    it('should defer first-ever client until first resize (size mismatch)', () => {
      // Default spawn size 120×30, client resizes to 40×20 → sizeChanged
      const session = createMockSession('s1', { scrollbackBuf: 'prompt-at-120-cols' });
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      // Client deferred — not yet in session.clients, scrollback NOT pre-cleared
      const output = ws._sent.find((m) => m.type === 'output');
      assert.strictEqual(output, undefined);
      assert.strictEqual(session.hasHadClient, true);
      assert.ok(!session.clients.has(ws));
      assert.strictEqual(ws._pendingResize, true);

      // Simulate more wrong-size output arriving while deferred
      session.scrollbackBuf = 'garbled-120-col-prompt';

      // First resize (40×20 ≠ 120×30): discard scrollback, add client, resize PTY
      ws._simulateMessage({ type: 'resize', cols: 40, rows: 20 });
      assert.ok(session.clients.has(ws));
      assert.strictEqual(ws._pendingResize, false);
      assert.strictEqual(session.scrollbackBuf, '');
      assert.strictEqual(session._resizes.length, 1);
    });

    it('should not clear scrollback or SIGWINCH when PTY was spawned at correct size', () => {
      // PTY spawned at 40×20, client resizes to same 40×20 → no sizeChanged
      const session = createMockSession('s1', {
        scrollbackBuf: 'correct-prompt',
        _lastCols: 40,
        _lastRows: 20,
      });
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      assert.ok(!session.clients.has(ws));
      assert.strictEqual(ws._pendingResize, true);

      // First resize matches spawn size → send scrollback, no SIGWINCH
      ws._simulateMessage({ type: 'resize', cols: 40, rows: 20 });
      assert.ok(session.clients.has(ws));
      assert.strictEqual(ws._pendingResize, false);
      assert.strictEqual(session.scrollbackBuf, 'correct-prompt'); // NOT cleared
      assert.strictEqual(session._resizes.length, 0); // no SIGWINCH

      const output = ws._sent.find((m) => m.type === 'output');
      assert.ok(output);
      assert.strictEqual(output.data, 'correct-prompt');
    });

    it('should add returning client to session on attach', () => {
      const session = createMockSession('s1', { hasHadClient: true });
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      assert.ok(session.clients.has(ws));
    });

    it('should remove client on close', () => {
      const session = createMockSession('s1', { hasHadClient: true });
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });
      assert.ok(session.clients.has(ws));

      ws._simulateClose();
      assert.ok(!session.clients.has(ws));
    });

    it('should send alt screen enter after replay when session is in alt screen', () => {
      const session = createMockSession('s1', { hasHadClient: true, scrollbackBuf: 'some output' });
      session.inAltScreen = true;
      session.altScreenMode = '1049';
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      // Alt-screen enter should come AFTER scrollback replay
      const replayIdx = ws._sent.findIndex((m) => m.type === 'output' && m.data !== '\x1b[?1049h');
      const altIdx = ws._sent.findIndex((m) => m.type === 'output' && m.data === '\x1b[?1049h');
      assert.ok(altIdx > replayIdx, 'alt-screen enter should come after replay');
      assert.strictEqual(ws._needsRedraw, true, 'should flag client for redraw');
    });

    it('should use matching alt-screen mode on reconnect (1047)', () => {
      const session = createMockSession('s1', { hasHadClient: true, scrollbackBuf: 'data' });
      session.inAltScreen = true;
      session.altScreenMode = '1047';
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const altMsg = ws._sent.find((m) => m.type === 'output' && m.data === '\x1b[?1047h');
      assert.ok(altMsg, 'should use mode 1047 for alt-screen enter');
    });

    it('should not send alt screen enter when session is not in alt screen', () => {
      const session = createMockSession('s1', { hasHadClient: true, scrollbackBuf: 'hello' });
      session.inAltScreen = false;
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      const altScreenMsg = ws._sent.find((m) => m.type === 'output' && m.data === '\x1b[?1049h');
      assert.strictEqual(altScreenMsg, undefined, 'should not send alt screen enter');
      assert.strictEqual(ws._needsRedraw, undefined, 'should not flag for redraw');
    });

    it('should force SIGWINCH via temporary resize on first resize after alt-screen reattach', () => {
      const session = createMockSession('s1', { hasHadClient: true, _lastCols: 80, _lastRows: 24 });
      session.inAltScreen = true;
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });
      assert.strictEqual(ws._needsRedraw, true);

      ws._simulateMessage({ type: 'resize', cols: 80, rows: 24 });
      assert.strictEqual(ws._needsRedraw, false, 'redraw flag should be cleared');

      // Should have resized to cols-1 for the intermediate SIGWINCH
      assert.ok(session._resizes.length >= 1, 'should have at least one resize');
      assert.strictEqual(session._resizes[0].cols, 79, 'intermediate resize should be cols-1');
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

    it('should use minimum dimensions across multiple clients', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      wss._simulateConnection(ws1);
      wss._simulateConnection(ws2);
      ws1._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws2._simulateMessage({ type: 'attach', sessionId: 's1' });

      ws1._simulateMessage({ type: 'resize', cols: 120, rows: 40 });
      ws2._simulateMessage({ type: 'resize', cols: 80, rows: 24 });

      const last = session._resizes[session._resizes.length - 1];
      assert.deepStrictEqual(last, { cols: 80, rows: 24 });
    });

    it('should recalculate on client disconnect', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      wss._simulateConnection(ws1);
      wss._simulateConnection(ws2);
      ws1._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws2._simulateMessage({ type: 'attach', sessionId: 's1' });

      ws1._simulateMessage({ type: 'resize', cols: 120, rows: 40 });
      ws2._simulateMessage({ type: 'resize', cols: 80, rows: 24 });

      // Small client disconnects — should recalculate to larger client's size
      ws2._simulateClose();
      const last = session._resizes[session._resizes.length - 1];
      assert.deepStrictEqual(last, { cols: 120, rows: 40 });
    });

    it('should not resize for invalid dimensions', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      ws._simulateMessage({ type: 'resize', cols: 0, rows: 0 });
      ws._simulateMessage({ type: 'resize', cols: -1, rows: 24 });
      ws._simulateMessage({ type: 'resize', cols: 80, rows: -5 });
      ws._simulateMessage({ type: 'resize', cols: 'abc', rows: 24 });

      assert.strictEqual(session._resizes.length, 0);
    });

    it('should reject dimensions exceeding maximum bounds', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      ws._simulateMessage({ type: 'resize', cols: 501, rows: 24 });
      ws._simulateMessage({ type: 'resize', cols: 80, rows: 201 });

      assert.strictEqual(session._resizes.length, 0);
    });

    it('should not send duplicate resize for same dimensions', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws = createMockWs();
      wss._simulateConnection(ws);
      ws._simulateMessage({ type: 'attach', sessionId: 's1' });

      ws._simulateMessage({ type: 'resize', cols: 80, rows: 24 });
      ws._simulateMessage({ type: 'resize', cols: 80, rows: 24 });

      assert.strictEqual(session._resizes.length, 1);
    });

    it('should ignore clients without dimensions in calculation', () => {
      const session = createMockSession('s1');
      sessions._add(session);

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      wss._simulateConnection(ws1);
      wss._simulateConnection(ws2);
      ws1._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws2._simulateMessage({ type: 'attach', sessionId: 's1' });

      // Only ws1 sends resize, ws2 never does
      ws1._simulateMessage({ type: 'resize', cols: 120, rows: 40 });

      assert.strictEqual(session._resizes.length, 1);
      assert.deepStrictEqual(session._resizes[0], { cols: 120, rows: 40 });
    });
  });

  describe('keepalive ping', () => {
    it('should set up a ping interval on connection', () => {
      const originalSetInterval = global.setInterval;
      let intervalCallback = null;
      let intervalDelay = null;

      global.setInterval = function (fn, delay) {
        intervalCallback = fn;
        intervalDelay = delay;
        return originalSetInterval(fn, delay);
      };

      try {
        const ws = createMockWs();
        let pingCalled = false;
        ws.ping = () => {
          pingCalled = true;
        };
        wss._simulateConnection(ws);

        assert.ok(intervalCallback, 'setInterval should be called on connection');
        assert.strictEqual(intervalDelay, 30000, 'ping interval should be 30 seconds');
        assert.strictEqual(pingCalled, false, 'ping should not fire immediately');

        // Manually invoke the interval callback to verify it calls ws.ping()
        intervalCallback();
        assert.strictEqual(pingCalled, true, 'interval callback should call ws.ping()');

        // Clean up
        ws._simulateClose();
      } finally {
        global.setInterval = originalSetInterval;
      }
    });

    it('should clear ping interval on ws close', () => {
      const originalSetInterval = global.setInterval;
      const originalClearInterval = global.clearInterval;
      let pingIntervalId = null;
      let clearedIntervalId = null;

      global.setInterval = function (fn, delay, ...args) {
        const id = originalSetInterval(fn, delay, ...args);
        pingIntervalId = id;
        return id;
      };

      global.clearInterval = function (id) {
        clearedIntervalId = id;
        return originalClearInterval(id);
      };

      try {
        const ws = createMockWs();
        wss._simulateConnection(ws);

        assert.ok(pingIntervalId !== null, 'ping interval should be set on connection');

        ws._simulateClose();
        assert.strictEqual(
          clearedIntervalId,
          pingIntervalId,
          'ping interval should be cleared on ws close',
        );
      } finally {
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
      }
    });
  });

  describe('activity-aware resize', () => {
    it('should prefer active client dimensions over idle clients', () => {
      const session = createMockSession('s1', { hasHadClient: true });
      sessions._add(session);

      const phoneWs = createMockWs();
      const laptopWs = createMockWs();
      wss._simulateConnection(phoneWs);
      wss._simulateConnection(laptopWs);
      phoneWs._simulateMessage({ type: 'attach', sessionId: 's1' });
      laptopWs._simulateMessage({ type: 'attach', sessionId: 's1' });

      // Phone sets small size
      phoneWs._simulateMessage({ type: 'resize', cols: 40, rows: 20 });
      assert.deepStrictEqual(session._resizes[session._resizes.length - 1], { cols: 40, rows: 20 });

      // Make phone idle by backdating its activity
      phoneWs._lastActivity = Date.now() - ACTIVE_THRESHOLD - 1000;

      // Laptop sends resize — should use laptop's size since phone is idle
      laptopWs._simulateMessage({ type: 'resize', cols: 120, rows: 40 });
      const last = session._resizes[session._resizes.length - 1];
      assert.deepStrictEqual(last, { cols: 120, rows: 40 });
    });

    it('should use minimum of active clients when multiple are active', () => {
      const session = createMockSession('s1', { hasHadClient: true });
      sessions._add(session);

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      wss._simulateConnection(ws1);
      wss._simulateConnection(ws2);
      ws1._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws2._simulateMessage({ type: 'attach', sessionId: 's1' });

      // Both send resize recently — both are active
      ws1._simulateMessage({ type: 'resize', cols: 120, rows: 40 });
      ws2._simulateMessage({ type: 'resize', cols: 80, rows: 24 });

      const last = session._resizes[session._resizes.length - 1];
      assert.deepStrictEqual(last, { cols: 80, rows: 24 });
    });

    it('should use new active client size when all existing clients are idle', () => {
      const session = createMockSession('s1', { hasHadClient: true });
      sessions._add(session);

      const ws1 = createMockWs();
      const ws2 = createMockWs();
      wss._simulateConnection(ws1);
      wss._simulateConnection(ws2);
      ws1._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws2._simulateMessage({ type: 'attach', sessionId: 's1' });

      ws1._simulateMessage({ type: 'resize', cols: 120, rows: 40 });
      ws2._simulateMessage({ type: 'resize', cols: 80, rows: 24 });

      // Make both idle
      ws1._lastActivity = Date.now() - ACTIVE_THRESHOLD - 1000;
      ws2._lastActivity = Date.now() - ACTIVE_THRESHOLD - 1000;

      // Trigger recalc via disconnect/reconnect of a third client
      const ws3 = createMockWs();
      wss._simulateConnection(ws3);
      ws3._simulateMessage({ type: 'attach', sessionId: 's1' });
      ws3._simulateMessage({ type: 'resize', cols: 60, rows: 15 });

      // ws3 is active, so its size is used (not min of all)
      const last = session._resizes[session._resizes.length - 1];
      assert.deepStrictEqual(last, { cols: 60, rows: 15 });
    });

    it('should track activity on input messages', () => {
      const session = createMockSession('s1', { hasHadClient: true });
      sessions._add(session);

      const phoneWs = createMockWs();
      const laptopWs = createMockWs();
      wss._simulateConnection(phoneWs);
      wss._simulateConnection(laptopWs);
      phoneWs._simulateMessage({ type: 'attach', sessionId: 's1' });
      laptopWs._simulateMessage({ type: 'attach', sessionId: 's1' });

      phoneWs._simulateMessage({ type: 'resize', cols: 40, rows: 20 });
      laptopWs._simulateMessage({ type: 'resize', cols: 120, rows: 40 });

      // Phone is idle but then sends input — becomes active again
      phoneWs._lastActivity = Date.now() - ACTIVE_THRESHOLD - 1000;
      phoneWs._simulateMessage({ type: 'input', data: 'ls\n' });

      // Now both are active, trigger recalc
      laptopWs._simulateMessage({ type: 'resize', cols: 120, rows: 40 });

      // Phone is active again, so min(40, 120) = 40
      const last = session._resizes[session._resizes.length - 1];
      assert.deepStrictEqual(last, { cols: 40, rows: 20 });
    });
  });

  describe('unparseable messages', () => {
    it('should drop unparseable messages without closing', () => {
      const ws = createMockWs();
      wss._simulateConnection(ws);

      // Send raw invalid JSON directly to the message handler
      ws._onMessage(Buffer.from('not-json{{{'));

      assert.ok(!ws._closed, 'connection should remain open');
      assert.strictEqual(ws._sent.length, 0, 'no messages should be sent');
    });
  });

  describe('sanitizeForReplay', () => {
    it('should strip OSC 11 background color responses', () => {
      const buf = 'hello\x1b]11;rgb:2828/2a2a/3636\x07world';
      assert.strictEqual(sanitizeForReplay(buf), 'helloworld');
    });

    it('should strip OSC 10 foreground color responses', () => {
      const buf = 'hello\x1b]10;rgb:f8f8/f8f8/f2f2\x07world';
      assert.strictEqual(sanitizeForReplay(buf), 'helloworld');
    });

    it('should strip OSC 4 palette color responses', () => {
      const buf = 'hello\x1b]4;0;rgb:2121/2222/2c2c\x07world';
      assert.strictEqual(sanitizeForReplay(buf), 'helloworld');
    });

    it('should strip OSC 12 cursor color responses', () => {
      const buf = 'hello\x1b]12;rgb:ffff/ffff/ffff\x07world';
      assert.strictEqual(sanitizeForReplay(buf), 'helloworld');
    });

    it('should strip OSC color queries', () => {
      const buf = 'hello\x1b]11;?\x07world';
      assert.strictEqual(sanitizeForReplay(buf), 'helloworld');
    });

    it('should strip sequences terminated with ST (ESC backslash)', () => {
      const buf = 'hello\x1b]11;rgb:2828/2a2a/3636\x1b\\world';
      assert.strictEqual(sanitizeForReplay(buf), 'helloworld');
    });

    it('should strip multiple consecutive OSC color sequences', () => {
      const buf =
        '\x1b]11;rgb:2828/2a2a/3636\x07' +
        '\x1b]10;rgb:f8f8/f8f8/f2f2\x07' +
        '\x1b]4;0;rgb:2121/2222/2c2c\x07' +
        '\x1b]4;1;rgb:ffff/5555/5555\x07';
      assert.strictEqual(sanitizeForReplay(buf), '');
    });

    it('should preserve non-color OSC sequences (title, hyperlinks)', () => {
      const buf = 'hello\x1b]0;my title\x07\x1b]8;;https://example.com\x07link\x1b]8;;\x07world';
      assert.strictEqual(sanitizeForReplay(buf), buf);
    });

    it('should preserve normal terminal output', () => {
      const buf = 'hello\x1b[32mgreen\x1b[0m world\r\n$ ';
      assert.strictEqual(sanitizeForReplay(buf), buf);
    });

    it('should strip matched alternate screen buffer pairs (1049)', () => {
      const buf = 'before\x1b[?1049h\x1b[2Jalt screen content\x1b[?1049lafter';
      assert.strictEqual(sanitizeForReplay(buf), 'beforeafter');
    });

    it('should strip matched alternate screen buffer pairs (1047)', () => {
      const buf = 'before\x1b[?1047halt content\x1b[?1047lafter';
      assert.strictEqual(sanitizeForReplay(buf), 'beforeafter');
    });

    it('should strip matched alternate screen buffer pairs (47)', () => {
      const buf = 'before\x1b[?47halt content\x1b[?47lafter';
      assert.strictEqual(sanitizeForReplay(buf), 'beforeafter');
    });

    it('should strip multiple alt screen enter/exit pairs', () => {
      const buf =
        'start\x1b[?1049hvim session\x1b[?1049l' +
        'middle\x1b[?1049hhtop session\x1b[?1049l' +
        'end';
      assert.strictEqual(sanitizeForReplay(buf), 'startmiddleend');
    });

    it('should strip unmatched alt screen enter (active alt screen)', () => {
      const buf = 'before\x1b[?1049hcopilot CLI banner';
      assert.strictEqual(sanitizeForReplay(buf), 'beforecopilot CLI banner');
    });

    it('should strip unmatched alt screen exit', () => {
      const buf = '\x1b[?1049lrestored content';
      assert.strictEqual(sanitizeForReplay(buf), 'restored content');
    });

    it('should strip ESC[3J clear scrollback sequences', () => {
      const buf = 'hello\x1b[3Jworld';
      assert.strictEqual(sanitizeForReplay(buf), 'helloworld');
    });

    it('should strip combined alt screen and clear scrollback', () => {
      const buf = 'before\x1b[?1049h\x1b[2J\x1b[3Jcli output\x1b[?1049l\x1b[3Jafter';
      assert.strictEqual(sanitizeForReplay(buf), 'beforeafter');
    });

    it('should preserve ESC[2J clear screen (needed for replay accuracy)', () => {
      const buf = 'hello\x1b[2Jworld';
      assert.strictEqual(sanitizeForReplay(buf), buf);
    });
  });
});
