const crypto = require('crypto');
const path = require('path');
const { exec } = require('child_process');
const pty = require('node-pty');
const log = require('../utils/logger');
const { getGitInfo } = require('../utils/git');

// Cache git info per session to avoid blocking the event loop on every list() call.
// lsof + git commands take ~200-500ms and block WebSocket traffic, causing
// xterm.js cursor position report responses to leak as visible text.
const _gitCache = new Map(); // sessionId -> { cwd, git, ts }
const GIT_CACHE_TTL = 5000;

function getCachedGitInfo(sessionId, pid, originalCwd) {
  const now = Date.now();
  const cached = _gitCache.get(sessionId);
  if (cached && now - cached.ts < GIT_CACHE_TTL) {
    log.debug(`Git cache hit for session ${sessionId}`);
    return { cwd: cached.cwd, git: cached.git };
  }

  // Always refresh asynchronously to avoid blocking the event loop.
  // Return stale data if available, or null on first call.
  log.debug(`Git cache miss for session ${sessionId}, scheduling refresh`);
  scheduleGitRefresh(sessionId, pid, originalCwd);
  if (cached) return { cwd: cached.cwd, git: cached.git };
  return { cwd: originalCwd, git: null };
}

function scheduleGitRefresh(sessionId, pid, originalCwd) {
  log.debug(`Scheduling git refresh for session ${sessionId}`);
  // Mark as refreshing to prevent duplicate refreshes
  const cached = _gitCache.get(sessionId);
  if (cached && cached._refreshing) return;
  if (cached) cached._refreshing = true;

  // Use exec (async) for the lsof call to avoid blocking the event loop
  const cmd =
    process.platform === 'darwin'
      ? `lsof -a -p ${pid} -d cwd -Fn`
      : process.platform === 'linux'
        ? `readlink /proc/${pid}/cwd`
        : null;

  if (!cmd) {
    // Windows or unsupported — just refresh sync quickly
    setImmediate(() => {
      const git = getGitInfo(originalCwd);
      _gitCache.set(sessionId, { cwd: originalCwd, git, ts: Date.now() });
    });
    return;
  }

  exec(cmd, { timeout: 2000 }, (err, stdout) => {
    if (err) log.debug(`Git cwd detection failed: ${err.message}`);
    let liveCwd = originalCwd;
    if (!err && stdout) {
      if (process.platform === 'darwin') {
        const match = stdout.match(/\nn(.+)/);
        if (match) liveCwd = match[1].trim();
      } else {
        liveCwd = stdout.trim();
      }
    }
    const git = getGitInfo(liveCwd);
    _gitCache.set(sessionId, { cwd: liveCwd, git, ts: Date.now() });
    log.debug(`Git refresh complete for session ${sessionId} (cwd=${liveCwd})`);
  });
}

