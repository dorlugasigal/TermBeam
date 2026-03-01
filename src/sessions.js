const crypto = require('crypto');
const pty = require('node-pty');

const SESSION_COLORS = [
  '#4a9eff', '#4ade80', '#fbbf24', '#c084fc',
  '#f87171', '#22d3ee', '#fb923c', '#f472b6',
];

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  create({ name, shell, args = [], cwd, initialCommand = null, color = null }) {
    const id = crypto.randomBytes(4).toString('hex');
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
      for (const ws of session.clients) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[termbeam] Session "${name}" (${id}) exited (code ${exitCode})`);
      for (const ws of session.clients) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
      }
      this.sessions.delete(id);
    });

    this.sessions.set(id, session);
    console.log(`[termbeam] Session "${name}" created (id=${id}, pid=${ptyProcess.pid})`);
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
    console.log(`[termbeam] Session "${s.name}" deleted (id=${id})`);
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
