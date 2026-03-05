const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const _fs = require('fs');
const _path = require('path');
const os = require('os');

// We test the pure/exported functions — not the interactive prompts
const {
  buildArgs,
  generateEcosystem,
  findPm2,
  TERMBEAM_DIR,
  DEFAULT_SERVICE_NAME,
} = require('../src/service');

describe('service', () => {
  describe('buildArgs', () => {
    it('returns empty array for default config', () => {
      const args = buildArgs({});
      assert.deepStrictEqual(args, []);
    });

    it('adds --no-password when password is false', () => {
      const args = buildArgs({ password: false });
      assert.ok(args.includes('--no-password'));
    });

    it('adds --password with value when set', () => {
      const args = buildArgs({ password: 'secret123' });
      const idx = args.indexOf('--password');
      assert.ok(idx >= 0);
      assert.strictEqual(args[idx + 1], 'secret123');
    });

    it('adds --port when non-default', () => {
      const args = buildArgs({ port: 8080 });
      const idx = args.indexOf('--port');
      assert.ok(idx >= 0);
      assert.strictEqual(args[idx + 1], '8080');
    });

    it('does not add --port for default 3456', () => {
      const args = buildArgs({ port: 3456 });
      assert.ok(!args.includes('--port'));
    });

    it('adds --host when non-default', () => {
      const args = buildArgs({ host: '192.168.1.1' });
      const idx = args.indexOf('--host');
      assert.ok(idx >= 0);
      assert.strictEqual(args[idx + 1], '192.168.1.1');
    });

    it('adds --lan flag', () => {
      const args = buildArgs({ lan: true });
      assert.ok(args.includes('--lan'));
    });

    it('adds --no-tunnel flag', () => {
      const args = buildArgs({ noTunnel: true });
      assert.ok(args.includes('--no-tunnel'));
    });

    it('adds --persisted-tunnel flag', () => {
      const args = buildArgs({ persistedTunnel: true });
      assert.ok(args.includes('--persisted-tunnel'));
    });

    it('adds --public flag', () => {
      const args = buildArgs({ publicTunnel: true });
      assert.ok(args.includes('--public'));
    });

    it('adds --log-level when non-default', () => {
      const args = buildArgs({ logLevel: 'debug' });
      const idx = args.indexOf('--log-level');
      assert.ok(idx >= 0);
      assert.strictEqual(args[idx + 1], 'debug');
    });

    it('does not add --log-level for default info', () => {
      const args = buildArgs({ logLevel: 'info' });
      assert.ok(!args.includes('--log-level'));
    });

    it('adds shell as last arg', () => {
      const args = buildArgs({ shell: '/bin/zsh' });
      assert.strictEqual(args[args.length - 1], '/bin/zsh');
    });

    it('combines multiple flags', () => {
      const args = buildArgs({
        password: 'pw',
        port: 9999,
        lan: true,
        noTunnel: true,
        logLevel: 'debug',
        shell: '/bin/bash',
      });
      assert.ok(args.includes('--password'));
      assert.ok(args.includes('--port'));
      assert.ok(args.includes('--lan'));
      assert.ok(args.includes('--no-tunnel'));
      assert.ok(args.includes('--log-level'));
      assert.ok(args.includes('/bin/bash'));
    });
  });

  describe('generateEcosystem', () => {
    it('generates valid JS module content', () => {
      const content = generateEcosystem({ name: 'test-tb', port: 3456 });
      assert.ok(content.startsWith('module.exports = '));
      assert.ok(content.includes('"test-tb"'));
    });

    it('includes termbeam.js script path', () => {
      const content = generateEcosystem({ name: 'termbeam' });
      assert.ok(content.includes('termbeam.js'));
    });

    it('uses default name when not specified', () => {
      const content = generateEcosystem({});
      assert.ok(content.includes(`"${DEFAULT_SERVICE_NAME}"`));
    });

    it('sets cwd in ecosystem config', () => {
      const content = generateEcosystem({ cwd: '/tmp/mydir' });
      assert.ok(content.includes('/tmp/mydir'));
    });

    it('includes args from buildArgs', () => {
      const content = generateEcosystem({ password: 'test', noTunnel: true });
      assert.ok(content.includes('"--password"'));
      assert.ok(content.includes('"test"'));
      assert.ok(content.includes('"--no-tunnel"'));
    });

    it('sets autorestart to true', () => {
      const content = generateEcosystem({});
      assert.ok(content.includes('"autorestart": true'));
    });
  });

  describe('findPm2', () => {
    it('returns a string or null', () => {
      const result = findPm2();
      assert.ok(result === null || typeof result === 'string');
    });
  });

  describe('constants', () => {
    it('TERMBEAM_DIR is under home directory', () => {
      assert.ok(TERMBEAM_DIR.startsWith(os.homedir()));
      assert.ok(TERMBEAM_DIR.endsWith('.termbeam'));
    });

    it('DEFAULT_SERVICE_NAME is termbeam', () => {
      assert.strictEqual(DEFAULT_SERVICE_NAME, 'termbeam');
    });
  });
});

