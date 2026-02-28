const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const { detectShells } = require('./shells');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function setupRoutes(app, { auth, sessions, config }) {
  // Serve static files (manifest.json, sw.js, icons, etc.)
  app.use(express.static(PUBLIC_DIR, { index: false }));

  // Login page
  app.get('/login', (_req, res) => {
    if (!auth.password) return res.redirect('/');
    res.send(auth.loginHTML);
  });

  // Auth API
  app.post('/api/auth', auth.rateLimit, (req, res) => {
    const { password } = req.body || {};
    if (password === auth.password) {
      const token = auth.generateToken();
      res.cookie('pty_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        secure: false,
      });
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: 'wrong password' });
    }
  });

  // Version API
  app.get('/api/version', (_req, res) => {
    const { getVersion } = require('./version');
    res.json({ version: getVersion() });
  });

  // Pages
  app.get('/', auth.middleware, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.get('/terminal', auth.middleware, (_req, res) =>
    res.sendFile(path.join(PUBLIC_DIR, 'terminal.html')),
  );

  // Session API
  app.get('/api/sessions', auth.middleware, (_req, res) => {
    res.json(sessions.list());
  });

  app.post('/api/sessions', auth.middleware, (req, res) => {
    const { name, shell, args: shellArgs, cwd, initialCommand, color } = req.body || {};
    const id = sessions.create({
      name: name || `Session ${sessions.sessions.size + 1}`,
      shell: shell || config.defaultShell,
      args: shellArgs || [],
      cwd: cwd || config.cwd,
      initialCommand: initialCommand || null,
      color: color || null,
    });
    res.json({ id, url: `/terminal?id=${id}` });
  });

  // Available shells
  app.get('/api/shells', auth.middleware, (_req, res) => {
    const shells = detectShells();
    res.json({ shells, default: config.defaultShell });
  });

  app.delete('/api/sessions/:id', auth.middleware, (req, res) => {
    if (sessions.delete(req.params.id)) {
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'not found' });
    }
  });

  app.patch('/api/sessions/:id', auth.middleware, (req, res) => {
    const { color, name } = req.body || {};
    const updates = {};
    if (color !== undefined) updates.color = color;
    if (name !== undefined) updates.name = name;
    if (sessions.update(req.params.id, updates)) {
      res.json({ ok: true });
    } else {
      res.status(404).json({ error: 'not found' });
    }
  });

  // Directory listing for folder browser
  app.get('/api/dirs', auth.middleware, (req, res) => {
    const query = req.query.q || os.homedir();
    const dir = query.endsWith('/') ? query : path.dirname(query);
    const prefix = query.endsWith('/') ? '' : path.basename(query);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .filter((e) => !prefix || e.name.toLowerCase().startsWith(prefix.toLowerCase()))
        .slice(0, 50)
        .map((e) => path.join(dir, e.name));
      res.json({ base: dir, dirs });
    } catch {
      res.json({ base: dir, dirs: [] });
    }
  });
}

module.exports = { setupRoutes };
