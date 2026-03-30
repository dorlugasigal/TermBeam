const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const EventEmitter = require('events');

const binPath = path.resolve(__dirname, '../../bin/termbeam.js');

// ── Helpers to load bin/termbeam.js with mocked dependencies ──────────────
// The bin file checks process.argv[2] at the top level to dispatch subcommands.
// For the else-branch (the main server path), it defines httpPost,
// checkExistingServer, stopExistingServer, and main() — all in module scope.
// We can't require() the file directly (it calls main() on load), so instead
// we extract the helpers by reading the source and evaluating snippets, or we
// test via the observable side-effects of running the script.

describe('bin/termbeam.js', () => {
  let origArgv;
  let origExit;
  let exitCode;
  let exitCalled;
  let consoleErrorSpy;
  let errorOutput;
  let consoleLogSpy;
  let logOutput;

  beforeEach(() => {
    origArgv = process.argv;
    origExit = process.exit;
    exitCalled = false;
    exitCode = undefined;
    errorOutput = [];
    logOutput = [];
    consoleErrorSpy = console.error;
    consoleLogSpy = console.log;
    console.error = (...args) => errorOutput.push(args.join(' '));
    console.log = (...args) => logOutput.push(args.join(' '));
  });

  afterEach(() => {
    process.argv = origArgv;
    process.exit = origExit;
    console.error = consoleErrorSpy;
    console.log = consoleLogSpy;
    // Clean require cache for bin and src/cli modules we may have loaded
    delete require.cache[binPath];
    for (const key of Object.keys(require.cache)) {
      if (
        key.includes('src/cli/service') ||
        key.includes('src/cli/resume') ||
        key.includes('src/cli/index') ||
        key.includes('src/cli/interactive') ||
        key.includes('src/server/index')
      ) {
        delete require.cache[key];
      }
    }
  });

  // ── httpPost tests ──────────────────────────────────────────────────────
  describe('httpPost', () => {
    let httpPost;
    let http;

    beforeEach(() => {
      http = require('http');
      // Extract httpPost by evaluating the function body from the source.
      // Instead, we replicate the function exactly as in the bin file and test it
      // against a real ephemeral HTTP server for accuracy.
      httpPost = function (url, headers) {
        return new Promise((resolve) => {
          const parsed = new URL(url);
          const req = http.request(
            {
              hostname: parsed.hostname,
              port: parsed.port,
              path: parsed.pathname,
              method: 'POST',
              headers,
              timeout: 2000,
            },
            (res) => {
              res.resume();
              resolve(res.statusCode);
            },
          );
          req.on('error', () => resolve(null));
          req.on('timeout', () => {
            req.destroy();
            resolve(null);
          });
          req.end();
        });
      };
    });

    it('resolves with status code on successful POST', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('ok');
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const status = await httpPost(`http://127.0.0.1:${port}/api/shutdown`, {});
        assert.equal(status, 200);
      } finally {
        server.close();
      }
    });

    it('sends Authorization header when provided', async () => {
      let receivedAuth;
      const server = http.createServer((req, res) => {
        receivedAuth = req.headers.authorization;
        res.writeHead(200);
        res.end();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        await httpPost(`http://127.0.0.1:${port}/test`, {
          Authorization: 'Bearer secret',
        });
        assert.equal(receivedAuth, 'Bearer secret');
      } finally {
        server.close();
      }
    });

    it('resolves with null on connection error', async () => {
      // Port with no server listening
      const status = await httpPost('http://127.0.0.1:1/nope', {});
      assert.equal(status, null);
    });

    it('resolves with 401 for unauthorized', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(401);
        res.end();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const status = await httpPost(`http://127.0.0.1:${port}/api/shutdown`, {});
        assert.equal(status, 401);
      } finally {
        server.close();
      }
    });
  });

  // ── checkExistingServer tests ───────────────────────────────────────────
  describe('checkExistingServer', () => {
    let checkExistingServer;
    let http;

    beforeEach(() => {
      http = require('http');
      // Replicate checkExistingServer from the bin file
      checkExistingServer = function (config) {
        if (!config) return Promise.resolve(false);
        const host = config.host === 'localhost' ? '127.0.0.1' : config.host;
        return new Promise((resolve) => {
          const req = http.get(
            `http://${host}:${config.port}/api/sessions`,
            {
              timeout: 2000,
              headers: config.password ? { Authorization: `Bearer ${config.password}` } : {},
            },
            (res) => {
              res.resume();
              resolve(res.statusCode < 500);
            },
          );
          req.on('error', () => resolve(false));
          req.on('timeout', () => {
            req.destroy();
            resolve(false);
          });
        });
      };
    });

    it('returns false for null config', async () => {
      const result = await checkExistingServer(null);
      assert.equal(result, false);
    });

    it('returns false for undefined config', async () => {
      const result = await checkExistingServer(undefined);
      assert.equal(result, false);
    });

    it('returns true when server responds with 200', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200);
        res.end('[]');
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const result = await checkExistingServer({
          host: '127.0.0.1',
          port,
          password: null,
        });
        assert.equal(result, true);
      } finally {
        server.close();
      }
    });

    it('returns true when server responds with 401 (still alive)', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(401);
        res.end();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const result = await checkExistingServer({
          host: '127.0.0.1',
          port,
          password: null,
        });
        assert.equal(result, true);
      } finally {
        server.close();
      }
    });

    it('returns false when server responds with 500', async () => {
      const server = http.createServer((_req, res) => {
        res.writeHead(500);
        res.end();
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const result = await checkExistingServer({
          host: '127.0.0.1',
          port,
          password: null,
        });
        assert.equal(result, false);
      } finally {
        server.close();
      }
    });

    it('returns false when no server is running', async () => {
      const result = await checkExistingServer({
        host: '127.0.0.1',
        port: 1,
        password: null,
      });
      assert.equal(result, false);
    });

    it('resolves localhost to 127.0.0.1', async () => {
      let requestReceived = false;
      const server = http.createServer((_req, res) => {
        requestReceived = true;
        res.writeHead(200);
        res.end('[]');
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const result = await checkExistingServer({
          host: 'localhost',
          port,
          password: null,
        });
        assert.equal(result, true);
        assert.equal(requestReceived, true);
      } finally {
        server.close();
      }
    });

    it('sends Authorization header when password is set', async () => {
      let receivedAuth;
      const server = http.createServer((req, res) => {
        receivedAuth = req.headers.authorization;
        res.writeHead(200);
        res.end('[]');
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        await checkExistingServer({
          host: '127.0.0.1',
          port,
          password: 'mypass',
        });
        assert.equal(receivedAuth, 'Bearer mypass');
      } finally {
        server.close();
      }
    });

    it('does not send Authorization header when no password', async () => {
      let receivedAuth;
      const server = http.createServer((req, res) => {
        receivedAuth = req.headers.authorization;
        res.writeHead(200);
        res.end('[]');
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        await checkExistingServer({
          host: '127.0.0.1',
          port,
          password: null,
        });
        assert.equal(receivedAuth, undefined);
      } finally {
        server.close();
      }
    });
  });

  // ── stopExistingServer tests ────────────────────────────────────────────
  describe('stopExistingServer', () => {
    let httpPostMock;
    let checkMock;
    let stopExistingServer;
    let exitCalledWith;

    beforeEach(() => {
      exitCalledWith = undefined;
      process.exit = (code) => {
        exitCalledWith = code;
        throw new Error(`process.exit(${code})`);
      };
    });

    it('stops server with config password on first try', async () => {
      const postCalls = [];
      httpPostMock = async (url, headers) => {
        postCalls.push({ url, headers });
        return 200;
      };
      let checkCount = 0;
      checkMock = async () => {
        checkCount++;
        return false; // server stopped immediately
      };

      stopExistingServer = async function (config, fallbackPassword) {
        const url = `http://127.0.0.1:${config.port}/api/shutdown`;
        const passwords = [config.password, fallbackPassword, null].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        let stopped = false;
        for (const pw of passwords) {
          const headers = pw ? { Authorization: `Bearer ${pw}` } : {};
          const status = await httpPostMock(url, headers);
          if (status && status !== 401) {
            stopped = true;
            break;
          }
        }
        if (!stopped) {
          process.exit(1);
        }
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 5)); // shorter wait for tests
          if (!(await checkMock(config))) break;
        }
      };

      await stopExistingServer({ port: 3456, password: 'pw1' }, 'pw2');
      assert.equal(postCalls.length, 1);
      assert.equal(postCalls[0].headers.Authorization, 'Bearer pw1');
    });

    it('tries fallback password when config password returns 401', async () => {
      const postCalls = [];
      httpPostMock = async (url, headers) => {
        postCalls.push({ url, headers });
        if (headers.Authorization === 'Bearer pw1') return 401;
        return 200;
      };
      checkMock = async () => false;

      stopExistingServer = async function (config, fallbackPassword) {
        const url = `http://127.0.0.1:${config.port}/api/shutdown`;
        const passwords = [config.password, fallbackPassword, null].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        let stopped = false;
        for (const pw of passwords) {
          const headers = pw ? { Authorization: `Bearer ${pw}` } : {};
          const status = await httpPostMock(url, headers);
          if (status && status !== 401) {
            stopped = true;
            break;
          }
        }
        if (!stopped) {
          process.exit(1);
        }
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 5));
          if (!(await checkMock(config))) break;
        }
      };

      await stopExistingServer({ port: 3456, password: 'pw1' }, 'pw2');
      assert.equal(postCalls.length, 2);
      assert.equal(postCalls[1].headers.Authorization, 'Bearer pw2');
    });

    it('exits with 1 when all passwords fail (all return 401)', async () => {
      httpPostMock = async () => 401;
      checkMock = async () => false;

      stopExistingServer = async function (config, fallbackPassword) {
        const url = `http://127.0.0.1:${config.port}/api/shutdown`;
        const passwords = [config.password, fallbackPassword, null].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        let stopped = false;
        for (const pw of passwords) {
          const headers = pw ? { Authorization: `Bearer ${pw}` } : {};
          const status = await httpPostMock(url, headers);
          if (status && status !== 401) {
            stopped = true;
            break;
          }
        }
        if (!stopped) {
          console.error(
            'Cannot stop the existing server — password mismatch.\n' +
              'Stop it manually (Ctrl+C in its terminal) and try again.',
          );
          process.exit(1);
        }
      };

      await assert.rejects(() => stopExistingServer({ port: 3456, password: 'pw1' }, 'pw2'), {
        message: 'process.exit(1)',
      });
      assert.equal(exitCalledWith, 1);
      assert.ok(errorOutput.some((m) => m.includes('password mismatch')));
    });

    it('deduplicates passwords (config pw same as fallback)', async () => {
      const postCalls = [];
      httpPostMock = async (url, headers) => {
        postCalls.push({ url, headers });
        return 200;
      };
      checkMock = async () => false;

      stopExistingServer = async function (config, fallbackPassword) {
        const url = `http://127.0.0.1:${config.port}/api/shutdown`;
        const passwords = [config.password, fallbackPassword, null].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        let stopped = false;
        for (const pw of passwords) {
          const headers = pw ? { Authorization: `Bearer ${pw}` } : {};
          const status = await httpPostMock(url, headers);
          if (status && status !== 401) {
            stopped = true;
            break;
          }
        }
        if (!stopped) {
          process.exit(1);
        }
      };

      await stopExistingServer({ port: 3456, password: 'same' }, 'same');
      // Should only try once (same password deduplicated), then null
      assert.equal(postCalls.length, 1);
    });

    it('tries null password as last resort', async () => {
      const postCalls = [];
      httpPostMock = async (url, headers) => {
        postCalls.push({ url, headers });
        if (headers.Authorization) return 401;
        return 200; // null password succeeds
      };
      checkMock = async () => false;

      stopExistingServer = async function (config, fallbackPassword) {
        const url = `http://127.0.0.1:${config.port}/api/shutdown`;
        const passwords = [config.password, fallbackPassword, null].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        let stopped = false;
        for (const pw of passwords) {
          const headers = pw ? { Authorization: `Bearer ${pw}` } : {};
          const status = await httpPostMock(url, headers);
          if (status && status !== 401) {
            stopped = true;
            break;
          }
        }
        if (!stopped) {
          process.exit(1);
        }
      };

      await stopExistingServer({ port: 3456, password: 'pw1' }, 'pw2');
      assert.equal(postCalls.length, 3);
      assert.deepStrictEqual(postCalls[2].headers, {});
    });

    it('polls checkExistingServer until server stops', async () => {
      httpPostMock = async () => 200;
      let checkCalls = 0;
      checkMock = async () => {
        checkCalls++;
        return checkCalls < 3; // server still up for first 2 checks
      };

      stopExistingServer = async function (config, fallbackPassword) {
        const url = `http://127.0.0.1:${config.port}/api/shutdown`;
        const passwords = [config.password, fallbackPassword, null].filter(
          (v, i, a) => a.indexOf(v) === i,
        );
        let stopped = false;
        for (const pw of passwords) {
          const headers = pw ? { Authorization: `Bearer ${pw}` } : {};
          const status = await httpPostMock(url, headers);
          if (status && status !== 401) {
            stopped = true;
            break;
          }
        }
        if (!stopped) {
          process.exit(1);
        }
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 5));
          if (!(await checkMock(config))) break;
        }
      };

      await stopExistingServer({ port: 3456, password: 'pw' });
      assert.equal(checkCalls, 3);
    });
  });

  // ── Subcommand dispatch tests ───────────────────────────────────────────
  describe('subcommand dispatch', () => {
    it('dispatches "service" subcommand', async () => {
      let runCalled = false;
      let runArgs;

      // Mock service module
      const servicePath = require.resolve('../../src/cli/service');
      require.cache[servicePath] = {
        id: servicePath,
        filename: servicePath,
        loaded: true,
        exports: {
          run: async (args) => {
            runCalled = true;
            runArgs = args;
          },
        },
      };

      process.argv = ['node', 'termbeam', 'service', 'status'];
      delete require.cache[binPath];

      require(binPath);
      // run() is async, give it a tick
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(runCalled, true);
      assert.deepStrictEqual(runArgs, ['status']);
    });

    it('dispatches "resume" subcommand', async () => {
      let resumeCalled = false;
      let resumeArgs;

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: {
          resume: async (args) => {
            resumeCalled = true;
            resumeArgs = args;
          },
        },
      };

      process.argv = ['node', 'termbeam', 'resume', 'mysession'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(resumeCalled, true);
      assert.deepStrictEqual(resumeArgs, ['mysession']);
    });

    it('dispatches "attach" as alias for resume', async () => {
      let resumeCalled = false;

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: {
          resume: async () => {
            resumeCalled = true;
          },
        },
      };

      process.argv = ['node', 'termbeam', 'attach'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(resumeCalled, true);
    });

    it('dispatches "list" subcommand', async () => {
      let listCalled = false;
      let listOpts;

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: {
          list: async (opts) => {
            listCalled = true;
            listOpts = opts;
          },
        },
      };

      process.argv = ['node', 'termbeam', 'list'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(listCalled, true);
      assert.deepStrictEqual(listOpts, { json: false });
    });

    it('dispatches "list --json" with json flag', async () => {
      let listOpts;

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: {
          list: async (opts) => {
            listOpts = opts;
          },
        },
      };

      process.argv = ['node', 'termbeam', 'list', '--json'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 50));

      assert.deepStrictEqual(listOpts, { json: true });
    });

    it('handles service subcommand error', async () => {
      process.exit = (code) => {
        exitCalled = true;
        exitCode = code;
      };

      const servicePath = require.resolve('../../src/cli/service');
      require.cache[servicePath] = {
        id: servicePath,
        filename: servicePath,
        loaded: true,
        exports: {
          run: async () => {
            throw new Error('service boom');
          },
        },
      };

      process.argv = ['node', 'termbeam', 'service', 'bad'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(exitCalled, true);
      assert.equal(exitCode, 1);
      assert.ok(errorOutput.some((m) => m.includes('service boom')));
    });

    it('handles resume subcommand error', async () => {
      process.exit = (code) => {
        exitCalled = true;
        exitCode = code;
      };

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: {
          resume: async () => {
            throw new Error('resume fail');
          },
        },
      };

      process.argv = ['node', 'termbeam', 'resume'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(exitCalled, true);
      assert.equal(exitCode, 1);
      assert.ok(errorOutput.some((m) => m.includes('resume fail')));
    });

    it('handles list subcommand error', async () => {
      process.exit = (code) => {
        exitCalled = true;
        exitCode = code;
      };

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: {
          list: async () => {
            throw new Error('list fail');
          },
        },
      };

      process.argv = ['node', 'termbeam', 'list'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(exitCalled, true);
      assert.equal(exitCode, 1);
      assert.ok(errorOutput.some((m) => m.includes('list fail')));
    });

    it('rejects unknown non-flag subcommand', async () => {
      process.exit = (code) => {
        exitCalled = true;
        exitCode = code;
      };

      const cliPath = require.resolve('../../src/cli');
      require.cache[cliPath] = {
        id: cliPath,
        filename: cliPath,
        loaded: true,
        exports: {
          printHelp: () => {},
          parseArgs: () => ({ port: 3456, host: '127.0.0.1' }),
        },
      };

      // Mock server and other deps so require doesn't fail
      const serverPath = require.resolve('../../src/server');
      require.cache[serverPath] = {
        id: serverPath,
        filename: serverPath,
        loaded: true,
        exports: {
          createTermBeamServer: () => ({
            start: () => {},
            shutdown: () => {},
          }),
        },
      };
      const interactivePath = require.resolve('../../src/cli/interactive');
      require.cache[interactivePath] = {
        id: interactivePath,
        filename: interactivePath,
        loaded: true,
        exports: { runInteractiveSetup: async () => ({}) },
      };
      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: { readConnectionConfig: () => null },
      };

      process.argv = ['node', 'termbeam', 'badcmd'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(exitCalled, true);
      assert.equal(exitCode, 1);
      assert.ok(errorOutput.some((m) => m.includes('Unknown command: badcmd')));
    });
  });

  // ── main() early-exit: existing server without --force ──────────────────
  describe('main() — existing server detection', () => {
    it('exits with error when server already running and no --force', async () => {
      process.exit = (code) => {
        exitCalled = true;
        exitCode = code;
      };

      const cliPath = require.resolve('../../src/cli');
      require.cache[cliPath] = {
        id: cliPath,
        filename: cliPath,
        loaded: true,
        exports: {
          printHelp: () => {},
          parseArgs: () => ({ port: 3456, host: '127.0.0.1', force: false }),
        },
      };

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: {
          readConnectionConfig: () => ({
            host: '127.0.0.1',
            port: 9999,
            password: 'test',
          }),
        },
      };

      // Mock http module to make checkExistingServer return true
      const httpMod = require('http');
      const origGet = httpMod.get;
      httpMod.get = (_url, _opts, cb) => {
        const fakeRes = new EventEmitter();
        fakeRes.statusCode = 200;
        fakeRes.resume = () => {};
        if (cb) process.nextTick(() => cb(fakeRes));
        const fakeReq = new EventEmitter();
        fakeReq.end = () => {};
        return fakeReq;
      };

      const serverPath = require.resolve('../../src/server');
      require.cache[serverPath] = {
        id: serverPath,
        filename: serverPath,
        loaded: true,
        exports: {
          createTermBeamServer: () => ({
            start: () => {},
            shutdown: () => {},
          }),
        },
      };
      const interactivePath = require.resolve('../../src/cli/interactive');
      require.cache[interactivePath] = {
        id: interactivePath,
        filename: interactivePath,
        loaded: true,
        exports: { runInteractiveSetup: async () => ({}) },
      };

      process.argv = ['node', 'termbeam'];
      delete require.cache[binPath];

      try {
        require(binPath);
        await new Promise((r) => setTimeout(r, 100));
      } finally {
        httpMod.get = origGet;
      }

      assert.equal(exitCalled, true);
      assert.equal(exitCode, 1);
      assert.ok(
        errorOutput.some((m) => m.includes('already running')),
        `Expected "already running" in error output, got: ${errorOutput}`,
      );
    });

    it('starts server when no existing server found', async () => {
      let startCalled = false;

      const cliPath = require.resolve('../../src/cli');
      require.cache[cliPath] = {
        id: cliPath,
        filename: cliPath,
        loaded: true,
        exports: {
          printHelp: () => {},
          parseArgs: () => ({ port: 0, host: '127.0.0.1', force: false }),
        },
      };

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: {
          readConnectionConfig: () => null,
        },
      };

      const serverPath = require.resolve('../../src/server');
      require.cache[serverPath] = {
        id: serverPath,
        filename: serverPath,
        loaded: true,
        exports: {
          createTermBeamServer: () => ({
            start: () => {
              startCalled = true;
            },
            shutdown: () => {},
          }),
        },
      };
      const interactivePath = require.resolve('../../src/cli/interactive');
      require.cache[interactivePath] = {
        id: interactivePath,
        filename: interactivePath,
        loaded: true,
        exports: { runInteractiveSetup: async () => ({}) },
      };

      process.argv = ['node', 'termbeam'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 100));

      assert.equal(startCalled, true);
    });

    it('handles main() error by printing message and exiting', async () => {
      process.exit = (code) => {
        exitCalled = true;
        exitCode = code;
      };

      const cliPath = require.resolve('../../src/cli');
      require.cache[cliPath] = {
        id: cliPath,
        filename: cliPath,
        loaded: true,
        exports: {
          printHelp: () => {},
          parseArgs: () => {
            throw new Error('config parse failed');
          },
        },
      };

      const resumePath = require.resolve('../../src/cli/resume');
      require.cache[resumePath] = {
        id: resumePath,
        filename: resumePath,
        loaded: true,
        exports: { readConnectionConfig: () => null },
      };
      const serverPath = require.resolve('../../src/server');
      require.cache[serverPath] = {
        id: serverPath,
        filename: serverPath,
        loaded: true,
        exports: {
          createTermBeamServer: () => ({
            start: () => {},
            shutdown: () => {},
          }),
        },
      };
      const interactivePath = require.resolve('../../src/cli/interactive');
      require.cache[interactivePath] = {
        id: interactivePath,
        filename: interactivePath,
        loaded: true,
        exports: { runInteractiveSetup: async () => ({}) },
      };

      process.argv = ['node', 'termbeam'];
      delete require.cache[binPath];

      require(binPath);
      await new Promise((r) => setTimeout(r, 100));

      assert.equal(exitCalled, true);
      assert.equal(exitCode, 1);
      assert.ok(errorOutput.some((m) => m.includes('config parse failed')));
    });
  });

  // ── Password deduplication logic ────────────────────────────────────────
  describe('password deduplication', () => {
    it('deduplicates identical passwords in the array', () => {
      const passwords = ['pw1', 'pw1', null].filter((v, i, a) => a.indexOf(v) === i);
      assert.deepStrictEqual(passwords, ['pw1', null]);
    });

    it('keeps distinct passwords', () => {
      const passwords = ['pw1', 'pw2', null].filter((v, i, a) => a.indexOf(v) === i);
      assert.deepStrictEqual(passwords, ['pw1', 'pw2', null]);
    });

    it('deduplicates null fallback when config password is null', () => {
      const passwords = [null, null, null].filter((v, i, a) => a.indexOf(v) === i);
      assert.deepStrictEqual(passwords, [null]);
    });

    it('deduplicates config pw null + fallback pw + null', () => {
      const passwords = [null, 'pw2', null].filter((v, i, a) => a.indexOf(v) === i);
      assert.deepStrictEqual(passwords, [null, 'pw2']);
    });
  });
});
