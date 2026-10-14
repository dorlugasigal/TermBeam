'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isValidModelId, normalizeModels } = require('../../src/utils/copilot-models');

describe('copilot-models', () => {
  describe('isValidModelId', () => {
    it('accepts Copilot model ids', () => {
      for (const id of ['auto', 'claude-sonnet-5', 'gpt-5.3-codex', 'mai-code-1.1-flash', 'o3']) {
        assert.strictEqual(isValidModelId(id), true, id);
      }
    });

    it('rejects non-strings, empty, spaced and oversized values', () => {
      for (const bad of [undefined, null, 42, {}, [], '', 'two words', 'a\nb', 'x'.repeat(129)]) {
        assert.strictEqual(isValidModelId(bad), false, String(bad));
      }
    });
  });

  describe('normalizeModels', () => {
    it('returns [] for anything that is not an array', () => {
      for (const raw of [undefined, null, {}, 'models']) {
        assert.deepStrictEqual(normalizeModels(raw), []);
      }
    });

    it('keeps SDK order, trims, dedupes and falls back to the id for a name', () => {
      const models = normalizeModels([
        { id: ' gpt-5.5 ', name: ' GPT-5.5 ' },
        { id: 'auto', name: 'Auto' },
        { id: 'gpt-5.5', name: 'Duplicate' },
        { id: 'grok-4.7', name: '   ' },
      ]);
      assert.deepStrictEqual(models, [
        { id: 'gpt-5.5', name: 'GPT-5.5' },
        { id: 'auto', name: 'Auto' },
        { id: 'grok-4.7', name: 'grok-4.7' },
      ]);
    });

    it('drops models disabled by policy and malformed entries', () => {
      const models = normalizeModels([
        null,
        'gpt-5.5',
        { name: 'No id' },
        { id: 'bad id' },
        { id: 'claude-opus-5', policy: { state: 'disabled' } },
        { id: 'claude-sonnet-5', policy: { state: 'unconfigured' } },
        { id: 'claude-haiku-5.5', policy: { state: 'enabled' } },
      ]);
      assert.deepStrictEqual(
        models.map((m) => m.id),
        ['claude-sonnet-5', 'claude-haiku-5.5'],
      );
    });
  });
});