// ── Mock helper for testing internal functions with mocked dependencies ──────

const Module = require('module');

function loadServiceWithMocks(mocks = {}) {
  const originalLoad = Module._load;
  const servicePath = require.resolve('../src/service');
  const promptsPath = require.resolve('../src/prompts');

  delete require.cache[servicePath];
  delete require.cache[promptsPath];

  const mockModules = {};
  if (mocks.childProcess) {
    mockModules['child_process'] = { ...require('child_process'), ...mocks.childProcess };
  }
  if (mocks.fs) {
    mockModules['fs'] = { ...require('fs'), ...mocks.fs };
  }
  if (mocks.readline) {
    mockModules['readline'] = { ...require('readline'), ...mocks.readline };
  }

  // Apply mocks to both service.js and prompts.js (prompts uses readline)
  const mockTargets = new Set([servicePath, promptsPath]);

  Module._load = function (request, parent, isMain) {
    if (mockModules[request] && parent && mockTargets.has(parent.filename)) {
      return mockModules[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const service = require('../src/service');

  return {
    service,
    restore() {
      delete require.cache[servicePath];
      delete require.cache[promptsPath];
      Module._load = originalLoad;
    },
  };
}

describe('color helpers', () => {
  const svc = require('../src/service');

  it('green wraps text with ANSI green code', () => {
    assert.strictEqual(svc.green('hi'), '\x1b[32mhi\x1b[0m');
  });

  it('yellow wraps text with ANSI yellow code', () => {
    assert.strictEqual(svc.yellow('hi'), '\x1b[33mhi\x1b[0m');
  });

  it('red wraps text with ANSI red code', () => {
    assert.strictEqual(svc.red('hi'), '\x1b[31mhi\x1b[0m');
  });

  it('cyan wraps text with ANSI cyan code', () => {
    assert.strictEqual(svc.cyan('hi'), '\x1b[36mhi\x1b[0m');
  });

  it('bold wraps text with ANSI bold code', () => {
    assert.strictEqual(svc.bold('hi'), '\x1b[1mhi\x1b[0m');
  });

  it('dim wraps text with ANSI dim code', () => {
    assert.strictEqual(svc.dim('hi'), '\x1b[2mhi\x1b[0m');
  });

  it('color wraps text with arbitrary ANSI code', () => {
    assert.strictEqual(svc.color('42', 'bg'), '\x1b[42mbg\x1b[0m');
  });
});

describe('writeEcosystem', () => {
  let loaded;

  afterEach(() => {
    if (loaded) loaded.restore();
  });

  it('creates directory and writes ecosystem file', () => {
    const calls = { mkdir: [], writeFile: [] };
    loaded = loadServiceWithMocks({
      fs: {
        mkdirSync: (...args) => calls.mkdir.push(args),
        writeFileSync: (...args) => calls.writeFile.push(args),
      },
    });

    loaded.service.writeEcosystem('test content');

    assert.strictEqual(calls.mkdir.length, 1);
    assert.ok(calls.mkdir[0][0].endsWith('.termbeam'));
    assert.deepStrictEqual(calls.mkdir[0][1], { recursive: true });

    assert.strictEqual(calls.writeFile.length, 1);
    assert.ok(calls.writeFile[0][0].endsWith('ecosystem.config.js'));
    assert.strictEqual(calls.writeFile[0][1], 'test content');
    assert.strictEqual(calls.writeFile[0][2], 'utf8');
  });
});

describe('pm2Exec', () => {
  let loaded;

  afterEach(() => {
    if (loaded) loaded.restore();
  });

  it('returns stdout on success', () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: () => 'pm2 output',
      },
    });
    const result = loaded.service.pm2Exec(['list']);
    assert.strictEqual(result, 'pm2 output');
  });

  it('returns null on error with silent: true', () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: () => {
          throw new Error('command failed');
        },
      },
    });
    const result = loaded.service.pm2Exec(['list'], { silent: true });
    assert.strictEqual(result, null);
  });

  it('logs error on failure without silent', () => {
    const errors = [];
    const origError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: () => {
          const err = new Error('fail');
          err.stderr = 'some stderr output';
          throw err;
        },
      },
    });

    const result = loaded.service.pm2Exec(['describe', 'termbeam']);
    console.error = origError;

    assert.strictEqual(result, null);
    assert.ok(errors.some((e) => e.includes('PM2 command failed')));
    assert.ok(errors.some((e) => e.includes('some stderr output')));
  });

  it('uses inherit stdio when opts.inherit is true', () => {
    let capturedOpts;
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args, opts) => {
          capturedOpts = opts;
          return '';
        },
      },
    });
    loaded.service.pm2Exec(['list'], { inherit: true });
    assert.strictEqual(capturedOpts.stdio, 'inherit');
  });
});

