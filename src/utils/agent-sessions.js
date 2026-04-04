const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('./logger');

// Try to load better-sqlite3 (optional dependency)
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  log.debug('better-sqlite3 not available — Copilot session reading disabled');
}

/**
 * Read Copilot sessions from SQLite store.
 * Returns array of { id, agent, summary, cwd, repo, branch, updatedAt, turnCount }
 */
function readCopilotSessions(limit = 50) {
  if (!Database) return [];
  const dbPath = path.join(os.homedir(), '.copilot', 'session-store.db');
  if (!fs.existsSync(dbPath)) return [];

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const sessions = db
      .prepare(
        `
      SELECT s.id, s.summary, s.cwd, s.repository, s.branch, s.updated_at,
             (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) as turn_count,
             (SELECT substr(t.user_message, 1, 200) FROM turns t WHERE t.session_id = s.id ORDER BY t.turn_index ASC LIMIT 1) as first_msg
      FROM sessions s
      ORDER BY s.updated_at DESC
      LIMIT ?
    `,
      )
      .all(limit);
    db.close();

    return sessions
      .filter((s) => s.turn_count > 0)
      .map((s) => ({
        id: s.id,
        agent: 'copilot',
        agentName: 'GitHub Copilot',
        agentIcon: 'copilot',
        summary: s.summary || s.first_msg || null,
        cwd: s.cwd || null,
        repo: s.repository || null,
        branch: s.branch || null,
        updatedAt: s.updated_at || null,
        turnCount: s.turn_count || 0,
      }));
  } catch (err) {
    log.warn(`Failed to read Copilot sessions: ${err.message}`);
    return [];
  }
}

/**
 * Read Claude Code sessions from JSONL files.
 * Returns array of unified session objects.
 */
function readClaudeSessions(limit = 50) {
  const baseDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(baseDir)) return [];

  try {
    const sessions = [];
    const projectDirs = fs.readdirSync(baseDir);

    for (const projDir of projectDirs) {
      const fullProjDir = path.join(baseDir, projDir);
      if (!fs.statSync(fullProjDir).isDirectory()) continue;

      // Decode CWD from directory name: -Users-foo-bar → /Users/foo/bar
      const cwd = projDir.replace(/^-/, '/').replace(/-/g, '/');

      const jsonlFiles = fs
        .readdirSync(fullProjDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => {
          const fullPath = path.join(fullProjDir, f);
          const stat = fs.statSync(fullPath);
          return { file: f, path: fullPath, mtime: stat.mtime, size: stat.size };
        })
        .sort((a, b) => b.mtime - a.mtime);

      for (const fileInfo of jsonlFiles.slice(0, 10)) {
        try {
          const sessionId = path.basename(fileInfo.file, '.jsonl');

          // Read line-by-line to avoid loading huge files into memory
          const content = fs.readFileSync(fileInfo.path, 'utf8');
          const rawLines = content.split('\n');

          let cwdFromFile = cwd;
          let branch = null;
          let userTurnCount = 0;
          let firstUserMsg = null;

          for (const line of rawLines) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line);
              if (!branch && entry.gitBranch) branch = entry.gitBranch;
              if (entry.cwd) cwdFromFile = entry.cwd;
              if (entry.type === 'user') {
                userTurnCount++;
                if (!firstUserMsg) {
                  // Claude stores user message at entry.message.content (not entry.data)
                  const msg = entry.message;
                  if (msg && typeof msg === 'object') {
                    const content = msg.content;
                    if (typeof content === 'string') {
                      // Skip meta/command messages (XML-tagged system entries)
                      if (!content.startsWith('<') && content.trim().length > 5) {
                        firstUserMsg = content.slice(0, 200);
                      }
                    } else if (Array.isArray(content)) {
                      for (const item of content) {
                        if (item && item.type === 'text' && typeof item.text === 'string') {
                          if (!item.text.startsWith('<') && item.text.trim().length > 5) {
                            firstUserMsg = item.text.slice(0, 200);
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              }
            } catch {
              // skip malformed line
            }
          }

          // Skip empty sessions (no user interaction)
          if (userTurnCount === 0) continue;

          sessions.push({
            id: sessionId,
            agent: 'claude',
            agentName: 'Claude Code',
            agentIcon: 'claude',
            summary: firstUserMsg || null,
            cwd: cwdFromFile,
            repo: null,
            branch,
            updatedAt: fileInfo.mtime.toISOString(),
            turnCount: userTurnCount,
          });
        } catch (err) {
          log.debug(`Failed to parse Claude session ${fileInfo.file}: ${err.message}`);
        }
      }
    }

    // Sort by updated time descending
    sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return sessions.slice(0, limit);
  } catch (err) {
    log.warn(`Failed to read Claude sessions: ${err.message}`);
    return [];
  }
}

/**
 * Get all agent sessions from all sources, unified and sorted.
 */
async function getAgentSessions({ limit = 100, agent = null, search = null } = {}) {
  const results = [];

  if (!agent || agent === 'copilot') {
    results.push(...readCopilotSessions(limit));
  }
  if (!agent || agent === 'claude') {
    results.push(...readClaudeSessions(limit));
  }

  // Sort all by updatedAt descending
  results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  // Apply search filter (case-insensitive substring match)
  if (search) {
    const q = search.toLowerCase();
    const filtered = results.filter(
      (s) =>
        (s.summary && s.summary.toLowerCase().includes(q)) ||
        (s.cwd && s.cwd.toLowerCase().includes(q)) ||
        (s.repo && s.repo.toLowerCase().includes(q)) ||
        (s.branch && s.branch.toLowerCase().includes(q)),
    );
    return filtered.slice(0, limit);
  }

  return results.slice(0, limit);
}

/**
 * Build the resume command for a given agent session.
 */
function getResumeCommand(session) {
  switch (session.agent) {
    case 'copilot':
      return `copilot --resume=${session.id}`;
    case 'claude':
      return `claude --resume ${session.id}`;
    default:
      return null;
  }
}

module.exports = { getAgentSessions, getResumeCommand, readCopilotSessions, readClaudeSessions };
