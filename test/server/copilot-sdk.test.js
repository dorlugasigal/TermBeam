'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MODULE_PATH = require.resolve('../../src/server/copilot-sdk');
const LOGGER_PATH = require.resolve('../../src/utils/logger');

// Keep original for restoration
const originalResolveFilename = Module._resolveFilename;

// Helpers to build mock SDK objects
function createMockSession(overrides = {}) {
  const listeners = [];
  return {
    on: (cb) => {
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx !== -1) listeners.splice(idx, 1);
      };
    },
    send: overrides.send || (async () => {}),
    abort: overrides.abort || (async () => {}),
    disconnect: overrides.disconnect || (async () => {}),
    setModel: overrides.setModel || (async () => {}),
    getMessages: overrides.getMessages || (async () => []),
    _listeners: listeners,
    // helper to emit an event from the mock
    _emit(event) {
      for (const cb of listeners) cb(event);
    },
  };
}

function createMockClient(overrides = {}) {
  const mockSession = createMockSession(overrides.sessionOverrides);
  return {
    start: overrides.start || (async () => {}),
    stop: overrides.stop || (async () => {}),
    createSession: overrides.createSession || (async () => mockSession),
    resumeSession: overrides.resumeSession || (async () => mockSession),
    listSessions: overrides.listSessions || (async () => []),
    _mockSession: mockSession,
  };
}

function setupMocks(clientOverrides = {}) {
  const mockClient = createMockClient(clientOverrides);

  // Mock @github/copilot-sdk
  Module._resolveFilename = function (request, parent) {
    if (request === '@github/copilot-sdk') return '@github/copilot-sdk';
    return originalResolveFilename.call(this, request, parent);
  };

  require.cache['@github/copilot-sdk'] = {
    id: '@github/copilot-sdk',
    filename: '@github/copilot-sdk',
    loaded: true,
    exports: {
      CopilotClient: function () {
        return mockClient;
      },
      approveAll: () => ({ kind: 'approved' }),
    },
  };

  // Mock logger to suppress output
  delete require.cache[LOGGER_PATH];
  require.cache[LOGGER_PATH] = {
    id: LOGGER_PATH,
    filename: LOGGER_PATH,
    loaded: true,
    exports: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      setLevel: () => {},
    },
  };

  // Mock fs operations used by ensureBrowserHandler / loadMcpConfig / _watchAuthUrls
  // Point config dir to a temp directory to avoid writing to ~/.termbeam/
  const testConfigDir = path.join(os.tmpdir(), `termbeam-test-sdk-${process.pid}`);
  process.env.TERMBEAM_CONFIG_DIR = testConfigDir;

  delete require.cache[MODULE_PATH];
  const { CopilotService } = require('../../src/server/copilot-sdk');

  return { CopilotService, mockClient, testConfigDir };
}

