const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const child_process = require('child_process');

describe('Shell Detection', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../../src/utils/shells')];
    if (os.platform() === 'win32') {
      // Mock execFileSync to avoid flaky `where` calls on Windows CI (Node 22)
      const found = {
        'cmd.exe': 'C:\\Windows\\System32\\cmd.exe',
        'powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      };
      mock.method(child_process, 'execFileSync', (cmd, args) => {
        if (cmd === 'where' && found[args[0]]) return found[args[0]] + '\n';
        throw new Error('not found');
      });
    }
  });

  afterEach(() => {
    delete require.cache[require.resolve('../../src/utils/shells')];
    mock.restoreAll();
  });

  it('should export detectShells function', () => {
    const { detectShells } = require('../../src/utils/shells');
    assert.strictEqual(typeof detectShells, 'function');
  });

  it('should return an array', () => {
    const { detectShells } = require('../../src/utils/shells');
    const shells = detectShells();
    assert.ok(Array.isArray(shells));
  });

  it('should return at least one shell', () => {
    const { detectShells } = require('../../src/utils/shells');
    const shells = detectShells();
    assert.ok(shells.length > 0, 'Expected at least one shell to be detected');
  });

  it('should return shells with name, path, and cmd properties', () => {
    const { detectShells } = require('../../src/utils/shells');
    const shells = detectShells();
    for (const shell of shells) {
      assert.ok(shell.name, 'Shell should have a name');
      assert.ok(shell.path, 'Shell should have a path');
      assert.ok(shell.cmd, 'Shell should have a cmd');
    }
  });

  it('should not return duplicate shells', () => {
    const { detectShells } = require('../../src/utils/shells');
    const shells = detectShells();
    const cmds = shells.map((s) => s.cmd);
    const unique = new Set(cmds);
    assert.strictEqual(cmds.length, unique.size, 'Detected duplicate shells');
  });

  if (os.platform() === 'win32') {
    it('should detect cmd.exe on Windows', () => {
      const { detectShells } = require('../../src/utils/shells');
      const shells = detectShells();
      const cmd = shells.find((s) => s.cmd === 'cmd.exe');
      assert.ok(cmd, 'cmd.exe should be detected on Windows');
      assert.strictEqual(cmd.name, 'Command Prompt');
    });

    it('should detect powershell on Windows', () => {
      const { detectShells } = require('../../src/utils/shells');
      const shells = detectShells();
      const ps = shells.find((s) => s.cmd === 'powershell.exe' || s.cmd === 'pwsh.exe');
      assert.ok(ps, 'PowerShell should be detected on Windows');
    });
  } else {
    it('should detect /bin/sh on Unix', () => {
      const { detectShells } = require('../../src/utils/shells');
      const shells = detectShells();
      const sh = shells.find((s) => s.name === 'sh');
      assert.ok(sh, '/bin/sh should be detected on Unix');
    });
  }
});

describe('detectUnixShells (mocked)', () => {
  let detectUnixShells;

  beforeEach(() => {
    delete require.cache[require.resolve('../../src/utils/shells')];
    // Require module BEFORE mocking fs so the loader isn't intercepted
    ({ detectUnixShells } = require('../../src/utils/shells'));
  });

  afterEach(() => {
    delete require.cache[require.resolve('../../src/utils/shells')];
    mock.restoreAll();
  });

  it('should parse /etc/shells file', () => {
    const etcShells = '# /etc/shells\n/bin/bash\n/bin/zsh\n/bin/sh\n';
    mock.method(fs, 'readFileSync', (path) => {
      if (path === '/etc/shells') return etcShells;
      throw new Error('ENOENT');
    });
    const shells = detectUnixShells();
    assert.ok(shells.length === 3);
    assert.deepStrictEqual(shells[0], { name: 'bash', path: '/bin/bash', cmd: '/bin/bash' });
    assert.deepStrictEqual(shells[1], { name: 'zsh', path: '/bin/zsh', cmd: '/bin/zsh' });
    assert.deepStrictEqual(shells[2], { name: 'sh', path: '/bin/sh', cmd: '/bin/sh' });
  });

  it('should skip comments and empty lines in /etc/shells', () => {
    const etcShells = '# Comment line\n\n/bin/bash\n# another comment\n/bin/zsh\n\n';
    mock.method(fs, 'readFileSync', (path) => {
      if (path === '/etc/shells') return etcShells;
      throw new Error('ENOENT');
    });
    const shells = detectUnixShells();
    assert.strictEqual(shells.length, 2);
    assert.strictEqual(shells[0].name, 'bash');
    assert.strictEqual(shells[1].name, 'zsh');
  });

  it('should deduplicate shells by name', () => {
    const etcShells = '/bin/bash\n/usr/local/bin/bash\n';
    mock.method(fs, 'readFileSync', (path) => {
      if (path === '/etc/shells') return etcShells;
      throw new Error('ENOENT');
    });
    const shells = detectUnixShells();
    assert.strictEqual(shells.length, 1);
    assert.strictEqual(shells[0].path, '/bin/bash');
  });

  it('should fallback to common paths when /etc/shells is unavailable', () => {
    mock.method(fs, 'readFileSync', () => {
      throw new Error('ENOENT');
    });
    const accessiblePaths = new Set(['/bin/bash', '/bin/sh']);
    mock.method(fs, 'accessSync', (p) => {
      if (!accessiblePaths.has(p)) throw new Error('ENOENT');
    });
    const shells = detectUnixShells();
    assert.strictEqual(shells.length, 2);
    assert.strictEqual(shells[0].name, 'bash');
    assert.strictEqual(shells[1].name, 'sh');
  });

  it('should return empty array when no shells are found in fallback', () => {
    mock.method(fs, 'readFileSync', () => {
      throw new Error('ENOENT');
    });
    mock.method(fs, 'accessSync', () => {
      throw new Error('ENOENT');
    });
    const shells = detectUnixShells();
    assert.strictEqual(shells.length, 0);
  });
});

