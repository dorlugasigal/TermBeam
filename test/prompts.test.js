const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  color,
  green,
  yellow,
  red,
  cyan,
  bold,
  dim,
  ask,
  confirm,
  createRL,
} = require('../src/prompts');

function mockRL(answer) {
  return {
    question: (_q, cb) => cb(answer),
    pause: () => {},
    resume: () => {},
    close: () => {},
  };
}

describe('Prompts', () => {
  describe('color helpers', () => {
    it('color() wraps text with ANSI code', () => {
      assert.strictEqual(color('32', 'text'), '\x1b[32mtext\x1b[0m');
    });

    it('green()', () => {
      assert.strictEqual(green('ok'), '\x1b[32mok\x1b[0m');
    });

    it('yellow()', () => {
      assert.strictEqual(yellow('warn'), '\x1b[33mwarn\x1b[0m');
    });

    it('red()', () => {
      assert.strictEqual(red('err'), '\x1b[31merr\x1b[0m');
    });

    it('cyan()', () => {
      assert.strictEqual(cyan('info'), '\x1b[36minfo\x1b[0m');
    });

    it('bold()', () => {
      assert.strictEqual(bold('strong'), '\x1b[1mstrong\x1b[0m');
    });

    it('dim()', () => {
      assert.strictEqual(dim('faint'), '\x1b[2mfaint\x1b[0m');
    });
  });

  describe('createRL', () => {
    it('returns a readline interface that can be closed', () => {
      const rl = createRL();
      assert.ok(rl);
      assert.strictEqual(typeof rl.question, 'function');
      assert.strictEqual(typeof rl.close, 'function');
      rl.close();
    });
  });

  describe('ask', () => {
    it('returns the user answer trimmed', async () => {
      const rl = mockRL('  hello  ');
      const result = await ask(rl, 'Name?');
      assert.strictEqual(result, 'hello');
    });

    it('returns the default value when answer is empty', async () => {
      const rl = mockRL('');
      const result = await ask(rl, 'Port?', 3456);
      assert.strictEqual(result, '3456');
    });

    it('returns empty string when no default and answer is empty', async () => {
      const rl = mockRL('');
      const result = await ask(rl, 'Name?');
      assert.strictEqual(result, '');
    });

    it('returns user answer over default when both exist', async () => {
      const rl = mockRL('8080');
      const result = await ask(rl, 'Port?', 3456);
      assert.strictEqual(result, '8080');
    });
  });

  describe('confirm', () => {
    it('returns true when user answers y', async () => {
      const rl = mockRL('y');
      const result = await confirm(rl, 'Continue?');
      assert.strictEqual(result, true);
    });

    it('returns true when user answers yes', async () => {
      const rl = mockRL('yes');
      const result = await confirm(rl, 'Continue?');
      assert.strictEqual(result, true);
    });

    it('returns false when user answers n', async () => {
      const rl = mockRL('n');
      const result = await confirm(rl, 'Continue?');
      assert.strictEqual(result, false);
    });

    it('returns default (true) when answer is empty and defaultYes=true', async () => {
      const rl = mockRL('');
      const result = await confirm(rl, 'Continue?', true);
      assert.strictEqual(result, true);
    });

    it('returns default (false) when answer is empty and defaultYes=false', async () => {
      const rl = mockRL('');
      const result = await confirm(rl, 'Continue?', false);
      assert.strictEqual(result, false);
    });

    it('is case insensitive', async () => {
      const rl = mockRL('Y');
      const result = await confirm(rl, 'Continue?');
      assert.strictEqual(result, true);
    });
  });
});