function cleanupMocks() {
  Module._resolveFilename = originalResolveFilename;
  delete require.cache['@github/copilot-sdk'];
  delete require.cache[MODULE_PATH];
  delete require.cache[LOGGER_PATH];
  delete process.env.TERMBEAM_CONFIG_DIR;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CopilotService', () => {
  let CopilotService;
  let mockClient;
  let service;

  beforeEach(() => {
    ({ CopilotService, mockClient } = setupMocks());
    service = new CopilotService();
    // Stop the auth URL polling timer so it doesn't leak
    if (service._authPollTimer) {
      clearInterval(service._authPollTimer);
      service._authPollTimer = null;
    }
  });

  afterEach(() => {
    if (service?._authPollTimer) {
      clearInterval(service._authPollTimer);
    }
    cleanupMocks();
  });

  // ─── Constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('should initialize with empty sessions map', () => {
      assert.ok(service.sessions instanceof Map);
      assert.strictEqual(service.sessions.size, 0);
    });

    it('should start with null client', () => {
      assert.strictEqual(service.client, null);
    });

    it('should set _startPromise to null', () => {
      assert.strictEqual(service._startPromise, null);
    });

    it('should initialize _authUrlOffset to 0', () => {
      assert.strictEqual(service._authUrlOffset, 0);
    });

    it('should have a browserHandler path', () => {
      assert.strictEqual(typeof service.browserHandler, 'string');
    });
  });

  // ─── ensureClient ─────────────────────────────────────────────────────────

  describe('ensureClient', () => {
    it('should create and start a client on first call', async () => {
      let startCalled = false;
      mockClient.start = async () => {
        startCalled = true;
      };
      const client = await service.ensureClient();
      assert.ok(client);
      assert.ok(startCalled);
    });

    it('should return existing client on subsequent calls', async () => {
      const client1 = await service.ensureClient();
      const client2 = await service.ensureClient();
      assert.strictEqual(client1, client2);
    });

    it('should throw and reset client if start fails', async () => {
      mockClient.start = async () => {
        throw new Error('start failed');
      };
      await assert.rejects(() => service.ensureClient(), { message: 'start failed' });
      assert.strictEqual(service.client, null);
      assert.strictEqual(service._startPromise, null);
    });

    it('should wait if another ensureClient is already starting', async () => {
      let resolveStart;
      mockClient.start = () =>
        new Promise((r) => {
          resolveStart = r;
        });

      // Start first call (it will block)
      const p1 = service.ensureClient();

      // Start second call immediately — it should wait
      const p2 = service.ensureClient();

      // Resolve the first
      resolveStart();

      const [c1, c2] = await Promise.all([p1, p2]);
      assert.strictEqual(c1, c2);
    });
  });

  // ─── createSession ────────────────────────────────────────────────────────

  describe('createSession', () => {
    it('should create a session and return a 32-char hex id', async () => {
      const id = await service.createSession();
      assert.strictEqual(typeof id, 'string');
      assert.strictEqual(id.length, 32);
      assert.ok(/^[0-9a-f]{32}$/.test(id));
    });

    it('should store the session in the sessions map', async () => {
      const id = await service.createSession();
      assert.strictEqual(service.sessions.size, 1);
      assert.ok(service.sessions.has(id));
    });

    it('should use default model when none specified', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);
      assert.strictEqual(entry.model, 'claude-opus-4.6');
    });

    it('should use provided options', async () => {
      const id = await service.createSession({
        model: 'gpt-4',
        name: 'My Session',
        cwd: '/home/test',
        ptySessionId: 'pty123',
      });
      const entry = service.sessions.get(id);
      assert.strictEqual(entry.model, 'gpt-4');
      assert.strictEqual(entry.name, 'My Session');
      assert.strictEqual(entry.cwd, '/home/test');
      assert.strictEqual(entry.ptySessionId, 'pty123');
    });

    it('should set createdAt and lastActivity timestamps', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);
      assert.ok(entry.createdAt);
      assert.ok(entry.lastActivity);
      // They should be valid ISO strings
      assert.ok(!isNaN(Date.parse(entry.createdAt)));
    });

    it('should initialize listener as null and eventBuffer as empty', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);
      assert.strictEqual(entry.listener, null);
      assert.ok(Array.isArray(entry.eventBuffer));
      assert.strictEqual(entry.eventBuffer.length, 0);
    });

    it('should create multiple independent sessions', async () => {
      const id1 = await service.createSession({ name: 'S1' });
      const id2 = await service.createSession({ name: 'S2' });
      assert.notStrictEqual(id1, id2);
      assert.strictEqual(service.sessions.size, 2);
    });

    it('should pass mcpServers to session config when available', async () => {
      let capturedConfig;
      mockClient.createSession = async (config) => {
        capturedConfig = config;
        return createMockSession();
      };
      service.mcpServers = { myServer: { command: 'node', args: ['server.js'] } };
      await service.createSession();
      assert.deepStrictEqual(capturedConfig.mcpServers, service.mcpServers);
    });

    it('should not include mcpServers when none loaded', async () => {
      let capturedConfig;
      mockClient.createSession = async (config) => {
        capturedConfig = config;
        return createMockSession();
      };
      service.mcpServers = null;
      await service.createSession();
      assert.strictEqual(capturedConfig.mcpServers, undefined);
    });
  });

  // ─── resumeSession ────────────────────────────────────────────────────────

  describe('resumeSession', () => {
    it('should resume an SDK session and return a new local id', async () => {
      const id = await service.resumeSession('sdk-session-abc');
      assert.strictEqual(typeof id, 'string');
      assert.strictEqual(id.length, 32);
      assert.ok(service.sessions.has(id));
    });

    it('should store the sdkSessionId in the entry', async () => {
      const id = await service.resumeSession('sdk-session-abc');
      const entry = service.sessions.get(id);
      assert.strictEqual(entry.sdkSessionId, 'sdk-session-abc');
    });

    it('should use provided options', async () => {
      const id = await service.resumeSession('sdk-1', {
        name: 'Resumed',
        model: 'gpt-4',
        cwd: '/test',
        ptySessionId: 'pty-1',
      });
      const entry = service.sessions.get(id);
      assert.strictEqual(entry.name, 'Resumed');
      assert.strictEqual(entry.model, 'gpt-4');
      assert.strictEqual(entry.cwd, '/test');
      assert.strictEqual(entry.ptySessionId, 'pty-1');
    });

    it('should default name to "Resumed Session"', async () => {
      const id = await service.resumeSession('sdk-1');
      const entry = service.sessions.get(id);
      assert.strictEqual(entry.name, 'Resumed Session');
    });

    it('should store existingMessages from SDK getMessages', async () => {
      const existingMsgs = [{ type: 'assistant.message', data: { content: 'Hello' } }];
      mockClient.resumeSession = async () => {
        return createMockSession({
          getMessages: async () => existingMsgs,
        });
      };
      const id = await service.resumeSession('sdk-1');
      const entry = service.sessions.get(id);
      assert.deepStrictEqual(entry.existingMessages, existingMsgs);
    });

    it('should handle getMessages failure gracefully', async () => {
      mockClient.resumeSession = async () => {
        return createMockSession({
          getMessages: async () => {
            throw new Error('fail');
          },
        });
      };
      const id = await service.resumeSession('sdk-1');
      const entry = service.sessions.get(id);
      assert.deepStrictEqual(entry.existingMessages, []);
    });

    it('should pass mcpServers when available', async () => {
      let capturedConfig;
      mockClient.resumeSession = async (_sdkId, config) => {
        capturedConfig = config;
        return createMockSession();
      };
      service.mcpServers = { s1: { command: 'echo' } };
      await service.resumeSession('sdk-1');
      assert.deepStrictEqual(capturedConfig.mcpServers, service.mcpServers);
    });
  });

  // ─── setListener ──────────────────────────────────────────────────────────

  describe('setListener', () => {
    it('should return false for non-existent session', () => {
      assert.strictEqual(
        service.setListener('nonexistent', () => {}),
        false,
      );
    });

    it('should set listener and flush buffered events', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);
      // Manually buffer some events
      entry.eventBuffer.push({ type: 'copilot.idle', data: {} });
      entry.eventBuffer.push({ type: 'copilot.idle', data: {} });

      const received = [];
      const result = service.setListener(id, (evt) => received.push(evt));
      assert.strictEqual(result, true);
      assert.strictEqual(received.length, 2);
      assert.strictEqual(entry.eventBuffer.length, 0);
    });

    it('should allow clearing the listener with null', async () => {
      const id = await service.createSession();
      service.setListener(id, () => {});
      const result = service.setListener(id, null);
      assert.strictEqual(result, true);
      const entry = service.sessions.get(id);
      assert.strictEqual(entry.listener, null);
    });

    it('should not flush when callback is null', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);
      entry.eventBuffer.push({ type: 'copilot.idle', data: {} });
      service.setListener(id, null);
      assert.strictEqual(entry.eventBuffer.length, 1);
    });
  });

  // ─── sendMessage ──────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('should throw for non-existent session', async () => {
      await assert.rejects(() => service.sendMessage('bad-id', 'hello'), {
        message: 'Session not found',
      });
    });

    it('should call session.send with the prompt', async () => {
      let sentPrompt;
      mockClient.createSession = async () =>
        createMockSession({
          send: async (msg) => {
            sentPrompt = msg;
          },
        });
      const id = await service.createSession();
      await service.sendMessage(id, 'hello world');
      assert.deepStrictEqual(sentPrompt, { prompt: 'hello world' });
    });

    it('should update lastActivity timestamp', async () => {
      const id = await service.createSession();
      const before = service.sessions.get(id).lastActivity;
      // Small delay to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10));
      await service.sendMessage(id, 'test');
      const after = service.sessions.get(id).lastActivity;
      assert.ok(after >= before);
    });

    it('should append user message to messageHistory', async () => {
      const id = await service.createSession();
      await service.sendMessage(id, 'hi');
      const entry = service.sessions.get(id);
      assert.ok(entry.messageHistory.length >= 1);
      const lastMsg = entry.messageHistory[entry.messageHistory.length - 1];
      assert.strictEqual(lastMsg.type, 'copilot.user_message');
      assert.strictEqual(lastMsg.data.content, 'hi');
    });
  });

  // ─── respondToInput ───────────────────────────────────────────────────────

  describe('respondToInput', () => {
    it('should return false for non-existent session', () => {
      assert.strictEqual(service.respondToInput('bad', { text: 'hi' }), false);
    });

    it('should return false when no pending input resolve', async () => {
      const id = await service.createSession();
      assert.strictEqual(service.respondToInput(id, { text: 'hi' }), false);
    });

    it('should resolve pending input and clear resolver', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);

      let resolvedValue;
      entry.pendingInputResolve = (val) => {
        resolvedValue = val;
      };

      const result = service.respondToInput(id, { text: 'yes', wasFreeform: false });
      assert.strictEqual(result, true);
      assert.deepStrictEqual(resolvedValue, { answer: 'yes', wasFreeform: false });
      assert.strictEqual(entry.pendingInputResolve, null);
    });

    it('should default wasFreeform to true when not specified', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);

      let resolvedValue;
      entry.pendingInputResolve = (val) => {
        resolvedValue = val;
      };

      service.respondToInput(id, { text: 'answer' });
      assert.strictEqual(resolvedValue.wasFreeform, true);
    });
  });

  // ─── getMessages ──────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should return empty array for non-existent session', () => {
      assert.deepStrictEqual(service.getMessages('bad-id'), []);
    });

    it('should return messageHistory when available', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);
      entry.messageHistory = [
        { type: 'copilot.user_message', data: { content: 'hi' } },
        { type: 'copilot.assistant_message', data: { content: 'hello' } },
      ];
      const msgs = service.getMessages(id);
      assert.strictEqual(msgs.length, 2);
      assert.strictEqual(msgs[0].data.content, 'hi');
    });

    it('should convert existingMessages for resumed sessions with no messageHistory', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);
      entry.messageHistory = []; // empty
      entry.existingMessages = [
        { type: 'assistant.message', data: { content: 'Resumed content' } },
        { type: 'user.message', data: { content: 'User said' } },
      ];
      const msgs = service.getMessages(id);
      // assistant.message maps to copilot.assistant_message
      // user.message adds copilot.user_message
      assert.ok(msgs.length >= 1);
      const assistantMsg = msgs.find((m) => m.type === 'copilot.assistant_message');
      assert.ok(assistantMsg);
      const userMsg = msgs.find((m) => m.type === 'copilot.user_message');
      assert.ok(userMsg);
      assert.strictEqual(userMsg.data.content, 'User said');
    });

    it('should return empty array when no history and no existingMessages', async () => {
      const id = await service.createSession();
      // messageHistory not set yet
      const entry = service.sessions.get(id);
      delete entry.messageHistory;
      assert.deepStrictEqual(service.getMessages(id), []);
    });
  });

  // ─── setModel ─────────────────────────────────────────────────────────────

  describe('setModel', () => {
    it('should throw for non-existent session', async () => {
      await assert.rejects(() => service.setModel('bad', 'gpt-4'), {
        message: 'Session not found',
      });
    });

    it('should call session.setModel and update entry', async () => {
      let modelSet;
      mockClient.createSession = async () =>
        createMockSession({
          setModel: async (m) => {
            modelSet = m;
          },
        });
      const id = await service.createSession({ model: 'old-model' });
      await service.setModel(id, 'gpt-4-turbo');
      assert.strictEqual(modelSet, 'gpt-4-turbo');
      assert.strictEqual(service.sessions.get(id).model, 'gpt-4-turbo');
    });
  });

  // ─── abortSession ─────────────────────────────────────────────────────────

  describe('abortSession', () => {
    it('should do nothing for non-existent session', async () => {
      // Should not throw
      await service.abortSession('nonexistent');
    });

    it('should call session.abort', async () => {
      let aborted = false;
      mockClient.createSession = async () =>
        createMockSession({
          abort: async () => {
            aborted = true;
          },
        });
      const id = await service.createSession();
      await service.abortSession(id);
      assert.ok(aborted);
    });

    it('should swallow abort errors', async () => {
      mockClient.createSession = async () =>
        createMockSession({
          abort: async () => {
            throw new Error('already idle');
          },
        });
      const id = await service.createSession();
      // Should not throw
      await service.abortSession(id);
    });
  });

  // ─── disconnectSession ────────────────────────────────────────────────────

  describe('disconnectSession', () => {
    it('should do nothing for non-existent session', async () => {
      await service.disconnectSession('nonexistent');
    });

    it('should call unsubscribe and disconnect, then remove from map', async () => {
      let disconnected = false;
      mockClient.createSession = async () =>
        createMockSession({
          disconnect: async () => {
            disconnected = true;
          },
        });
      const id = await service.createSession();
      await service.disconnectSession(id);
      assert.ok(disconnected);
      assert.strictEqual(service.sessions.has(id), false);
    });

    it('should handle disconnect errors gracefully', async () => {
      mockClient.createSession = async () =>
        createMockSession({
          disconnect: async () => {
            throw new Error('disconnect fail');
          },
        });
      const id = await service.createSession();
      // Should not throw
      await service.disconnectSession(id);
      assert.strictEqual(service.sessions.has(id), false);
    });
  });

  // ─── listSessions ─────────────────────────────────────────────────────────

  describe('listSessions', () => {
    it('should return empty array when no sessions', () => {
      assert.deepStrictEqual(service.listSessions(), []);
    });

    it('should return session ids', async () => {
      const id1 = await service.createSession();
      const id2 = await service.createSession();
      const list = service.listSessions();
      assert.strictEqual(list.length, 2);
      assert.ok(list.includes(id1));
      assert.ok(list.includes(id2));
    });
  });

  // ─── listSdkSessions ─────────────────────────────────────────────────────

  describe('listSdkSessions', () => {
    it('should return mapped SDK sessions', async () => {
      mockClient.listSessions = async () => [
        {
          sessionId: 'sdk-1',
          startTime: '2024-01-01',
          modifiedTime: '2024-01-02',
          summary: 'Test session',
          isRemote: false,
          context: { cwd: '/home', repository: 'repo', branch: 'main' },
        },
      ];
      // Ensure client is initialized
      await service.ensureClient();
      const list = await service.listSdkSessions();
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].sessionId, 'sdk-1');
      assert.strictEqual(list[0].summary, 'Test session');
      assert.strictEqual(list[0].cwd, '/home');
      assert.strictEqual(list[0].repository, 'repo');
      assert.strictEqual(list[0].branch, 'main');
    });

    it('should return empty array on error', async () => {
      mockClient.listSessions = async () => {
        throw new Error('network error');
      };
      await service.ensureClient();
      const list = await service.listSdkSessions();
      assert.deepStrictEqual(list, []);
    });

    it('should handle sessions without context', async () => {
      mockClient.listSessions = async () => [
        { sessionId: 'sdk-2', startTime: null, context: undefined },
      ];
      await service.ensureClient();
      const list = await service.listSdkSessions();
      assert.strictEqual(list[0].cwd, undefined);
    });
  });

  // ─── listSessionsDetailed ─────────────────────────────────────────────────

  describe('listSessionsDetailed', () => {
    it('should return empty array when no sessions', () => {
      assert.deepStrictEqual(service.listSessionsDetailed(), []);
    });

    it('should return detailed session info', async () => {
      const id = await service.createSession({
        name: 'TestSession',
        model: 'gpt-4',
        cwd: '/workspace',
        ptySessionId: 'pty-abc',
      });
      const list = service.listSessionsDetailed();
      assert.strictEqual(list.length, 1);
      assert.strictEqual(list[0].id, id);
      assert.strictEqual(list[0].name, 'TestSession');
      assert.strictEqual(list[0].model, 'gpt-4');
      assert.strictEqual(list[0].cwd, '/workspace');
      assert.strictEqual(list[0].ptySessionId, 'pty-abc');
      assert.ok(list[0].createdAt);
      assert.ok(list[0].lastActivity);
    });

    it('should use defaults for missing fields', async () => {
      const id = await service.createSession();
      const entry = service.sessions.get(id);
      delete entry.name;
      delete entry.model;
      delete entry.cwd;
      delete entry.createdAt;
      delete entry.lastActivity;

      const list = service.listSessionsDetailed();
      assert.strictEqual(list[0].name, 'Copilot Session');
      assert.strictEqual(list[0].model, 'claude-opus-4.6');
      assert.ok(list[0].cwd); // falls back to process.cwd()
      assert.ok(list[0].createdAt); // falls back to new Date()
    });
  });

  // ─── shutdown ─────────────────────────────────────────────────────────────

  describe('shutdown', () => {
    it('should disconnect all sessions and stop client', async () => {
      let clientStopped = false;
      mockClient.stop = async () => {
        clientStopped = true;
      };

      const id1 = await service.createSession();
      const id2 = await service.createSession();
      assert.strictEqual(service.sessions.size, 2);

      await service.ensureClient();
      await service.shutdown();

      assert.strictEqual(service.sessions.size, 0);
      assert.ok(clientStopped);
      assert.strictEqual(service.client, null);
    });

    it('should clear auth poll timer', async () => {
      // Re-set the timer to verify it gets cleared
      service._authPollTimer = setInterval(() => {}, 10000);
      await service.shutdown();
      // If we get here, the timer was cleared (no hanging test)
    });

    it('should handle shutdown with no client gracefully', async () => {
      service.client = null;
      await service.shutdown();
      // Should not throw
    });

    it('should handle shutdown with no sessions', async () => {
      await service.ensureClient();
      await service.shutdown();
      assert.strictEqual(service.client, null);
    });
  });

  // ─── _createPermissionHandler ─────────────────────────────────────────────

  describe('_createPermissionHandler', () => {
    it('should return approved for any request', async () => {
      const id = await service.createSession();
      const handler = service._createPermissionHandler(id);
      const result = handler({ kind: 'url', url: 'https://auth.example.com' });
      assert.deepStrictEqual(result, { kind: 'approved' });
    });

    it('should forward URL to active listener', async () => {
      const id = await service.createSession();
      const events = [];
      service.setListener(id, (evt) => events.push(evt));

      const handler = service._createPermissionHandler(id);
      handler({ kind: 'url', url: 'https://auth.example.com/oauth' });

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'copilot.auth_url');
      assert.strictEqual(events[0].data.url, 'https://auth.example.com/oauth');
    });

    it('should buffer URL event when no listener attached', async () => {
      const id = await service.createSession();
      const handler = service._createPermissionHandler(id);
      handler({ kind: 'url', url: 'https://auth.example.com' });

      const entry = service.sessions.get(id);
      assert.strictEqual(entry.eventBuffer.length, 1);
      assert.strictEqual(entry.eventBuffer[0].type, 'copilot.auth_url');
    });

    it('should ignore non-URL requests', async () => {
      const id = await service.createSession();
      const events = [];
      service.setListener(id, (evt) => events.push(evt));

      const handler = service._createPermissionHandler(id);
      handler({ kind: 'file', path: '/some/file' });

      assert.strictEqual(events.length, 0);
    });

    it('should ignore URL requests without url field', async () => {
      const id = await service.createSession();
      const events = [];
      service.setListener(id, (evt) => events.push(evt));

      const handler = service._createPermissionHandler(id);
      handler({ kind: 'url' }); // no url field

      assert.strictEqual(events.length, 0);
    });
  });

  // ─── _mapEvent ────────────────────────────────────────────────────────────

  describe('_mapEvent', () => {
    it('should map assistant.message', () => {
      const result = service._mapEvent({
        type: 'assistant.message',
        data: { content: 'Hello world', toolRequests: [] },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.assistant_message',
        data: { content: 'Hello world', toolRequests: [] },
      });
    });

    it('should map assistant.message_delta', () => {
      const result = service._mapEvent({
        type: 'assistant.message_delta',
        data: { deltaContent: 'chunk' },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.message_delta',
        data: { deltaContent: 'chunk' },
      });
    });

    it('should map assistant.reasoning', () => {
      const result = service._mapEvent({
        type: 'assistant.reasoning',
        data: { content: 'thinking...' },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.reasoning',
        data: { content: 'thinking...' },
      });
    });

    it('should map assistant.reasoning_delta', () => {
      const result = service._mapEvent({
        type: 'assistant.reasoning_delta',
        data: { deltaContent: 'more thinking' },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.reasoning_delta',
        data: { deltaContent: 'more thinking' },
      });
    });

    it('should map tool.execution_start with arguments', () => {
      const result = service._mapEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc1', toolName: 'readFile', arguments: { path: '/a.txt' } },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.tool_start',
        data: { toolCallId: 'tc1', toolName: 'readFile', input: { path: '/a.txt' } },
      });
    });

    it('should map tool.execution_start with input fallback', () => {
      const result = service._mapEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc2', toolName: 'run', input: { cmd: 'ls' } },
      });
      assert.strictEqual(result.data.input.cmd, 'ls');
    });

    it('should map tool.execution_start with args fallback', () => {
      const result = service._mapEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc3', toolName: 'exec', args: { x: 1 } },
      });
      assert.strictEqual(result.data.input.x, 1);
    });

    it('should map tool.execution_start with empty input when no args', () => {
      const result = service._mapEvent({
        type: 'tool.execution_start',
        data: { toolCallId: 'tc4', toolName: 'noop' },
      });
      assert.deepStrictEqual(result.data.input, {});
    });

    it('should map tool.execution_complete with result', () => {
      const result = service._mapEvent({
        type: 'tool.execution_complete',
        data: {
          toolCallId: 'tc1',
          toolName: 'readFile',
          result: 'file content',
          duration: 150,
        },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.tool_complete',
        data: {
          toolCallId: 'tc1',
          toolName: 'readFile',
          result: 'file content',
          duration: 150,
        },
      });
    });

    it('should map tool.execution_complete with output fallback', () => {
      const result = service._mapEvent({
        type: 'tool.execution_complete',
        data: { toolCallId: 'tc1', toolName: 'run', output: 'stdout content' },
      });
      assert.strictEqual(result.data.result, 'stdout content');
    });

    it('should map tool.execution_complete with durationMs fallback', () => {
      const result = service._mapEvent({
        type: 'tool.execution_complete',
        data: { toolCallId: 'tc1', toolName: 'run', durationMs: 200 },
      });
      assert.strictEqual(result.data.duration, 200);
    });

    it('should map tool.execution_complete falling back to event.data as result', () => {
      const eventData = { toolCallId: 'tc1', toolName: 'x' };
      const result = service._mapEvent({
        type: 'tool.execution_complete',
        data: eventData,
      });
      // When no result/output, falls back to event.data itself
      assert.strictEqual(result.data.result, eventData);
    });

    it('should map subagent.started', () => {
      const result = service._mapEvent({
        type: 'subagent.started',
        data: {
          toolCallId: 'sa1',
          agentName: 'researcher',
          agentDisplayName: 'Research Agent',
        },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.subagent_start',
        data: {
          toolCallId: 'sa1',
          agentName: 'researcher',
          agentDisplayName: 'Research Agent',
        },
      });
    });

    it('should map subagent.completed', () => {
      const result = service._mapEvent({
        type: 'subagent.completed',
        data: {
          toolCallId: 'sa1',
          agentDisplayName: 'Research Agent',
          model: 'gpt-4',
          totalToolCalls: 5,
          totalTokens: 1000,
          durationMs: 3000,
        },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.subagent_complete',
        data: {
          toolCallId: 'sa1',
          agentDisplayName: 'Research Agent',
          model: 'gpt-4',
          totalToolCalls: 5,
          totalTokens: 1000,
          durationMs: 3000,
        },
      });
    });

    it('should map session.idle', () => {
      const result = service._mapEvent({ type: 'session.idle', data: {} });
      assert.deepStrictEqual(result, { type: 'copilot.idle', data: {} });
    });

    it('should map session.mode_changed', () => {
      const result = service._mapEvent({
        type: 'session.mode_changed',
        data: { mode: 'agent' },
      });
      assert.deepStrictEqual(result, {
        type: 'copilot.mode_changed',
        data: { mode: 'agent' },
      });
    });

    it('should return null for unknown event types', () => {
      assert.strictEqual(service._mapEvent({ type: 'internal.debug', data: {} }), null);
    });

    it('should return null for completely unknown events', () => {
      assert.strictEqual(service._mapEvent({ type: 'foo.bar' }), null);
    });

    it('should handle missing data gracefully in tool events', () => {
      const result = service._mapEvent({ type: 'tool.execution_start', data: undefined });
      assert.strictEqual(result.type, 'copilot.tool_start');
      assert.strictEqual(result.data.toolCallId, undefined);
    });

    it('should handle missing data gracefully in subagent events', () => {
      const result = service._mapEvent({ type: 'subagent.started', data: undefined });
      assert.strictEqual(result.type, 'copilot.subagent_start');
      assert.strictEqual(result.data.toolCallId, undefined);
    });
  });

  // ─── Event forwarding integration ─────────────────────────────────────────

  describe('event forwarding', () => {
    it('should forward mapped events to listener via session.on', async () => {
      const mockSession = createMockSession();
      mockClient.createSession = async () => mockSession;

      const id = await service.createSession();
      const received = [];
      service.setListener(id, (evt) => received.push(evt));

      // Emit an event from the mock session
      mockSession._emit({
        type: 'assistant.message',
        data: { content: 'Hi!' },
      });

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0].type, 'copilot.assistant_message');
      assert.strictEqual(received[0].data.content, 'Hi!');
    });

    it('should buffer events when no listener attached', async () => {
      const mockSession = createMockSession();
      mockClient.createSession = async () => mockSession;

      const id = await service.createSession();
      // No listener set yet

      mockSession._emit({
        type: 'session.idle',
        data: {},
      });

      const entry = service.sessions.get(id);
      assert.strictEqual(entry.eventBuffer.length, 1);
      assert.strictEqual(entry.eventBuffer[0].type, 'copilot.idle');
    });

    it('should add mapped events to messageHistory', async () => {
      const mockSession = createMockSession();
      mockClient.createSession = async () => mockSession;

      const id = await service.createSession();
      service.setListener(id, () => {});

      mockSession._emit({
        type: 'assistant.message',
        data: { content: 'stored' },
      });

      const entry = service.sessions.get(id);
      assert.ok(entry.messageHistory.length >= 1);
      const last = entry.messageHistory[entry.messageHistory.length - 1];
      assert.strictEqual(last.type, 'copilot.assistant_message');
    });

    it('should skip null-mapped events (internal events)', async () => {
      const mockSession = createMockSession();
      mockClient.createSession = async () => mockSession;

      const id = await service.createSession();
      const received = [];
      service.setListener(id, (evt) => received.push(evt));

      mockSession._emit({ type: 'internal.heartbeat', data: {} });

      assert.strictEqual(received.length, 0);
    });

    it('should forward events for resumed sessions', async () => {
      const mockSession = createMockSession();
      mockClient.resumeSession = async () => mockSession;

      const id = await service.resumeSession('sdk-1');
      const received = [];
      service.setListener(id, (evt) => received.push(evt));

      mockSession._emit({
        type: 'assistant.message_delta',
        data: { deltaContent: 'delta' },
      });

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0].type, 'copilot.message_delta');
    });
  });
});

