const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');

const {
  installDevtunnel,
  getInstallDir,
  stripQuarantine,
  resolveBinaryPath,
  hasQuarantine,
} = require('../../src/tunnel/install');

describe('devtunnel-install unit', () => {
  it('should be requirable without errors', () => {
    const mod = require('../../src/tunnel/install');
    assert.ok(mod);
    assert.equal(typeof mod.installDevtunnel, 'function');
    assert.equal(typeof mod.promptInstall, 'function');
    assert.equal(typeof mod.getInstallDir, 'function');
    assert.equal(typeof mod.stripQuarantine, 'function');
    assert.equal(typeof mod.resolveBinaryPath, 'function');
    assert.equal(typeof mod.hasQuarantine, 'function');
  });

  it('getInstallDir() returns a path under home directory', () => {
    const dir = getInstallDir();
    assert.ok(dir.startsWith(os.homedir()));
  });
});

describe('resolveBinaryPath', () => {
  it('returns null for empty / undefined input', () => {
    assert.equal(resolveBinaryPath(''), null);
    assert.equal(resolveBinaryPath(null), null);
    assert.equal(resolveBinaryPath(undefined), null);
  });

  it('returns null for non-existent absolute path', () => {
    assert.equal(resolveBinaryPath('/definitely/does/not/exist/devtunnel'), null);
  });

  it('returns the realpath for an existing absolute path', () => {
    // process.execPath is always present and absolute
    const r = resolveBinaryPath(process.execPath);
    assert.ok(r);
    assert.equal(typeof r, 'string');
    assert.ok(path.isAbsolute(r));
  });

  it('resolves a bare command name via $PATH', () => {
    // node was used to run this test, so it must be on PATH
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    const r = resolveBinaryPath(nodeName);
    assert.ok(r, `expected to find ${nodeName} on PATH`);
    assert.ok(path.isAbsolute(r));
    assert.ok(fs.existsSync(r));
  });

  it('returns null for a bare name that is not on $PATH', () => {
    assert.equal(resolveBinaryPath('absolutely-not-a-real-binary-name-xyz-123'), null);
  });
});

describe('hasQuarantine', () => {
  it('returns false on non-darwin platforms', () => {
    if (process.platform === 'darwin') return;
    assert.equal(hasQuarantine(process.execPath), false);
    assert.equal(hasQuarantine('/some/path'), false);
  });

  it('returns false for empty input', () => {
    assert.equal(hasQuarantine(''), false);
    assert.equal(hasQuarantine(null), false);
    assert.equal(hasQuarantine(undefined), false);
  });

  it('returns false for a file with no quarantine attribute', () => {
    if (process.platform !== 'darwin') return;
    // Create a fresh temp file — by default it has no xattrs
    const tmp = path.join(os.tmpdir(), `tb-noquarantine-${Date.now()}`);
    fs.writeFileSync(tmp, 'x');
    try {
      assert.equal(hasQuarantine(tmp), false);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('returns true after we manually attach the quarantine attribute', () => {
    if (process.platform !== 'darwin') return;
    const tmp = path.join(os.tmpdir(), `tb-hasquarantine-${Date.now()}`);
    fs.writeFileSync(tmp, 'x');
    try {
      execFileSync('xattr', ['-w', 'com.apple.quarantine', '0001;0;TermBeamTest;', tmp]);
      assert.equal(hasQuarantine(tmp), true);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  });
});

describe('stripQuarantine', () => {
  it('returns "noop" for empty input', () => {
    assert.equal(stripQuarantine(''), 'noop');
    assert.equal(stripQuarantine(null), 'noop');
    assert.equal(stripQuarantine(undefined), 'noop');
  });

  it('returns "noop" on non-darwin platforms', () => {
    if (process.platform === 'darwin') return;
    assert.equal(stripQuarantine('/some/path'), 'noop');
    assert.equal(stripQuarantine('node'), 'noop');
  });

  it('returns "noop" for a file without quarantine attribute (darwin)', () => {
    if (process.platform !== 'darwin') return;
    const tmp = path.join(os.tmpdir(), `tb-strip-noop-${Date.now()}`);
    fs.writeFileSync(tmp, 'x');
    try {
      assert.equal(stripQuarantine(tmp), 'noop');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('returns "stripped" when the attribute is present and removable (darwin)', () => {
    if (process.platform !== 'darwin') return;
    const tmp = path.join(os.tmpdir(), `tb-strip-real-${Date.now()}`);
    fs.writeFileSync(tmp, 'x');
    try {
      execFileSync('xattr', ['-w', 'com.apple.quarantine', '0001;0;TermBeamTest;', tmp]);
      assert.equal(hasQuarantine(tmp), true);
      const result = stripQuarantine(tmp);
      assert.equal(result, 'stripped');
      assert.equal(hasQuarantine(tmp), false);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  });

  it('handles a bare command name via PATH resolution (darwin)', () => {
    if (process.platform !== 'darwin') return;
    // 'node' is on PATH — should resolve and report noop (system node has no
    // quarantine attribute). The key point: this must not throw.
    const result = stripQuarantine('node');
    assert.ok(['noop', 'stripped', 'failed'].includes(result));
  });
});

describe('devtunnel auto-install integration', { timeout: 120000 }, () => {
  it('should install devtunnel and produce a working binary', async () => {
    const result = await installDevtunnel();
    assert.ok(result !== null, 'installDevtunnel() returned null — install may have failed');
    assert.equal(typeof result, 'string');

    // Verify the binary is accessible
    const cmd = result === 'devtunnel' ? 'devtunnel' : result;
    const version = execSync(`${cmd} --version`, { encoding: 'utf-8', timeout: 10000 });
    assert.ok(version.length > 0, 'devtunnel --version produced no output');
    assert.ok(version.toLowerCase().includes('tunnel'), 'version output does not mention tunnel');
  });

  it('install leaves the resolved binary free of quarantine on darwin', () => {
    if (process.platform !== 'darwin') return;
    const resolved = resolveBinaryPath('devtunnel');
    if (!resolved) return; // devtunnel not installed in this environment
    assert.equal(
      hasQuarantine(resolved),
      false,
      `devtunnel binary at ${resolved} still has com.apple.quarantine after install`,
    );
  });
});
