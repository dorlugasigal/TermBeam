const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const _fs = require('fs');
const _path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { installDevtunnel, getInstallDir } = require('../../src/tunnel/install');

describe('devtunnel-install unit', () => {
  it('should be requirable without errors', () => {
    const mod = require('../../src/tunnel/install');
    assert.ok(mod);
    assert.equal(typeof mod.installDevtunnel, 'function');
    assert.equal(typeof mod.promptInstall, 'function');
    assert.equal(typeof mod.getInstallDir, 'function');
  });

  it('getInstallDir() returns a path under home directory', () => {
    const dir = getInstallDir();
    assert.ok(dir.startsWith(os.homedir()));
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
});