describe('actionStatus', () => {
  let loaded;
  let origExit, origError;
  let exitCode;

  beforeEach(() => {
    origExit = process.exit;
    origError = console.error;
    exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };
    console.error = () => {};
  });

  afterEach(() => {
    process.exit = origExit;
    console.error = origError;
    if (loaded) loaded.restore();
  });

  it('calls pm2 describe when PM2 is found', () => {
    const calls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          return '';
        },
      },
    });

    loaded.service.actionStatus();

    const pm2Call = calls.find((c) => c.cmd === 'pm2');
    assert.ok(pm2Call, 'pm2 should have been called');
    assert.deepStrictEqual(pm2Call.args, ['describe', 'termbeam']);
  });

  it('exits with error when PM2 is not found', () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: () => {
          throw new Error('not found');
        },
      },
    });

    assert.throws(() => loaded.service.actionStatus(), /process\.exit/);
    assert.strictEqual(exitCode, 1);
  });
});

describe('actionRestart', () => {
  let loaded;
  let origExit, origLog, origError;
  let exitCode;

  beforeEach(() => {
    origExit = process.exit;
    origLog = console.log;
    origError = console.error;
    exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };
    console.log = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    if (loaded) loaded.restore();
  });

  it('calls pm2 restart when PM2 is found', () => {
    const calls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          return '';
        },
      },
    });

    loaded.service.actionRestart();

    const pm2Call = calls.find((c) => c.cmd === 'pm2');
    assert.ok(pm2Call, 'pm2 should have been called');
    assert.deepStrictEqual(pm2Call.args, ['restart', 'termbeam']);
  });

  it('exits with error when PM2 is not found', () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: () => {
          throw new Error('not found');
        },
      },
    });

    assert.throws(() => loaded.service.actionRestart(), /process\.exit/);
    assert.strictEqual(exitCode, 1);
  });
});