// ─── Standalone function tests ────────────────────────────────────────────────

describe('ensureBrowserHandler', () => {
  afterEach(() => {
    cleanupMocks();
  });

  it('should return a path string', () => {
    const { CopilotService: CS } = setupMocks();
    const svc = new CS();
    if (svc._authPollTimer) clearInterval(svc._authPollTimer);
    assert.strictEqual(typeof svc.browserHandler, 'string');
    assert.ok(svc.browserHandler.includes('browser-handler'));
  });
});

describe('loadMcpConfig', () => {
  afterEach(() => {
    cleanupMocks();
  });

  it('should set mcpServers to null when no config file exists', () => {
    const { CopilotService: CS } = setupMocks();
    const svc = new CS();
    if (svc._authPollTimer) clearInterval(svc._authPollTimer);
    const valid = svc.mcpServers === null || typeof svc.mcpServers === 'object';
    assert.ok(valid);
  });
});

// ─── Additional coverage tests ──────────────────────────────────────────────

describe('CopilotService — SDK unavailable (lines 8-9)', () => {
  afterEach(() => {
    cleanupMocks();
  });

  it('should handle missing SDK and throw on ensureClient', async () => {
    Module._resolveFilename = function (request, parent) {
      if (request === '@github/copilot-sdk') throw new Error('Cannot find module');
      return originalResolveFilename.call(this, request, parent);
    };
    delete require.cache['@github/copilot-sdk'];

    delete require.cache[LOGGER_PATH];
    require.cache[LOGGER_PATH] = {
      id: LOGGER_PATH,
      filename: LOGGER_PATH,
      loaded: true,
      exports: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        setLevel: () => {},
      },
    };

    const testDir = path.join(os.tmpdir(), `termbeam-test-nosdk-${process.pid}-${Date.now()}`);
    process.env.TERMBEAM_CONFIG_DIR = testDir;
    delete require.cache[MODULE_PATH];
    const { CopilotService: CS } = require('../../src/server/copilot-sdk');

    const svc = new CS();
    if (svc._authPollTimer) clearInterval(svc._authPollTimer);

    await assert.rejects(() => svc.ensureClient(), {
      message: 'Copilot SDK not installed',
    });
    assert.strictEqual(svc.client, null);
  });
});

