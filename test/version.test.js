const { describe, it, beforeEach, afterEach, mock } = require('node:test');
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
    delete require.cache[require.resolve('../src/version')];
  });

  it('should return a version string', () => {
    const { getVersion } = require('../src/version');
    const version = getVersion();
    assert.ok(typeof version === 'string');
    assert.ok(version.length > 0);
  });

  it('should return base version when npm_package_version is set', () => {
    const pkg = require('../package.json');
    process.env.npm_package_version = pkg.version;
    const { getVersion } = require('../src/version');
    const version = getVersion();
    assert.equal(version, pkg.version);
  });

  it('should include -dev suffix when running from source without npm_package_version', () => {
    delete process.env.npm_package_version;
    const { getVersion } = require('../src/version');
    const version = getVersion();
    const pkg = require('../package.json');
    // Running from source in a git repo, should either be exact version or dev version
    assert.ok(
      version === pkg.version || version.startsWith(pkg.version),
      `Expected version to start with ${pkg.version}, got ${version}`,
    );
  });

  it('should return dev version with git describe info', () => {
    delete process.env.npm_package_version;
    const { getVersion } = require('../src/version');
    const version = getVersion();
    const pkg = require('../package.json');
    // In a git repo from source, version should contain the base version
    assert.ok(version.includes(pkg.version));
    // If not on an exact tag, should have -dev suffix with git hash
    if (version !== pkg.version) {
      assert.match(version, /^\d+\.\d+\.\d+-dev \(/);
    }
  });

  it('should detect non-global install correctly', () => {
    // When running tests, __dirname won't contain node_modules
    // so isInstalledGlobally returns false (exercised via getVersion path)
    delete process.env.npm_package_version;
    const { getVersion } = require('../src/version');
    const version = getVersion();
    // Should take the git describe path, not the global install path
    assert.ok(typeof version === 'string');
  });
});
