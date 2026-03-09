const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');

// ── Mock WebSocket ───────────────────────────────────────────────────────────

class MockWS extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.readyState = 1; // OPEN
    this.closed = false;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

// ── I/O mock helpers ─────────────────────────────────────────────────────────

function setupIOMocks(opts = {}) {
  const state = { writes: [], rawMode: false, resumed: false, paused: false };
  const orig = {
    write: process.stdout.write,
    columns: process.stdout.columns,
    rows: process.stdout.rows,
    isTTY: process.stdin.isTTY,
    isRaw: process.stdin.isRaw,
    setRawMode: process.stdin.setRawMode,
    resume: process.stdin.resume,
    pause: process.stdin.pause,
    stdinDataCount: process.stdin.listenerCount('data'),
    sigwinchCount: process.listenerCount('SIGWINCH'),
  };

  process.stdout.write = (d) => {
    state.writes.push(d);
    return true;
  };
  process.stdout.columns = 'columns' in opts ? opts.columns : 80;
  process.stdout.rows = 'rows' in opts ? opts.rows : 24;
  process.stdin.isTTY = 'isTTY' in opts ? opts.isTTY : true;
  process.stdin.isRaw = false;
  process.stdin.setRawMode = (m) => {
    state.rawMode = m;
    process.stdin.isRaw = m;
    return process.stdin;
  };
  process.stdin.resume = () => {
    state.resumed = true;
    return process.stdin;
  };
  process.stdin.pause = () => {
    state.paused = true;
    return process.stdin;
  };

  state.restore = () => {
    process.stdout.write = orig.write;
    process.stdout.columns = orig.columns;
    process.stdout.rows = orig.rows;
    process.stdin.isTTY = orig.isTTY;
    process.stdin.isRaw = orig.isRaw;
    if (orig.setRawMode) process.stdin.setRawMode = orig.setRawMode;
    process.stdin.resume = orig.resume;
    process.stdin.pause = orig.pause;
    while (process.stdin.listenerCount('data') > orig.stdinDataCount) {
      const l = process.stdin.listeners('data');
      process.stdin.removeListener('data', l[l.length - 1]);
    }
    while (process.listenerCount('SIGWINCH') > orig.sigwinchCount) {
      const l = process.listeners('SIGWINCH');
      process.removeListener('SIGWINCH', l[l.length - 1]);
    }
  };

  return state;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Inject mock ws module into require cache before loading client
const realWsPath = require.resolve('ws');
const savedWsCache = require.cache[realWsPath];

describe('client', () => {
  let createTerminalClient;
  let FakeWSClass;
  let lastWsInstance;

  beforeEach(() => {
    // Create a fake WebSocket class that mimics ws behavior
    FakeWSClass = class extends MockWS {
      constructor() {
        super();
        lastWsInstance = this;
        // Simulate async open
        process.nextTick(() => this.emit('open'));
      }
    };
    FakeWSClass.OPEN = 1;
    FakeWSClass.CONNECTING = 0;

    // Override ws in require cache
    require.cache[realWsPath] = {
      id: realWsPath,
      filename: realWsPath,
      loaded: true,
      exports: FakeWSClass,
    };

    // Clear client from cache so it picks up the mock
    const clientPath = require.resolve('../../src/cli/client');
    delete require.cache[clientPath];
    ({ createTerminalClient } = require('../../src/cli/client'));
  });

  afterEach(() => {
    // Restore ws
    if (savedWsCache) {
      require.cache[realWsPath] = savedWsCache;
    } else {
      delete require.cache[realWsPath];
    }
    const clientPath = require.resolve('../../src/cli/client');
    delete require.cache[clientPath];
  });

  it('should send auth then attach when password is provided', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: 'secret',
      sessionId: 'abc123',
    });

    // Wait for open handler to fire
    await new Promise((r) => setTimeout(r, 20));

    // Should have sent auth message
    assert.deepStrictEqual(lastWsInstance.sent[0], { type: 'auth', password: 'secret' });

    // Simulate auth_ok
    lastWsInstance.emit('message', JSON.stringify({ type: 'auth_ok' }));
    await new Promise((r) => setTimeout(r, 10));

    // Should have sent attach
    assert.deepStrictEqual(lastWsInstance.sent[1], { type: 'attach', sessionId: 'abc123' });

    // Close to resolve the promise
    lastWsInstance.emit('close');
    const result = await promise;
    assert.equal(result.reason, 'connection closed');
  });

  it('should attach directly when no password', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(lastWsInstance.sent[0], { type: 'attach', sessionId: 'abc123' });

    lastWsInstance.emit('close');
    await promise;
  });

  it('should resolve with exit reason when session exits', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));

    lastWsInstance.emit('message', JSON.stringify({ type: 'exit', code: 0 }));
    const result = await promise;
    assert.equal(result.reason, 'session exited with code 0');
  });

  it('should resolve with error reason on server error', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));

    lastWsInstance.emit('message', JSON.stringify({ type: 'error', message: 'Session not found' }));
    const result = await promise;
    assert.equal(result.reason, 'error: Session not found');
  });

  it('should reject on connection error', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));

    lastWsInstance.emit('error', new Error('ECONNREFUSED'));
    await assert.rejects(promise, { message: 'ECONNREFUSED' });
  });

  it('should handle unparseable messages gracefully', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));

    // Send invalid JSON — should not throw
    lastWsInstance.emit('message', 'not json{{{');
    await new Promise((r) => setTimeout(r, 10));

    lastWsInstance.emit('close');
    await promise;
  });

  // ── attached handler ────────────────────────────────────────────────────────

  it('should set terminal title, enter raw mode, and send resize on attached', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
        sessionName: 'myterm',
        detachLabel: 'Ctrl+B',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(20);

      // Terminal title escape sequence written
      assert.ok(
        io.writes.some((w) => w.includes('[termbeam] myterm') && w.includes('Ctrl+B to detach')),
      );
      // Raw mode enabled and stdin resumed
      assert.strictEqual(io.rawMode, true);
      assert.strictEqual(io.resumed, true);
      // Resize message sent with stdout dimensions
      const resize = lastWsInstance.sent.find((m) => m.type === 'resize');
      assert.ok(resize);
      assert.equal(resize.cols, 80);
      assert.equal(resize.rows, 24);

      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  // ── showBanner / debounceBanner ─────────────────────────────────────────────

  it('should show banner after 500ms debounce on attached', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
        sessionName: 'myterm',
        detachLabel: 'Ctrl+B',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));

      // Banner should NOT appear before the 500ms debounce
      await wait(100);
      assert.ok(!io.writes.some((w) => w.includes('attached: myterm')));

      // After the debounce timer fires, banner appears
      await wait(500);
      assert.ok(
        io.writes.some((w) => w.includes('attached: myterm') && w.includes('Ctrl+B to detach')),
      );

      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  it('should show banner only once even after multiple debounceBanner triggers', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
        sessionName: 'myterm',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(600); // banner fires

      const bannerCount = io.writes.filter((w) => w.includes('attached: myterm')).length;
      assert.equal(bannerCount, 1);

      // Trigger debounceBanner again via output — bannerShown=true so early return
      lastWsInstance.emit('message', JSON.stringify({ type: 'output', data: 'x' }));
      await wait(600);

      assert.equal(io.writes.filter((w) => w.includes('attached: myterm')).length, 1);

      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  it('should clear pending banner timer on cleanup before it fires', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
        sessionName: 'myterm',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(50); // timer is pending but hasn't fired

      // Close immediately — cleanup clears the banner timer
      lastWsInstance.emit('close');
      await promise;

      // Wait past the original timer period
      await wait(600);
      assert.ok(!io.writes.some((w) => w.includes('attached: myterm')));
    } finally {
      io.restore();
    }
  });

  it('should debounce banner: re-calling resets the timer', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
        sessionName: 'myterm',
      });
      await wait(20);

      // attached triggers first debounceBanner (T=0)
      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(300);

      // output triggers debounceBanner again at T=300ms (clears old timer, sets new 500ms)
      lastWsInstance.emit('message', JSON.stringify({ type: 'output', data: 'hi' }));

      // At T=550ms (250ms after second call), banner should NOT be shown yet
      await wait(250);
      assert.ok(!io.writes.some((w) => w.includes('attached: myterm')));

      // At T=850ms (550ms after second call), banner should be shown
      await wait(350);
      assert.ok(io.writes.some((w) => w.includes('attached: myterm')));

      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  // ── output handler ──────────────────────────────────────────────────────────

  it('should write output data to stdout', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'output', data: 'hello world' }));
      await wait(10);

      assert.ok(io.writes.includes('hello world'));

      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  // ── enterRawMode / stdin handling ───────────────────────────────────────────

  it('should resolve with detached when detach key is pressed', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(20);

      // Press Ctrl+B (default detach key)
      process.stdin.emit('data', Buffer.from('\x02'));

      const result = await promise;
      assert.equal(result.reason, 'detached');
    } finally {
      io.restore();
    }
  });

  it('should forward non-detach stdin data as input message', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(20);

      process.stdin.emit('data', Buffer.from('ls -la'));
      await wait(10);

      const inputMsg = lastWsInstance.sent.find((m) => m.type === 'input');
      assert.ok(inputMsg);
      assert.equal(inputMsg.data, 'ls -la');

      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  it('should not send input when WS is not open', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(20);

      // Simulate WS in CLOSING state
      lastWsInstance.readyState = 2;
      process.stdin.emit('data', Buffer.from('hello'));
      await wait(10);

      assert.ok(!lastWsInstance.sent.find((m) => m.type === 'input'));

      lastWsInstance.readyState = 3;
      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  it('should skip setRawMode when stdin is not a TTY', async () => {
    const io = setupIOMocks({ isTTY: false });
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(20);

      // setRawMode should NOT have been called
      assert.strictEqual(io.rawMode, false);
      // stdin should still be resumed
      assert.strictEqual(io.resumed, true);

      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  // ── sendResize ──────────────────────────────────────────────────────────────

  it('should not send resize when stdout has no dimensions', async () => {
    const io = setupIOMocks({ columns: 0, rows: 0 });
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(20);

      assert.ok(!lastWsInstance.sent.find((m) => m.type === 'resize'));

      lastWsInstance.emit('close');
      await promise;
    } finally {
      io.restore();
    }
  });

  // ── resetTerminal ───────────────────────────────────────────────────────────

  it('should restore raw mode, pause stdin, and reset title on cleanup', async () => {
    const io = setupIOMocks();
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
      });
      await wait(20);

      lastWsInstance.emit('message', JSON.stringify({ type: 'attached' }));
      await wait(20);
      assert.strictEqual(io.rawMode, true);

      // Close triggers cleanup → resetTerminal
      lastWsInstance.emit('close');
      await promise;

      assert.strictEqual(io.rawMode, false);
      assert.strictEqual(io.paused, true);
      assert.ok(io.writes.includes('\x1b]0;\x07'));
      assert.ok(lastWsInstance.closed);
    } finally {
      io.restore();
    }
  });

  it('should handle resetTerminal when no raw mode was set (non-TTY)', async () => {
    const io = setupIOMocks({ isTTY: false });
    try {
      const promise = createTerminalClient({
        url: 'ws://localhost:3456/ws',
        password: null,
        sessionId: 's1',
      });
      await wait(20);

      // Close without ever receiving attached — no listeners to remove
      lastWsInstance.emit('close');
      await promise;

      // Should still reset title and pause stdin
      assert.ok(io.writes.includes('\x1b]0;\x07'));
      assert.strictEqual(io.paused, true);
      // rawMode should never have been touched
      assert.strictEqual(io.rawMode, false);
    } finally {
      io.restore();
    }
  });
});
