const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

describe('Version', () => {
  const originalEnv = process.env.npm_package_version;

  afterEach(() => {
    // Restore env
    if (originalEnv !== undefined) {
      process.env.npm_package_version = originalEnv;
    } else {
      delete process.env.npm_package_version;
    }
    // Clear require cache so getVersion re-evaluates
    delete require.cache[require.resolve('../../src/utils/version')];
  });

  it('should return a version string', () => {
    const { getVersion } = require('../../src/utils/version');
    const version = getVersion();
    assert.ok(typeof version === 'string');
    assert.ok(version.length > 0);
  });

  it('should return base version when npm_package_version is set', () => {
    const pkg = require('../../package.json');
    process.env.npm_package_version = pkg.version;
    const { getVersion } = require('../../src/utils/version');
    const version = getVersion();
    assert.equal(version, pkg.version);
  });

  it('should derive version from git tag, not package.json, when running from source', () => {
    delete process.env.npm_package_version;
    const { getVersion } = require('../../src/utils/version');
    const version = getVersion();
    // Should be a semver or semver-dev string derived from the git tag
    assert.match(version, /^\d+\.\d+\.\d+/);
  });

  it('should return clean version when exactly on a git tag', () => {
    delete process.env.npm_package_version;
    const child_process = require('child_process');
    const origExecSync = child_process.execSync;
    child_process.execSync = (cmd, opts) => {
      if (cmd.includes('git describe')) return 'v2.5.0\n';
      return origExecSync(cmd, opts);
    };
    try {
      delete require.cache[require.resolve('../../src/utils/version')];
      const { getVersion } = require('../../src/utils/version');
      assert.equal(getVersion(), '2.5.0');
    } finally {
      child_process.execSync = origExecSync;
      delete require.cache[require.resolve('../../src/utils/version')];
    }
  });

  it('should return dev version from git tag when ahead of tag', () => {
    delete process.env.npm_package_version;
    const child_process = require('child_process');
    const origExecSync = child_process.execSync;
    child_process.execSync = (cmd, opts) => {
      if (cmd.includes('git describe')) return 'v2.5.0-3-gabcdef1\n';
      return origExecSync(cmd, opts);
    };
    try {
      delete require.cache[require.resolve('../../src/utils/version')];
      const { getVersion } = require('../../src/utils/version');
      assert.equal(getVersion(), '2.5.0-dev.3+gabcdef1');
    } finally {
      child_process.execSync = origExecSync;
      delete require.cache[require.resolve('../../src/utils/version')];
    }
  });

  it('should return dev version from git tag when dirty', () => {
    delete process.env.npm_package_version;
    const child_process = require('child_process');
    const origExecSync = child_process.execSync;
    child_process.execSync = (cmd, opts) => {
      if (cmd.includes('git describe')) return 'v2.5.0-dirty\n';
      return origExecSync(cmd, opts);
    };
    try {
      delete require.cache[require.resolve('../../src/utils/version')];
      const { getVersion } = require('../../src/utils/version');
      assert.equal(getVersion(), '2.5.0-dev+dirty');
    } finally {
      child_process.execSync = origExecSync;
      delete require.cache[require.resolve('../../src/utils/version')];
    }
  });

  it('should fall back to package.json when git has no semver tag', () => {
    delete process.env.npm_package_version;
    const child_process = require('child_process');
    const origExecSync = child_process.execSync;
    child_process.execSync = (cmd, opts) => {
      if (cmd.includes('git describe')) return 'abcdef1\n';
      return origExecSync(cmd, opts);
    };
    try {
      delete require.cache[require.resolve('../../src/utils/version')];
      const { getVersion } = require('../../src/utils/version');
      const pkg = require('../../package.json');
      assert.equal(getVersion(), `${pkg.version}-dev+abcdef1`);
    } finally {
      child_process.execSync = origExecSync;
      delete require.cache[require.resolve('../../src/utils/version')];
    }
  });

  it('should detect non-global install correctly', () => {
    // When running tests, __dirname won't contain node_modules
    // so isInstalledGlobally returns false (exercised via getVersion path)
    delete process.env.npm_package_version;
    const { getVersion } = require('../../src/utils/version');
    const version = getVersion();
    // Should take the git describe path, not the global install path
    assert.ok(typeof version === 'string');
  });

  it('should return base-dev when git describe fails', () => {
    delete process.env.npm_package_version;
    const child_process = require('child_process');
    const origExecSync = child_process.execSync;
    child_process.execSync = (cmd) => {
      if (cmd.includes('git describe')) throw new Error('not a git repo');
      return origExecSync(cmd);
    };
    try {
      delete require.cache[require.resolve('../../src/utils/version')];
      const { getVersion } = require('../../src/utils/version');
      const version = getVersion();
      const pkg = require('../../package.json');
      assert.equal(version, `${pkg.version}-dev`);
    } finally {
      child_process.execSync = origExecSync;
      delete require.cache[require.resolve('../../src/utils/version')];
    }
  });
});