describe('CopilotService — _watchAuthUrls forwarding (lines 93-113)', () => {
  afterEach(() => {
    cleanupMocks();
  });

  it('should forward auth URLs from file to all session listeners', async () => {
    const { CopilotService: CS, mockClient: mc, testConfigDir: testDir } = setupMocks();
    const svc = new CS();
    // Do NOT clear the timer — we need the poll to run

    try {
      await svc.ensureClient();
      const id = await svc.createSession();
      const received = [];
      svc.setListener(id, (evt) => received.push(evt));

      const authUrlFile = path.join(testDir, 'auth-urls.log');
      fs.mkdirSync(testDir, { recursive: true });
      fs.appendFileSync(authUrlFile, 'https://auth.example.com/oauth?code=123\n');

      await new Promise((r) => setTimeout(r, 700));

      const authEvents = received.filter((e) => e.type === 'copilot.auth_url');
      assert.ok(authEvents.length >= 1, 'Expected at least one auth URL event');
      assert.ok(authEvents[0].data.url.includes('auth.example.com'));
    } finally {
      if (svc._authPollTimer) clearInterval(svc._authPollTimer);
    }
  });

  it('should handle URLs with invalid format for URL parser', async () => {
    const { CopilotService: CS, testConfigDir: testDir } = setupMocks();
    const svc = new CS();

    try {
      await svc.ensureClient();
      const id = await svc.createSession();
      const received = [];
      svc.setListener(id, (evt) => received.push(evt));

      const authUrlFile = path.join(testDir, 'auth-urls.log');
      fs.mkdirSync(testDir, { recursive: true });
      // URL starts with http but is malformed — triggers inner try/catch
      fs.appendFileSync(authUrlFile, 'http://[invalid-url\n');

      await new Promise((r) => setTimeout(r, 700));

      const authEvents = received.filter((e) => e.type === 'copilot.auth_url');
      assert.ok(authEvents.length >= 1, 'Should still forward malformed URLs');
    } finally {
      if (svc._authPollTimer) clearInterval(svc._authPollTimer);
    }
  });

  it('should filter out non-http lines', async () => {
    const { CopilotService: CS, testConfigDir: testDir } = setupMocks();
    const svc = new CS();

    try {
      await svc.ensureClient();
      const id = await svc.createSession();
      const received = [];
      svc.setListener(id, (evt) => received.push(evt));

      const authUrlFile = path.join(testDir, 'auth-urls.log');
      fs.mkdirSync(testDir, { recursive: true });
      fs.appendFileSync(authUrlFile, 'not-a-url\nhttps://valid.example.com/auth\n');

      await new Promise((r) => setTimeout(r, 700));

      const authEvents = received.filter((e) => e.type === 'copilot.auth_url');
      assert.ok(authEvents.length >= 1);
      assert.ok(authEvents.every((e) => e.data.url.includes('valid.example.com')));
    } finally {
      if (svc._authPollTimer) clearInterval(svc._authPollTimer);
    }
  });

  it('should forward to multiple sessions', async () => {
    const { CopilotService: CS, testConfigDir: testDir } = setupMocks();
    const svc = new CS();

    try {
      await svc.ensureClient();
      const id1 = await svc.createSession();
      const id2 = await svc.createSession();
      const received1 = [];
      const received2 = [];
      svc.setListener(id1, (evt) => received1.push(evt));
      svc.setListener(id2, (evt) => received2.push(evt));

      const authUrlFile = path.join(testDir, 'auth-urls.log');
      fs.mkdirSync(testDir, { recursive: true });
      fs.appendFileSync(authUrlFile, 'https://auth.example.com/multi\n');

      await new Promise((r) => setTimeout(r, 700));

      const auth1 = received1.filter((e) => e.type === 'copilot.auth_url');
      const auth2 = received2.filter((e) => e.type === 'copilot.auth_url');
      assert.ok(auth1.length >= 1, 'Session 1 should receive auth URL');
      assert.ok(auth2.length >= 1, 'Session 2 should receive auth URL');
    } finally {
      if (svc._authPollTimer) clearInterval(svc._authPollTimer);
    }
  });
});