describe('actionLogs', () => {
  let loaded;
  let origExit, origError;

  beforeEach(() => {
    origExit = process.exit;
    origError = console.error;
    process.exit = (code) => {
      throw new Error(`process.exit(${code})`);
    };
    console.error = () => {};
  });

  afterEach(() => {
    process.exit = origExit;
    console.error = origError;
    if (loaded) loaded.restore();
  });

  it('spawns pm2 logs with correct arguments', () => {
    const spawnCalls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd) => {
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          return '';
        },
        spawn: (cmd, args, opts) => {
          spawnCalls.push({ cmd, args, opts });
          return { on: () => {} };
        },
      },
    });

    loaded.service.actionLogs();

    assert.strictEqual(spawnCalls.length, 1);
    assert.strictEqual(spawnCalls[0].cmd, 'pm2');
    assert.deepStrictEqual(spawnCalls[0].args, ['logs', 'termbeam', '--lines', '200']);
    assert.deepStrictEqual(spawnCalls[0].opts, { stdio: 'inherit' });
  });

  it('exits with error when PM2 is not found', () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: () => {
          throw new Error('not found');
        },
      },
    });

    assert.throws(() => loaded.service.actionLogs(), /process\.exit/);
  });
});

describe('run', () => {
  let loaded;
  let origExit, origLog, origError;
  let logs;

  beforeEach(() => {
    origExit = process.exit;
    origLog = console.log;
    origError = console.error;
    logs = [];
    process.exit = (code) => {
      throw new Error(`process.exit(${code})`);
    };
    console.log = (...args) => logs.push(args.join(' '));
    console.error = () => {};
  });

  afterEach(() => {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    if (loaded) loaded.restore();
  });

  it('status calls actionStatus', async () => {
    const calls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          return '';
        },
      },
    });
    await loaded.service.run(['status']);
    assert.ok(calls.some((c) => c.cmd === 'pm2' && c.args[0] === 'describe'));
  });

  it('restart calls actionRestart', async () => {
    const calls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          calls.push({ cmd, args });
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          return '';
        },
      },
    });
    await loaded.service.run(['restart']);
    assert.ok(calls.some((c) => c.cmd === 'pm2' && c.args[0] === 'restart'));
  });

  it('logs calls actionLogs', async () => {
    const spawnCalls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd) => {
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          return '';
        },
        spawn: (cmd, args) => {
          spawnCalls.push({ cmd, args });
          return { on: () => {} };
        },
      },
    });
    await loaded.service.run(['logs']);
    assert.ok(spawnCalls.some((c) => c.cmd === 'pm2' && c.args[0] === 'logs'));
  });

  it('log also calls actionLogs', async () => {
    const spawnCalls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd) => {
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          return '';
        },
        spawn: (cmd, args) => {
          spawnCalls.push({ cmd, args });
          return { on: () => {} };
        },
      },
    });
    await loaded.service.run(['log']);
    assert.ok(spawnCalls.some((c) => c.cmd === 'pm2' && c.args[0] === 'logs'));
  });

  it('unknown action prints help', async () => {
    loaded = loadServiceWithMocks();
    await loaded.service.run(['unknown-action']);
    assert.ok(logs.some((l) => l.includes('termbeam service')));
  });

  it('empty args prints help', async () => {
    loaded = loadServiceWithMocks();
    await loaded.service.run([]);
    assert.ok(logs.some((l) => l.includes('termbeam service')));
  });

  it('install calls actionInstall', async () => {
    const execCalls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          execCalls.push({ cmd, args });
          throw new Error('not found');
        },
      },
      readline: {
        createInterface: () => ({
          question: (q, cb) => cb('n'),
          close: () => {},
        }),
      },
    });
    await assert.rejects(() => loaded.service.run(['install']), /process\.exit/);
    assert.ok(execCalls.some((c) => c.args && c.args[0] === 'pm2'));
  });

  it('uninstall calls actionUninstall', async () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: () => {
          throw new Error('not found');
        },
      },
    });
    await assert.rejects(() => loaded.service.run(['uninstall']), /process\.exit/);
  });

  it('remove also calls actionUninstall', async () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: () => {
          throw new Error('not found');
        },
      },
    });
    await assert.rejects(() => loaded.service.run(['remove']), /process\.exit/);
  });
});

