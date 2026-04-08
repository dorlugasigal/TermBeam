'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { setupWebSocket } = require('../../src/server/websocket');

// --- Mock helpers (same pattern as websocket.test.js) ---

function createMockAuth(password = null) {
  const tokens = new Set();
  return {
    password,
    generateToken() {
      const t = 'tok_' + Math.random().toString(36).slice(2);
      tokens.add(t);
      return t;
    },
    validateToken(t) {
      return tokens.has(t);
    },
    parseCookies(str) {
      const cookies = {};
      if (!str) return cookies;
      str.split(';').forEach((pair) => {
        const [k, ...v] = pair.trim().split('=');
        if (k) cookies[k.trim()] = v.join('=');
      });
      return cookies;
    },
  };
}

function createMockSessions() {
  const map = new Map();
  return {
    get(id) {
      return map.get(id);
    },
    _add(session) {
      map.set(session.id, session);
    },
  };
}

function createMockWs() {
  const sent = [];
  const closeCbs = [];
  return {
    readyState: 1,
    send(data) {
      sent.push(JSON.parse(data));
    },
    close(code, reason) {
      this._closed = true;
      this._closeCode = code;
      this._closeReason = reason;
    },
    ping() {},
    terminate() {
      this._terminated = true;
    },
    on(event, cb) {
      if (event === 'message') this._onMessage = cb;
      if (event === 'close') closeCbs.push(cb);
      if (event === 'pong') this._onPong = cb;
    },
    _sent: sent,
    _closed: false,
    _terminated: false,
    _closeCbs: closeCbs,
    async _simulateMessage(obj) {
      await this._onMessage(Buffer.from(JSON.stringify(obj)));
    },
    _simulateClose() {
      this._closeCbs.forEach((cb) => cb());
    },
  };
}

function createMockWss() {
  return {
    on(event, cb) {
      if (event === 'connection') this._onConnection = cb;
    },
    _simulateConnection(ws, req) {
      const defaultReq = { headers: {}, socket: { remoteAddress: '127.0.0.1' } };
      this._onConnection(ws, req ? { ...defaultReq, ...req } : defaultReq);
    },
  };
}

// --- Mock CopilotService ---

function createMockCopilotService(overrides = {}) {
  const sessionsMap = new Map();
  const listeners = new Map();
  const calls = {
    createSession: [],
    resumeSession: [],
    sendMessage: [],
    abortSession: [],
    setModel: [],
    getMessages: [],
    respondToInput: [],
    setListener: [],
  };

  return {
    sessions: sessionsMap,
    _listeners: listeners,
    _calls: calls,

    async createSession(options = {}) {
      calls.createSession.push(options);
      if (overrides.createSessionError) {
        throw new Error(overrides.createSessionError);
      }
      const id = overrides.sessionId || 'mock-sdk-session-1';
      sessionsMap.set(id, {
        model: options.model || 'claude-opus-4.6',
        listener: null,
        eventBuffer: [],
      });
      return id;
    },

    async resumeSession(sdkSessionId, options = {}) {
      calls.resumeSession.push({ sdkSessionId, options });
      if (overrides.resumeSessionError) {
        throw new Error(overrides.resumeSessionError);
      }
      const id = overrides.resumeSessionId || 'mock-resumed-session-1';
      sessionsMap.set(id, {
        model: options.model || 'claude-opus-4.6',
        listener: null,
        eventBuffer: [],
        existingMessages: overrides.existingMessages || [],
      });
      return id;
    },

    async sendMessage(sessionId, prompt) {
      calls.sendMessage.push({ sessionId, prompt });
      if (overrides.sendMessageError) {
        throw new Error(overrides.sendMessageError);
      }
    },

    async abortSession(sessionId) {
      calls.abortSession.push(sessionId);
    },

    async setModel(sessionId, model) {
      calls.setModel.push({ sessionId, model });
      if (overrides.setModelError) {
        throw new Error(overrides.setModelError);
      }
      const entry = sessionsMap.get(sessionId);
      if (!entry) throw new Error('Session not found');
      entry.model = model;
    },

    getMessages(sessionId) {
      calls.getMessages.push(sessionId);
      if (overrides.messages) return overrides.messages;
      return [];
    },

    respondToInput(sessionId, answer) {
      calls.respondToInput.push({ sessionId, answer });
      return true;
    },

    setListener(sessionId, callback, owner) {
      calls.setListener.push({ sessionId, callback, owner });
      listeners.set(sessionId, callback);
      const entry = sessionsMap.get(sessionId);
      if (entry) {
        entry.listener = callback;
        entry._listenerOwner = owner || null;
      }
      return true;
    },
  };
}

