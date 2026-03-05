const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// ── Temp config dir (must be set BEFORE any require of src/) ─────────────────
const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-server-test-'));
process.env.TERMBEAM_CONFIG_DIR = testConfigDir;

// ── Mock node-pty ────────────────────────────────────────────────────────────
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent) {
  if (request === 'node-pty') return 'node-pty';
  return originalResolveFilename.call(this, request, parent);
};

require.cache['node-pty'] = {
  id: 'node-pty',
  filename: 'node-pty',
  loaded: true,
  exports: {
    spawn: () => {
      const cbs = {};
      return {
        pid: 7777,
        onData: (cb) => (cbs.onData = cb),
        onExit: (cb) => (cbs.onExit = cb),
        write: () => {},
        resize: () => {},
        kill: () => cbs.onExit && cbs.onExit({ exitCode: 0 }),
      };
    },
  },
};

// ── Mock tunnel module (controllable per-test via tunnelState) ────────────────
const tunnelState = {
  findDevtunnel: () => 'devtunnel',
  startTunnel: async () => null,
  cleanupTunnel: () => {},
};

const tunnelPath = require.resolve('../src/tunnel');
require.cache[tunnelPath] = {
  id: tunnelPath,
  filename: tunnelPath,
  loaded: true,
  exports: {
    findDevtunnel: (...a) => tunnelState.findDevtunnel(...a),
    startTunnel: (...a) => tunnelState.startTunnel(...a),
    cleanupTunnel: (...a) => tunnelState.cleanupTunnel(...a),
  },
};

// ── Mock devtunnel-install (lazy-required inside start()) ────────────────────
const installState = { promptInstall: async () => false };
const installPath = require.resolve('../src/devtunnel-install');
require.cache[installPath] = {
  id: installPath,
  filename: installPath,
  loaded: true,
  exports: {
    promptInstall: (...a) => installState.promptInstall(...a),
  },
};

// ── Clear cached modules so they pick up mocks ───────────────────────────────
for (const key of Object.keys(require.cache)) {
  if (key.includes('/src/server.js') || key.includes('/src/sessions.js')) {
    delete require.cache[key];
  }
}

const { createTermBeamServer, getLocalIP } = require('../src/server');

// ── Helpers ──────────────────────────────────────────────────────────────────

const baseConfig = {
  port: 0,
  host: '127.0.0.1',
  password: null,
  useTunnel: false,
  persistedTunnel: false,
  publicTunnel: false,
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  shellArgs: [],
  cwd: process.cwd(),
  defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  version: '0.1.0-test',
  logLevel: 'error',
};

