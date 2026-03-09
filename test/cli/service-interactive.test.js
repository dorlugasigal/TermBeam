const { describe, it } = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('stream');
const readline = require('readline');

const { ask, choose, confirm } = require('../../src/cli/service');

function createMockRL() {
  const input = new PassThrough();
  const output = new PassThrough();
  const rl = readline.createInterface({ input, output });
  return { rl, input, output };
}

describe('ask()', () => {
  it('returns user input when provided', async () => {
    const { rl, input } = createMockRL();
    const promise = ask(rl, 'Name:');
    input.write('hello\n');
    assert.strictEqual(await promise, 'hello');
    rl.close();
  });

  it('returns default value when user presses Enter', async () => {
    const { rl, input } = createMockRL();
    const promise = ask(rl, 'Name:', 'world');
    input.write('\n');
    assert.strictEqual(await promise, 'world');
    rl.close();
  });

  it('returns empty string when no default and empty input', async () => {
    const { rl, input } = createMockRL();
    const promise = ask(rl, 'Name:');
    input.write('\n');
    assert.strictEqual(await promise, '');
    rl.close();
  });

  it('trims whitespace from input', async () => {
    const { rl, input } = createMockRL();
    const promise = ask(rl, 'Name:');
    input.write('  spaced  \n');
    assert.strictEqual(await promise, 'spaced');
    rl.close();
  });

  it('uses default when input is only whitespace', async () => {
    const { rl, input } = createMockRL();
    const promise = ask(rl, 'Name:', 'fallback');
    input.write('   \n');
    assert.strictEqual(await promise, 'fallback');
    rl.close();
  });

  it('converts numeric default to string', async () => {
    const { rl, input } = createMockRL();
    const promise = ask(rl, 'Port:', 3000);
    input.write('\n');
    assert.strictEqual(await promise, '3000');
    rl.close();
  });
});

describe('confirm()', () => {
  it('returns true for "y"', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?');
    input.write('y\n');
    assert.strictEqual(await promise, true);
    rl.close();
  });

  it('returns true for "yes"', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?');
    input.write('yes\n');
    assert.strictEqual(await promise, true);
    rl.close();
  });

  it('returns true for "Y"', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?');
    input.write('Y\n');
    assert.strictEqual(await promise, true);
    rl.close();
  });

  it('returns false for "n"', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?');
    input.write('n\n');
    assert.strictEqual(await promise, false);
    rl.close();
  });

  it('returns false for "no"', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?');
    input.write('no\n');
    assert.strictEqual(await promise, false);
    rl.close();
  });

  it('returns false for "N"', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?');
    input.write('N\n');
    assert.strictEqual(await promise, false);
    rl.close();
  });

  it('returns defaultYes (true) on empty input', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?', true);
    input.write('\n');
    assert.strictEqual(await promise, true);
    rl.close();
  });

  it('returns defaultYes (false) on empty input', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?', false);
    input.write('\n');
    assert.strictEqual(await promise, false);
    rl.close();
  });

  it('trims whitespace before checking', async () => {
    const { rl, input } = createMockRL();
    const promise = confirm(rl, 'Continue?');
    input.write('  yes  \n');
    assert.strictEqual(await promise, true);
    rl.close();
  });
});

describe('choose()', () => {
  it('selects first item on Enter with string choices', async () => {
    const { rl } = createMockRL();
    const promise = choose(rl, 'Pick:', ['Option A', 'Option B']);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\r'));
    const result = await promise;
    assert.strictEqual(result.index, 0);
    assert.strictEqual(result.value, 'Option A');
    rl.close();
  });

  it('selects second item with down arrow then Enter', async () => {
    const { rl } = createMockRL();
    const promise = choose(rl, 'Pick:', ['Option A', 'Option B']);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\x1b[B'));
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\r'));
    const result = await promise;
    assert.strictEqual(result.index, 1);
    assert.strictEqual(result.value, 'Option B');
    rl.close();
  });

  it('wraps around with up arrow from first item', async () => {
    const { rl } = createMockRL();
    const promise = choose(rl, 'Pick:', ['A', 'B', 'C']);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\x1b[A'));
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\r'));
    const result = await promise;
    assert.strictEqual(result.index, 2);
    assert.strictEqual(result.value, 'C');
    rl.close();
  });

  it('accepts {label, hint} object choices', async () => {
    const { rl } = createMockRL();
    const choices = [
      { label: 'Start', hint: 'Begin process' },
      { label: 'Stop', hint: 'End process' },
    ];
    const promise = choose(rl, 'Action:', choices);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\r'));
    const result = await promise;
    assert.strictEqual(result.index, 0);
    assert.strictEqual(result.value, 'Start');
    rl.close();
  });

  it('handles warn hint choices', async () => {
    const { rl } = createMockRL();
    const choices = [{ label: 'Risky', hint: 'May fail', warn: true }];
    const promise = choose(rl, 'Pick:', choices);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\r'));
    const result = await promise;
    assert.strictEqual(result.index, 0);
    assert.strictEqual(result.value, 'Risky');
    rl.close();
  });

  it('handles danger hint choices', async () => {
    const { rl } = createMockRL();
    const choices = [{ label: 'Delete', hint: 'Permanent!', danger: true }];
    const promise = choose(rl, 'Pick:', choices);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\r'));
    const result = await promise;
    assert.strictEqual(result.index, 0);
    assert.strictEqual(result.value, 'Delete');
    rl.close();
  });

  it('respects defaultIndex', async () => {
    const { rl } = createMockRL();
    const promise = choose(rl, 'Pick:', ['A', 'B', 'C'], 2);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\r'));
    const result = await promise;
    assert.strictEqual(result.index, 2);
    assert.strictEqual(result.value, 'C');
    rl.close();
  });

  it('navigates with j/k keys', async () => {
    const { rl } = createMockRL();
    const promise = choose(rl, 'Pick:', ['A', 'B', 'C']);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('j'));
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('j'));
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('k'));
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\r'));
    const result = await promise;
    assert.strictEqual(result.index, 1);
    assert.strictEqual(result.value, 'B');
    rl.close();
  });

  it('accepts newline as Enter', async () => {
    const { rl } = createMockRL();
    const promise = choose(rl, 'Pick:', ['Only']);
    await new Promise((r) => setImmediate(r));
    process.stdin.emit('data', Buffer.from('\n'));
    const result = await promise;
    assert.strictEqual(result.index, 0);
    assert.strictEqual(result.value, 'Only');
    rl.close();
  });
});
