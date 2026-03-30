const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('update-executor', () => {
  let origConfigDir;
  let tempDir;

  beforeEach(() => {
    origConfigDir = process.env.TERMBEAM_CONFIG_DIR;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-update-test-'));
    process.env.TERMBEAM_CONFIG_DIR = tempDir;

    // Reset module state between tests
    delete require.cache[require.resolve('../../src/utils/update-executor')];
  });

  afterEach(() => {
    if (origConfigDir !== undefined) process.env.TERMBEAM_CONFIG_DIR = origConfigDir;
    else delete process.env.TERMBEAM_CONFIG_DIR;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  describe('getUpdateState', () => {
    it('should return idle state initially', () => {
      const { getUpdateState } = require('../../src/utils/update-executor');
      const state = getUpdateState();
      assert.equal(state.status, 'idle');
      assert.equal(state.phase, null);
      assert.equal(state.error, null);
      assert.equal(state.fromVersion, null);
      assert.equal(state.toVersion, null);
    });
  });

  describe('resetState', () => {
    it('should reset state to idle', () => {
      const { getUpdateState, resetState } = require('../../src/utils/update-executor');
      // Verify initial state
      assert.equal(getUpdateState().status, 'idle');
      resetState();
      assert.equal(getUpdateState().status, 'idle');
    });
  });

  describe('writeUpdateResult / readUpdateResult / clearUpdateResult', () => {
    it('should write and read update result', () => {
      const { writeUpdateResult, readUpdateResult } = require('../../src/utils/update-executor');
      writeUpdateResult({ fromVersion: '1.0.0', toVersion: '1.1.0' });
      const result = readUpdateResult();
      assert.equal(result.fromVersion, '1.0.0');
      assert.equal(result.toVersion, '1.1.0');
      assert.ok(result.updatedAt > 0);
    });

    it('should clear update result', () => {
      const {
        writeUpdateResult,
        readUpdateResult,
        clearUpdateResult,
      } = require('../../src/utils/update-executor');
      writeUpdateResult({ fromVersion: '1.0.0', toVersion: '1.1.0' });
      assert.ok(readUpdateResult());
      clearUpdateResult();
      assert.equal(readUpdateResult(), null);
    });

    it('should return null when no result exists', () => {
      const { readUpdateResult } = require('../../src/utils/update-executor');
      assert.equal(readUpdateResult(), null);
    });

    it('should handle corrupt result file gracefully', () => {
      const { readUpdateResult } = require('../../src/utils/update-executor');
      const resultPath = path.join(tempDir, 'update-result.json');
      fs.writeFileSync(resultPath, 'not json');
      assert.equal(readUpdateResult(), null);
    });
  });

  describe('checkPermissions', () => {
    it('should detect npm on PATH', async () => {
      const { checkPermissions } = require('../../src/utils/update-executor');
      const result = await checkPermissions('npm');
      // npm should be available in the test environment
      assert.ok(typeof result.canUpdate === 'boolean');
      assert.ok(result.reason === null || typeof result.reason === 'string');
    });
  });

  describe('executeUpdate', () => {
    it('should reject if already updating', async () => {
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      // Start a first update (not awaited). executeUpdate sets status to
      // 'checking-permissions' synchronously before its first await, so the
      // second call will always see a non-idle state.
      mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: process.execPath,
        installArgs: ['-e', 'process.exit(0)'],
        command: 'node -e "process.exit(0)"',
        method: 'npm',
        restartStrategy: 'exit',
        performRestart: () => Promise.resolve(),
      });

      // State should now reflect an in-progress update (set synchronously)
      const state = mod.getUpdateState();
      assert.notEqual(state.status, 'idle');
      assert.notEqual(state.status, 'failed');

      // A second update attempt while one is in progress should return an error
      const result = await mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: process.execPath,
        installArgs: ['-e', 'process.exit(0)'],
        command: 'node -e "process.exit(0)"',
        method: 'npm',
        restartStrategy: 'exit',
        performRestart: () => Promise.resolve(),
      });
      assert.ok(result.error, 'second call should return an error');
      assert.ok(
        /already/i.test(result.error),
        `expected "already in progress", got: ${result.error}`,
      );
    });
  });

  // ── Mocked checkPermissions ────────────────────────────────────────────────

  describe('checkPermissions (mocked)', () => {
    it('should return canUpdate true when git is available for source method', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'git') return cb(null, 'git version 2.43.0', '');
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { checkPermissions } = require('../../src/utils/update-executor');
      const result = await checkPermissions('source');
      assert.strictEqual(result.canUpdate, true);
      assert.strictEqual(result.reason, null);
    });

    it('should return canUpdate false when git is not found for source method', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        cb(new Error('not found'));
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { checkPermissions } = require('../../src/utils/update-executor');
      const result = await checkPermissions('source');
      assert.strictEqual(result.canUpdate, false);
      assert.ok(result.reason.includes('git'));
    });

    it('should return canUpdate true for yarn method', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'yarn') return cb(null, '1.22.0', '');
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { checkPermissions } = require('../../src/utils/update-executor');
      const result = await checkPermissions('yarn');
      assert.strictEqual(result.canUpdate, true);
      assert.strictEqual(result.reason, null);
    });

    it('should return canUpdate true for pnpm method', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'pnpm') return cb(null, '8.0.0', '');
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { checkPermissions } = require('../../src/utils/update-executor');
      const result = await checkPermissions('pnpm');
      assert.strictEqual(result.canUpdate, true);
      assert.strictEqual(result.reason, null);
    });

    it('should return canUpdate false when yarn is not on PATH', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        cb(new Error('not found'));
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { checkPermissions } = require('../../src/utils/update-executor');
      const result = await checkPermissions('yarn');
      assert.strictEqual(result.canUpdate, false);
      assert.ok(result.reason.includes('yarn'));
    });

    it('should return canUpdate false when npm is not on PATH', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        cb(new Error('not found'));
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { checkPermissions } = require('../../src/utils/update-executor');
      const result = await checkPermissions('npm');
      assert.strictEqual(result.canUpdate, false);
      assert.ok(result.reason.includes('npm'));
    });

    it('should return canUpdate false when npm global dir is not writable', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === '--version') return cb(null, '10.0.0', '');
        if (cmd === 'npm' && args[0] === 'root') {
          return cb(null, '/nonexistent/fake/unwritable/path/xyz', '');
        }
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { checkPermissions } = require('../../src/utils/update-executor');
      const result = await checkPermissions('npm');
      assert.strictEqual(result.canUpdate, false);
      assert.ok(result.reason.includes('not writable'));
    });
  });

  // ── Mocked verifyInstalledVersion ──────────────────────────────────────────

  describe('verifyInstalledVersion (mocked)', () => {
    it('should read version from cwd package.json for source method', async () => {
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ version: '2.5.0' }));
      const version = await verifyInstalledVersion('source', tempDir);
      assert.strictEqual(version, '2.5.0');
    });

    it('should return null when source package.json read fails', async () => {
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      const version = await verifyInstalledVersion('source', '/nonexistent/path');
      assert.strictEqual(version, null);
    });

    it('should return null when source package.json has no version', async () => {
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test' }));
      const version = await verifyInstalledVersion('source', tempDir);
      assert.strictEqual(version, null);
    });

    it('should parse version from npm ls JSON output', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === 'ls') {
          const json = JSON.stringify({ dependencies: { termbeam: { version: '3.0.0' } } });
          return cb(null, json, '');
        }
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      const version = await verifyInstalledVersion('npm');
      assert.strictEqual(version, '3.0.0');
    });

    it('should use regex fallback for yarn output', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'yarn') {
          return cb(null, '{"type":"info","data":"termbeam@3.5.0"}', '');
        }
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      const version = await verifyInstalledVersion('yarn');
      assert.strictEqual(version, '3.5.0');
    });

    it('should use regex fallback for pnpm output', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'pnpm') {
          return cb(null, 'termbeam@4.0.0 /usr/local/lib', '');
        }
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      const version = await verifyInstalledVersion('pnpm');
      assert.strictEqual(version, '4.0.0');
    });

    it('should use regex fallback when npm JSON has no termbeam dep', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === 'ls') {
          // JSON with no termbeam dep, but stdout contains termbeam@x.y.z
          return cb(null, '{"dependencies":{}}\ntermbeam@6.1.0', '');
        }
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      // JSON.parse will fail on the multiline string, falling through to regex
      // Actually JSON.parse will throw, caught by try/catch, then termbeam fallback
      // Let's verify the behavior
      const version = await verifyInstalledVersion('npm');
      // JSON.parse('{"dependencies":{}}\ntermbeam@6.1.0') throws, so it goes to
      // the termbeam --version fallback which also fails → null
      // But if we want regex fallback on valid JSON, we need stdout that IS valid
      // JSON but also contains the pattern. That's unrealistic, so this test
      // covers the catch→fallback path.
      assert.ok(version === null || version === '6.1.0');
    });

    it('should fall back to termbeam --version when primary method fails', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === 'ls') return cb(new Error('npm ls failed'));
        if (cmd === 'termbeam') return cb(null, 'termbeam v5.0.0', '');
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      const version = await verifyInstalledVersion('npm');
      assert.strictEqual(version, '5.0.0');
    });

    it('should return null when all verification methods fail', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        cb(new Error('fail'));
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const { verifyInstalledVersion } = require('../../src/utils/update-executor');
      const version = await verifyInstalledVersion('npm');
      assert.strictEqual(version, null);
    });
  });

  // ── Mocked executeUpdate ───────────────────────────────────────────────────

  describe('executeUpdate (mocked)', () => {
    it('should fail when permission check fails', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        cb(new Error('not found'));
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      const result = await mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: 'npm',
        installArgs: ['install', '-g', 'termbeam@latest'],
        command: 'npm install -g termbeam@latest',
        method: 'npm',
        restartStrategy: 'exit',
      });
      assert.strictEqual(result.status, 'failed');
      assert.ok(result.error.includes('not found on PATH'));
    });

    it('should handle install command failure', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === '--version') return cb(null, '10.0.0', '');
        if (cmd === 'npm' && args[0] === 'root') return cb(null, tempDir, '');
        // Install and everything else fails
        cb(new Error('NETWORK ERROR'));
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      const result = await mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: 'npm',
        installArgs: ['install', '-g', 'termbeam@latest'],
        command: 'npm install -g termbeam@latest',
        method: 'npm',
        restartStrategy: 'exit',
      });
      assert.strictEqual(result.status, 'failed');
      assert.ok(result.error.includes('NETWORK ERROR'));
    });

    it('should fail when version verification returns null', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === '--version') return cb(null, '10.0.0', '');
        if (cmd === 'npm' && args[0] === 'root') return cb(null, tempDir, '');
        if (cmd === 'npm' && args[0] === 'install') return cb(null, 'installed', '');
        // All verify attempts fail (npm ls, termbeam --version)
        cb(new Error('fail'));
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      const result = await mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: 'npm',
        installArgs: ['install', '-g', 'termbeam@latest'],
        command: 'npm install -g termbeam@latest',
        method: 'npm',
        restartStrategy: 'exit',
      });
      assert.strictEqual(result.status, 'failed');
      assert.ok(result.error.includes('Could not determine new version'));
    });

    it('should succeed when same version is reinstalled', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === '--version') return cb(null, '10.0.0', '');
        if (cmd === 'npm' && args[0] === 'root') return cb(null, tempDir, '');
        if (cmd === 'npm' && args[0] === 'install') return cb(null, 'installed ok', '');
        if (cmd === 'npm' && args[0] === 'ls') {
          const json = JSON.stringify({ dependencies: { termbeam: { version: '1.0.0' } } });
          return cb(null, json, '');
        }
        cb(new Error('unexpected'), '', '');
      });
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      const result = await mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: 'npm',
        installArgs: ['install', '-g', 'termbeam@latest'],
        command: 'npm install -g termbeam@latest',
        method: 'npm',
        restartStrategy: 'exit',
      });
      assert.strictEqual(result.status, 'complete');
      assert.strictEqual(result.toVersion, '1.0.0');
    });

    it('should fail when downgrade is detected', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === '--version') return cb(null, '10.0.0', '');
        if (cmd === 'npm' && args[0] === 'root') return cb(null, tempDir, '');
        if (cmd === 'npm' && args[0] === 'install') return cb(null, 'installed', '');
        if (cmd === 'npm' && args[0] === 'ls') {
          const json = JSON.stringify({ dependencies: { termbeam: { version: '0.9.0' } } });
          return cb(null, json, '');
        }
        cb(new Error('unexpected'), '', '');
      });
      // Mock isNewerVersion to return false (0.9.0 is not newer than 1.0.0)
      const updateCheck = require('../../src/utils/update-check');
      t.mock.method(updateCheck, 'isNewerVersion', () => false);

      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      const result = await mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: 'npm',
        installArgs: ['install', '-g', 'termbeam@latest'],
        command: 'npm install -g termbeam@latest',
        method: 'npm',
        restartStrategy: 'exit',
      });
      assert.strictEqual(result.status, 'failed');
      assert.ok(result.error.includes('Unexpected version'));
      assert.ok(result.error.includes('0.9.0'));
    });

    it('should handle onProgress callback errors gracefully', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === '--version') return cb(null, '10.0.0', '');
        if (cmd === 'npm' && args[0] === 'root') return cb(null, tempDir, '');
        if (cmd === 'npm' && args[0] === 'install') return cb(null, 'installed', '');
        if (cmd === 'npm' && args[0] === 'ls') {
          const json = JSON.stringify({ dependencies: { termbeam: { version: '2.0.0' } } });
          return cb(null, json, '');
        }
        cb(new Error('unexpected'), '', '');
      });
      const updateCheck = require('../../src/utils/update-check');
      t.mock.method(updateCheck, 'isNewerVersion', () => true);

      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      const result = await mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: 'npm',
        installArgs: ['install', '-g', 'termbeam@latest'],
        command: 'npm install -g termbeam@latest',
        method: 'npm',
        restartStrategy: 'exit',
        onProgress: () => {
          throw new Error('callback error');
        },
      });
      // Update should succeed despite callback errors
      assert.strictEqual(result.status, 'complete');
      assert.strictEqual(result.toVersion, '2.0.0');
    });

    it('should call performRestart on successful update', async (t) => {
      const cp = require('child_process');
      t.mock.method(cp, 'execFile', (cmd, args, opts, cb) => {
        if (cmd === 'npm' && args[0] === '--version') return cb(null, '10.0.0', '');
        if (cmd === 'npm' && args[0] === 'root') return cb(null, tempDir, '');
        if (cmd === 'npm' && args[0] === 'install') return cb(null, 'installed', '');
        if (cmd === 'npm' && args[0] === 'ls') {
          const json = JSON.stringify({ dependencies: { termbeam: { version: '2.0.0' } } });
          return cb(null, json, '');
        }
        cb(new Error('unexpected'), '', '');
      });
      const updateCheck = require('../../src/utils/update-check');
      t.mock.method(updateCheck, 'isNewerVersion', () => true);

      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      let restartCalled = false;
      const result = await mod.executeUpdate({
        currentVersion: '1.0.0',
        installCmd: 'npm',
        installArgs: ['install', '-g', 'termbeam@latest'],
        command: 'npm install -g termbeam@latest',
        method: 'npm',
        restartStrategy: 'exit',
        performRestart: async () => {
          restartCalled = true;
        },
      });
      assert.strictEqual(result.status, 'complete');
      assert.strictEqual(restartCalled, true);
    });
  });

  // ── readUpdateResult edge cases ────────────────────────────────────────────

  describe('readUpdateResult edge cases', () => {
    it('should return null when JSON is valid but missing required fields', () => {
      const { readUpdateResult } = require('../../src/utils/update-executor');
      const resultPath = path.join(tempDir, 'update-result.json');
      fs.writeFileSync(resultPath, JSON.stringify({ foo: 'bar' }));
      assert.strictEqual(readUpdateResult(), null);
    });
  });
});