// --- Tests ---

describe('Copilot WebSocket handlers', () => {
  let wss, auth, sessions, copilotService;

  beforeEach(() => {
    wss = createMockWss();
    auth = createMockAuth(); // no password → auto-authenticated
    sessions = createMockSessions();
    copilotService = createMockCopilotService();
    setupWebSocket(wss, { auth, sessions, copilotService });
  });

  function connectWs(req) {
    const ws = createMockWs();
    wss._simulateConnection(ws, req);
    return ws;
  }

  // ---- copilot.create ----

  describe('copilot.create', () => {
    it('should create a session and respond with copilot.created', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create', model: 'gpt-4o' });

      const created = ws._sent.find((m) => m.type === 'copilot.created');
      assert.ok(created, 'should receive copilot.created');
      assert.strictEqual(created.data.sessionId, 'mock-sdk-session-1');
      assert.strictEqual(copilotService._calls.createSession.length, 1);
      assert.strictEqual(copilotService._calls.createSession[0].model, 'gpt-4o');
    });

    it('should set a listener that forwards events to WebSocket', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });

      assert.strictEqual(copilotService._calls.setListener.length, 1);
      const listenerCall = copilotService._calls.setListener[0];
      assert.strictEqual(listenerCall.sessionId, 'mock-sdk-session-1');
      assert.strictEqual(typeof listenerCall.callback, 'function');

      // Simulate an event via the listener
      listenerCall.callback({ type: 'copilot.message_delta', data: { deltaContent: 'hello' } });
      const delta = ws._sent.find((m) => m.type === 'copilot.message_delta');
      assert.ok(delta, 'listener should forward events to WS');
      assert.strictEqual(delta.data.deltaContent, 'hello');
    });

    it('should not forward events if WebSocket is closed', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });

      const listenerCall = copilotService._calls.setListener[0];
      ws.readyState = 3; // CLOSED
      const sentBefore = ws._sent.length;
      listenerCall.callback({ type: 'copilot.idle', data: {} });
      assert.strictEqual(ws._sent.length, sentBefore, 'should not send to closed WS');
    });

    it('should reuse existing session on duplicate create', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      const firstCreated = ws._sent.find((m) => m.type === 'copilot.created');
      assert.ok(firstCreated);

      // Second create should reuse existing session
      await ws._simulateMessage({ type: 'copilot.create' });
      const createdMessages = ws._sent.filter((m) => m.type === 'copilot.created');
      assert.strictEqual(createdMessages.length, 2);
      // createSession should only be called once
      assert.strictEqual(copilotService._calls.createSession.length, 1);
    });

    it('should send copilot.error on createSession failure', async () => {
      copilotService = createMockCopilotService({ createSessionError: 'SDK init failed' });
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions, copilotService });

      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });

      const err = ws._sent.find((m) => m.type === 'copilot.error');
      assert.ok(err, 'should receive copilot.error');
      assert.strictEqual(err.data.message, 'SDK init failed');
    });

    it('should store copilotSessionId on the WebSocket', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      assert.strictEqual(ws._copilotSessionId, 'mock-sdk-session-1');
    });
  });

  // ---- copilot.attach ----

  describe('copilot.attach', () => {
    it('should attach to an existing session', async () => {
      copilotService.sessions.set('existing-session', {
        model: 'gpt-4o',
        listener: null,
        eventBuffer: [],
      });

      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.attach', sessionId: 'existing-session' });

      const created = ws._sent.find((m) => m.type === 'copilot.created');
      assert.ok(created);
      assert.strictEqual(created.data.sessionId, 'existing-session');
      assert.strictEqual(created.data.model, 'gpt-4o');
    });

    it('should create a new session if attached session does not exist', async () => {
      const ws = connectWs();
      await ws._simulateMessage({
        type: 'copilot.attach',
        sessionId: 'gone-session',
        model: 'gpt-4o',
      });

      // Since session doesn't exist, it creates a new one
      assert.strictEqual(copilotService._calls.createSession.length, 1);
      const created = ws._sent.find((m) => m.type === 'copilot.created');
      assert.ok(created);
      assert.strictEqual(created.data.sessionId, 'mock-sdk-session-1');
    });

    it('should send copilot.error if auto-create fails on attach', async () => {
      copilotService = createMockCopilotService({ createSessionError: 'Cannot create' });
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions, copilotService });

      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.attach', sessionId: 'gone' });

      const err = ws._sent.find((m) => m.type === 'copilot.error');
      assert.ok(err);
      assert.strictEqual(err.data.message, 'Cannot create');
    });

    it('should send message_history if existing messages', async () => {
      const msgs = [{ type: 'copilot.message_delta', data: { deltaContent: 'hi' } }];
      copilotService = createMockCopilotService({ messages: msgs });
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions, copilotService });
      copilotService.sessions.set('has-history', {
        model: 'gpt-4o',
        listener: null,
        eventBuffer: [],
      });

      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.attach', sessionId: 'has-history' });

      const history = ws._sent.find((m) => m.type === 'copilot.message_history');
      assert.ok(history, 'should send message history');
      assert.deepStrictEqual(history.data.messages, msgs);
    });

    it('should not send message_history if empty', async () => {
      copilotService.sessions.set('no-history', {
        model: 'gpt-4o',
        listener: null,
        eventBuffer: [],
      });

      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.attach', sessionId: 'no-history' });

      const history = ws._sent.find((m) => m.type === 'copilot.message_history');
      assert.ok(!history, 'should not send empty message history');
    });
  });

  // ---- copilot.send ----

  describe('copilot.send', () => {
    it('should send a message to the copilot session', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      await ws._simulateMessage({ type: 'copilot.send', prompt: 'hello world' });

      assert.strictEqual(copilotService._calls.sendMessage.length, 1);
      assert.strictEqual(copilotService._calls.sendMessage[0].sessionId, 'mock-sdk-session-1');
      assert.strictEqual(copilotService._calls.sendMessage[0].prompt, 'hello world');
    });

    it('should silently return if no copilot session is set', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.send', prompt: 'hello' });

      assert.strictEqual(copilotService._calls.sendMessage.length, 0);
      assert.strictEqual(ws._sent.length, 0);
    });

    it('should send copilot.error on sendMessage failure', async () => {
      copilotService = createMockCopilotService({ sendMessageError: 'Rate limited' });
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions, copilotService });

      const ws = connectWs();
      // Manually set copilot session ID to bypass create
      await ws._simulateMessage({ type: 'copilot.create' });
      await ws._simulateMessage({ type: 'copilot.send', prompt: 'test' });

      const err = ws._sent.find((m) => m.type === 'copilot.error');
      assert.ok(err, 'should receive copilot.error');
      assert.strictEqual(err.data.message, 'Rate limited');
    });
  });

  // ---- copilot.cancel ----

  describe('copilot.cancel', () => {
    it('should abort the copilot session', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      await ws._simulateMessage({ type: 'copilot.cancel' });

      assert.strictEqual(copilotService._calls.abortSession.length, 1);
      assert.strictEqual(copilotService._calls.abortSession[0], 'mock-sdk-session-1');
    });

    it('should silently return if no copilot session is set', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.cancel' });

      assert.strictEqual(copilotService._calls.abortSession.length, 0);
    });
  });

  // ---- copilot.set_model ----

  describe('copilot.set_model', () => {
    it('should change the model and respond with copilot.model_changed', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      await ws._simulateMessage({ type: 'copilot.set_model', model: 'gpt-4o-mini' });

      const changed = ws._sent.find((m) => m.type === 'copilot.model_changed');
      assert.ok(changed, 'should receive copilot.model_changed');
      assert.strictEqual(changed.data.model, 'gpt-4o-mini');
      assert.strictEqual(copilotService._calls.setModel.length, 1);
      assert.strictEqual(copilotService._calls.setModel[0].model, 'gpt-4o-mini');
    });

    it('should silently return if no copilot session is set', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.set_model', model: 'gpt-4o' });

      assert.strictEqual(copilotService._calls.setModel.length, 0);
      assert.strictEqual(ws._sent.length, 0);
    });

    it('should send copilot.error on setModel failure', async () => {
      copilotService = createMockCopilotService({ setModelError: 'Model not available' });
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions, copilotService });

      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      await ws._simulateMessage({ type: 'copilot.set_model', model: 'invalid-model' });

      const err = ws._sent.find((m) => m.type === 'copilot.error');
      assert.ok(err, 'should receive copilot.error');
      assert.strictEqual(err.data.message, 'Model not available');
    });
  });

  // ---- copilot.get_messages ----

  describe('copilot.get_messages', () => {
    it('should return message history', async () => {
      const msgs = [
        { type: 'copilot.user_message', data: { content: 'hi' } },
        { type: 'copilot.assistant_message', data: { content: 'hello' } },
      ];
      copilotService = createMockCopilotService({ messages: msgs });
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions, copilotService });

      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      await ws._simulateMessage({ type: 'copilot.get_messages' });

      const history = ws._sent.find((m) => m.type === 'copilot.message_history');
      assert.ok(history, 'should receive copilot.message_history');
      assert.deepStrictEqual(history.data.messages, msgs);
    });

    it('should return empty array when no messages', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      await ws._simulateMessage({ type: 'copilot.get_messages' });

      const history = ws._sent.find((m) => m.type === 'copilot.message_history');
      assert.ok(history);
      assert.deepStrictEqual(history.data.messages, []);
    });

    it('should silently return if no copilot session is set', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.get_messages' });

      assert.strictEqual(copilotService._calls.getMessages.length, 0);
      assert.strictEqual(ws._sent.length, 0);
    });
  });

  // ---- copilot.input_response ----

  describe('copilot.input_response', () => {
    it('should forward user input response', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      await ws._simulateMessage({
        type: 'copilot.input_response',
        answer: { text: 'yes', wasFreeform: false },
      });

      assert.strictEqual(copilotService._calls.respondToInput.length, 1);
      assert.strictEqual(copilotService._calls.respondToInput[0].sessionId, 'mock-sdk-session-1');
      assert.deepStrictEqual(copilotService._calls.respondToInput[0].answer, {
        text: 'yes',
        wasFreeform: false,
      });
    });

    it('should silently return if no copilot session is set', async () => {
      const ws = connectWs();
      await ws._simulateMessage({
        type: 'copilot.input_response',
        answer: { text: 'hi' },
      });

      assert.strictEqual(copilotService._calls.respondToInput.length, 0);
    });
  });

  // ---- copilot.resume ----

  describe('copilot.resume', () => {
    it('should resume a session and respond with copilot.created', async () => {
      const ws = connectWs();
      await ws._simulateMessage({
        type: 'copilot.resume',
        sdkSessionId: 'sdk-abc-123',
        model: 'gpt-4o',
      });

      const created = ws._sent.find((m) => m.type === 'copilot.created');
      assert.ok(created, 'should receive copilot.created');
      assert.strictEqual(created.data.sessionId, 'mock-resumed-session-1');
      assert.strictEqual(copilotService._calls.resumeSession.length, 1);
      assert.strictEqual(copilotService._calls.resumeSession[0].sdkSessionId, 'sdk-abc-123');
    });

    it('should set listener and store copilot session on ws', async () => {
      const ws = connectWs();
      await ws._simulateMessage({
        type: 'copilot.resume',
        sdkSessionId: 'sdk-abc-123',
      });

      assert.strictEqual(ws._copilotSessionId, 'mock-resumed-session-1');
      const listenerCall = copilotService._calls.setListener.find(
        (c) => c.sessionId === 'mock-resumed-session-1',
      );
      assert.ok(listenerCall, 'should set listener for resumed session');
    });

    it('should send copilot.error when sdkSessionId is missing', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.resume' });

      const err = ws._sent.find((m) => m.type === 'copilot.error');
      assert.ok(err, 'should receive copilot.error');
      assert.strictEqual(err.data.message, 'Missing sdkSessionId');
    });

    it('should send copilot.error on resumeSession failure', async () => {
      copilotService = createMockCopilotService({ resumeSessionError: 'Session expired' });
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions, copilotService });

      const ws = connectWs();
      await ws._simulateMessage({
        type: 'copilot.resume',
        sdkSessionId: 'sdk-expired',
      });

      const err = ws._sent.find((m) => m.type === 'copilot.error');
      assert.ok(err, 'should receive copilot.error');
      assert.strictEqual(err.data.message, 'Session expired');
    });

    it('should send message_history for resumed session with existing messages', async () => {
      const existingMsgs = [{ type: 'copilot.assistant_message', data: { content: 'old msg' } }];
      copilotService = createMockCopilotService({ existingMessages: existingMsgs });
      wss = createMockWss();
      setupWebSocket(wss, { auth, sessions, copilotService });

      const ws = connectWs();
      await ws._simulateMessage({
        type: 'copilot.resume',
        sdkSessionId: 'sdk-with-history',
      });

      const history = ws._sent.find((m) => m.type === 'copilot.message_history');
      assert.ok(history, 'should send existing message history');
      assert.deepStrictEqual(history.data.messages, existingMsgs);
    });
  });

  // ---- WebSocket close ----

  describe('close behavior', () => {
    it('should detach listener on WS close when copilot session exists', async () => {
      const ws = connectWs();
      await ws._simulateMessage({ type: 'copilot.create' });
      assert.strictEqual(ws._copilotSessionId, 'mock-sdk-session-1');

      ws._simulateClose();

      // setListener should be called with null to detach
      const detachCall = copilotService._calls.setListener.find(
        (c) => c.sessionId === 'mock-sdk-session-1' && c.callback === null,
      );
      assert.ok(detachCall, 'should call setListener(sid, null) on close');
    });

    it('should not call setListener on close if no copilot session', () => {
      const ws = connectWs();
      ws._simulateClose();

      const detachCalls = copilotService._calls.setListener.filter((c) => c.callback === null);
      assert.strictEqual(detachCalls.length, 0);
    });
  });

  // ---- Require authentication ----

  describe('authentication', () => {
    it('should reject copilot messages when not authenticated', async () => {
      const protectedAuth = createMockAuth('secret123');
      const protectedWss = createMockWss();
      setupWebSocket(protectedWss, { auth: protectedAuth, sessions, copilotService });

      const ws = createMockWs();
      protectedWss._simulateConnection(ws);

      await ws._simulateMessage({ type: 'copilot.create' });

      const err = ws._sent.find((m) => m.type === 'error');
      assert.ok(err, 'should receive error');
      assert.strictEqual(err.message, 'Unauthorized');
      assert.ok(ws._closed);
    });

    it('should allow copilot messages after successful auth', async () => {
      const protectedAuth = createMockAuth('secret123');
      const protectedWss = createMockWss();
      setupWebSocket(protectedWss, { auth: protectedAuth, sessions, copilotService });

      const ws = createMockWs();
      protectedWss._simulateConnection(ws);

      await ws._simulateMessage({ type: 'auth', password: 'secret123' });
      const authOk = ws._sent.find((m) => m.type === 'auth_ok');
      assert.ok(authOk);

      await ws._simulateMessage({ type: 'copilot.create' });
      const created = ws._sent.find((m) => m.type === 'copilot.created');
      assert.ok(created, 'should allow copilot.create after auth');
    });
  });

  // ---- No copilotService ----

  describe('copilotService disabled', () => {
    it('should ignore copilot messages when copilotService is null', async () => {
      const noSdkWss = createMockWss();
      setupWebSocket(noSdkWss, { auth, sessions, copilotService: null });

      const ws = createMockWs();
      noSdkWss._simulateConnection(ws);
      await ws._simulateMessage({ type: 'copilot.create' });

      assert.strictEqual(ws._sent.length, 0, 'should not respond to copilot messages');
    });

    it('should ignore copilot messages when copilotService is undefined', async () => {
      const noSdkWss = createMockWss();
      setupWebSocket(noSdkWss, { auth, sessions });

      const ws = createMockWs();
      noSdkWss._simulateConnection(ws);
      await ws._simulateMessage({ type: 'copilot.create' });

      assert.strictEqual(ws._sent.length, 0);
    });
  });
});
