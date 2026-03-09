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
});
