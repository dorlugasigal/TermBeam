'use strict';

/**
 * Integration: SessionManager (PTY output tracking) + websocket.js (replay on
 * attach). Regression for "long Copilot CLI session reopened: mouse tracking
 * lost" — once >1MB of output trimmed the app's original DECSET sequences out
 * of the scrollback, a re-attaching client was never told to re-enable mouse
 * tracking, so wheel/touch scrolling turned into Up/Down arrow keys.
 */
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { createAuth } = require('../../src/server/auth');
const { setupWebSocket } = require('../../src/server/websocket');
const { TerminalModeTracker } = require('../../src/server/terminal-modes');

const SESSIONS_PATH = require.resolve('../../src/server/sessions');
const originalResolveFilename = Module._resolveFilename;

const COPILOT_STARTUP = '\x1b[?1049h\x1b[?2004h\x1b[?1004h\x1b[?1003h\x1b[?1006h\x1b[?25l';
const COPILOT_RESTORE = '\x1b[?1;25;1000l\x1b[?7;1004;2004;1003;1006h';
const DEFAULT_RESTORE = '\x1b[?1;1004;2004;1000;1006l\x1b[?7;25h';

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
    terminate() {},
    on(event, cb) {
      if (event === 'message') this._onMessage = cb;
      if (event === 'close') closeCbs.push(cb);
    },
    _sent: sent,
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
    connect(ws) {
      this.clients.add(ws);
      this._onConnection(ws, { headers: {}, socket: { remoteAddress: '127.0.0.1' } });
      return ws;
    },
  };
}

/** Attach a fresh client to a session and return its `replay` payload. */
async function attachAndGetReplay(wss, sessionId) {
  const ws = wss.connect(createMockWs());
  await ws._simulateMessage({ type: 'attach', sessionId });
  const replay = ws._sent.find((m) => m.type === 'replay');
  assert.ok(
    ws._sent.find((m) => m.type === 'attached'),
    'client should be attached',
  );
  return { ws, replay };
}

