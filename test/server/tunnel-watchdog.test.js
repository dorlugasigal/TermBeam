'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');

// We can't easily test the real watchdog (requires devtunnel CLI), so we test:
// 1. The tunnelEvents export is a proper EventEmitter
// 2. The module exports the expected API
// 3. The server mock contract matches the real module exports

describe('tunnel watchdog', () => {
  describe('module exports', () => {
    it('should export tunnelEvents as an EventEmitter', () => {
      // Clear cache to get fresh module (won't actually spawn anything
      // since we don't call startTunnel)
      const tunnelPath = require.resolve('../../src/tunnel');
      delete require.cache[tunnelPath];
      const tunnel = require('../../src/tunnel');

      assert.ok(tunnel.tunnelEvents, 'tunnelEvents should be exported');
      assert.ok(
        tunnel.tunnelEvents instanceof EventEmitter,
        'tunnelEvents should be an EventEmitter',
      );
      assert.equal(typeof tunnel.tunnelEvents.on, 'function');
      assert.equal(typeof tunnel.tunnelEvents.emit, 'function');

      // Clean up
      delete require.cache[tunnelPath];
    });

    it('should export startTunnel, cleanupTunnel, findDevtunnel', () => {
      const tunnelPath = require.resolve('../../src/tunnel');
      delete require.cache[tunnelPath];
      const tunnel = require('../../src/tunnel');

      assert.equal(typeof tunnel.startTunnel, 'function');
      assert.equal(typeof tunnel.cleanupTunnel, 'function');
      assert.equal(typeof tunnel.findDevtunnel, 'function');

      delete require.cache[tunnelPath];
    });
  });

  describe('tunnelEvents contract', () => {
    let emitter;

    beforeEach(() => {
      emitter = new EventEmitter();
    });

    it('should emit connected with url', () => {
      const events = [];
      emitter.on('connected', (data) => events.push(data));
      emitter.emit('connected', { url: 'https://test.devtunnels.ms/' });
      assert.equal(events.length, 1);
      assert.equal(events[0].url, 'https://test.devtunnels.ms/');
    });

    it('should emit disconnected', () => {
      let called = false;
      emitter.on('disconnected', () => {
        called = true;
      });
      emitter.emit('disconnected');
      assert.ok(called);
    });

    it('should emit reconnecting with attempt and delay', () => {
      const events = [];
      emitter.on('reconnecting', (data) => events.push(data));
      emitter.emit('reconnecting', { attempt: 3, delay: 5000 });
      assert.equal(events.length, 1);
      assert.equal(events[0].attempt, 3);
      assert.equal(events[0].delay, 5000);
    });

    it('should emit failed with attempts count', () => {
      const events = [];
      emitter.on('failed', (data) => events.push(data));
      emitter.emit('failed', { attempts: 10 });
      assert.equal(events.length, 1);
      assert.equal(events[0].attempts, 10);
    });

    it('should support multiple listeners', () => {
      let count = 0;
      emitter.on('disconnected', () => count++);
      emitter.on('disconnected', () => count++);
      emitter.emit('disconnected');
      assert.equal(count, 2);
    });
  });

  describe('server mock compatibility', () => {
    it('mock should match real module export shape', () => {
      const tunnelPath = require.resolve('../../src/tunnel');
      delete require.cache[tunnelPath];
      const real = require('../../src/tunnel');
      const realKeys = Object.keys(real).sort();

      // This is the mock shape from server.test.js
      const mockKeys = ['findDevtunnel', 'startTunnel', 'cleanupTunnel', 'tunnelEvents'].sort();

      assert.deepEqual(realKeys, mockKeys, 'Mock exports should match real module exports');

      delete require.cache[tunnelPath];
    });
  });
});
