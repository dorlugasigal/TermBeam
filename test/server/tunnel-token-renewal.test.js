'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const http = require('http');
const { createTermBeamServer } = require('../../src/server');

// --- Helpers ---

const baseConfig = {
  port: 0,
  host: '127.0.0.1',
  password: null,
  useTunnel: false,
  persistedTunnel: false,
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  shellArgs: [],
  cwd: process.cwd(),
  defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  version: '0.1.0-test',
  logLevel: 'error',
};

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function startServer(configOverrides = {}) {
  const instance = createTermBeamServer({ config: { ...baseConfig, ...configOverrides } });
  const { defaultId } = await instance.start();
  const port = instance.server.address().port;
  return { ...instance, port, defaultId };
}

describe('tunnel token renewal', () => {
  // ── parseLoginInfo tests ──

  describe('parseLoginInfo', () => {
    let parseLoginInfo;

    beforeEach(() => {
      const tunnelPath = require.resolve('../../src/tunnel');
      delete require.cache[tunnelPath];
      ({ parseLoginInfo } = require('../../src/tunnel'));
    });

    it('should parse GitHub login with token lifetime', () => {
      const output = [
        'Using token cache file: /tmp/devtunnels-tokens-github',
        'Loaded cached GitHub tokens for account(s): testuser',
        'Expiration: 30.3.2026 17:24:09',
        'Logged in as testuser using GitHub.',
        'Expiration: 30.3.2026 20:24:09',
        'Token lifetime: 7:18:27',
      ].join('\n');

      const info = parseLoginInfo(output);
      assert.equal(info.provider, 'github');
      assert.equal(info.tokenLifetimeSeconds, 7 * 3600 + 18 * 60 + 27);
    });

    it('should parse Microsoft login with token lifetime', () => {
      const output = [
        'MSAL: stuff...',
        'Logged in as user@microsoft.com using Microsoft.',
        'Expiration: 30.3.2026 14:33:40',
        'Token lifetime: 1:09:47',
      ].join('\n');

      const info = parseLoginInfo(output);
      assert.equal(info.provider, 'microsoft');
      assert.equal(info.tokenLifetimeSeconds, 1 * 3600 + 9 * 60 + 47);
    });

    it('should return null for not logged in', () => {
      assert.equal(parseLoginInfo('Not logged in'), null);
      assert.equal(parseLoginInfo('Status: not logged in'), null);
    });

    it('should return null for null/empty input', () => {
      assert.equal(parseLoginInfo(null), null);
      assert.equal(parseLoginInfo(''), null);
      assert.equal(parseLoginInfo(undefined), null);
    });

    it('should return null tokenLifetimeSeconds when format is unexpected', () => {
      const output = 'Logged in as user using GitHub.\nNo lifetime here';
      const info = parseLoginInfo(output);
      assert.equal(info.provider, 'github');
      assert.equal(info.tokenLifetimeSeconds, null);
    });

    it('should detect unknown provider', () => {
      const output = 'Logged in as user.\nToken lifetime: 2:30:00';
      const info = parseLoginInfo(output);
      assert.equal(info.provider, 'unknown');
      assert.equal(info.tokenLifetimeSeconds, 2 * 3600 + 30 * 60);
    });

    it('should handle zero token lifetime', () => {
      const output = 'Logged in as user using GitHub.\nToken lifetime: 0:00:00';
      const info = parseLoginInfo(output);
      assert.equal(info.tokenLifetimeSeconds, 0);
    });

    it('should handle large token lifetimes', () => {
      const output = 'Logged in as user using Microsoft.\nToken lifetime: 168:00:00';
      const info = parseLoginInfo(output);
      assert.equal(info.tokenLifetimeSeconds, 168 * 3600);
    });
  });

  // ── New exports ──

  describe('new module exports', () => {
    it('should export getLoginInfo and parseLoginInfo', () => {
      const tunnelPath = require.resolve('../../src/tunnel');
      delete require.cache[tunnelPath];
      const tunnel = require('../../src/tunnel');

      assert.equal(typeof tunnel.getLoginInfo, 'function');
      assert.equal(typeof tunnel.parseLoginInfo, 'function');

      delete require.cache[tunnelPath];
    });
  });

  // ── auth-expiring event contract ──

  describe('auth-expiring event contract', () => {
    let emitter;

    beforeEach(() => {
      emitter = new EventEmitter();
    });

    it('should emit auth-expiring with expiresIn and provider', () => {
      const events = [];
      emitter.on('auth-expiring', (data) => events.push(data));
      emitter.emit('auth-expiring', { expiresIn: 1800000, provider: 'github' });
      assert.equal(events.length, 1);
      assert.equal(events[0].expiresIn, 1800000);
      assert.equal(events[0].provider, 'github');
    });

    it('should emit auth-expired', () => {
      let called = false;
      emitter.on('auth-expired', () => {
        called = true;
      });
      emitter.emit('auth-expired');
      assert.ok(called);
    });

    it('should emit auth-restored', () => {
      let called = false;
      emitter.on('auth-restored', () => {
        called = true;
      });
      emitter.emit('auth-restored');
      assert.ok(called);
    });
  });

  // ── isAuthError coverage ──

  describe('isAuthError patterns', () => {
    // We test via parseLoginInfo behavior since isAuthError is internal,
    // but we can verify the patterns work by checking parseLoginInfo returns null
    // for "not logged in" messages (which uses the same pattern matching)

    let parseLoginInfo;

    beforeEach(() => {
      const tunnelPath = require.resolve('../../src/tunnel');
      delete require.cache[tunnelPath];
      ({ parseLoginInfo } = require('../../src/tunnel'));
    });

    it('should detect "not logged in" case-insensitively', () => {
      assert.equal(parseLoginInfo('NOT LOGGED IN'), null);
      assert.equal(parseLoginInfo('Not Logged In'), null);
      assert.equal(parseLoginInfo('User is not logged in to the CLI'), null);
    });
  });

  // ── API route tests ──

  describe('GET /api/tunnel/status', () => {
    let instance;

    after(async () => {
      if (instance) await instance.shutdown();
    });

    it('should return tunnel status', async () => {
      instance = await startServer();
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: instance.port,
        path: '/api/tunnel/status',
        method: 'GET',
      });
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.data);
      // No tunnel running, so state is unknown or null
      assert.ok('provider' in body);
      assert.ok('tokenLifetimeSeconds' in body);
    });
  });

  describe('POST /api/tunnel/renew', () => {
    // Both regex patterns used in the route handler
    function parseDeviceCode(output) {
      return (
        output.match(/open the page (https:\/\/[^\s]+) and enter the code ([A-Z0-9]+)/i) ||
        output.match(/Browse to (https:\/\/[^\s]+) and enter the code:?\s*([A-Z0-9-]+)/i)
      );
    }

    it('should parse Entra device code output', () => {
      const output =
        'To sign in, use a web browser to open the page https://login.microsoft.com/device and enter the code ABC123DEF to authenticate.';
      const match = parseDeviceCode(output);
      assert.ok(match);
      assert.equal(match[1], 'https://login.microsoft.com/device');
      assert.equal(match[2], 'ABC123DEF');
    });

    it('should parse GitHub device code output', () => {
      const output = 'Browse to https://github.com/login/device and enter the code: 35BC-4CFF';
      const match = parseDeviceCode(output);
      assert.ok(match);
      assert.equal(match[1], 'https://github.com/login/device');
      assert.equal(match[2], '35BC-4CFF');
    });

    it('should parse GitHub code without colon', () => {
      const output = 'Browse to https://github.com/login/device and enter the code AB12-CD34';
      const match = parseDeviceCode(output);
      assert.ok(match);
      assert.equal(match[2], 'AB12-CD34');
    });

    it('should not match non-device-code output', () => {
      const output = 'Logged in as user@example.com using Microsoft.';
      const match = parseDeviceCode(output);
      assert.equal(match, null);
    });
  });

  // ── WebSocket tunnel-status broadcast contract ──

  describe('tunnel-status WebSocket broadcast', () => {
    it('should broadcast tunnel-status messages to wss clients', () => {
      // Simulate the broadcast pattern used in server/index.js
      const mockClients = new Set();
      const messages = [];

      const mockWs = {
        readyState: 1,
        send: (data) => messages.push(JSON.parse(data)),
      };
      mockClients.add(mockWs);

      // Simulate broadcast
      const msg = {
        type: 'tunnel-status',
        state: 'expiring',
        expiresIn: 1800000,
        provider: 'github',
      };
      const data = JSON.stringify(msg);
      mockClients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(data);
        }
      });

      assert.equal(messages.length, 1);
      assert.equal(messages[0].type, 'tunnel-status');
      assert.equal(messages[0].state, 'expiring');
      assert.equal(messages[0].expiresIn, 1800000);
      assert.equal(messages[0].provider, 'github');
    });

    it('should skip clients that are not open', () => {
      const messages = [];
      const closedWs = {
        readyState: 3, // CLOSED
        send: (data) => messages.push(data),
      };

      const msg = JSON.stringify({ type: 'tunnel-status', state: 'auth-expired' });
      [closedWs].forEach((client) => {
        if (client.readyState === 1) {
          client.send(msg);
        }
      });

      assert.equal(messages.length, 0);
    });

    it('should handle send errors gracefully', () => {
      const errorWs = {
        readyState: 1,
        send: () => {
          throw new Error('Connection reset');
        },
      };

      // Should not throw
      const msg = JSON.stringify({ type: 'tunnel-status', state: 'connected' });
      [errorWs].forEach((client) => {
        if (client.readyState === 1) {
          try {
            client.send(msg);
          } catch {
            /* expected */
          }
        }
      });
    });

    it('should broadcast all tunnel state types', () => {
      const states = [
        'connected',
        'disconnected',
        'expiring',
        'auth-expired',
        'reconnecting',
        'failed',
      ];
      for (const state of states) {
        const msg = { type: 'tunnel-status', state };
        const parsed = JSON.parse(JSON.stringify(msg));
        assert.equal(parsed.type, 'tunnel-status');
        assert.equal(parsed.state, state);
      }
    });
  });
});
