const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const tunnel = require('../../src/tunnel');
const { isNetworkError, isAuthError } = tunnel._internal;

describe('tunnel watchdog classification', () => {
  it('isNetworkError detects common DNS/connectivity failures', () => {
    const cases = [
      'nodename nor servname provided, or not known',
      'getaddrinfo ENOTFOUND uks1.rel.tunnels.api.visualstudio.com',
      'connect ECONNREFUSED 20.0.0.1:443',
      'connect ETIMEDOUT',
      'Network is unreachable',
      'Temporary failure in name resolution',
      'EAI_AGAIN some-host',
    ];
    for (const msg of cases) {
      assert.equal(isNetworkError(msg), true, `expected network error: ${msg}`);
    }
  });

  it('isNetworkError returns false for non-network messages', () => {
    assert.equal(isNetworkError('login required'), false);
    assert.equal(isNetworkError('tunnel not found'), false);
    assert.equal(isNetworkError(''), false);
    assert.equal(isNetworkError(null), false);
    assert.equal(isNetworkError(undefined), false);
  });

  it('isAuthError detects auth-related messages', () => {
    assert.equal(isAuthError('Login required'), true);
    assert.equal(isAuthError('not logged in'), true);
    assert.equal(isAuthError('Sign in required'), true);
  });

  it('isAuthError ignores network errors', () => {
    assert.equal(isAuthError('getaddrinfo ENOTFOUND'), false);
    assert.equal(isAuthError('ECONNREFUSED'), false);
  });
});

describe('tunnel watchdog public surface', () => {
  it('exposes tunnelEvents emitter', () => {
    assert.ok(tunnel.tunnelEvents);
    assert.equal(typeof tunnel.tunnelEvents.on, 'function');
    assert.equal(typeof tunnel.tunnelEvents.emit, 'function');
  });

  it('network-lost/network-restored events are emitable', () => {
    let lost = 0;
    let restored = 0;
    const onLost = () => lost++;
    const onRestored = () => restored++;
    tunnel.tunnelEvents.on('network-lost', onLost);
    tunnel.tunnelEvents.on('network-restored', onRestored);
    try {
      tunnel.tunnelEvents.emit('network-lost');
      tunnel.tunnelEvents.emit('network-restored');
      assert.equal(lost, 1);
      assert.equal(restored, 1);
    } finally {
      tunnel.tunnelEvents.off('network-lost', onLost);
      tunnel.tunnelEvents.off('network-restored', onRestored);
    }
  });
});