/** The final "ESC[?…h" of a payload, as a list of mode numbers. */
function finalSetModes(payload) {
  const m = /\x1b\[\?([\d;]+)h$/.exec(payload);
  assert.ok(m, 'replay should end with a DECSET sequence');
  return m[1].split(';').map(Number);
}

describe('session replay restores terminal input modes', () => {
  describe('SessionManager with a mocked PTY', () => {
    let SessionManager;
    let ptys;
    let mgr;
    let auth;
    let wss;
    const clients = [];

    function emit(pty, data) {
      pty._callbacks.onData(data);
    }

    beforeEach(() => {
      ptys = [];
      Module._resolveFilename = function (request, parent, ...rest) {
        if (request === 'node-pty') return 'node-pty';
        return originalResolveFilename.call(this, request, parent, ...rest);
      };
      require.cache['node-pty'] = {
        id: 'node-pty',
        filename: 'node-pty',
        loaded: true,
        exports: {
          spawn: () => {
            const callbacks = {};
            const pty = {
              pid: 424242,
              onData: (cb) => (callbacks.onData = cb),
              onExit: (cb) => (callbacks.onExit = cb),
              write: () => {},
              resize: () => {},
              kill: () => callbacks.onExit && callbacks.onExit({ exitCode: 0 }),
              _callbacks: callbacks,
            };
            ptys.push(pty);
            return pty;
          },
        },
      };
      delete require.cache[SESSIONS_PATH];
      ({ SessionManager } = require(SESSIONS_PATH));
      mgr = new SessionManager();
      auth = createAuth(null);
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions: mgr });
    });

    afterEach(() => {
      for (const ws of clients.splice(0)) ws._simulateClose();
      for (const ws of wss.clients) ws._simulateClose();
      mgr.shutdown();
      auth.cleanup();
      Module._resolveFilename = originalResolveFilename;
      delete require.cache['node-pty'];
      delete require.cache[SESSIONS_PATH];
    });

    it('feeds PTY output into the session mode tracker', () => {
      const id = mgr.create({ name: 'copilot', shell: '/bin/sh', cwd: process.cwd() });
      const session = mgr.get(id);
      assert.ok(session.modes instanceof TerminalModeTracker);
      // Split mid-sequence across chunks, like a real PTY read
      emit(ptys[0], 'copilot\r\n\x1b[?10');
      emit(ptys[0], '49h\x1b[?1003h\x1b[?100');
      emit(ptys[0], '6h');
      assert.equal(session.inAltScreen, true);
      assert.equal(session.altScreenMode, '1049');
      assert.equal(session.modes.mouseProtocol, 1003);
      assert.equal(session.modes.mouseEncoding, 1006);
    });

    it('replay ends with the alt-screen enter followed by the restore sequence', async () => {
      const id = mgr.create({ name: 'copilot', shell: '/bin/sh', cwd: process.cwd() });
      const session = mgr.get(id);
      session.hasHadClient = true; // a client was attached earlier
      emit(ptys[0], `$ copilot\r\n${COPILOT_STARTUP}\x1b[2J\x1b[H> How can I help?`);

      const { ws, replay } = await attachAndGetReplay(wss, id);
      clients.push(ws);
      assert.ok(replay, 'returning client should get a replay snapshot');
      assert.equal(session.modes.restoreSequence(), COPILOT_RESTORE);
      assert.ok(
        replay.data.endsWith(`\x1b[?1049h${COPILOT_RESTORE}`),
        `unexpected replay tail: ${JSON.stringify(replay.data.slice(-80))}`,
      );
      assert.ok(replay.data.startsWith('$ copilot\r\n'), 'scrollback comes first');
    });

    it('long Copilot CLI session reopened: mouse tracking survives a trimmed scrollback', async () => {
      const id = mgr.create({ name: 'copilot', shell: '/bin/sh', cwd: process.cwd() });
      const session = mgr.get(id);
      session.hasHadClient = true;
      emit(ptys[0], `$ copilot\r\n${COPILOT_STARTUP}`);
      assert.ok(session.scrollbackBuf.includes('\x1b[?1003h'));

      // > 1MB of transcript output: the buffer is trimmed to the last ~500k
      // chars, which drops the original mode switches.
      const line = `${'agent output '.repeat(7)}\r\n`;
      const chunk = line.repeat(Math.ceil(50_000 / line.length));
      let total = 0;
      while (total < 1_100_000) {
        emit(ptys[0], chunk);
        total += chunk.length;
      }
      assert.ok(session.scrollbackBuf.length <= 1_000_000, 'scrollback was trimmed');
      for (const seq of ['\x1b[?1049h', '\x1b[?1003h', '\x1b[?1006h', '\x1b[?2004h']) {
        assert.equal(session.scrollbackBuf.includes(seq), false, `${JSON.stringify(seq)} trimmed`);
      }

      const { ws, replay } = await attachAndGetReplay(wss, id);
      clients.push(ws);
      assert.ok(replay);
      const sets = finalSetModes(replay.data);
      assert.ok(sets.includes(1003), 'any-motion mouse tracking is re-enabled');
      assert.ok(sets.includes(1006), 'SGR mouse encoding is re-enabled');
      assert.ok(replay.data.includes('\x1b[?1049h'), 'alt screen is re-entered');
      assert.ok(
        replay.data.endsWith(`\x1b[?1049h${session.modes.restoreSequence()}`),
        'modes are restored after entering the alt screen',
      );

      // What xterm.js ends up with after reset + replay
      const client = new TerminalModeTracker();
      client.feed(replay.data);
      assert.equal(client.mouseProtocol, 1003);
      assert.equal(client.mouseEncoding, 1006);
      assert.equal(client.inAltScreen, true);
      assert.equal(client.flags.get(2004), true, 'bracketed paste');
      assert.equal(client.flags.get(1004), true, 'focus reporting');
      assert.equal(client.flags.get(25), false, 'cursor stays hidden');
    });

    it('first client (no prior attach) gets the restore sequence after its first resize', async () => {
      const id = mgr.create({ name: 'copilot', shell: '/bin/sh', cwd: process.cwd() });
      emit(ptys[0], COPILOT_STARTUP);
      const ws = wss.connect(createMockWs());
      clients.push(ws);
      await ws._simulateMessage({ type: 'attach', sessionId: id });
      assert.equal(
        ws._sent.find((m) => m.type === 'replay'),
        undefined,
        'deferred until resize',
      );
      await ws._simulateMessage({ type: 'resize', cols: 120, rows: 30 }); // same size as spawn
      const replay = ws._sent.find((m) => m.type === 'replay');
      assert.ok(replay);
      assert.ok(replay.data.endsWith(`\x1b[?1049h${COPILOT_RESTORE}`));
    });

    it('after the app exits, the replay resets input modes to their defaults', async () => {
      const id = mgr.create({ name: 'copilot', shell: '/bin/sh', cwd: process.cwd() });
      const session = mgr.get(id);
      session.hasHadClient = true;
      emit(ptys[0], `$ copilot\r\n${COPILOT_STARTUP}UI`);
      emit(ptys[0], '\x1b[?1006l\x1b[?1003l\x1b[?1004l\x1b[?2004l\x1b[?25h\x1b[?1049l$ ');
      assert.equal(session.inAltScreen, false);
      assert.equal(session.altScreenMode, undefined);

      const { ws, replay } = await attachAndGetReplay(wss, id);
      clients.push(ws);
      assert.equal(replay.data.includes('\x1b[?1049h'), false, 'no alt-screen re-entry');
      assert.ok(replay.data.endsWith(DEFAULT_RESTORE));
      const client = new TerminalModeTracker();
      client.feed(replay.data);
      assert.equal(client.mouseProtocol, 0);
      assert.equal(client.hasNonDefaultModes(), false);
    });
  });

  describe('SessionManager with a real PTY', { skip: process.platform === 'win32' }, () => {
    let mgr;
    let auth;
    let wss;

    before(() => {
      Module._resolveFilename = originalResolveFilename;
      delete require.cache['node-pty'];
      delete require.cache[SESSIONS_PATH];
      const { SessionManager } = require(SESSIONS_PATH);
      mgr = new SessionManager();
      auth = createAuth(null);
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions: mgr });
    });

    after(() => {
      for (const ws of wss.clients) ws._simulateClose();
      mgr.shutdown();
      auth.cleanup();
      delete require.cache[SESSIONS_PATH];
    });

    it('re-enables mouse tracking after >1MB of real PTY output', { timeout: 60_000 }, async () => {
      const script = [
        "printf '\\033[?1049h\\033[?2004h\\033[?1004h\\033[?1003h\\033[?1006h\\033[?25l'",
        "head -c 1200000 /dev/zero | tr '\\000' 'x' | fold -w 99",
        "printf '\\nTB-REPLAY-DONE\\n'",
        'exec sleep 60',
      ].join('; ');
      const id = mgr.create({
        name: 'copilot-sim',
        shell: '/bin/sh',
        args: ['-c', script],
        cwd: process.cwd(),
      });
      const session = mgr.get(id);

      const deadline = Date.now() + 45_000;
      while (!session.scrollbackBuf.includes('TB-REPLAY-DONE')) {
        assert.ok(Date.now() < deadline, 'PTY output did not finish in time');
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(session.scrollbackBuf.includes('\x1b[?1003h'), false, 'start-up modes trimmed');
      assert.equal(session.modes.mouseProtocol, 1003);
      assert.equal(session.modes.mouseEncoding, 1006);

      session.hasHadClient = true; // reopening a long-running session
      const { replay } = await attachAndGetReplay(wss, id);
      assert.ok(replay);
      const sets = finalSetModes(replay.data);
      assert.ok(sets.includes(1003));
      assert.ok(sets.includes(1006));
      const client = new TerminalModeTracker();
      client.feed(replay.data);
      assert.equal(client.mouseProtocol, 1003);
      assert.equal(client.mouseEncoding, 1006);
      assert.equal(client.inAltScreen, true);
    });
  });
});
