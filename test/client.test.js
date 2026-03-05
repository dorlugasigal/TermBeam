const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');

// ── Mock WebSocket ───────────────────────────────────────────────────────────

class MockWS extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.readyState = 1; // OPEN
    this.closed = false;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

// Inject mock ws module into require cache before loading client
const realWsPath = require.resolve('ws');
const savedWsCache = require.cache[realWsPath];

describe('client', () => {
  let createTerminalClient;
  let FakeWSClass;
  let lastWsInstance;

  beforeEach(() => {
    // Create a fake WebSocket class that mimics ws behavior
    FakeWSClass = class extends MockWS {
      constructor() {
        super();
        lastWsInstance = this;
        // Simulate async open
        process.nextTick(() => this.emit('open'));
      }
    };
    FakeWSClass.OPEN = 1;
    FakeWSClass.CONNECTING = 0;

    // Override ws in require cache
    require.cache[realWsPath] = {
      id: realWsPath,
      filename: realWsPath,
      loaded: true,
      exports: FakeWSClass,
    };

    // Clear client from cache so it picks up the mock
    const clientPath = require.resolve('../src/client');
    delete require.cache[clientPath];
    ({ createTerminalClient } = require('../src/client'));
  });

  afterEach(() => {
    // Restore ws
    if (savedWsCache) {
      require.cache[realWsPath] = savedWsCache;
    } else {
      delete require.cache[realWsPath];
    }
    const clientPath = require.resolve('../src/client');
    delete require.cache[clientPath];
  });

  it('should send auth then attach when password is provided', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: 'secret',
      sessionId: 'abc123',
    });

    // Wait for open handler to fire
    await new Promise((r) => setTimeout(r, 20));

    // Should have sent auth message
    assert.deepStrictEqual(lastWsInstance.sent[0], { type: 'auth', password: 'secret' });

    // Simulate auth_ok
    lastWsInstance.emit('message', JSON.stringify({ type: 'auth_ok' }));
    await new Promise((r) => setTimeout(r, 10));

    // Should have sent attach
    assert.deepStrictEqual(lastWsInstance.sent[1], { type: 'attach', sessionId: 'abc123' });

    // Close to resolve the promise
    lastWsInstance.emit('close');
    const result = await promise;
    assert.equal(result.reason, 'connection closed');
  });

  it('should attach directly when no password', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(lastWsInstance.sent[0], { type: 'attach', sessionId: 'abc123' });

    lastWsInstance.emit('close');
    await promise;
  });

  it('should resolve with exit reason when session exits', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));

    lastWsInstance.emit('message', JSON.stringify({ type: 'exit', code: 0 }));
    const result = await promise;
    assert.equal(result.reason, 'session exited with code 0');
  });

  it('should resolve with error reason on server error', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));

    lastWsInstance.emit('message', JSON.stringify({ type: 'error', message: 'Session not found' }));
    const result = await promise;
    assert.equal(result.reason, 'error: Session not found');
  });

  it('should reject on connection error', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));

    lastWsInstance.emit('error', new Error('ECONNREFUSED'));
    await assert.rejects(promise, { message: 'ECONNREFUSED' });
  });

  it('should handle unparseable messages gracefully', async () => {
    const promise = createTerminalClient({
      url: 'ws://localhost:3456/ws',
      password: null,
      sessionId: 'abc123',
    });

    await new Promise((r) => setTimeout(r, 20));

    // Send invalid JSON — should not throw
    lastWsInstance.emit('message', 'not json{{{');
    await new Promise((r) => setTimeout(r, 10));

    lastWsInstance.emit('close');
    await promise;
  });
});