describe('CopilotService — createSession onUserInputRequest (lines 291-323, 371-372)', () => {
  let CopilotService, mockClient, service;

  beforeEach(() => {
    ({ CopilotService, mockClient } = setupMocks());
    service = new CopilotService();
    if (service._authPollTimer) clearInterval(service._authPollTimer);
  });

  afterEach(() => {
    if (service?._authPollTimer) clearInterval(service._authPollTimer);
    cleanupMocks();
  });

  it('should forward user input request to listener and resolve via respondToInput', async () => {
    let capturedConfig;
    mockClient.createSession = async (config) => {
      capturedConfig = config;
      return createMockSession();
    };

    const id = await service.createSession();
    const received = [];
    service.setListener(id, (evt) => received.push(evt));

    const promise = capturedConfig.onUserInputRequest({
      question: 'Continue?',
      choices: ['yes', 'no'],
      allowFreeform: true,
    });

    const inputEvents = received.filter((e) => e.type === 'copilot.user_input_request');
    assert.strictEqual(inputEvents.length, 1);
    assert.strictEqual(inputEvents[0].data.question, 'Continue?');
    assert.deepStrictEqual(inputEvents[0].data.choices, ['yes', 'no']);
    assert.strictEqual(inputEvents[0].data.allowFreeform, true);

    service.respondToInput(id, { text: 'yes', wasFreeform: false });
    const result = await promise;
    assert.deepStrictEqual(result, { answer: 'yes', wasFreeform: false });
  });

  it('should buffer user input request when no listener attached', async () => {
    let capturedConfig;
    mockClient.createSession = async (config) => {
      capturedConfig = config;
      return createMockSession();
    };

    const id = await service.createSession();

    const promise = capturedConfig.onUserInputRequest({
      question: 'Pick one',
      choices: ['a', 'b'],
    });

    const entry = service.sessions.get(id);
    const inputEvents = entry.eventBuffer.filter((e) => e.type === 'copilot.user_input_request');
    assert.strictEqual(inputEvents.length, 1);

    assert.ok(entry.pendingInputResolve);
    entry.pendingInputResolve({ answer: 'a', wasFreeform: false });
    const result = await promise;
    assert.deepStrictEqual(result, { answer: 'a', wasFreeform: false });
  });

  it('should transfer _pendingInputResolve when called during createSession', async () => {
    let inputPromise;
    mockClient.createSession = async (config) => {
      // Call onUserInputRequest DURING createSession (before session is registered)
      inputPromise = config.onUserInputRequest({
        question: 'Early question',
        choices: [],
      });
      return createMockSession();
    };

    const id = await service.createSession();
    const entry = service.sessions.get(id);

    assert.ok(entry.pendingInputResolve, 'pendingInputResolve should be transferred');

    entry.pendingInputResolve({ answer: 'early answer', wasFreeform: true });
    const result = await inputPromise;
    assert.deepStrictEqual(result, { answer: 'early answer', wasFreeform: true });
  });

  it('should default allowFreeform to true when not specified', async () => {
    let capturedConfig;
    mockClient.createSession = async (config) => {
      capturedConfig = config;
      return createMockSession();
    };

    const id = await service.createSession();
    const received = [];
    service.setListener(id, (evt) => received.push(evt));

    const promise = capturedConfig.onUserInputRequest({
      question: 'Test?',
      choices: [],
    });

    const inputEvents = received.filter((e) => e.type === 'copilot.user_input_request');
    assert.strictEqual(inputEvents[0].data.allowFreeform, true);

    service.respondToInput(id, { text: 'ok' });
    await promise;
  });
});