const SESSION_COLORS = [
  '#4a9eff',
  '#4ade80',
  '#fbbf24',
  '#c084fc',
  '#f87171',
  '#22d3ee',
  '#fb923c',
  '#f472b6',
];

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  create({
    name,
    shell,
    args = [],
    cwd,
    initialCommand = null,
    color = null,
    cols = 120,
    rows = 30,
  }) {
    // Defense-in-depth: reject shells with dangerous characters or relative paths
    if (
      typeof shell !== 'string' ||
      !shell ||
      /[;&|`$(){}\[\]!#~]/.test(shell) ||
      (!path.isAbsolute(shell) && !shell.match(/^[a-zA-Z0-9._-]+(\.exe)?$/))
    ) {
      log.warn(`Invalid shell rejected: ${shell}`);
      throw new Error('Invalid shell');
    }

    // Defense-in-depth: validate args and initialCommand types
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
      log.warn(`Invalid args rejected: ${JSON.stringify(args)}`);
      throw new Error('args must be an array of strings');
    }
    if (initialCommand !== null && typeof initialCommand !== 'string') {
      log.warn(`Invalid initialCommand rejected: ${typeof initialCommand}`);
      throw new Error('initialCommand must be a string');
    }

    const id = crypto.randomBytes(16).toString('hex');
    if (!color) {
      color = SESSION_COLORS[this.sessions.size % SESSION_COLORS.length];
    }
    log.debug(`Spawning PTY: shell=${shell}, args=${JSON.stringify(args)}, cwd=${cwd}`);
    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color', TERMBEAM_SESSION: '1' },
    });

    // Send initial command once the shell is ready
    if (initialCommand) {
      log.debug(`Scheduling initialCommand for session ${id}: ${initialCommand}`);
      setTimeout(() => ptyProcess.write(initialCommand + '\r'), 300);
    }

    const session = {
      pty: ptyProcess,
      name,
      shell,
      cwd,
      color,
      createdAt: new Date().toISOString(),
      lastActivity: Date.now(),
      clients: new Set(),
      scrollback: [],
      scrollbackBuf: '',
      hasHadClient: false,
      inAltScreen: false,
      _altScanTail: '',
      _lastCols: cols,
      _lastRows: rows,
    };

    ptyProcess.onData((data) => {
      session.lastActivity = Date.now();
      session.scrollbackBuf += data;

      // Track alt screen mode so reconnecting clients can re-enter it.
      // Carry a small tail between chunks so split escape sequences are detected.
      const scanBuf = session._altScanTail + data;
      session._altScanTail =
        data.length >= 16 ? data.slice(-16) : (session._altScanTail + data).slice(-16);
      const altEnterIdx = Math.max(
        scanBuf.lastIndexOf('\x1b[?1049h'),
        scanBuf.lastIndexOf('\x1b[?1047h'),
        scanBuf.lastIndexOf('\x1b[?47h'),
      );
      const altExitIdx = Math.max(
        scanBuf.lastIndexOf('\x1b[?1049l'),
        scanBuf.lastIndexOf('\x1b[?1047l'),
        scanBuf.lastIndexOf('\x1b[?47l'),
      );
      if (altEnterIdx > altExitIdx) {
        session.inAltScreen = true;
        // Track which mode was used so reconnect sends the matching sequence
        const enter1049 = scanBuf.lastIndexOf('\x1b[?1049h');
        const enter1047 = scanBuf.lastIndexOf('\x1b[?1047h');
        const enter47 = scanBuf.lastIndexOf('\x1b[?47h');
        if (altEnterIdx === enter1049) session.altScreenMode = '1049';
        else if (altEnterIdx === enter1047) session.altScreenMode = '1047';
        else if (altEnterIdx === enter47) session.altScreenMode = '47';
      } else if (altExitIdx > altEnterIdx) {
        session.inAltScreen = false;
        session.altScreenMode = undefined;
      }
      // High/low water scrollback cap: trim to 500k chars when buffer exceeds 1,000,000 chars
      if (session.scrollbackBuf.length > 1000000) {
        log.debug(`Trimming scrollback buffer from ${session.scrollbackBuf.length} to 500k chars`);
        let buf = session.scrollbackBuf.slice(-500000);
        // Advance to first newline to avoid starting mid-line
        const nlIdx = buf.indexOf('\n');
        if (nlIdx > 0 && nlIdx < 200) {
          buf = buf.slice(nlIdx + 1);
        }
        session.scrollbackBuf = buf;
      }
      for (const ws of session.clients) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      log.info(`Session "${name}" (${id}) exited (code ${exitCode})`);
      for (const ws of session.clients) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      }
      this.sessions.delete(id);
      _gitCache.delete(id);
    });

    this.sessions.set(id, session);
    log.info(`Session "${name}" created (id=${id}, pid=${ptyProcess.pid})`);
    return id;
  }

  get(id) {
    return this.sessions.get(id);
  }

  update(id, fields) {
    const s = this.sessions.get(id);
    if (!s) return false;
    const changes = [];
    if (fields.color !== undefined) {
      s.color = fields.color;
      changes.push(`color=${fields.color}`);
    }
    if (fields.name !== undefined) {
      s.name = fields.name;
      changes.push(`name=${fields.name}`);
    }
    if (changes.length > 0) {
      log.debug(`Session ${id} updated: ${changes.join(', ')}`);
    }
    return true;
  }

  delete(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    log.info(`Session "${s.name}" deleted (id=${id})`);
    _gitCache.delete(id);
    s.pty.kill();
    return true;
  }

  list() {
    const list = [];
    for (const [id, s] of this.sessions) {
      const { cwd, git } = getCachedGitInfo(id, s.pty.pid, s.cwd);
      list.push({
        id,
        name: s.name,
        cwd,
        shell: s.shell,
        pid: s.pty.pid,
        clients: s.clients.size,
        createdAt: s.createdAt,
        color: s.color,
        lastActivity: s.lastActivity,
        git,
      });
    }
    log.debug(`Listing ${list.length} session(s)`);
    return list;
  }

  shutdown() {
    log.info(`Shutting down ${this.sessions.size} session(s)`);
    for (const [_id, s] of this.sessions) {
      try {
        s.pty.kill();
      } catch (err) {
        log.warn(`Failed to kill session ${_id}: ${err.message}`);
      }
    }
    this.sessions.clear();
    _gitCache.clear();
  }
}

module.exports = { SessionManager };
