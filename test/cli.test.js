const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

describe('CLI', () => {
  let originalArgv, originalEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = { ...process.env };
    // Clean env vars that affect parsing
    delete process.env.TERMBEAM_PASSWORD;
    delete process.env.TERMBEAM_CWD;
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
    assert.strictEqual(config.host, '0.0.0.0');
    assert.strictEqual(config.password, null);
    assert.strictEqual(config.useTunnel, false);
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
});