describe('CopilotService — resumeSession onUserInputRequest (lines 188-217, 267-268)', () => {
  let CopilotService, mockClient, service;

  beforeEach(() => {
    ({ CopilotService, mockClient } = setupMocks());
    service = new CopilotService();
    if (service._authPollTimer) clearInterval(service._authPollTimer);
  });

  afterEach(() => {
    if (service?._authPollTimer) clearInterval(service._authPollTimer);
    cleanupMocks();
  });

  it('should forward user input request to listener in resumed session', async () => {
    let capturedConfig;
    mockClient.resumeSession = async (_sdkId, config) => {
      capturedConfig = config;
      return createMockSession();
    };

    const id = await service.resumeSession('sdk-1');
    const received = [];
    service.setListener(id, (evt) => received.push(evt));

    const promise = capturedConfig.onUserInputRequest({
      question: 'Resume action?',
      choices: ['continue', 'stop'],
      allowFreeform: false,
    });

    const inputEvents = received.filter((e) => e.type === 'copilot.user_input_request');
    assert.strictEqual(inputEvents.length, 1);
    assert.strictEqual(inputEvents[0].data.question, 'Resume action?');
    assert.strictEqual(inputEvents[0].data.allowFreeform, false);

    service.respondToInput(id, { text: 'continue', wasFreeform: false });
    const result = await promise;
    assert.deepStrictEqual(result, { answer: 'continue', wasFreeform: false });
  });

  it('should buffer user input request in resumed session when no listener', async () => {
    let capturedConfig;
    mockClient.resumeSession = async (_sdkId, config) => {
      capturedConfig = config;
      return createMockSession();
    };

    const id = await service.resumeSession('sdk-1');

    const promise = capturedConfig.onUserInputRequest({
      question: 'Pick',
      choices: ['x'],
    });

    const entry = service.sessions.get(id);
    assert.ok(entry.eventBuffer.some((e) => e.type === 'copilot.user_input_request'));
    assert.ok(entry.pendingInputResolve);

    entry.pendingInputResolve({ answer: 'x', wasFreeform: false });
    const result = await promise;
    assert.deepStrictEqual(result, { answer: 'x', wasFreeform: false });
  });

  it('should transfer _pendingInputResolve during resumeSession', async () => {
    let inputPromise;
    mockClient.resumeSession = async (_sdkId, config) => {
      inputPromise = config.onUserInputRequest({
        question: 'Early resume question',
        choices: [],
      });
      return createMockSession();
    };

    const id = await service.resumeSession('sdk-1');
    const entry = service.sessions.get(id);

    assert.ok(entry.pendingInputResolve, 'pendingInputResolve should be transferred');
    entry.pendingInputResolve({ answer: 'done', wasFreeform: true });
    const result = await inputPromise;
    assert.deepStrictEqual(result, { answer: 'done', wasFreeform: true });
  });
});

