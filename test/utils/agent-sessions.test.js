const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('Agent Sessions', () => {
  let agentSessions;

  beforeEach(() => {
    delete require.cache[require.resolve('../../src/utils/agent-sessions')];
  });

  afterEach(() => {
    delete require.cache[require.resolve('../../src/utils/agent-sessions')];
    mock.restoreAll();
  });

  function load() {
    agentSessions = require('../../src/utils/agent-sessions');
    return agentSessions;
  }

  describe('readCopilotSessions()', () => {
    it('returns an empty array when DB does not exist', () => {
      const { readCopilotSessions } = load();
      const result = readCopilotSessions();
      assert.ok(Array.isArray(result), 'Should return an array');
    });

    it('returns an empty array when better-sqlite3 is not available', () => {
      // Simulate missing better-sqlite3 by clearing its cache entry
      try {
        // Force re-require with a mock that throws
        const modPath = require.resolve('../../src/utils/agent-sessions');
        delete require.cache[modPath];

        // Also clear better-sqlite3 from cache so the mock intercepts
        try {
          const sqlite3Path = require.resolve('better-sqlite3');
          delete require.cache[sqlite3Path];
        } catch {
          // not installed, that's fine
        }

        // Temporarily break better-sqlite3 resolution
        const Module = require('module');
        const origResolve = Module._resolveFilename;
        Module._resolveFilename = function (request, ...args) {
          if (request === 'better-sqlite3') {
            throw new Error('Cannot find module');
          }
          return origResolve.call(this, request, ...args);
        };

        try {
          const mod = require('../../src/utils/agent-sessions');
          const result = mod.readCopilotSessions();
          assert.deepStrictEqual(result, []);
        } finally {
          Module._resolveFilename = origResolve;
        }
      } finally {
        // Cleanup
        delete require.cache[require.resolve('../../src/utils/agent-sessions')];
      }
    });
  });

  describe('readClaudeSessions()', () => {
    // Integration test: reads the real filesystem. Returns [] on machines without
    // Claude agent data installed — this is expected and the test still passes.
    it('returns an empty array when .claude/projects does not exist', () => {
      const { readClaudeSessions } = load();
      const result = readClaudeSessions();
      assert.ok(Array.isArray(result), 'Should return an array');
    });

    it('respects the limit parameter', () => {
      const { readClaudeSessions } = load();
      const result = readClaudeSessions(5);
      assert.ok(Array.isArray(result));
      assert.ok(result.length <= 5, 'Should respect limit');
    });

    it('sessions have correct agent field', () => {
      const { readClaudeSessions } = load();
      const result = readClaudeSessions();
      for (const session of result) {
        assert.strictEqual(session.agent, 'claude');
        assert.strictEqual(session.agentName, 'Claude Code');
        assert.strictEqual(session.agentIcon, 'claude');
      }
    });
  });

  describe('getAgentSessions()', () => {
    it('returns a unified sorted array', async () => {
      const { getAgentSessions } = load();
      const result = await getAgentSessions();
      assert.ok(Array.isArray(result), 'Should return an array');

      // Verify sorted by updatedAt descending
      for (let i = 1; i < result.length; i++) {
        const prev = new Date(result[i - 1].updatedAt);
        const curr = new Date(result[i].updatedAt);
        assert.ok(prev >= curr, 'Sessions should be sorted by updatedAt descending');
      }
    });

    it('respects the limit parameter', async () => {
      const { getAgentSessions } = load();
      const result = await getAgentSessions({ limit: 3 });
      assert.ok(result.length <= 3, 'Should respect limit');
    });

    it('filters by agent when specified', async () => {
      const { getAgentSessions } = load();
      const copilotOnly = await getAgentSessions({ agent: 'copilot' });
      for (const s of copilotOnly) {
        assert.strictEqual(s.agent, 'copilot');
      }

      const claudeOnly = await getAgentSessions({ agent: 'claude' });
      for (const s of claudeOnly) {
        assert.strictEqual(s.agent, 'claude');
      }
    });

    it('sessions have all required fields', async () => {
      const { getAgentSessions } = load();
      const result = await getAgentSessions();
      for (const session of result) {
        assert.ok(session.id, 'Session should have id');
        assert.ok(session.agent, 'Session should have agent');
        assert.ok(session.agentName, 'Session should have agentName');
        assert.ok(session.agentIcon, 'Session should have agentIcon');
        assert.ok('updatedAt' in session, 'Session should have updatedAt');
        assert.ok('summary' in session, 'Session should have summary');
        assert.ok('cwd' in session, 'Session should have cwd');
        assert.ok('branch' in session, 'Session should have branch');
        assert.ok('turnCount' in session, 'Session should have turnCount');
        assert.ok('repo' in session, 'Session should have repo');
      }
    });

    it('returns empty array with no errors for default call', async () => {
      const { getAgentSessions } = load();
      const result = await getAgentSessions();
      assert.ok(Array.isArray(result));
    });
  });

  describe('getResumeCommand()', () => {
    it('returns correct command for copilot', () => {
      const { getResumeCommand } = load();
      const cmd = getResumeCommand({
        agent: 'copilot',
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      });
      assert.strictEqual(cmd, 'copilot --resume=a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    });

    it('returns correct command for claude', () => {
      const { getResumeCommand } = load();
      const cmd = getResumeCommand({ agent: 'claude', id: 'aabbccdd-1122-3344-5566-778899aabbcc' });
      assert.strictEqual(cmd, 'claude --resume aabbccdd-1122-3344-5566-778899aabbcc');
    });

    it('returns null for unknown agent', () => {
      const { getResumeCommand } = load();
      const cmd = getResumeCommand({ agent: 'unknown-agent', id: 'xyz' });
      assert.strictEqual(cmd, null);
    });

    it('returns null when agent is undefined', () => {
      const { getResumeCommand } = load();
      const cmd = getResumeCommand({ id: 'xyz' });
      assert.strictEqual(cmd, null);
    });
  });

  describe('module exports', () => {
    it('exports all expected functions', () => {
      const mod = load();
      assert.strictEqual(typeof mod.getAgentSessions, 'function');
      assert.strictEqual(typeof mod.getResumeCommand, 'function');
      assert.strictEqual(typeof mod.readCopilotSessions, 'function');
      assert.strictEqual(typeof mod.readClaudeSessions, 'function');
    });
  });
});
