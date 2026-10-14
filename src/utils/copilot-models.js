'use strict';

// Copilot model IDs look like `claude-sonnet-5`, `gpt-5.3-codex` or `auto`.
const MODEL_ID_RE = /^[\w.:/-]{1,128}$/;

function isValidModelId(model) {
  return typeof model === 'string' && MODEL_ID_RE.test(model);
}

/**
 * Reduce the SDK's model list to the models this account can pick, as
 * `{ id, name }` in the SDK's order. Models disabled by policy are dropped.
 */
function normalizeModels(raw) {
  const seen = new Set();
  const models = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    const id = typeof m?.id === 'string' ? m.id.trim() : '';
    if (!isValidModelId(id) || seen.has(id) || m.policy?.state === 'disabled') continue;
    seen.add(id);
    const name = typeof m.name === 'string' && m.name.trim() ? m.name.trim() : id;
    models.push({ id, name });
  }
  return models;
}

module.exports = { isValidModelId, normalizeModels };
