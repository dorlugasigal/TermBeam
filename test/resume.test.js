const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

describe('resume', () => {
  let resume;
  const CONNECTION_FILE = path.join(os.homedir(), '.termbeam', 'connection.json');
  let savedConfig = null;

  beforeEach(() => {
    // Save existing connection config if present
    try {
      savedConfig = fs.readFileSync(CONNECTION_FILE, 'utf8');
    } catch {
      savedConfig = null;
    }

    // Clear module cache
    const resumePath = require.resolve('../src/resume');
    delete require.cache[resumePath];
    resume = require('../src/resume');
  });

  afterEach(() => {
    // Restore connection config
    if (savedConfig) {
      fs.writeFileSync(CONNECTION_FILE, savedConfig);
    } else {
      try {
        fs.unlinkSync(CONNECTION_FILE);
      } catch {
        /* ignore */
      }
    }
  });

  describe('writeConnectionConfig / readConnectionConfig', () => {
    it('should write and read connection config', () => {
      resume.writeConnectionConfig({ port: 4000, host: 'localhost', password: 'test123' });

      const config = resume.readConnectionConfig();
      assert.equal(config.port, 4000);
      assert.equal(config.host, 'localhost');
      assert.equal(config.password, 'test123');
    });

    it('should write config with restrictive permissions', () => {
      resume.writeConnectionConfig({ port: 3456, host: 'localhost', password: 'pw' });

      const stat = fs.statSync(CONNECTION_FILE);
      // On Unix, check mode is 0o600 (owner read/write only)
      if (process.platform !== 'win32') {
        const mode = stat.mode & 0o777;
        assert.equal(mode, 0o600, `Expected 0600 permissions, got ${mode.toString(8)}`);
      }
    });

    it('should handle null password', () => {
      resume.writeConnectionConfig({ port: 3456, host: 'localhost', password: null });

      const config = resume.readConnectionConfig();
      assert.equal(config.password, null);
    });
  });

  describe('removeConnectionConfig', () => {
    it('should remove connection config file', () => {
      resume.writeConnectionConfig({ port: 3456, host: 'localhost', password: 'pw' });
      assert.ok(fs.existsSync(CONNECTION_FILE));

      resume.removeConnectionConfig();
      assert.ok(!fs.existsSync(CONNECTION_FILE));
    });

    it('should not throw when file does not exist', () => {
      resume.removeConnectionConfig();
      assert.doesNotThrow(() => resume.removeConnectionConfig());
    });
  });

  describe('readConnectionConfig', () => {
    it('should return null when no config file exists', () => {
      resume.removeConnectionConfig();
      const config = resume.readConnectionConfig();
      assert.equal(config, null);
    });

    it('should return null for invalid JSON', () => {
      fs.mkdirSync(path.dirname(CONNECTION_FILE), { recursive: true });
      fs.writeFileSync(CONNECTION_FILE, 'not json');
      const config = resume.readConnectionConfig();
      assert.equal(config, null);
    });
  });

  describe('printResumeHelp', () => {
    it('should not throw', () => {
      assert.doesNotThrow(() => resume.printResumeHelp());
    });
  });

  describe('resume with --help', () => {
    it('should print help and return', async () => {
      // Should not throw or exit
      await resume.resume(['--help']);
    });
  });

  describe('listSessions with --help', () => {
    it('should print help and return', async () => {
      await resume.listSessions(['--help']);
    });
  });

  describe('resume with ECONNREFUSED', () => {
    it('should exit with error when server is not running', async () => {
      // Use a port that's almost certainly not in use
      const exitMock = { called: false, code: null };
      const origExit = process.exit;
      process.exit = (code) => {
        exitMock.called = true;
        exitMock.code = code;
        throw new Error('process.exit called');
      };

      try {
        await resume.resume(['--port', '19999', '--host', 'localhost']);
      } catch (err) {
        assert.equal(err.message, 'process.exit called');
      } finally {
        process.exit = origExit;
      }

      assert.ok(exitMock.called);
      assert.equal(exitMock.code, 1);
    });
  });
});