// ── installPm2Global tests ──────────────────────────────────────────────────

describe('installPm2Global (via run install)', () => {
  let loaded;
  let origExit, origLog, origError;
  let exitCode;

  beforeEach(() => {
    origExit = process.exit;
    origLog = console.log;
    origError = console.error;
    exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };
    console.log = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    if (loaded) loaded.restore();
  });

  it('exits when npm install -g pm2 fails', async () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd) => {
          if (cmd === 'which' || cmd === 'where') throw new Error('not found');
          if (cmd === 'npm') throw new Error('permission denied');
          return '';
        },
      },
      readline: {
        createInterface: () => ({
          question: (prompt, cb) => setImmediate(() => cb('y')),
          close: () => {},
        }),
      },
    });
    await assert.rejects(() => loaded.service.run(['install']), /process\.exit/);
    assert.strictEqual(exitCode, 1);
  });

  it('exits when PM2 still not found after successful install', async () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd) => {
          if (cmd === 'which' || cmd === 'where') throw new Error('not found');
          if (cmd === 'npm') return '';
          return '';
        },
      },
      readline: {
        createInterface: () => ({
          question: (prompt, cb) => setImmediate(() => cb('y')),
          close: () => {},
        }),
      },
    });
    await assert.rejects(() => loaded.service.run(['install']), /process\.exit/);
    assert.strictEqual(exitCode, 1);
  });
});

// ── actionUninstall tests ───────────────────────────────────────────────────

describe('actionUninstall (via run)', () => {
  let loaded;
  let origExit, origLog, origError;
  let exitCode;

  beforeEach(() => {
    origExit = process.exit;
    origLog = console.log;
    origError = console.error;
    exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };
    console.log = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    if (loaded) loaded.restore();
  });

  it('stops, deletes, saves, and removes ecosystem when user confirms', async () => {
    const execCalls = [];
    const unlinkCalls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          execCalls.push({ cmd, args: [...(args || [])] });
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          if (cmd === 'pm2' && args[0] === 'jlist') {
            return JSON.stringify([{ name: 'termbeam', pm_id: 0 }]);
          }
          return '';
        },
      },
      readline: {
        createInterface: () => ({
          question: (prompt, cb) => setImmediate(() => cb('y')),
          close: () => {},
        }),
      },
      fs: {
        existsSync: () => true,
        unlinkSync: (p) => unlinkCalls.push(p),
      },
    });

    await loaded.service.run(['remove']);
    assert.ok(execCalls.some((c) => c.cmd === 'pm2' && c.args[0] === 'stop'));
    assert.ok(execCalls.some((c) => c.cmd === 'pm2' && c.args[0] === 'delete'));
    assert.ok(execCalls.some((c) => c.cmd === 'pm2' && c.args[0] === 'save'));
    assert.strictEqual(unlinkCalls.length, 1);
  });

  it('cancels when user declines confirmation', async () => {
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          if (cmd === 'pm2' && args[0] === 'jlist') return '[]';
          return '';
        },
      },
      readline: {
        createInterface: () => ({
          question: (prompt, cb) => setImmediate(() => cb('n')),
          close: () => {},
        }),
      },
    });
    await assert.rejects(() => loaded.service.run(['uninstall']), /process\.exit/);
    assert.strictEqual(exitCode, 0);
  });

  it('handles invalid jlist JSON gracefully', async () => {
    const execCalls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          execCalls.push({ cmd, args: [...(args || [])] });
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          if (cmd === 'pm2' && args[0] === 'jlist') return 'not-json';
          return '';
        },
      },
      readline: {
        createInterface: () => ({
          question: (prompt, cb) => setImmediate(() => cb('y')),
          close: () => {},
        }),
      },
      fs: {
        existsSync: () => false,
        unlinkSync: () => {},
      },
    });
    await loaded.service.run(['uninstall']);
    assert.ok(execCalls.some((c) => c.cmd === 'pm2' && c.args[0] === 'stop'));
  });

  it('skips ecosystem removal when file does not exist', async () => {
    const unlinkCalls = [];
    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd, args) => {
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          if (cmd === 'pm2' && args[0] === 'jlist') return '[]';
          return '';
        },
      },
      readline: {
        createInterface: () => ({
          question: (prompt, cb) => setImmediate(() => cb('y')),
          close: () => {},
        }),
      },
      fs: {
        existsSync: () => false,
        unlinkSync: (p) => unlinkCalls.push(p),
      },
    });
    await loaded.service.run(['uninstall']);
    assert.strictEqual(unlinkCalls.length, 0);
  });
});

