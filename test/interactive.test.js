const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// ── Test helper: load interactive.js with mocked prompts ─────────────────────

function loadInteractiveWithMocks({ chooseAnswers = [], askAnswers = [], confirmAnswer = true }) {
  const originalLoad = Module._load;
  const interactivePath = require.resolve('../src/interactive');
  const promptsPath = require.resolve('../src/prompts');

  delete require.cache[interactivePath];
  delete require.cache[promptsPath];

  let chooseIdx = 0;
  let askIdx = 0;

  const mockPrompts = {
    green: (t) => t,
    yellow: (t) => t,
    red: (t) => t,
    cyan: (t) => t,
    bold: (t) => t,
    dim: (t) => t,
    ask: async (_rl, _q, _def) => {
      const answer = askAnswers[askIdx] ?? '';
      askIdx++;
      return answer;
    },
    choose: async (_rl, _q, _choices, _def) => {
      const answer = chooseAnswers[chooseIdx] ?? { index: 0, value: 'default' };
      chooseIdx++;
      return answer;
    },
    confirm: async (_rl, _q, _def) => confirmAnswer,
    createRL: () => ({
      question: (_q, cb) => cb(''),
      pause: () => {},
      resume: () => {},
      close: () => {},
    }),
  };

  Module._load = function (request, parent, isMain) {
    if (request === './prompts' && parent && parent.filename === interactivePath) {
      return mockPrompts;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const interactive = require('../src/interactive');
  return {
    interactive,
    restore() {
      delete require.cache[interactivePath];
      Module._load = originalLoad;
    },
  };
}

const baseConfig = {
  port: 3456,
  host: '127.0.0.1',
  password: null,
  useTunnel: true,
  persistedTunnel: false,
  publicTunnel: false,
  shell: '/bin/zsh',
  shellArgs: [],
  cwd: '/tmp',
  defaultShell: '/bin/zsh',
  version: '1.7.0',
  logLevel: 'info',
};

// Suppress stdout during tests
let origWrite;
let origLog;

describe('Interactive', () => {
  beforeEach(() => {
    origWrite = process.stdout.write;
    origLog = console.log;
    process.stdout.write = () => true;
    console.log = () => {};
  });

  afterEach(() => {
    process.stdout.write = origWrite;
    console.log = origLog;
  });

  it('exports runInteractiveSetup as a function', () => {
    const { runInteractiveSetup } = require('../src/interactive');
    assert.strictEqual(typeof runInteractiveSetup, 'function');
  });

  describe('password step', () => {
    it('auto-generates password when index 0 chosen', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' }, // password
          { index: 2, value: 'Localhost only' }, // access
          { index: 0, value: 'info' }, // log level
        ],
        askAnswers: ['3456'], // port
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.ok(config.password, 'password should be set');
        assert.ok(config.password.length > 10, 'should be a long random password');
      } finally {
        restore();
      }
    });

    it('uses custom password when index 1 chosen', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 1, value: 'Custom password' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['mysecret', '3456'], // password, then port
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.password, 'mysecret');
      } finally {
        restore();
      }
    });

    it('retries when custom password is empty then accepts valid one', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 1, value: 'Custom password' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['', 'actualpass', '3456'], // empty, then valid, then port
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.password, 'actualpass');
      } finally {
        restore();
      }
    });

    it('disables password when index 2 chosen', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 2, value: 'No password' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.password, null);
      } finally {
        restore();
      }
    });
  });

  describe('port step', () => {
    it('accepts a valid port', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['8080'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.port, 8080);
      } finally {
        restore();
      }
    });

    it('falls back to 3456 for invalid port (too high)', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['99999'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.port, 3456);
      } finally {
        restore();
      }
    });

    it('falls back to 3456 for invalid port (negative)', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['-5'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.port, 3456);
      } finally {
        restore();
      }
    });

    it('falls back to 3456 for non-numeric port', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['abc'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.port, 3456);
      } finally {
        restore();
      }
    });

    it('falls back to 3456 for port 0', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['0'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.port, 3456);
      } finally {
        restore();
      }
    });
  });

  describe('access step', () => {
    it('configures DevTunnel ephemeral private', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' }, // password
          { index: 0, value: 'DevTunnel (internet)' }, // access
          { index: 0, value: 'Ephemeral' }, // persistence
          { index: 0, value: 'Private (owner-only)' }, // visibility
          { index: 0, value: 'info' }, // log level
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.useTunnel, true);
        assert.strictEqual(config.persistedTunnel, false);
        assert.strictEqual(config.publicTunnel, false);
        assert.strictEqual(config.host, '127.0.0.1');
      } finally {
        restore();
      }
    });

    it('configures DevTunnel persisted public', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' }, // password (auto so public tunnel won't force re-gen)
          { index: 0, value: 'DevTunnel (internet)' }, // access
          { index: 1, value: 'Persisted' }, // persistence
          { index: 1, value: 'Public' }, // visibility
          { index: 0, value: 'info' }, // log level
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.useTunnel, true);
        assert.strictEqual(config.persistedTunnel, true);
        assert.strictEqual(config.publicTunnel, true);
      } finally {
        restore();
      }
    });

    it('auto-generates password for public tunnel with no password', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 2, value: 'No password' }, // no password
          { index: 0, value: 'DevTunnel (internet)' }, // access
          { index: 0, value: 'Ephemeral' }, // persistence
          { index: 1, value: 'Public' }, // public
          { index: 0, value: 'info' }, // log level
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.ok(config.password, 'should auto-generate password for public tunnel');
        assert.ok(config.password.length > 10);
      } finally {
        restore();
      }
    });

    it('configures LAN mode', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 1, value: 'LAN' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.host, '0.0.0.0');
        assert.strictEqual(config.useTunnel, false);
        assert.strictEqual(config.persistedTunnel, false);
        assert.strictEqual(config.publicTunnel, false);
      } finally {
        restore();
      }
    });

    it('configures Localhost only', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.host, '127.0.0.1');
        assert.strictEqual(config.useTunnel, false);
      } finally {
        restore();
      }
    });
  });

  describe('log level step', () => {
    it('sets debug log level', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 1, value: 'debug' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.strictEqual(config.logLevel, 'debug');
      } finally {
        restore();
      }
    });
  });

  describe('confirmation step', () => {
    it('returns config when user confirms', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const config = await interactive.runInteractiveSetup({ ...baseConfig });
        assert.ok(config);
        assert.strictEqual(config.shell, '/bin/zsh');
        assert.strictEqual(config.cwd, '/tmp');
      } finally {
        restore();
      }
    });

    it('exits process when user declines', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: false,
      });
      const origExit = process.exit;
      let exitCode = null;
      process.exit = (code) => {
        exitCode = code;
        throw new Error('EXIT');
      };
      try {
        await assert.rejects(() => interactive.runInteractiveSetup({ ...baseConfig }), {
          message: 'EXIT',
        });
        assert.strictEqual(exitCode, 0);
      } finally {
        process.exit = origExit;
        restore();
      }
    });
  });

  describe('config passthrough', () => {
    it('preserves base config fields not changed by wizard', async () => {
      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        const custom = { ...baseConfig, shell: '/bin/fish', cwd: '/home', version: '2.0.0' };
        const config = await interactive.runInteractiveSetup(custom);
        assert.strictEqual(config.shell, '/bin/fish');
        assert.strictEqual(config.cwd, '/home');
        assert.strictEqual(config.version, '2.0.0');
      } finally {
        restore();
      }
    });
  });

  describe('CLI command generation', () => {
    it('generates --no-password for no-password mode', async () => {
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 2, value: 'No password' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        await interactive.runInteractiveSetup({ ...baseConfig });
        const cmdLog = logs.find((l) => l.includes('termbeam') && l.includes('--no-password'));
        assert.ok(cmdLog, 'should include --no-password in CLI command');
      } finally {
        restore();
      }
    });

    it('generates --lan for LAN mode', async () => {
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 1, value: 'LAN' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        await interactive.runInteractiveSetup({ ...baseConfig });
        const cmdLog = logs.find((l) => l.includes('--lan'));
        assert.ok(cmdLog, 'should include --lan in CLI command');
      } finally {
        restore();
      }
    });

    it('generates --port for non-default port', async () => {
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['8080'],
        confirmAnswer: true,
      });
      try {
        await interactive.runInteractiveSetup({ ...baseConfig });
        const cmdLog = logs.find((l) => l.includes('--port') && l.includes('8080'));
        assert.ok(cmdLog, 'should include --port 8080 in CLI command');
      } finally {
        restore();
      }
    });

    it('generates --log-level for non-default level', async () => {
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 0, value: 'Auto-generate' },
          { index: 2, value: 'Localhost only' },
          { index: 2, value: 'warn' },
        ],
        askAnswers: ['3456'],
        confirmAnswer: true,
      });
      try {
        await interactive.runInteractiveSetup({ ...baseConfig });
        const cmdLog = logs.find((l) => l.includes('--log-level') && l.includes('warn'));
        assert.ok(cmdLog, 'should include --log-level warn in CLI command');
      } finally {
        restore();
      }
    });

    it('uses placeholder for custom password in CLI command', async () => {
      const logs = [];
      console.log = (...args) => logs.push(args.join(' '));

      const { interactive, restore } = loadInteractiveWithMocks({
        chooseAnswers: [
          { index: 1, value: 'Custom password' },
          { index: 2, value: 'Localhost only' },
          { index: 0, value: 'info' },
        ],
        askAnswers: ['s3cret!', '3456'],
        confirmAnswer: true,
      });
      try {
        await interactive.runInteractiveSetup({ ...baseConfig });
        const cmdLog = logs.find((l) => l.includes('--password'));
        assert.ok(cmdLog, 'should include --password');
        assert.ok(!cmdLog.includes('s3cret!'), 'should NOT include actual password');
        assert.ok(cmdLog.includes('<your-password>'), 'should use placeholder');
      } finally {
        restore();
      }
    });
  });
});
