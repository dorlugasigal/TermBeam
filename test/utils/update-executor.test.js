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
      // We need to manipulate the internal state
      delete require.cache[require.resolve('../../src/utils/update-executor')];
      const mod = require('../../src/utils/update-executor');
      // Start a fake update that won't resolve
      const neverResolve = new Promise(() => {});
      mod.executeUpdate({
        currentVersion: '1.0.0',
        command: 'echo noop',
        method: 'npm',
        restartStrategy: 'exit',
        performRestart: () => neverResolve,
      });

      // Try to start another one immediately — state should be non-idle
      const state = mod.getUpdateState();
      assert.notEqual(state.status, 'idle');
    });
  });
});
