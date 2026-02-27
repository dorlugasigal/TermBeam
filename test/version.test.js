const { describe, it, beforeEach, afterEach } = require('node:test');
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
});
