const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Interactive', () => {
  it('exports runInteractiveSetup as a function', () => {
    const { runInteractiveSetup } = require('../src/interactive');
    assert.strictEqual(typeof runInteractiveSetup, 'function');
  });

  it('can be required without errors', () => {
    assert.doesNotThrow(() => require('../src/interactive'));
  });
});