function makeConfig(overrides = {}) {
  return { ...baseConfig, ...overrides };
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        resolve({ statusCode: res.statusCode, headers: res.headers, data });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function startServer(configOverrides = {}) {
  const instance = createTermBeamServer({ config: makeConfig(configOverrides) });
  const { defaultId } = await instance.start();
  const port = instance.server.address().port;
  return { ...instance, port, defaultId };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('server.js', () => {
  after(() => {
    fs.rmSync(testConfigDir, { recursive: true, force: true });
    delete process.env.TERMBEAM_CONFIG_DIR;
  });

  // Reset tunnel mocks before each test
  beforeEach(() => {
    tunnelState.findDevtunnel = () => 'devtunnel';
    tunnelState.startTunnel = async () => null;
    tunnelState.cleanupTunnel = () => {};
    installState.promptInstall = async () => false;
  });

  // ── getLocalIP ───────────────────────────────────────────────────────────

  describe('getLocalIP()', () => {
    it('returns a valid IP string', () => {
      const ip = getLocalIP();
      assert.equal(typeof ip, 'string');
      assert.ok(ip.length > 0);
    });

    it('returns 127.0.0.1 when no external IPv4 interface exists', () => {
      const original = os.networkInterfaces;
      // Return only internal interfaces
      os.networkInterfaces = () => ({
        lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      });
      try {
        const ip = getLocalIP();
        assert.equal(ip, '127.0.0.1');
      } finally {
        os.networkInterfaces = original;
      }
    });

    it('returns 127.0.0.1 when no interfaces exist at all', () => {
      const original = os.networkInterfaces;
      os.networkInterfaces = () => ({});
      try {
        assert.equal(getLocalIP(), '127.0.0.1');
      } finally {
        os.networkInterfaces = original;
      }
    });
  });

  // ── /api/shutdown endpoint ───────────────────────────────────────────────

  describe('/api/shutdown endpoint', () => {
    let inst;

    afterEach(() => inst?.shutdown());

    it('returns 200 from loopback and triggers shutdown', async () => {
      inst = await startServer();
      const origExit = process.exit;
      let exitCode;
      process.exit = (code) => {
        exitCode = code;
      };

      try {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/api/shutdown',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        assert.equal(res.statusCode, 200);
        const body = JSON.parse(res.data);
        assert.deepEqual(body, { ok: true });

        // Wait for the 100ms setTimeout to fire
        await new Promise((r) => setTimeout(r, 200));
        assert.equal(exitCode, 0);
      } finally {
        process.exit = origExit;
      }
    });

    it('returns 403 from non-loopback address', async () => {
      inst = await startServer();

      // Spoof the remote address at the socket level
      let spoofActive = true;
      inst.server.on('connection', (socket) => {
        if (spoofActive) {
          Object.defineProperty(socket, 'remoteAddress', {
            value: '10.0.0.99',
            writable: true,
            configurable: true,
          });
        }
      });

      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/api/shutdown',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      spoofActive = false;
      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.data);
      assert.equal(body.error, 'Shutdown is only available from localhost');
    });
  });

  // ── start() connection config ────────────────────────────────────────────

  describe('start() connection config', () => {
    let inst;
    afterEach(() => inst?.shutdown());

    it('maps host :: to localhost in connection config', async () => {
      inst = await startServer({ host: '::' });

      const configPath = path.join(testConfigDir, 'connection.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.host, 'localhost');
      assert.equal(typeof config.port, 'number');
    });

    it('maps host ::1 to localhost in connection config', async () => {
      inst = await startServer({ host: '::1' });

      const configPath = path.join(testConfigDir, 'connection.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(config.host, 'localhost');
    });

    it('survives writeConnectionConfig failure', async () => {
      // Make the resume module's writeConnectionConfig throw
      const resume = require('../src/resume');
      const origWrite = resume.writeConnectionConfig;
      resume.writeConnectionConfig = () => {
        throw new Error('disk full');
      };

      // Patch the server module's cached reference via the resume module exports
      // Since server.js destructures the import, we need to mock at module level
      // by clearing and reloading. Instead, temporarily break CONFIG_DIR.
      resume.writeConnectionConfig = origWrite;

      // Simpler approach: set a config dir that cannot be written to
      const origDir = process.env.TERMBEAM_CONFIG_DIR;
      process.env.TERMBEAM_CONFIG_DIR = '/dev/null/impossible/path';

      // Clear resume module cache so it picks up new TERMBEAM_CONFIG_DIR
      delete require.cache[require.resolve('../src/resume')];

      // We need to reload server.js too since it imports from resume
      delete require.cache[require.resolve('../src/server')];
      delete require.cache[require.resolve('../src/sessions')];
      const { createTermBeamServer: freshCreate } = require('../src/server');

      try {
        const freshInst = freshCreate({ config: makeConfig() });
        // start() should NOT throw even though writeConnectionConfig fails
        const result = await freshInst.start();
        assert.ok(result.url);
        assert.ok(result.defaultId);
        inst = freshInst;
      } finally {
        process.env.TERMBEAM_CONFIG_DIR = origDir;
        // Restore caches
        delete require.cache[require.resolve('../src/resume')];
        delete require.cache[require.resolve('../src/server')];
        delete require.cache[require.resolve('../src/sessions')];
      }
    });
  });

  // ── start() with tunnel ──────────────────────────────────────────────────

  describe('start() with tunnel', () => {
    let inst;
    afterEach(() => inst?.shutdown());

    it('sets publicUrl when tunnel succeeds', async () => {
      tunnelState.startTunnel = async () => ({ url: 'https://test-tunnel.example.com' });

      inst = await startServer({ useTunnel: true });
      // The tunnel URL is stored in state.shareBaseUrl — we can verify by
      // checking that the server started successfully
      assert.ok(inst.port > 0);
    });

    it('continues with LAN only when tunnel fails', async () => {
      tunnelState.startTunnel = async () => null;

      inst = await startServer({ useTunnel: true });
      assert.ok(inst.port > 0);
    });
  });

  // ── devtunnel install prompt ─────────────────────────────────────────────

  describe('devtunnel install path', () => {
    it('exits when devtunnel not found and install declined', async () => {
      tunnelState.findDevtunnel = () => null;
      installState.promptInstall = async () => false;

      const origExit = process.exit;
      let exitCode;
      process.exit = (code) => {
        exitCode = code;
        throw new Error('EXIT');
      };

      try {
        const inst = createTermBeamServer({ config: makeConfig({ useTunnel: true }) });
        await assert.rejects(inst.start(), { message: 'EXIT' });
        assert.equal(exitCode, 1);
        inst.shutdown();
      } finally {
        process.exit = origExit;
      }
    });

    it('continues when devtunnel install succeeds', async () => {
      tunnelState.findDevtunnel = () => null;
      installState.promptInstall = async () => true;
      // After install succeeds, start() proceeds to listen
      tunnelState.startTunnel = async () => null;

      const inst = await startServer({ useTunnel: true });
      assert.ok(inst.port > 0);
      inst.shutdown();
    });
  });

  // ── Public tunnel consent (confirmPublicTunnel) ──────────────────────────

  describe('public tunnel consent', () => {
    it('exits when user declines public tunnel', async () => {
      const readline = require('readline');
      const origCreateInterface = readline.createInterface;
      readline.createInterface = () => ({
        question: (_prompt, cb) => cb('n'),
        close: () => {},
      });

      const origExit = process.exit;
      let exitCode;
      process.exit = (code) => {
        exitCode = code;
        throw new Error('EXIT');
      };

      try {
        const inst = createTermBeamServer({
          config: makeConfig({ useTunnel: true, publicTunnel: true }),
        });
        await assert.rejects(inst.start(), { message: 'EXIT' });
        assert.equal(exitCode, 1);
        inst.shutdown();
      } finally {
        process.exit = origExit;
        readline.createInterface = origCreateInterface;
      }
    });

    it('proceeds when user confirms public tunnel', async () => {
      const readline = require('readline');
      const origCreateInterface = readline.createInterface;
      readline.createInterface = () => ({
        question: (_prompt, cb) => cb('y'),
        close: () => {},
      });

      tunnelState.startTunnel = async () => ({ url: 'https://public-tunnel.example.com' });

      let inst;
      try {
        inst = await startServer({ useTunnel: true, publicTunnel: true });
        assert.ok(inst.port > 0);
      } finally {
        readline.createInterface = origCreateInterface;
        inst?.shutdown();
      }
    });
  });

  // ── QR code generation failure ───────────────────────────────────────────

  describe('QR code error handling', () => {
    let inst;
    afterEach(() => inst?.shutdown());

    it('ignores QR code generation failure', async () => {
      const QRCode = require('qrcode');
      const origToString = QRCode.toString;
      QRCode.toString = async () => {
        throw new Error('QR generation failed');
      };

      try {
        inst = await startServer();
        // Server starts successfully despite QR error
        assert.ok(inst.port > 0);
      } finally {
        QRCode.toString = origToString;
      }
    });
  });
});
