const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const os = require('os');

describe('Shell Detection', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../src/shells')];
  });

  afterEach(() => {
    delete require.cache[require.resolve('../src/shells')];
  });

  it('should export detectShells function', () => {
    const { detectShells } = require('../src/shells');
    assert.strictEqual(typeof detectShells, 'function');
  });

  it('should return an array', () => {
    const { detectShells } = require('../src/shells');
    const shells = detectShells();
    assert.ok(Array.isArray(shells));
  });

  it('should return at least one shell', () => {
    const { detectShells } = require('../src/shells');
    const shells = detectShells();
    assert.ok(shells.length > 0, 'Expected at least one shell to be detected');
  });

  it('should return shells with name, path, and cmd properties', () => {
    const { detectShells } = require('../src/shells');
    const shells = detectShells();
    for (const shell of shells) {
      assert.ok(shell.name, 'Shell should have a name');
      assert.ok(shell.path, 'Shell should have a path');
      assert.ok(shell.cmd, 'Shell should have a cmd');
    }
  });

  it('should not return duplicate shells', () => {
    const { detectShells } = require('../src/shells');
    const shells = detectShells();
    const cmds = shells.map((s) => s.cmd);
    const unique = new Set(cmds);
    assert.strictEqual(cmds.length, unique.size, 'Detected duplicate shells');
  });

  if (os.platform() === 'win32') {
    it('should detect cmd.exe on Windows', () => {
      const { detectShells } = require('../src/shells');
      const shells = detectShells();
      const cmd = shells.find((s) => s.cmd === 'cmd.exe');
      assert.ok(cmd, 'cmd.exe should be detected on Windows');
      assert.strictEqual(cmd.name, 'Command Prompt');
    });

    it('should detect powershell on Windows', () => {
      const { detectShells } = require('../src/shells');
      const shells = detectShells();
      const ps = shells.find(
        (s) => s.cmd === 'powershell.exe' || s.cmd === 'pwsh.exe',
      );
      assert.ok(ps, 'PowerShell should be detected on Windows');
    });
  } else {
    it('should detect /bin/sh on Unix', () => {
      const { detectShells } = require('../src/shells');
      const shells = detectShells();
      const sh = shells.find((s) => s.name === 'sh');
      assert.ok(sh, '/bin/sh should be detected on Unix');
    });
  }
});
