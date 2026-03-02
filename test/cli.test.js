const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');

describe('CLI', () => {
  let originalArgv, originalEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = { ...process.env };
    // Clean env vars that affect parsing
    delete process.env.TERMBEAM_PASSWORD;
    delete process.env.TERMBEAM_CWD;
    delete process.env.TERMBEAM_LOG_LEVEL;
    delete process.env.PTY_PASSWORD;
    delete process.env.PTY_CWD;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    // Clear require cache so parseArgs re-reads argv
    delete require.cache[require.resolve('../src/cli')];
  });

  it('should return defaults with no args', () => {
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.port, 3456);
    assert.strictEqual(config.host, '127.0.0.1');
    assert.ok(config.password, 'should auto-generate password by default');
    assert.ok(config.password.length > 10, 'auto-generated password should be long');
    assert.strictEqual(config.useTunnel, true);
  });

  it('should parse --password flag', () => {
    process.argv = ['node', 'termbeam', '--password', 'secret123'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, 'secret123');
  });

  it('should parse --password= syntax', () => {
    process.argv = ['node', 'termbeam', '--password=mysecret'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, 'mysecret');
  });

  it('should parse --port flag', () => {
    process.argv = ['node', 'termbeam', '--port', '8080'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.port, 8080);
  });

  it('should parse --host flag', () => {
    process.argv = ['node', 'termbeam', '--host', '0.0.0.0'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.host, '0.0.0.0');
  });

  it('should parse --tunnel flag', () => {
    process.argv = ['node', 'termbeam', '--tunnel'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.useTunnel, true);
  });

  it('should generate password with --generate-password', () => {
    process.argv = ['node', 'termbeam', '--generate-password'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.ok(config.password);
    assert.ok(config.password.length > 10);
  });

  it('should use positional arg as shell', () => {
    process.argv = ['node', 'termbeam', '/bin/bash'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.shell, '/bin/bash');
  });

  it('should read TERMBEAM_PASSWORD from env', () => {
    process.env.TERMBEAM_PASSWORD = 'envpass';
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, 'envpass');
  });

  it('should read PORT from env', () => {
    process.env.PORT = '9999';
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.port, 9999);
  });

  it('should parse --persisted-tunnel flag', () => {
    process.argv = ['node', 'termbeam', '--persisted-tunnel'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.persistedTunnel, true);
    assert.strictEqual(config.useTunnel, true);
  });

  it('should default persistedTunnel to false', () => {
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.persistedTunnel, false);
  });

  it('should combine multiple flags', () => {
    process.argv = [
      'node',
      'termbeam',
      '--password',
      'pw',
      '--port',
      '5000',
      '--tunnel',
      '/bin/sh',
    ];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, 'pw');
    assert.strictEqual(config.port, 5000);
    assert.strictEqual(config.useTunnel, true);
    assert.strictEqual(config.shell, '/bin/sh');
  });

  it('should read TERMBEAM_CWD from env', () => {
    process.env.TERMBEAM_CWD = '/tmp/mydir';
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.cwd, '/tmp/mydir');
  });

  it('should read PTY_CWD as legacy fallback', () => {
    process.env.PTY_CWD = '/tmp/legacy';
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.cwd, '/tmp/legacy');
  });

  it('should prefer TERMBEAM_CWD over PTY_CWD', () => {
    process.env.TERMBEAM_CWD = '/tmp/new';
    process.env.PTY_CWD = '/tmp/old';
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.cwd, '/tmp/new');
  });

  it('should read PTY_PASSWORD as legacy fallback', () => {
    process.env.PTY_PASSWORD = 'legacypw';
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, 'legacypw');
  });

  it('should prefer TERMBEAM_PASSWORD over PTY_PASSWORD', () => {
    process.env.TERMBEAM_PASSWORD = 'newpw';
    process.env.PTY_PASSWORD = 'oldpw';
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, 'newpw');
  });

  it('should pass shell args after positional shell', () => {
    process.argv = ['node', 'termbeam', '/bin/bash', '-l', '-i'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.shell, '/bin/bash');
    assert.deepStrictEqual(config.shellArgs, ['-l', '-i']);
  });

  it('should return a version string', () => {
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.ok(config.version);
    assert.strictEqual(typeof config.version, 'string');
  });

  it('should return defaultShell in config', () => {
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.ok(config.defaultShell);
    assert.strictEqual(typeof config.defaultShell, 'string');
  });

  it('should use cwd from process.cwd() when no env set', () => {
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.cwd, process.cwd());
  });

  it('printHelp should output help text', () => {
    const lines = [];
    const origLog = console.log;
    console.log = (msg) => lines.push(msg);
    try {
      const { printHelp } = require('../src/cli');
      printHelp();
      const output = lines.join('\n');
      assert.ok(output.includes('termbeam'), 'Should mention termbeam');
      assert.ok(output.includes('--password'), 'Should mention --password flag');
      assert.ok(output.includes('--tunnel'), 'Should mention --tunnel flag');
      assert.ok(output.includes('--port'), 'Should mention --port flag');
      assert.ok(output.includes('--host'), 'Should mention --host flag');
      assert.ok(output.includes('--generate-password'), 'Should mention --generate-password');
      assert.ok(output.includes('TERMBEAM_PASSWORD'), 'Should mention TERMBEAM_PASSWORD env');
      assert.ok(output.includes('TERMBEAM_CWD'), 'Should mention TERMBEAM_CWD env');
    } finally {
      console.log = origLog;
    }
  });

  it('--password flag should override env password', () => {
    process.env.TERMBEAM_PASSWORD = 'envpw';
    process.argv = ['node', 'termbeam', '--password', 'flagpw'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, 'flagpw');
  });

  it('should parse --lan flag', () => {
    process.argv = ['node', 'termbeam', '--lan'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.host, '0.0.0.0');
  });

  it('--host should override --lan', () => {
    process.argv = ['node', 'termbeam', '--lan', '--host', '192.168.1.1'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.host, '192.168.1.1');
  });

  it('should parse --no-tunnel flag', () => {
    process.argv = ['node', 'termbeam', '--no-tunnel'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.useTunnel, false);
  });

  it('should parse --no-password flag', () => {
    process.argv = ['node', 'termbeam', '--no-password'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, null);
  });

  it('--no-tunnel should override default tunnel', () => {
    process.argv = ['node', 'termbeam', '--no-tunnel'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.useTunnel, false);
  });

  it('--no-password should disable auto-generated password', () => {
    process.argv = ['node', 'termbeam', '--no-password'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.password, null);
    assert.strictEqual(config.useTunnel, true);
  });

  it('should parse --log-level flag', () => {
    process.argv = ['node', 'termbeam', '--log-level', 'debug'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.logLevel, 'debug');
  });

  it('should default logLevel to info', () => {
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.logLevel, 'info');
  });

  it('should read TERMBEAM_LOG_LEVEL from env', () => {
    process.env.TERMBEAM_LOG_LEVEL = 'warn';
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.logLevel, 'warn');
  });

  it('should parse --allow-fs-browse-root flag', () => {
    process.argv = ['node', 'termbeam', '--allow-fs-browse-root'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.allowFsBrowseRoot, true);
  });

  it('should default allowFsBrowseRoot to false', () => {
    process.argv = ['node', 'termbeam'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.allowFsBrowseRoot, false);
  });

  it('--log-level flag should override TERMBEAM_LOG_LEVEL env', () => {
    process.env.TERMBEAM_LOG_LEVEL = 'error';
    process.argv = ['node', 'termbeam', '--log-level', 'debug'];
    const { parseArgs } = require('../src/cli');
    const config = parseArgs();
    assert.strictEqual(config.logLevel, 'debug');
  });

  it('printHelp should mention --log-level and TERMBEAM_LOG_LEVEL', () => {
    const lines = [];
    const origLog = console.log;
    console.log = (msg) => lines.push(msg);
    try {
      const { printHelp } = require('../src/cli');
      printHelp();
      const output = lines.join('\n');
      assert.ok(output.includes('--log-level'), 'Should mention --log-level flag');
      assert.ok(output.includes('TERMBEAM_LOG_LEVEL'), 'Should mention TERMBEAM_LOG_LEVEL env');
    } finally {
      console.log = origLog;
    }
  });

  it('--public --no-password should exit with error', () => {
    process.argv = ['node', 'termbeam', '--public', '--no-password'];
    const exitCalls = [];
    const errorMessages = [];
    const origExit = process.exit;
    const origError = console.error;
    process.exit = (code) => exitCalls.push(code);
    console.error = (msg) => errorMessages.push(msg);
    try {
      const { parseArgs } = require('../src/cli');
      parseArgs();
      assert.ok(exitCalls.includes(1), 'Should call process.exit(1)');
      assert.ok(
        errorMessages.some((m) => m.includes('Public tunnels require password')),
        'Should mention public tunnels require password',
      );
    } finally {
      process.exit = origExit;
      console.error = origError;
    }
  });

  it('--public with password should work without error', () => {
    process.argv = ['node', 'termbeam', '--public', '--password', 'secret'];
    const exitCalls = [];
    const origExit = process.exit;
    process.exit = (code) => exitCalls.push(code);
    try {
      const { parseArgs } = require('../src/cli');
      const config = parseArgs();
      assert.strictEqual(config.publicTunnel, true);
      assert.strictEqual(config.password, 'secret');
      assert.ok(!exitCalls.includes(1), 'Should not exit with error when password is provided');
    } finally {
      process.exit = origExit;
    }
  });

  it('--public with auto-generated password should work without error', () => {
    process.argv = ['node', 'termbeam', '--public'];
    const exitCalls = [];
    const origExit = process.exit;
    process.exit = (code) => exitCalls.push(code);
    try {
      const { parseArgs } = require('../src/cli');
      const config = parseArgs();
      assert.strictEqual(config.publicTunnel, true);
      assert.ok(config.password, 'Should have auto-generated password');
      assert.ok(
        !exitCalls.includes(1),
        'Should not exit with error when password is auto-generated',
      );
    } finally {
      process.exit = origExit;
    }
  });

  describe('isKnownShell', () => {
    it('should recognize common shells', () => {
      const { isKnownShell } = require('../src/cli');
      assert.ok(isKnownShell('bash'), 'bash should be a known shell');
      assert.ok(isKnownShell('zsh'), 'zsh should be a known shell');
      assert.ok(isKnownShell('sh'), 'sh should be a known shell');
      assert.ok(isKnownShell('fish'), 'fish should be a known shell');
      assert.ok(isKnownShell('dash'), 'dash should be a known shell');
      assert.ok(isKnownShell('/bin/bash'), '/bin/bash should be a known shell');
      assert.ok(isKnownShell('/bin/zsh'), '/bin/zsh should be a known shell');
    });

    it('should reject non-shell process names', () => {
      const { isKnownShell } = require('../src/cli');
      assert.ok(!isKnownShell('node'), 'node is not a shell');
      assert.ok(!isKnownShell('npm'), 'npm is not a shell');
      assert.ok(!isKnownShell('npm exec termbeam@latest'), 'npm command is not a shell');
      assert.ok(!isKnownShell('python3'), 'python3 is not a shell');
      assert.ok(!isKnownShell('code'), 'code is not a shell');
      assert.ok(!isKnownShell(''), 'empty string is not a shell');
      assert.ok(!isKnownShell(null), 'null is not a shell');
    });
  });
});
