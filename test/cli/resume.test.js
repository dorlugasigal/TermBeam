const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');

describe('resume', () => {
  let resume;
  let tempDir;
  let CONNECTION_FILE;
  let savedTermbeamSession;

  beforeEach(() => {
    // Save and clear TERMBEAM_SESSION so resume() doesn't bail out
    savedTermbeamSession = process.env.TERMBEAM_SESSION;
    delete process.env.TERMBEAM_SESSION;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-test-'));
    process.env.TERMBEAM_CONFIG_DIR = tempDir;
    CONNECTION_FILE = path.join(tempDir, 'connection.json');

    // Clear module cache so resume picks up the new env var
    const resumePath = require.resolve('../../src/cli/resume');
    delete require.cache[resumePath];
    resume = require('../../src/cli/resume');
  });

  afterEach(() => {
    // Restore TERMBEAM_SESSION
    if (savedTermbeamSession !== undefined) {
      process.env.TERMBEAM_SESSION = savedTermbeamSession;
    } else {
      delete process.env.TERMBEAM_SESSION;
    }
    delete process.env.TERMBEAM_CONFIG_DIR;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
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

  describe('parseDetachKey', () => {
    it('should parse \\xNN hex escape', () => {
      assert.equal(resume.parseDetachKey('\\x01'), '\x01');
      assert.equal(resume.parseDetachKey('\\x02'), '\x02');
      assert.equal(resume.parseDetachKey('\\x1a'), '\x1a');
    });

    it('should parse ^X caret notation', () => {
      assert.equal(resume.parseDetachKey('^A'), '\x01');
      assert.equal(resume.parseDetachKey('^B'), '\x02');
      assert.equal(resume.parseDetachKey('^Z'), '\x1a');
    });

    it('should parse ctrl+X notation (case-insensitive)', () => {
      assert.equal(resume.parseDetachKey('ctrl+A'), '\x01');
      assert.equal(resume.parseDetachKey('Ctrl+B'), '\x02');
      assert.equal(resume.parseDetachKey('CTRL+Z'), '\x1a');
    });

    it('should pass through literal characters', () => {
      assert.equal(resume.parseDetachKey('q'), 'q');
      assert.equal(resume.parseDetachKey('\x02'), '\x02');
    });
  });

  describe('resume with --help', () => {
    it('should print help and return', async () => {
      // Should not throw or exit
      await resume.resume(['--help']);
    });
  });

  describe('list', () => {
    it('should be a function', () => {
      assert.strictEqual(typeof resume.list, 'function');
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

  // ── New tests for parseResumeArgs ────────────────────────────────────────

  describe('parseResumeArgs (internal, tested via resume/resolveConnection)', () => {
    // parseResumeArgs is not exported, so we test it indirectly through resume()

    it('should parse --password=value format', async () => {
      // We test that --password=value is accepted by calling resume with it.
      // It will fail to connect, but we verify it doesn't error on the flag parse.
      const origExit = process.exit;
      let exitCode = null;
      process.exit = (code) => {
        exitCode = code;
        throw new Error('process.exit called');
      };

      try {
        await resume.resume(['--password=mypass', '--port', '19999']);
      } catch {
        // expected
      } finally {
        process.exit = origExit;
      }
      // It got past arg parsing to the connection stage
      assert.equal(exitCode, 1);
    });

    it('should parse --detach-key flag', async () => {
      const origExit = process.exit;
      let exitCode = null;
      process.exit = (code) => {
        exitCode = code;
        throw new Error('process.exit called');
      };

      try {
        await resume.resume(['--detach-key', '^A', '--port', '19999']);
      } catch {
        // expected
      } finally {
        process.exit = origExit;
      }
      assert.equal(exitCode, 1);
    });

    it('should treat unknown flags as error and show help', async () => {
      // Unknown flags set exitCode=1 and return { help: true }, so resume() prints help and returns
      const origExitCode = process.exitCode;
      await resume.resume(['--unknown-flag']);
      // exitCode should have been set to 1
      assert.equal(process.exitCode, 1);
      process.exitCode = origExitCode;
    });

    it('should parse positional name argument', async () => {
      const origExit = process.exit;
      let exitCode = null;
      process.exit = (code) => {
        exitCode = code;
        throw new Error('process.exit called');
      };

      try {
        await resume.resume(['my-session', '--port', '19999']);
      } catch {
        // expected
      } finally {
        process.exit = origExit;
      }
      assert.equal(exitCode, 1);
    });
  });

  // ── Tests with a mock HTTP server ──────────────────────────────────────────

  describe('with mock server', () => {
    let server;
    let serverPort;
    let origExit;
    let exitMock;
    let mockHandler;

    // Mocks for prompts and client modules
    let promptsPath;
    let clientPath;
    let savedPromptsCache;
    let savedClientCache;

    beforeEach(async () => {
      // Set up mock handler
      mockHandler = (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      };

      server = http.createServer((req, res) => mockHandler(req, res));
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      serverPort = server.address().port;

      // Mock process.exit
      exitMock = { called: false, code: null };
      origExit = process.exit;
      process.exit = (code) => {
        exitMock.called = true;
        exitMock.code = code;
        throw new Error('process.exit called');
      };

      // Save module caches for prompts and client
      promptsPath = require.resolve('../../src/cli/prompts');
      clientPath = require.resolve('../../src/cli/client');
      savedPromptsCache = require.cache[promptsPath];
      savedClientCache = require.cache[clientPath];
    });

    afterEach(async () => {
      process.exit = origExit;

      // Restore module caches
      if (savedPromptsCache) {
        require.cache[promptsPath] = savedPromptsCache;
      } else {
        delete require.cache[promptsPath];
      }
      if (savedClientCache) {
        require.cache[clientPath] = savedClientCache;
      } else {
        delete require.cache[clientPath];
      }

      await new Promise((resolve) => server.close(resolve));
    });

    function reloadResume() {
      const resumePath = require.resolve('../../src/cli/resume');
      delete require.cache[resumePath];
      resume = require('../../src/cli/resume');
    }

    function mockPrompts(overrides = {}) {
      const real = require('../../src/cli/prompts');
      require.cache[promptsPath] = {
        id: promptsPath,
        filename: promptsPath,
        loaded: true,
        exports: {
          ...real,
          ...overrides,
        },
      };
      reloadResume();
    }

    function mockClient(overrides = {}) {
      require.cache[clientPath] = {
        id: clientPath,
        filename: clientPath,
        loaded: true,
        exports: {
          createTerminalClient:
            overrides.createTerminalClient || (() => Promise.resolve({ reason: 'detached' })),
          ...overrides,
        },
      };
      reloadResume();
    }

    function mockPromptsAndClient(promptOverrides = {}, clientOverrides = {}) {
      const real = require('../../src/cli/prompts');
      require.cache[promptsPath] = {
        id: promptsPath,
        filename: promptsPath,
        loaded: true,
        exports: { ...real, ...promptOverrides },
      };
      require.cache[clientPath] = {
        id: clientPath,
        filename: clientPath,
        loaded: true,
        exports: {
          createTerminalClient:
            clientOverrides.createTerminalClient || (() => Promise.resolve({ reason: 'detached' })),
          ...clientOverrides,
        },
      };
      reloadResume();
    }

    // ── fetchSessions ──────────────────────────────────────────────────────

    describe('fetchSessions (via resume)', () => {
      it('should fetch sessions successfully', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'test',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };
        mockClient();

        await resume.resume(['--port', String(serverPort)]);
        // No error — single session auto-selected and connected
      });

      it('should throw unauthorized on 401', async () => {
        mockHandler = (req, res) => {
          res.writeHead(401);
          res.end('Unauthorized');
        };
        reloadResume();

        try {
          await resume.resume(['--port', String(serverPort), '--password', 'wrong']);
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });

      it('should throw on 500 server error', async () => {
        mockHandler = (req, res) => {
          res.writeHead(500);
          res.end('Internal Server Error');
        };
        reloadResume();

        // 500 throws a non-unauthorized error which propagates as an unhandled throw
        await assert.rejects(
          () => resume.resume(['--port', String(serverPort)]),
          (err) => err.message.includes('HTTP 500'),
        );
      });
    });

    // ── resolveConnection ──────────────────────────────────────────────────

    describe('resolveConnection (via resume)', () => {
      it('should use saved config for host/port/password', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'saved',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 1,
          },
        ];
        let receivedAuth = null;
        mockHandler = (req, res) => {
          receivedAuth = req.headers.authorization;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };
        mockClient();

        // Write connection config that points to our mock server
        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: 'saved-pw' });
        reloadResume();
        resume = require('../../src/cli/resume');

        // Need to re-mock after reload
        mockClient();
        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: 'saved-pw' });

        await resume.resume([]);
        assert.equal(receivedAuth, 'Bearer saved-pw');
      });

      it('should prompt for password on 401 when no password provided', async () => {
        let callCount = 0;
        mockHandler = (req, res) => {
          callCount++;
          if (!req.headers.authorization || req.headers.authorization !== 'Bearer prompted-pw') {
            res.writeHead(401);
            res.end('Unauthorized');
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'abcd1234abcd1234',
                  name: 'test',
                  cwd: '/tmp',
                  createdAt: new Date().toISOString(),
                  clients: 0,
                },
              ]),
            );
          }
        };

        mockPromptsAndClient({
          createRL: () => ({ close() {} }),
          ask: () => Promise.resolve('prompted-pw'),
        });

        await resume.resume(['--port', String(serverPort)]);
        assert.ok(callCount >= 2, 'Should have retried after prompting');
      });

      it('should exit on auth failure after prompting', async () => {
        mockHandler = (req, res) => {
          res.writeHead(401);
          res.end('Unauthorized');
        };

        mockPromptsAndClient({
          createRL: () => ({ close() {} }),
          ask: () => Promise.resolve('still-wrong'),
        });

        try {
          await resume.resume(['--port', String(serverPort)]);
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });

      it('should return refused when ECONNREFUSED', async () => {
        reloadResume();
        try {
          await resume.resume(['--port', '19998']);
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });
    });

    // ── resume() ───────────────────────────────────────────────────────────

    describe('resume()', () => {
      it('should exit when TERMBEAM_SESSION env is set', async () => {
        process.env.TERMBEAM_SESSION = 'some-session';
        reloadResume();

        try {
          await resume.resume([]);
        } catch {
          // expected
        } finally {
          delete process.env.TERMBEAM_SESSION;
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });

      it('should exit when no sessions are active', async () => {
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        };
        reloadResume();

        try {
          await resume.resume(['--port', String(serverPort)]);
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });

      it('should match session by name (case-insensitive)', async () => {
        const sessions = [
          {
            id: 'aaaa1111bbbb2222',
            name: 'MyProject',
            cwd: '/home',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
          {
            id: 'cccc3333dddd4444',
            name: 'other',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 1,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        let connectedSessionId;
        mockClient({
          createTerminalClient: (opts) => {
            connectedSessionId = opts.sessionId;
            return Promise.resolve({ reason: 'detached' });
          },
        });

        await resume.resume(['myproject', '--port', String(serverPort)]);
        assert.equal(connectedSessionId, 'aaaa1111bbbb2222');
      });

      it('should match session by ID prefix', async () => {
        const sessions = [
          {
            id: 'abcdef1234567890',
            name: 'proj',
            cwd: '/home',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        let connectedSessionId;
        mockClient({
          createTerminalClient: (opts) => {
            connectedSessionId = opts.sessionId;
            return Promise.resolve({ reason: 'detached' });
          },
        });

        await resume.resume(['abcdef12', '--port', String(serverPort)]);
        assert.equal(connectedSessionId, 'abcdef1234567890');
      });

      it('should exit when no session matches the name', async () => {
        const sessions = [
          {
            id: 'aaaa1111bbbb2222',
            name: 'proj1',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };
        reloadResume();

        try {
          await resume.resume(['nonexistent', '--port', String(serverPort)]);
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });

      it('should auto-select when only one session exists', async () => {
        const sessions = [
          {
            id: 'single12345678ab',
            name: 'only-one',
            cwd: '/home',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        let connectedName;
        mockClient({
          createTerminalClient: (opts) => {
            connectedName = opts.sessionName;
            return Promise.resolve({ reason: 'detached' });
          },
        });

        await resume.resume(['--port', String(serverPort)]);
        assert.equal(connectedName, 'only-one');
      });

      it('should use interactive chooser for multiple sessions', async () => {
        const sessions = [
          {
            id: 'aaaa1111bbbb2222',
            name: 'proj1',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
          {
            id: 'cccc3333dddd4444',
            name: 'proj2',
            cwd: '/home',
            createdAt: new Date().toISOString(),
            clients: 1,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        let connectedSessionId;
        mockPromptsAndClient(
          {
            createRL: () => ({ close() {} }),
            choose: () => Promise.resolve({ index: 1 }),
          },
          {
            createTerminalClient: (opts) => {
              connectedSessionId = opts.sessionId;
              return Promise.resolve({ reason: 'detached' });
            },
          },
        );

        await resume.resume(['--port', String(serverPort)]);
        assert.equal(connectedSessionId, 'cccc3333dddd4444');
      });

      it('should display detach message when reason is detached', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'my-sess',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        mockClient({
          createTerminalClient: () => Promise.resolve({ reason: 'detached' }),
        });

        // Should not throw — detached is a normal exit
        await resume.resume(['--port', String(serverPort)]);
      });

      it('should display session ended message when reason starts with "session exited"', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'my-sess',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        mockClient({
          createTerminalClient: () => Promise.resolve({ reason: 'session exited (code 0)' }),
        });

        await resume.resume(['--port', String(serverPort)]);
      });

      it('should display generic disconnect message for other reasons', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'my-sess',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        mockClient({
          createTerminalClient: () => Promise.resolve({ reason: 'connection-closed' }),
        });

        await resume.resume(['--port', String(serverPort)]);
      });

      it('should display disconnect message when reason is null/undefined', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'my-sess',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        mockClient({
          createTerminalClient: () => Promise.resolve({ reason: null }),
        });

        await resume.resume(['--port', String(serverPort)]);
      });

      it('should exit on createTerminalClient error', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'my-sess',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        mockClient({
          createTerminalClient: () => Promise.reject(new Error('ws connection failed')),
        });

        try {
          await resume.resume(['--port', String(serverPort)]);
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });

      it('should pass custom detach key to createTerminalClient', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'my-sess',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        let passedOpts;
        mockClient({
          createTerminalClient: (opts) => {
            passedOpts = opts;
            return Promise.resolve({ reason: 'detached' });
          },
        });

        await resume.resume(['--port', String(serverPort), '--detach-key', '^A']);
        assert.equal(passedOpts.detachKey, '\x01');
        assert.equal(passedOpts.detachLabel, 'Ctrl+A');
      });
    });

    // ── list() ─────────────────────────────────────────────────────────────

    describe('list()', () => {
      it('should display sessions table', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'project1',
            cwd: '/home/user',
            createdAt: new Date().toISOString(),
            clients: 2,
          },
          {
            id: 'efgh5678efgh5678',
            name: 'dev',
            cwd: '/tmp',
            createdAt: new Date(Date.now() - 3600000).toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: null });
        reloadResume();

        await resume.list();
        // No error — sessions printed
      });

      it('should display message when no sessions are active', async () => {
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        };

        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: null });
        reloadResume();

        await resume.list();
        // Should print "Connected to server on ... — no active sessions." and return
      });

      it('should display singular "session" when count is 1', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'solo',
            cwd: '/tmp',
            createdAt: new Date().toISOString(),
            clients: 1,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: null });
        reloadResume();

        await resume.list();
      });

      it('should prompt for password on 401 when no password saved', async () => {
        let callCount = 0;
        mockHandler = (req, res) => {
          callCount++;
          if (req.headers.authorization === 'Bearer correct-pw') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify([
                {
                  id: 'abcd1234abcd1234',
                  name: 'test',
                  cwd: '/tmp',
                  createdAt: new Date().toISOString(),
                  clients: 0,
                },
              ]),
            );
          } else {
            res.writeHead(401);
            res.end('Unauthorized');
          }
        };

        // No saved password
        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: null });

        mockPrompts({
          createRL: () => ({ close() {} }),
          ask: () => Promise.resolve('correct-pw'),
        });

        await resume.list();
        assert.ok(callCount >= 2);
      });

      it('should exit on auth failure when password is saved', async () => {
        mockHandler = (req, res) => {
          res.writeHead(401);
          res.end('Unauthorized');
        };

        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: 'bad-pw' });
        reloadResume();

        try {
          await resume.list();
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });

      it('should exit on auth failure after prompting wrong password', async () => {
        mockHandler = (req, res) => {
          res.writeHead(401);
          res.end('Unauthorized');
        };

        // No saved password — will prompt, but answer is still wrong
        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: null });

        mockPrompts({
          createRL: () => ({ close() {} }),
          ask: () => Promise.resolve('still-wrong'),
        });

        try {
          await resume.list();
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);
      });

      it('should handle ECONNREFUSED gracefully', async () => {
        resume.writeConnectionConfig({ port: 19997, host: 'localhost', password: null });
        reloadResume();

        // list() prints a message and returns (no exit)
        await resume.list();
      });

      it('should exit on other connection errors', async () => {
        // Create a server that immediately destroys connections
        const badServer = http.createServer((req, res) => {
          req.socket.destroy();
        });
        await new Promise((resolve) => badServer.listen(0, '127.0.0.1', resolve));
        const badPort = badServer.address().port;

        resume.writeConnectionConfig({ port: badPort, host: 'localhost', password: null });
        reloadResume();

        try {
          await resume.list();
        } catch {
          // expected
        }
        assert.ok(exitMock.called);
        assert.equal(exitMock.code, 1);

        await new Promise((resolve) => badServer.close(resolve));
      });
    });

    describe('list() --json', () => {
      function findJsonOutput(logs) {
        for (const line of logs) {
          try {
            const parsed = JSON.parse(line);
            if (Array.isArray(parsed)) return parsed;
          } catch {
            // not JSON
          }
        }
        return null;
      }

      it('should output sessions as JSON array', async () => {
        const sessions = [
          {
            id: 'abcd1234abcd1234',
            name: 'project1',
            cwd: '/home/user',
            createdAt: new Date().toISOString(),
            clients: 2,
          },
          {
            id: 'efgh5678efgh5678',
            name: 'dev',
            cwd: '/tmp',
            createdAt: new Date(Date.now() - 3600000).toISOString(),
            clients: 0,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: null });
        reloadResume();

        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));
        try {
          await resume.list({ json: true });
        } finally {
          console.log = origLog;
        }

        const parsed = findJsonOutput(logs);
        assert.ok(parsed, 'Expected JSON array output');
        assert.equal(parsed.length, 2);
        assert.equal(parsed[0].name, 'project1');
        assert.equal(parsed[1].name, 'dev');
      });

      it('should output empty JSON array when no sessions', async () => {
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        };

        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: null });
        reloadResume();

        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));
        try {
          await resume.list({ json: true });
        } finally {
          console.log = origLog;
        }

        const parsed = findJsonOutput(logs);
        assert.ok(parsed, 'Expected JSON array output');
        assert.deepEqual(parsed, []);
      });

      it('should output empty JSON array on ECONNREFUSED', async () => {
        resume.writeConnectionConfig({ port: 19997, host: 'localhost', password: null });
        reloadResume();

        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));
        try {
          await resume.list({ json: true });
        } finally {
          console.log = origLog;
        }

        const parsed = findJsonOutput(logs);
        assert.ok(parsed, 'Expected JSON array output');
        assert.deepEqual(parsed, []);
      });

      it('should output valid parseable JSON with all session fields', async () => {
        const sessions = [
          {
            id: 'abc123abc123abc1',
            name: 'test-session',
            cwd: '/workspace',
            createdAt: '2026-03-18T00:00:00Z',
            clients: 3,
            shell: '/bin/bash',
            pid: 12345,
          },
        ];
        mockHandler = (req, res) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(sessions));
        };

        resume.writeConnectionConfig({ port: serverPort, host: 'localhost', password: null });
        reloadResume();

        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));
        try {
          await resume.list({ json: true });
        } finally {
          console.log = origLog;
        }

        const parsed = findJsonOutput(logs);
        assert.ok(parsed, 'Expected JSON array output');
        assert.equal(parsed[0].id, 'abc123abc123abc1');
        assert.equal(parsed[0].shell, '/bin/bash');
        assert.equal(parsed[0].pid, 12345);
      });
    });
  });

  // ── formatUptime (tested indirectly via internal function) ────────────────

  describe('formatUptime / shortId / detachKeyLabel (internal helpers)', () => {
    // These are not exported, so we test them indirectly.
    // We can verify their behavior through list() and resume() output,
    // but a more direct approach is to re-require the module and test the
    // functions by calling resume/list with known data and checking output.

    // However, to get proper coverage we can also access them via a creative approach:
    // Load the source file and extract the functions by evaluating the module scope.
    // Instead, we use the mock server approach to exercise these code paths.

    it('should format seconds correctly (via list with recent session)', async () => {
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Created 30 seconds ago
        res.end(
          JSON.stringify([
            {
              id: 'abcd1234abcd1234',
              name: 'recent',
              cwd: '/tmp',
              createdAt: new Date(Date.now() - 30000).toISOString(),
              clients: 0,
            },
          ]),
        );
      });
      await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = srv.address().port;

      resume.writeConnectionConfig({ port, host: 'localhost', password: null });
      const resumePath = require.resolve('../../src/cli/resume');
      delete require.cache[resumePath];
      resume = require('../../src/cli/resume');

      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));
      try {
        await resume.list();
        assert.ok(
          logs.some((l) => l.includes('recent')),
          'should output session name',
        );
        assert.ok(
          logs.some((l) => /\d+s/.test(l)),
          'should format uptime in seconds',
        );
      } finally {
        console.log = origLog;
      }
      await new Promise((resolve) => srv.close(resolve));
    });

    it('should format minutes correctly (via list with ~5min old session)', async () => {
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Created 5 minutes ago
        res.end(
          JSON.stringify([
            {
              id: 'abcd1234abcd1234',
              name: 'mins',
              cwd: '/tmp',
              createdAt: new Date(Date.now() - 300000).toISOString(),
              clients: 0,
            },
          ]),
        );
      });
      await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = srv.address().port;

      resume.writeConnectionConfig({ port, host: 'localhost', password: null });
      const resumePath = require.resolve('../../src/cli/resume');
      delete require.cache[resumePath];
      resume = require('../../src/cli/resume');

      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));
      try {
        await resume.list();
        assert.ok(
          logs.some((l) => l.includes('mins')),
          'should output session name',
        );
        assert.ok(
          logs.some((l) => /\d+m/.test(l)),
          'should format uptime in minutes',
        );
      } finally {
        console.log = origLog;
      }
      await new Promise((resolve) => srv.close(resolve));
    });

    it('should format hours correctly (via list with ~2hr old session)', async () => {
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Created 2 hours and 15 minutes ago
        res.end(
          JSON.stringify([
            {
              id: 'abcd1234abcd1234',
              name: 'hours',
              cwd: '/tmp',
              createdAt: new Date(Date.now() - 8100000).toISOString(),
              clients: 0,
            },
          ]),
        );
      });
      await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = srv.address().port;

      resume.writeConnectionConfig({ port, host: 'localhost', password: null });
      const resumePath = require.resolve('../../src/cli/resume');
      delete require.cache[resumePath];
      resume = require('../../src/cli/resume');

      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));
      try {
        await resume.list();
        assert.ok(
          logs.some((l) => l.includes('hours')),
          'should output session name',
        );
        assert.ok(
          logs.some((l) => /\d+h \d+m/.test(l)),
          'should format uptime in hours and minutes',
        );
      } finally {
        console.log = origLog;
      }
      await new Promise((resolve) => srv.close(resolve));
    });

    it('should format days correctly (via list with ~2day old session)', async () => {
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Created 2 days and 3 hours ago
        res.end(
          JSON.stringify([
            {
              id: 'abcd1234abcd1234',
              name: 'days',
              cwd: '/tmp',
              createdAt: new Date(Date.now() - 183600000).toISOString(),
              clients: 0,
            },
          ]),
        );
      });
      await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = srv.address().port;

      resume.writeConnectionConfig({ port, host: 'localhost', password: null });
      const resumePath = require.resolve('../../src/cli/resume');
      delete require.cache[resumePath];
      resume = require('../../src/cli/resume');

      const logs = [];
      const origLog = console.log;
      console.log = (...args) => logs.push(args.join(' '));
      try {
        await resume.list();
        assert.ok(
          logs.some((l) => l.includes('days')),
          'should output session name',
        );
        assert.ok(
          logs.some((l) => /\d+d \d+h/.test(l)),
          'should format uptime in days and hours',
        );
      } finally {
        console.log = origLog;
      }
      await new Promise((resolve) => srv.close(resolve));
    });

    it('detachKeyLabel should return Ctrl+B for default key', async () => {
      // Exercise detachKeyLabel with default detach key via resume()
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: 'abcd1234abcd1234',
              name: 'test',
              cwd: '/tmp',
              createdAt: new Date().toISOString(),
              clients: 0,
            },
          ]),
        );
      });
      await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = srv.address().port;

      let passedLabel;
      const clientPath = require.resolve('../../src/cli/client');
      require.cache[clientPath] = {
        id: clientPath,
        filename: clientPath,
        loaded: true,
        exports: {
          createTerminalClient: (opts) => {
            passedLabel = opts.detachLabel;
            return Promise.resolve({ reason: 'detached' });
          },
        },
      };
      const resumePath = require.resolve('../../src/cli/resume');
      delete require.cache[resumePath];
      resume = require('../../src/cli/resume');

      await resume.resume(['--port', String(port)]);
      assert.equal(passedLabel, 'Ctrl+B');

      // Restore
      delete require.cache[clientPath];
      await new Promise((resolve) => srv.close(resolve));
    });

    it('detachKeyLabel should format control chars as Ctrl+X', async () => {
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: 'abcd1234abcd1234',
              name: 'test',
              cwd: '/tmp',
              createdAt: new Date().toISOString(),
              clients: 0,
            },
          ]),
        );
      });
      await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = srv.address().port;

      let passedLabel;
      const clientPath = require.resolve('../../src/cli/client');
      require.cache[clientPath] = {
        id: clientPath,
        filename: clientPath,
        loaded: true,
        exports: {
          createTerminalClient: (opts) => {
            passedLabel = opts.detachLabel;
            return Promise.resolve({ reason: 'detached' });
          },
        },
      };
      const resumePath = require.resolve('../../src/cli/resume');
      delete require.cache[resumePath];
      resume = require('../../src/cli/resume');

      // Use --detach-key ^D which is \x04
      await resume.resume(['--port', String(port), '--detach-key', '^D']);
      assert.equal(passedLabel, 'Ctrl+D');

      delete require.cache[clientPath];
      await new Promise((resolve) => srv.close(resolve));
    });

    it('detachKeyLabel should return literal key for non-control chars', async () => {
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            {
              id: 'abcd1234abcd1234',
              name: 'test',
              cwd: '/tmp',
              createdAt: new Date().toISOString(),
              clients: 0,
            },
          ]),
        );
      });
      await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
      const port = srv.address().port;

      let passedLabel;
      const clientPath = require.resolve('../../src/cli/client');
      require.cache[clientPath] = {
        id: clientPath,
        filename: clientPath,
        loaded: true,
        exports: {
          createTerminalClient: (opts) => {
            passedLabel = opts.detachLabel;
            return Promise.resolve({ reason: 'detached' });
          },
        },
      };
      const resumePath = require.resolve('../../src/cli/resume');
      delete require.cache[resumePath];
      resume = require('../../src/cli/resume');

      // Use --detach-key q (literal character > 26)
      await resume.resume(['--port', String(port), '--detach-key', 'q']);
      assert.equal(passedLabel, 'q');

      delete require.cache[clientPath];
      await new Promise((resolve) => srv.close(resolve));
    });
  });

  // ── resume with -h flag ──────────────────────────────────────────────────

  describe('resume with -h flag', () => {
    it('should print help with -h shorthand', async () => {
      await resume.resume(['-h']);
    });
  });
});
