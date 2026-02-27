const crypto = require('crypto');
const pty = require('node-pty');

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  create({ name, shell, args = [], cwd, initialCommand = null }) {
    const id = crypto.randomBytes(4).toString('hex');
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
      createdAt: new Date().toISOString(),
      clients: new Set(),
      scrollback: [],
    };

    ptyProcess.onData((data) => {
      session.scrollback.push(data);
      if (session.scrollback.length > 2000) session.scrollback.shift();
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

  delete(id) {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.pty.kill();
    this.sessions.delete(id);
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