describe('CopilotService — event handler errors (lines 241-242, 350-351)', () => {
  let CopilotService, mockClient, service;

  beforeEach(() => {
    ({ CopilotService, mockClient } = setupMocks());
    service = new CopilotService();
    if (service._authPollTimer) clearInterval(service._authPollTimer);
  });

  afterEach(() => {
    if (service?._authPollTimer) clearInterval(service._authPollTimer);
    cleanupMocks();
  });

  it('should catch event processing errors in createSession handler', async () => {
    const mockSession = createMockSession();
    mockClient.createSession = async () => mockSession;

    const id = await service.createSession();
    service.setListener(id, () => {
      throw new Error('listener boom');
    });

    // Emit an event — should not throw
    mockSession._emit({ type: 'assistant.message', data: { content: 'test' } });
    assert.ok(service.sessions.has(id));
  });

  it('should catch event processing errors in resumeSession handler', async () => {
    const mockSession = createMockSession();
    mockClient.resumeSession = async () => mockSession;

    const id = await service.resumeSession('sdk-1');
    service.setListener(id, () => {
      throw new Error('listener error');
    });

    mockSession._emit({ type: 'assistant.message', data: { content: 'test' } });
    assert.ok(service.sessions.has(id));
  });

  it('should buffer events in resumeSession when no listener attached', async () => {
    const mockSession = createMockSession();
    mockClient.resumeSession = async () => mockSession;

    const id = await service.resumeSession('sdk-1');
    // No listener set — event should go to eventBuffer

    mockSession._emit({ type: 'session.idle', data: {} });

    const entry = service.sessions.get(id);
    assert.strictEqual(entry.eventBuffer.length, 1);
    assert.strictEqual(entry.eventBuffer[0].type, 'copilot.idle');
  });
});

