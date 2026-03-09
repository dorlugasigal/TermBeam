const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const log = require('../../src/utils/logger');

describe('logger', () => {
  let originalLog, originalWarn, originalError;
  let logCalls, warnCalls, errorCalls;

  beforeEach(() => {
    log.setLevel('info');
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    logCalls = [];
    warnCalls = [];
    errorCalls = [];
    console.log = (...args) => logCalls.push(args);
    console.warn = (...args) => warnCalls.push(args);
    console.error = (...args) => errorCalls.push(args);
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    log.setLevel('info');
  });

  it('default level is info', () => {
    assert.strictEqual(log.getLevel(), 'info');
  });

  it('setLevel changes the level', () => {
    log.setLevel('debug');
    assert.strictEqual(log.getLevel(), 'debug');
  });

  it('setLevel ignores invalid levels', () => {
    log.setLevel('invalid');
    assert.strictEqual(log.getLevel(), 'info');
  });

  it('at info level, debug messages are suppressed', () => {
    log.debug('test');
    assert.strictEqual(logCalls.length, 0);
  });

  it('at info level, info/warn/error messages are shown', () => {
    log.info('info msg');
    log.warn('warn msg');
    log.error('error msg');
    assert.strictEqual(logCalls.length, 1);
    assert.strictEqual(warnCalls.length, 1);
    assert.strictEqual(errorCalls.length, 1);
  });

  it('at debug level, all messages are shown', () => {
    log.setLevel('debug');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.strictEqual(logCalls.length, 2);
    assert.strictEqual(warnCalls.length, 1);
    assert.strictEqual(errorCalls.length, 1);
  });

  it('at warn level, only warn and error are shown', () => {
    log.setLevel('warn');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.strictEqual(logCalls.length, 0);
    assert.strictEqual(warnCalls.length, 1);
    assert.strictEqual(errorCalls.length, 1);
  });

  it('at error level, only errors are shown', () => {
    log.setLevel('error');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    assert.strictEqual(logCalls.length, 0);
    assert.strictEqual(warnCalls.length, 0);
    assert.strictEqual(errorCalls.length, 1);
  });

  it('messages include timestamp and level prefix', () => {
    log.info('hello');
    assert.ok(
      logCalls[0][0].match(/^\[\d{2}:\d{2}:\d{2}\]$/),
      'First arg should be [HH:MM:SS] timestamp',
    );
    assert.strictEqual(logCalls[0][1], '[INFO]');
    assert.strictEqual(logCalls[0][2], 'hello');
  });
});
