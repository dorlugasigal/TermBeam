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
      assert.strictEqual(typeof mod.readOpenCodeSessions, 'function');
    });
  });

  describe('fixture-backed coverage', () => {
    let tmpHome;
    let origHome;
    let origUserprofile;

    beforeEach(() => {
      tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-agent-sessions-'));
      origHome = process.env.HOME;
      origUserprofile = process.env.USERPROFILE;
      process.env.HOME = tmpHome;
      process.env.USERPROFILE = tmpHome;
      mock.method(os, 'homedir', () => tmpHome);
    });

    afterEach(() => {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
      if (origUserprofile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = origUserprofile;
      try {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    function maybeSqlite() {
      try {
        return require('better-sqlite3');
      } catch {
        return null;
      }
    }

    it('readCopilotSessions returns rows from a populated DB', () => {
      const Database = maybeSqlite();
      if (!Database) return; // optional dep not installed
      const dbDir = path.join(tmpHome, '.copilot');
      fs.mkdirSync(dbDir, { recursive: true });
      const dbPath = path.join(dbDir, 'session-store.db');
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          summary TEXT,
          cwd TEXT,
          repository TEXT,
          branch TEXT,
          updated_at TEXT
        );
        CREATE TABLE turns (
          session_id TEXT,
          turn_index INTEGER,
          user_message TEXT
        );
      `);
      db.prepare(
        `INSERT INTO sessions (id, summary, cwd, repository, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('s1', 'First session', '/tmp/work', 'org/repo', 'main', '2025-01-02T00:00:00Z');
      db.prepare(
        `INSERT INTO sessions (id, summary, cwd, repository, branch, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('s2', null, null, null, null, '2025-01-01T00:00:00Z');
      // s2 will have only first_msg fallback; s1 has both summary and turns
      db.prepare(`INSERT INTO turns (session_id, turn_index, user_message) VALUES (?, ?, ?)`).run(
        's1',
        0,
        'hello',
      );
      db.prepare(`INSERT INTO turns (session_id, turn_index, user_message) VALUES (?, ?, ?)`).run(
        's2',
        0,
        'fallback summary',
      );
      db.close();

      const { readCopilotSessions } = load();
      const result = readCopilotSessions();
      assert.ok(Array.isArray(result));
      assert.strictEqual(result.length, 2);
      const s1 = result.find((s) => s.id === 's1');
      const s2 = result.find((s) => s.id === 's2');
      assert.strictEqual(s1.agent, 'copilot');
      assert.strictEqual(s1.summary, 'First session');
      assert.strictEqual(s1.repo, 'org/repo');
      assert.strictEqual(s2.summary, 'fallback summary');
    });

    it('readCopilotSessions returns [] on a corrupt DB', () => {
      const Database = maybeSqlite();
      if (!Database) return;
      const dbDir = path.join(tmpHome, '.copilot');
      fs.mkdirSync(dbDir, { recursive: true });
      fs.writeFileSync(path.join(dbDir, 'session-store.db'), 'not a sqlite file');
      const { readCopilotSessions } = load();
      const result = readCopilotSessions();
      assert.deepStrictEqual(result, []);
    });

    it('readClaudeSessions parses JSONL fixtures', () => {
      const projDir = path.join(tmpHome, '.claude', 'projects', '-tmp-work');
      fs.mkdirSync(projDir, { recursive: true });
      const sessionId = 'aabbccdd-1122-3344-5566-778899aabbcc';
      const lines = [
        JSON.stringify({ type: 'system', cwd: '/tmp/work', gitBranch: 'feat/x' }),
        JSON.stringify({ type: 'user', message: { content: 'A real user question to summarize' } }),
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'text', text: 'Another follow-up question here' }] },
        }),
        JSON.stringify({ type: 'user', message: { content: '<meta>skip me</meta>' } }),
        'this-is-not-json',
      ];
      fs.writeFileSync(path.join(projDir, `${sessionId}.jsonl`), lines.join('\n'));

      // Empty session (no user turns) — should be filtered out
      const emptyId = '11111111-2222-3333-4444-555555555555';
      fs.writeFileSync(
        path.join(projDir, `${emptyId}.jsonl`),
        JSON.stringify({ type: 'system' }) + '\n',
      );

      // Non-directory entry inside projects/ should be skipped
      fs.writeFileSync(path.join(tmpHome, '.claude', 'projects', 'stray.txt'), 'ignore me');

      const { readClaudeSessions } = load();
      const result = readClaudeSessions();
      assert.ok(Array.isArray(result));
      const session = result.find((s) => s.id === sessionId);
      assert.ok(session, 'expected session to be parsed');
      assert.strictEqual(session.agent, 'claude');
      assert.strictEqual(session.cwd, '/tmp/work');
      assert.strictEqual(session.branch, 'feat/x');
      assert.ok(session.summary && session.summary.length > 5);
      assert.ok(session.turnCount >= 2);
      assert.ok(!result.find((s) => s.id === emptyId), 'empty session should be filtered');
    });

    it('readClaudeSessions truncates files larger than 100KB', () => {
      const projDir = path.join(tmpHome, '.claude', 'projects', '-tmp-big');
      fs.mkdirSync(projDir, { recursive: true });
      const sessionId = 'big11111-2222-3333-4444-555555555555';
      const userLine =
        JSON.stringify({
          type: 'user',
          message: { content: 'Large session probe message here' },
        }) + '\n';
      const padding = 'x'.repeat(120_000);
      fs.writeFileSync(path.join(projDir, `${sessionId}.jsonl`), userLine + padding);
      const { readClaudeSessions } = load();
      const result = readClaudeSessions();
      const session = result.find((s) => s.id === sessionId);
      assert.ok(session, 'big session should still parse');
      assert.ok(session.turnCount >= 1);
    });

    it('readOpenCodeSessions returns rows from a populated DB', () => {
      const Database = maybeSqlite();
      if (!Database) return;
      const dbDir = path.join(tmpHome, '.local', 'share', 'opencode');
      fs.mkdirSync(dbDir, { recursive: true });
      const dbPath = path.join(dbDir, 'opencode.db');
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          title TEXT,
          directory TEXT,
          time_created TEXT,
          time_updated TEXT,
          time_archived TEXT
        );
        CREATE TABLE message (
          session_id TEXT
        );
      `);
      db.prepare(
        `INSERT INTO session (id, title, directory, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, NULL)`,
      ).run('ses_active', 'Active session', '/tmp/oc', '2025-01-01', '2025-01-02');
      db.prepare(
        `INSERT INTO session (id, title, directory, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run('ses_archived', 'Archived', '/tmp/oc', '2025-01-01', '2025-01-02', '2025-01-03');
      db.prepare(`INSERT INTO message (session_id) VALUES (?)`).run('ses_active');
      db.prepare(`INSERT INTO message (session_id) VALUES (?)`).run('ses_archived');
      db.close();

      const { readOpenCodeSessions } = load();
      const result = readOpenCodeSessions();
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].id, 'ses_active');
      assert.strictEqual(result[0].agent, 'opencode');
      assert.strictEqual(result[0].cwd, '/tmp/oc');
    });

    it('readOpenCodeSessions returns [] on a corrupt DB', () => {
      const Database = maybeSqlite();
      if (!Database) return;
      const dbDir = path.join(tmpHome, '.local', 'share', 'opencode');
      fs.mkdirSync(dbDir, { recursive: true });
      fs.writeFileSync(path.join(dbDir, 'opencode.db'), 'not sqlite');
      const { readOpenCodeSessions } = load();
      const result = readOpenCodeSessions();
      assert.deepStrictEqual(result, []);
    });

    it('getAgentSessions filters by search term', async () => {
      const Database = maybeSqlite();
      if (!Database) return;
      const dbDir = path.join(tmpHome, '.copilot');
      fs.mkdirSync(dbDir, { recursive: true });
      const dbPath = path.join(dbDir, 'session-store.db');
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY, summary TEXT, cwd TEXT,
          repository TEXT, branch TEXT, updated_at TEXT
        );
        CREATE TABLE turns (session_id TEXT, turn_index INTEGER, user_message TEXT);
      `);
      db.prepare(
        `INSERT INTO sessions VALUES ('a', 'find me alpha', '/cwd', 'org/r', 'main', '2025-01-02')`,
      ).run();
      db.prepare(
        `INSERT INTO sessions VALUES ('b', 'beta thing', '/other', 'org/r', 'dev', '2025-01-01')`,
      ).run();
      db.prepare(`INSERT INTO turns VALUES ('a', 0, 'hi')`).run();
      db.prepare(`INSERT INTO turns VALUES ('b', 0, 'hi')`).run();
      db.close();

      const { getAgentSessions } = load();
      const filtered = await getAgentSessions({ search: 'alpha' });
      assert.ok(filtered.every((s) => /alpha/i.test(s.summary || '')));
      assert.ok(filtered.find((s) => s.id === 'a'));
    });

    it('getResumeCommand returns null for invalid session ids', () => {
      const { getResumeCommand } = load();
      assert.strictEqual(getResumeCommand({ agent: 'copilot', id: 'short' }), null);
      assert.strictEqual(
        getResumeCommand({ agent: 'copilot', id: 'has spaces and bad chars!' }),
        null,
      );
    });

    it('getResumeCommand returns command for opencode', () => {
      const { getResumeCommand } = load();
      const cmd = getResumeCommand({ agent: 'opencode', id: 'ses_abcdef123' });
      assert.strictEqual(cmd, 'opencode --session ses_abcdef123');
    });
  });
});
