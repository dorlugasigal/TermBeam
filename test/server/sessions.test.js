const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Mock node-pty before requiring sessions
const originalResolveFilename = Module._resolveFilename;

describe('SessionManager', () => {
  let SessionManager;
  let mockPtyProcesses;

  beforeEach(() => {
    mockPtyProcesses = [];

    // Mock node-pty
    Module._resolveFilename = function (request, parent) {
      if (request === 'node-pty') return 'node-pty';
      return originalResolveFilename.call(this, request, parent);
    };

    require.cache['node-pty'] = {
      id: 'node-pty',
      filename: 'node-pty',
      loaded: true,
      exports: {
        spawn: (shell, args, opts) => {
          const callbacks = {};
          const mockProcess = {
            pid: 1000 + mockPtyProcesses.length,
            onData: (cb) => {
              callbacks.onData = cb;
            },
            onExit: (cb) => {
              callbacks.onExit = cb;
            },
            write: () => {},
            resize: () => {},
            kill: () => {
              if (callbacks.onExit) callbacks.onExit({ exitCode: 0 });
            },
            _callbacks: callbacks,
            _shell: shell,
            _args: args,
            _opts: opts,
          };
          mockPtyProcesses.push(mockProcess);
          return mockProcess;
        },
      },
    };

    // Clear sessions module cache and re-require
    delete require.cache[require.resolve('../../src/server/sessions')];
    ({ SessionManager } = require('../../src/server/sessions'));
  });

  afterEach(() => {
    Module._resolveFilename = originalResolveFilename;
    delete require.cache['node-pty'];
    delete require.cache[require.resolve('../../src/server/sessions')];
  });

  it('should create a session and return an id', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    assert.ok(id);
    assert.strictEqual(typeof id, 'string');
    assert.strictEqual(id.length, 32);
  });

  it('should list created sessions', () => {
    const mgr = new SessionManager();
    mgr.create({ name: 'sess1', shell: '/bin/sh', cwd: '/tmp' });
    mgr.create({ name: 'sess2', shell: '/bin/bash', cwd: '/home' });
    const list = mgr.list();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].name, 'sess1');
    assert.strictEqual(list[1].name, 'sess2');
  });

  it('should get a session by id', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    assert.ok(session);
    assert.strictEqual(session.name, 'test');
  });

  it('should return undefined for unknown id', () => {
    const mgr = new SessionManager();
    assert.strictEqual(mgr.get('nonexistent'), undefined);
  });

  it('should delete a session', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    assert.strictEqual(mgr.delete(id), true);
    assert.strictEqual(mgr.get(id), undefined);
    assert.strictEqual(mgr.list().length, 0);
  });

  it('should return false when deleting nonexistent session', () => {
    const mgr = new SessionManager();
    assert.strictEqual(mgr.delete('nonexistent'), false);
  });

  it('should shutdown all sessions', () => {
    const mgr = new SessionManager();
    mgr.create({ name: 's1', shell: '/bin/sh', cwd: '/tmp' });
    mgr.create({ name: 's2', shell: '/bin/sh', cwd: '/tmp' });
    assert.strictEqual(mgr.list().length, 2);
    mgr.shutdown();
    assert.strictEqual(mgr.list().length, 0);
  });

  it('should track session metadata', () => {
    const mgr = new SessionManager();
    const _id = mgr.create({ name: 'myterm', shell: '/bin/zsh', args: ['-l'], cwd: '/Users/test' });
    const list = mgr.list();
    assert.strictEqual(list[0].name, 'myterm');
    assert.strictEqual(list[0].shell, '/bin/zsh');
    assert.strictEqual(list[0].cwd, '/Users/test');
    assert.ok(list[0].pid);
    assert.ok(list[0].createdAt);
  });

  it('should assign colors from SESSION_COLORS in order', () => {
    const mgr = new SessionManager();
    const _id1 = mgr.create({ name: 's1', shell: '/bin/sh', cwd: '/tmp' });
    const _id2 = mgr.create({ name: 's2', shell: '/bin/sh', cwd: '/tmp' });
    const list = mgr.list();
    assert.ok(list[0].color, 'First session should have a color');
    assert.ok(list[1].color, 'Second session should have a color');
    assert.notStrictEqual(
      list[0].color,
      list[1].color,
      'First two sessions should have different colors',
    );
  });

  it('should accept a custom color', () => {
    const mgr = new SessionManager();
    const _id = mgr.create({ name: 'custom', shell: '/bin/sh', cwd: '/tmp', color: '#ff0000' });
    const list = mgr.list();
    assert.strictEqual(list[0].color, '#ff0000');
  });

  it('should update session name and color', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'original', shell: '/bin/sh', cwd: '/tmp' });
    assert.strictEqual(mgr.update(id, { name: 'renamed', color: '#00ff00' }), true);
    const session = mgr.get(id);
    assert.strictEqual(session.name, 'renamed');
    assert.strictEqual(session.color, '#00ff00');
  });

  it('should return false when updating nonexistent session', () => {
    const mgr = new SessionManager();
    assert.strictEqual(mgr.update('nonexistent', { name: 'x' }), false);
  });

  it('should accumulate scrollback buffer from pty data', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    // Simulate pty data via the mock's onData callback
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];
    mockProcess._callbacks.onData('hello ');
    mockProcess._callbacks.onData('world');
    assert.strictEqual(session.scrollbackBuf, 'hello world');
  });

  it('should track lastActivity on pty data', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const before = session.lastActivity;
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];
    mockProcess._callbacks.onData('data');
    assert.ok(session.lastActivity >= before);
  });

  it('should send initialCommand to PTY after delay', async () => {
    const _mgr = new SessionManager();
    const writeCalls = [];
    const origSpawn = require.cache['node-pty'].exports.spawn;
    require.cache['node-pty'].exports.spawn = (shell, args, opts) => {
      const proc = origSpawn(shell, args, opts);
      proc.write = (data) => writeCalls.push(data);
      return proc;
    };
    delete require.cache[require.resolve('../../src/server/sessions')];
    ({ SessionManager } = require('../../src/server/sessions'));
    const mgr2 = new SessionManager();
    mgr2.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp', initialCommand: 'htop' });
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(
      writeCalls.includes('htop\r'),
      'pty.write should be called with initialCommand + \\r',
    );
    // Restore original spawn
    require.cache['node-pty'].exports.spawn = origSpawn;
  });

  it('should trim scrollback to ~500KB when buffer exceeds ~1MB', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];
    // Emit a single chunk exceeding 1,000,000 chars
    const bigChunk = 'x'.repeat(1100000);
    mockProcess._callbacks.onData(bigChunk);
    assert.ok(session.scrollbackBuf.length <= 500000, 'scrollbackBuf should be trimmed to ~500KB');
    assert.strictEqual(session.scrollbackBuf.length, 500000);
  });

  it('should track inAltScreen when alt screen enter sequence is received', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];
    assert.strictEqual(session.inAltScreen, false);

    mockProcess._callbacks.onData('\x1b[?1049h');
    assert.strictEqual(session.inAltScreen, true);
    assert.strictEqual(session.altScreenMode, '1049');
  });

  it('should track inAltScreen when alt screen exit sequence is received', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];

    mockProcess._callbacks.onData('\x1b[?1049h');
    assert.strictEqual(session.inAltScreen, true);

    mockProcess._callbacks.onData('\x1b[?1049l');
    assert.strictEqual(session.inAltScreen, false);
  });

  it('should detect alt screen sequences split across chunks', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];
    assert.strictEqual(session.inAltScreen, false);

    // Split \x1b[?1049h across two chunks
    mockProcess._callbacks.onData('some output\x1b[?10');
    mockProcess._callbacks.onData('49h');
    assert.strictEqual(session.inAltScreen, true, 'should detect split alt screen enter');
  });

  it('should track all alt screen buffer variants (1047, 47)', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];

    mockProcess._callbacks.onData('\x1b[?1047h');
    assert.strictEqual(session.inAltScreen, true);
    assert.strictEqual(session.altScreenMode, '1047');

    mockProcess._callbacks.onData('\x1b[?1047l');
    assert.strictEqual(session.inAltScreen, false);
    assert.strictEqual(session.altScreenMode, undefined);

    mockProcess._callbacks.onData('\x1b[?47h');
    assert.strictEqual(session.inAltScreen, true);
    assert.strictEqual(session.altScreenMode, '47');

    mockProcess._callbacks.onData('\x1b[?47l');
    assert.strictEqual(session.inAltScreen, false);
    assert.strictEqual(session.altScreenMode, undefined);
  });

  it('should not throw when pty.kill() errors during shutdown', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    // Make pty.kill throw
    session.pty.kill = () => {
      throw new Error('kill failed');
    };
    assert.doesNotThrow(() => mgr.shutdown());
    assert.strictEqual(mgr.list().length, 0);
  });

  // --- Shell validation tests ---

  it('should reject shell with dangerous characters', () => {
    const mgr = new SessionManager();
    const dangerous = ['/bin/sh;rm', 'bash|cat', 'sh`id`', 'sh$(cmd)', 'sh&bg', '{bad}'];
    for (const shell of dangerous) {
      assert.throws(
        () => mgr.create({ name: 'test', shell, cwd: '/tmp' }),
        { message: 'Invalid shell' },
        `Should reject shell: ${shell}`,
      );
    }
  });

  it('should reject empty shell', () => {
    const mgr = new SessionManager();
    assert.throws(() => mgr.create({ name: 'test', shell: '', cwd: '/tmp' }), {
      message: 'Invalid shell',
    });
  });

  it('should reject non-string shell', () => {
    const mgr = new SessionManager();
    assert.throws(() => mgr.create({ name: 'test', shell: 123, cwd: '/tmp' }), {
      message: 'Invalid shell',
    });
    assert.throws(() => mgr.create({ name: 'test', shell: null, cwd: '/tmp' }), {
      message: 'Invalid shell',
    });
  });

  it('should reject relative path with special chars', () => {
    const mgr = new SessionManager();
    assert.throws(() => mgr.create({ name: 'test', shell: '../bash', cwd: '/tmp' }), {
      message: 'Invalid shell',
    });
    assert.throws(() => mgr.create({ name: 'test', shell: './sub/shell', cwd: '/tmp' }), {
      message: 'Invalid shell',
    });
  });

  it('should accept valid absolute shell path', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/bash', cwd: '/tmp' });
    assert.ok(id);
  });

  it('should accept bare shell name without path separators', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: 'bash', cwd: '/tmp' });
    assert.ok(id);
  });

  it('should accept bare shell name with .exe suffix', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: 'cmd.exe', cwd: '/tmp' });
    assert.ok(id);
  });

  // --- initialCommand validation tests ---

  it('should reject non-string initialCommand', () => {
    const mgr = new SessionManager();
    assert.throws(
      () => mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp', initialCommand: 123 }),
      { message: 'initialCommand must be a string' },
    );
    assert.throws(
      () => mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp', initialCommand: true }),
      { message: 'initialCommand must be a string' },
    );
  });

  it('should accept null initialCommand', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp', initialCommand: null });
    assert.ok(id);
  });

  // --- args validation tests ---

  it('should reject non-array args', () => {
    const mgr = new SessionManager();
    assert.throws(
      () => mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp', args: 'not-array' }),
      { message: 'args must be an array of strings' },
    );
  });

  it('should reject args with non-string elements', () => {
    const mgr = new SessionManager();
    assert.throws(
      () => mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp', args: ['-l', 42] }),
      { message: 'args must be an array of strings' },
    );
  });

  // --- list() returns git info ---

  it('should return git info in list output', () => {
    const mgr = new SessionManager();
    mgr.create({ name: 'test', shell: '/bin/sh', cwd: '/tmp' });
    const list = mgr.list();
    assert.strictEqual(list.length, 1);
    // git key should exist (may be null for non-git dirs)
    assert.ok('git' in list[0]);
  });

  // --- update() only changes provided fields ---

  it('should update only color when name is not provided', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'keep', shell: '/bin/sh', cwd: '/tmp' });
    mgr.update(id, { color: '#abcdef' });
    const s = mgr.get(id);
    assert.strictEqual(s.name, 'keep');
    assert.strictEqual(s.color, '#abcdef');
  });

  it('should update only name when color is not provided', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'old', shell: '/bin/sh', cwd: '/tmp', color: '#111111' });
    mgr.update(id, { name: 'new' });
    const s = mgr.get(id);
    assert.strictEqual(s.name, 'new');
    assert.strictEqual(s.color, '#111111');
  });

  // --- _emitNotification tests ---

  it('should call onCommandComplete callback when set', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'notif-test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);

    let callbackArg = null;
    mgr.onCommandComplete = (arg) => {
      callbackArg = arg;
    };

    mgr._emitNotification(id, session);

    assert.ok(callbackArg, 'onCommandComplete should have been called');
    assert.strictEqual(callbackArg.sessionId, id);
    assert.strictEqual(callbackArg.sessionName, 'notif-test');
  });

  it('should broadcast notification to connected WS clients', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'ws-notif', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);

    const sentMessages = [];
    const mockWs = {
      readyState: 1,
      send: (msg) => sentMessages.push(msg),
    };
    session.clients.add(mockWs);

    mgr._emitNotification(id, session);

    assert.strictEqual(sentMessages.length, 1);
    const parsed = JSON.parse(sentMessages[0]);
    assert.strictEqual(parsed.type, 'notification');
    assert.strictEqual(parsed.notificationType, 'command-complete');
    assert.strictEqual(parsed.sessionName, 'ws-notif');
    assert.ok(parsed.timestamp);
    // Should NOT add to pending since a client received it
    assert.strictEqual(session.pendingNotifications.length, 0);
  });

  it('should store pending notification when no clients are connected', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'pending-test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);

    mgr._emitNotification(id, session);

    assert.strictEqual(session.pendingNotifications.length, 1);
    assert.strictEqual(session.pendingNotifications[0].notificationType, 'command-complete');
    assert.strictEqual(session.pendingNotifications[0].sessionName, 'pending-test');
  });

  it('should cap pending notifications at 5', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'cap-test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);

    for (let i = 0; i < 7; i++) {
      mgr._emitNotification(id, session);
    }

    assert.strictEqual(session.pendingNotifications.length, 5);
  });

  it('should skip WS clients with readyState !== 1', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'closed-ws', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);

    const mockWs = { readyState: 3, send: () => assert.fail('should not send') };
    session.clients.add(mockWs);

    mgr._emitNotification(id, session);

    // Not delivered, so stored as pending
    assert.strictEqual(session.pendingNotifications.length, 1);
  });

  // --- Scrollback trimming newline advance ---

  it('should advance past first newline when trimming scrollback', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'trim-nl', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];

    // Build a buffer >1MB where the last 500K starts with partial line then newline
    const prefix = 'A'.repeat(600100);
    const midLineStart = 'partial-line';
    const afterNewline = '\n' + 'B'.repeat(499880);
    const bigChunk = prefix + midLineStart + afterNewline;
    assert.ok(bigChunk.length > 1000000, 'chunk should exceed 1MB');

    mockProcess._callbacks.onData(bigChunk);

    // After trimming, buffer should start after the first newline
    assert.ok(session.scrollbackBuf.length < 500000, 'should be trimmed');
    assert.ok(!session.scrollbackBuf.startsWith('partial'), 'should advance past partial line');
    assert.ok(session.scrollbackBuf.startsWith('B'), 'should start after newline');
  });

  // --- Silence detection setup ---

  it('should set silence timer when direct child has sustained output', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'silence-test', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];

    // Simulate a direct child process running
    session._hasDirectChild = true;
    // Pre-set burst start to 2 seconds ago (simulates sustained output)
    session._outputBurstStart = Date.now() - 2000;

    // Send enough data to meet the threshold (>100 bytes)
    mockProcess._callbacks.onData('x'.repeat(200));

    // The silence timer should be set since duration >= 1000 and bytes >= 100
    assert.ok(session._silenceTimer, 'silence timer should be set');
    assert.ok(session._outputBytes >= 200, 'output bytes should be tracked');

    // Cleanup the timer to avoid it firing after the test
    clearTimeout(session._silenceTimer);
  });

  it('should not set silence timer when output burst is too short', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'short-burst', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];

    session._hasDirectChild = true;
    // Don't pre-set _outputBurstStart — it will be set to now, making duration ~0

    mockProcess._callbacks.onData('x'.repeat(200));

    // Duration is ~0ms (< 1000ms threshold), so no timer should be set
    assert.ok(!session._silenceTimer, 'silence timer should NOT be set for short burst');
  });

  it('should not track silence when no direct child', () => {
    const mgr = new SessionManager();
    const id = mgr.create({ name: 'no-child', shell: '/bin/sh', cwd: '/tmp' });
    const session = mgr.get(id);
    const mockProcess = mockPtyProcesses[mockPtyProcesses.length - 1];

    // _hasDirectChild defaults to false/undefined
    session._outputBurstStart = Date.now() - 2000;
    mockProcess._callbacks.onData('x'.repeat(200));

    assert.ok(!session._silenceTimer, 'silence timer should NOT be set without direct child');
  });
});