// ── actionLogs error handler ────────────────────────────────────────────────

describe('actionLogs error handler', () => {
  let loaded;
  let origExit, origError;

  beforeEach(() => {
    origExit = process.exit;
    origError = console.error;
    process.exit = (code) => {
      throw new Error(`process.exit(${code})`);
    };
  });

  afterEach(() => {
    process.exit = origExit;
    console.error = origError;
    if (loaded) loaded.restore();
  });

  it('logs error when spawn emits error event', async () => {
    const errors = [];
    console.error = (...args) => errors.push(args.join(' '));

    loaded = loadServiceWithMocks({
      childProcess: {
        execFileSync: (cmd) => {
          if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
          return '';
        },
        spawn: () => {
          const { EventEmitter } = require('events');
          const child = new EventEmitter();
          setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
          return child;
        },
      },
    });

    loaded.service.actionLogs();
    await new Promise((r) => setImmediate(r));
    assert.ok(errors.some((e) => e.includes('Failed to stream logs')));
  });
});

// ── actionInstall wizard tests ──────────────────────────────────────────────

describe('actionInstall wizard (via run)', () => {
  let loaded;
  let origExit, origLog, origError;
  let exitCode;

  beforeEach(() => {
    origExit = process.exit;
    origLog = console.log;
    origError = console.error;
    exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    };
    console.log = () => {};
    console.error = () => {};
  });

  afterEach(() => {
    process.exit = origExit;
    console.log = origLog;
    console.error = origError;
    if (loaded) loaded.restore();
  });

  function wizardMocks({
    questionAnswers,
    chooseIndices = [],
    execOverride,
    fsMock,
    startupOutput = '',
    spawnMock,
  }) {
    let qIdx = 0;
    let cIdx = 0;
    return {
      childProcess: {
        execFileSync:
          execOverride ||
          ((cmd, args) => {
            if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
            if (cmd === 'pm2' && args[0] === 'startup') return startupOutput;
            return '';
          }),
        spawn:
          spawnMock ||
          (() => ({
            on: (event, cb) => {
              if (event === 'close') setImmediate(cb);
            },
          })),
      },
      readline: {
        createInterface: () => ({
          question: (prompt, cb) => {
            const ans = questionAnswers[qIdx++] || '';
            setImmediate(() => cb(ans));
          },
          close: () => {},
          pause: () => {
            const idx = chooseIndices[cIdx++] || 0;
            setImmediate(() => {
              for (let i = 0; i < idx; i++) {
                process.stdin.emit('data', Buffer.from('\x1b[B'));
              }
              process.stdin.emit('data', Buffer.from('\r'));
            });
          },
          resume: () => {},
        }),
      },
      fs: fsMock || {
        existsSync: () => true,
        mkdirSync: () => {},
        writeFileSync: () => {},
        readFileSync: () => 'Shell: /bin/bash\nLocal: http://localhost:3456\nScan the QR code',
        unlinkSync: () => {},
      },
    };
  }

  it('completes DevTunnel install with sudo startup', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['myservice', '4000', '/tmp/testdir', 'y', 'y'],
      chooseIndices: [0, 0, 0, 0],
      startupOutput: 'sudo env PATH=$PATH pm2 startup systemd',
    });
    loaded = loadServiceWithMocks(mocks);
    await loaded.service.run(['install']);
  });

  it('completes LAN install without tunnel sub-question', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['lansvc', '3456', '/tmp/lan', 'n', 'y'],
      chooseIndices: [0, 1, 0],
    });
    loaded = loadServiceWithMocks(mocks);
    await loaded.service.run(['install']);
  });

  it('completes localhost-only install', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['localsvc', '5000', '/tmp/local', 'y', 'y'],
      chooseIndices: [0, 2, 0],
      startupOutput: 'pm2 startup configured',
    });
    loaded = loadServiceWithMocks(mocks);
    await loaded.service.run(['install']);
  });

  it('exits when user cancels at confirmation', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['cancelsvc', '3456', '/tmp/cancel', 'y', 'n'],
      chooseIndices: [0, 0, 0, 0],
    });
    loaded = loadServiceWithMocks(mocks);
    await assert.rejects(() => loaded.service.run(['install']), /process\.exit/);
    assert.strictEqual(exitCode, 0);
  });

  it('handles custom password flow', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['customsvc', 'mypassword', '3456', '/tmp/custom', 'n', 'y'],
      chooseIndices: [1, 2, 0],
    });
    loaded = loadServiceWithMocks(mocks);
    await loaded.service.run(['install']);
  });

  it('retries when custom password is empty', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['retrysvc', '', 'actualpassword', '3456', '/tmp/retry', 'n', 'y'],
      chooseIndices: [1, 2, 0],
    });
    loaded = loadServiceWithMocks(mocks);
    await loaded.service.run(['install']);
  });

  it('handles no-password choice', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['nopwsvc', '3456', '/tmp/nopw', 'n', 'y'],
      chooseIndices: [2, 2, 0],
    });
    loaded = loadServiceWithMocks(mocks);
    await loaded.service.run(['install']);
  });

  it('auto-generates password for no-password with public tunnel', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['publicsvc', '3456', '/tmp/public', 'n', 'y'],
      chooseIndices: [2, 0, 1, 0],
    });
    loaded = loadServiceWithMocks(mocks);
    await loaded.service.run(['install']);
  });

  it('creates working directory when it does not exist', async () => {
    const mkdirCalls = [];
    const mocks = wizardMocks({
      questionAnswers: ['mkdirsvc', '3456', '/tmp/newdir', 'n', 'y'],
      chooseIndices: [0, 2, 0],
      fsMock: {
        existsSync: (p) => !p.includes('newdir'),
        mkdirSync: (p, opts) => mkdirCalls.push({ p, opts }),
        writeFileSync: () => {},
        readFileSync: () => 'Local: http://localhost:3456\nScan the QR code',
        unlinkSync: () => {},
      },
    });
    loaded = loadServiceWithMocks(mocks);
    await loaded.service.run(['install']);
    assert.ok(mkdirCalls.some((c) => c.p.includes('newdir')));
  });

  it('exits when pm2 start fails and ecosystem file missing', async () => {
    const mocks = wizardMocks({
      questionAnswers: ['failsvc', '3456', '/tmp/fail', 'n', 'y'],
      chooseIndices: [0, 2, 0],
      execOverride: (cmd, args) => {
        if (cmd === 'which' || cmd === 'where') return '/usr/bin/pm2\n';
        if (cmd === 'pm2' && args[0] === 'start') throw new Error('start failed');
        return '';
      },
      fsMock: {
        existsSync: (p) => !p.includes('ecosystem'),
        mkdirSync: () => {},
        writeFileSync: () => {},
        readFileSync: () => '',
        unlinkSync: () => {},
      },
    });
    loaded = loadServiceWithMocks(mocks);
    await assert.rejects(() => loaded.service.run(['install']), /process\.exit/);
    assert.strictEqual(exitCode, 1);
  });
});
