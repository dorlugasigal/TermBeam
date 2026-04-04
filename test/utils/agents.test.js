const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const child_process = require('child_process');

describe('Agent Detection', () => {
  beforeEach(() => {
    delete require.cache[require.resolve('../../src/utils/agents')];
  });

  afterEach(() => {
    delete require.cache[require.resolve('../../src/utils/agents')];
    mock.restoreAll();
  });

  it('KNOWN_AGENTS has expected shape', () => {
    const { KNOWN_AGENTS } = require('../../src/utils/agents');
    assert.ok(Array.isArray(KNOWN_AGENTS));
    assert.ok(KNOWN_AGENTS.length > 0, 'Should have at least one known agent');
    for (const agent of KNOWN_AGENTS) {
      assert.ok(agent.id, 'Agent should have id');
      assert.ok(agent.name, 'Agent should have name');
      assert.ok(agent.cmd, 'Agent should have cmd');
      assert.ok(agent.icon, 'Agent should have icon');
      assert.ok(Array.isArray(agent.detect), 'Agent should have detect array');
      assert.strictEqual(agent.detect.length, 2, 'detect should have [cmd, args]');
      assert.ok(Array.isArray(agent.detect[1]), 'detect[1] should be an args array');
    }
  });

  it('detectAgents() returns an array', async () => {
    mock.method(child_process, 'execFile', (_cmd, _args, _opts, cb) => {
      cb(new Error('not found'));
    });
    const { detectAgents } = require('../../src/utils/agents');
    const agents = await detectAgents();
    assert.ok(Array.isArray(agents));
  });

  it('detectAgents() returns objects with required fields', async () => {
    mock.method(child_process, 'execFile', (cmd, _args, _opts, cb) => {
      if (cmd === 'claude') {
        cb(null, 'claude 1.2.3\n');
      } else {
        cb(new Error('not found'));
      }
    });
    const { detectAgents } = require('../../src/utils/agents');
    const agents = await detectAgents();
    assert.ok(agents.length >= 1, 'Should detect at least mocked agent');
    const claude = agents.find((a) => a.id === 'claude');
    assert.ok(claude, 'Should find claude agent');
    assert.strictEqual(claude.name, 'Claude Code');
    assert.strictEqual(claude.cmd, 'claude');
    assert.strictEqual(claude.icon, 'claude');
    assert.ok(claude.version, 'Should have version');
    assert.ok(Array.isArray(claude.args), 'Should have args array');
  });

  it('getAvailableAgents() returns same results on second call (cache)', async () => {
    let callCount = 0;
    mock.method(child_process, 'execFile', (_cmd, _args, _opts, cb) => {
      callCount++;
      cb(new Error('not found'));
    });
    const { getAvailableAgents } = require('../../src/utils/agents');
    const first = await getAvailableAgents();
    const countAfterFirst = callCount;
    const second = await getAvailableAgents();
    assert.deepStrictEqual(first, second, 'Cached result should match');
    assert.strictEqual(callCount, countAfterFirst, 'Should not call execFile again (cached)');
  });

  it('getAvailableAgents() returns an array even when no agents are found', async () => {
    mock.method(child_process, 'execFile', (_cmd, _args, _opts, cb) => {
      cb(new Error('not found'));
    });
    const { getAvailableAgents } = require('../../src/utils/agents');
    const agents = await getAvailableAgents();
    assert.ok(Array.isArray(agents));
    assert.strictEqual(agents.length, 0);
  });

  it('detectAgents() handles errors gracefully', async () => {
    mock.method(child_process, 'execFile', (_cmd, _args, _opts, cb) => {
      cb(new Error('ENOENT: command not found'));
    });
    const { detectAgents } = require('../../src/utils/agents');
    const agents = await detectAgents();
    assert.ok(Array.isArray(agents));
    assert.strictEqual(agents.length, 0, 'Should return empty array on error');
  });
});