describe('detectWindowsShells (mocked)', () => {
  let detectWindowsShells;

  beforeEach(() => {
    delete require.cache[require.resolve('../../src/utils/shells')];
    ({ detectWindowsShells } = require('../../src/utils/shells'));
  });

  afterEach(() => {
    delete require.cache[require.resolve('../../src/utils/shells')];
    mock.restoreAll();
  });

  it('should detect shells found by where command', () => {
    mock.method(child_process, 'execFileSync', (cmd, args) => {
      if (cmd === 'where') {
        if (args[0] === 'cmd.exe') return 'C:\\Windows\\System32\\cmd.exe\n';
        if (args[0] === 'pwsh.exe') return 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\n';
      }
      throw new Error('not found');
    });
    const shells = detectWindowsShells();
    assert.ok(shells.length >= 2, 'Should detect at least 2 shells');
    const cmd = shells.find((s) => s.cmd === 'cmd.exe');
    assert.ok(cmd, 'Should find cmd.exe');
    assert.strictEqual(cmd.name, 'Command Prompt');
    assert.strictEqual(cmd.path, 'C:\\Windows\\System32\\cmd.exe');
    const pwsh = shells.find((s) => s.cmd === 'pwsh.exe');
    assert.ok(pwsh, 'Should find pwsh.exe');
    assert.strictEqual(pwsh.name, 'PowerShell (Core)');
  });

  it('should return empty array when no shells are found', () => {
    mock.method(child_process, 'execFileSync', () => {
      throw new Error('not found');
    });
    const shells = detectWindowsShells();
    assert.strictEqual(shells.length, 0);
  });

  it('should skip shells with empty where output', () => {
    mock.method(child_process, 'execFileSync', (cmd, args) => {
      if (cmd === 'where' && args[0] === 'cmd.exe') return '  \n';
      throw new Error('not found');
    });
    const shells = detectWindowsShells();
    // 'cmd.exe' with whitespace-only path should NOT be included since '  '.trim() is empty
    // Actually, '  \n'.trim().split('\n')[0].trim() is '' which is falsy, so it should be skipped
    assert.strictEqual(shells.length, 0, 'Should skip shells with empty paths');
  });

  it('should take first path when where returns multiple paths', () => {
    mock.method(child_process, 'execFileSync', (cmd, args) => {
      if (cmd === 'where' && args[0] === 'cmd.exe') {
        return 'C:\\Windows\\System32\\cmd.exe\nC:\\Other\\cmd.exe\n';
      }
      throw new Error('not found');
    });
    const shells = detectWindowsShells();
    assert.strictEqual(shells.length, 1);
    assert.strictEqual(shells[0].path, 'C:\\Windows\\System32\\cmd.exe');
  });
});

describe('detectShells with mocked platform', () => {
  afterEach(() => {
    delete require.cache[require.resolve('../../src/utils/shells')];
    mock.restoreAll();
  });

  it('should call detectWindowsShells on win32 platform', () => {
    mock.method(os, 'platform', () => 'win32');
    mock.method(child_process, 'execFileSync', (cmd, args) => {
      if (cmd === 'where' && args[0] === 'cmd.exe') return 'C:\\Windows\\System32\\cmd.exe\n';
      throw new Error('not found');
    });
    delete require.cache[require.resolve('../../src/utils/shells')];
    const { detectShells } = require('../../src/utils/shells');
    const shells = detectShells();
    assert.ok(Array.isArray(shells));
    // On mocked win32, it should use detectWindowsShells
    const cmd = shells.find((s) => s.cmd === 'cmd.exe');
    assert.ok(cmd, 'Should detect cmd.exe on mocked Windows');
  });
});
