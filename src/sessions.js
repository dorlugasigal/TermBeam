const crypto = require('crypto');
const pty = require('node-pty');
const log = require('./logger');

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
  constructor(options = {}) {
    this.sessions = new Map();
    this.mirror = options.mirror || false;
    this.mirroredSessionId = null;
    this.stdinHandler = null;
    this.resizeHandler = null;
    this.originalStdinRaw = null;
    this.onStopRequest = options.onStopRequest || null; // Callback when user requests stop
    this.lastCtrlBackslash = 0; // Track double-tap timing
  }

  /**
   * Set up bidirectional mirroring for a session.
   * Puts stdin in raw mode and forwards input to the PTY.
   */
  setupMirror(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !this.mirror) return;

    this.mirroredSessionId = sessionId;

    // Only set up stdin forwarding if stdin is a TTY
    if (process.stdin.isTTY) {
      this.originalStdinRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();

      this.stdinHandler = (data) => {
        // Ctrl+\ (0x1c) to stop the server (double-tap within 500ms)
        if (data.length === 1 && data[0] === 0x1c) {
          const now = Date.now();
          if (now - this.lastCtrlBackslash < 500) {
            // Double-tap: stop the server
            console.log('\n[termbeam] Stopping server (Ctrl+\\ twice)...');
            if (this.onStopRequest) {
              this.onStopRequest();
            }
            return;
          }
          this.lastCtrlBackslash = now;
          console.log('\n[termbeam] Press Ctrl+\\ again to stop server, or continue typing.');
          return;
        }
        // Ctrl+Q to detach from mirror mode (like screen/tmux)
        if (data.length === 1 && data[0] === 0x11) {
          this.teardownMirror();
          console.log('\n[termbeam] Detached from mirror mode (Ctrl+Q). Server still running.');
          return;
        }
        session.pty.write(data);
      };
      process.stdin.on('data', this.stdinHandler);

      // Handle terminal resize
      this.resizeHandler = () => {
        const { columns, rows } = process.stdout;
        if (columns && rows) {
          session.pty.resize(columns, rows);
          // Notify WebSocket clients of resize
          for (const ws of session.clients) {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({ type: 'resize', cols: columns, rows: rows }));
            }
          }
        }
      };
      process.stdout.on('resize', this.resizeHandler);

      // Set initial size from local terminal
      const { columns, rows } = process.stdout;
      if (columns && rows) {
        session.pty.resize(columns, rows);
      }
    }
  }

  /**
   * Tear down mirroring - restore stdin to normal mode.
   */
  teardownMirror() {
    if (this.stdinHandler) {
      process.stdin.removeListener('data', this.stdinHandler);
      this.stdinHandler = null;
    }
    if (this.resizeHandler) {
      process.stdout.removeListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    if (process.stdin.isTTY && this.originalStdinRaw !== null) {
      process.stdin.setRawMode(this.originalStdinRaw);
    }
    this.mirroredSessionId = null;
  }

  create({ name, shell, args = [], cwd, initialCommand = null, color = null }) {
    const id = crypto.randomBytes(16).toString('hex');
    if (!color) {
      color = SESSION_COLORS[this.sessions.size % SESSION_COLORS.length];
    }
    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    // Send initial command once the shell is ready
    if (initialCommand) {
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
    };

    ptyProcess.onData((data) => {
      session.lastActivity = Date.now();
      session.scrollbackBuf += data;
      // Cap scrollback at ~200KB
      if (session.scrollbackBuf.length > 200000) {
        session.scrollbackBuf = session.scrollbackBuf.slice(-100000);
      }
      // Mirror output to local terminal if enabled
      if (this.mirror) {
        process.stdout.write(data);
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
    if (fields.color !== undefined) s.color = fields.color;
    if (fields.name !== undefined) s.name = fields.name;
    return true;
  }

  delete(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    log.info(`Session "${s.name}" deleted (id=${id})`);
    s.pty.kill();
    return true;
  }

  list() {
    const list = [];
    for (const [id, s] of this.sessions) {
      list.push({
        id,
        name: s.name,
        cwd: s.cwd,
        shell: s.shell,
        pid: s.pty.pid,
        clients: s.clients.size,
        createdAt: s.createdAt,
        color: s.color,
        lastActivity: s.lastActivity,
      });
    }
    return list;
  }

  shutdown() {
    this.teardownMirror();
    for (const [id, s] of this.sessions) {
      try {
        s.pty.kill();
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear();
  }
}

module.exports = { SessionManager };