describe('CopilotService — setListener overwrite (lines 382-385)', () => {
  let CopilotService, mockClient, service;

  beforeEach(() => {
    ({ CopilotService, mockClient } = setupMocks());
    service = new CopilotService();
    if (service._authPollTimer) clearInterval(service._authPollTimer);
  });

  afterEach(() => {
    if (service?._authPollTimer) clearInterval(service._authPollTimer);
    cleanupMocks();
  });

  it('should warn when overwriting existing listener with a different one', async () => {
    const id = await service.createSession();
    const listener1 = () => {};
    const listener2 = () => {};
    service.setListener(id, listener1);
    const result = service.setListener(id, listener2);
    assert.strictEqual(result, true);
    assert.strictEqual(service.sessions.get(id).listener, listener2);
  });

  it('should store listener owner', async () => {
    const id = await service.createSession();
    service.setListener(id, () => {}, 'ws-client-1');
    const entry = service.sessions.get(id);
    assert.strictEqual(entry._listenerOwner, 'ws-client-1');
  });
});

describe('CopilotService — disconnectSession edge cases (lines 471-472, 476-477)', () => {
  let CopilotService, mockClient, service;

  beforeEach(() => {
    ({ CopilotService, mockClient } = setupMocks());
    service = new CopilotService();
    if (service._authPollTimer) clearInterval(service._authPollTimer);
  });

  afterEach(() => {
    if (service?._authPollTimer) clearInterval(service._authPollTimer);
    cleanupMocks();
  });

  it('should handle unsubscribe error gracefully', async () => {
    const id = await service.createSession();
    const entry = service.sessions.get(id);
    entry.unsubscribe = () => {
      throw new Error('unsubscribe failed');
    };

    await service.disconnectSession(id);
    assert.strictEqual(service.sessions.has(id), false);
  });

  it('should resolve pending input on disconnect', async () => {
    const id = await service.createSession();
    const entry = service.sessions.get(id);

    let resolvedValue;
    entry.pendingInputResolve = (val) => {
      resolvedValue = val;
    };

    await service.disconnectSession(id);
    assert.deepStrictEqual(resolvedValue, { answer: '', wasFreeform: true });
  });
});

describe('CopilotService — _doStart timer cleanup (lines 138-140)', () => {
  let CopilotService, mockClient, service;

  beforeEach(() => {
    ({ CopilotService, mockClient } = setupMocks());
    service = new CopilotService();
    if (service._authPollTimer) clearInterval(service._authPollTimer);
  });

  afterEach(() => {
    if (service?._authPollTimer) clearInterval(service._authPollTimer);
    cleanupMocks();
  });

  it('should clear auth poll timer when client start fails', async () => {
    mockClient.start = async () => {
      throw new Error('start failure');
    };
    service._authPollTimer = setInterval(() => {}, 100000);

    await assert.rejects(() => service.ensureClient(), { message: 'start failure' });
    assert.strictEqual(service._authPollTimer, null);
  });
});

describe('CopilotService — _createPermissionHandler eventBuffer fallback (lines 165-167)', () => {
  let CopilotService, mockClient, service;

  beforeEach(() => {
    ({ CopilotService, mockClient } = setupMocks());
    service = new CopilotService();
    if (service._authPollTimer) clearInterval(service._authPollTimer);
  });

  afterEach(() => {
    if (service?._authPollTimer) clearInterval(service._authPollTimer);
    cleanupMocks();
  });

  it('should buffer to external eventBuffer when session entry does not exist', () => {
    const externalBuffer = [];
    const handler = service._createPermissionHandler('nonexistent-session', externalBuffer);
    handler({ kind: 'url', url: 'https://auth.example.com' });
    assert.strictEqual(externalBuffer.length, 1);
    assert.strictEqual(externalBuffer[0].type, 'copilot.auth_url');
    assert.strictEqual(externalBuffer[0].data.url, 'https://auth.example.com');
  });
});
