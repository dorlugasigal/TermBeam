const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { detectShells } = require('./shells');
const log = require('./logger');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const uploadedFiles = new Map(); // id -> filepath

const IMAGE_SIGNATURES = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: 'image/webp', offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  { type: 'image/bmp', bytes: [0x42, 0x4d] },
];

function validateMagicBytes(buffer, contentType) {
  const sig = IMAGE_SIGNATURES.find((s) => s.type === contentType);
  if (!sig) return true; // unknown type, skip validation
  const offset = sig.offset || 0;
  if (buffer.length < offset + sig.bytes.length) return false;
  const match = sig.bytes.every((b, i) => buffer[offset + i] === b);
  if (!match) return false;
  // WebP requires RIFF header at offset 0
  if (contentType === 'image/webp') {
    const riff = [0x52, 0x49, 0x46, 0x46];
    if (buffer.length < 4) return false;
    return riff.every((b, i) => buffer[i] === b);
  }
  return true;
}

function setupRoutes(app, { auth, sessions, config, state }) {
  // Only redirect to known application paths to prevent open redirects


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
        secure: req.secure,
      });
      log.info(`Auth: login success from ${req.ip}`);
      res.json({ ok: true });
    } else {
      log.warn(`Auth: login failed from ${req.ip}`);
      res.status(401).json({ error: 'wrong password' });
    }
  });

  // Version API
  app.get('/api/version', (_req, res) => {
    const { getVersion } = require('./version');
    res.json({ version: getVersion() });
  });

  // Share token auto-login middleware: validates ?ott= param, sets session cookie, redirects to clean URL
  function autoLogin(req, res, next) {
    const { ott } = req.query;
    if (!ott || !auth.password) return next();
    // Already authenticated (e.g. DevTunnel anti-phishing re-sent the request) — just redirect
    if (req.cookies.pty_token && auth.validateToken(req.cookies.pty_token)) {
      return res.redirect(req.path === '/terminal' ? '/terminal' : '/');
    }
    if (auth.validateShareToken(ott)) {
      const token = auth.generateToken();
      res.cookie('pty_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        secure: req.secure,
      });
      log.info(`Auth: share-token auto-login from ${req.ip}`);
      // Redirect to the same path without ?ott= to keep the URL clean
      return res.redirect(req.path === '/terminal' ? '/terminal' : '/');
    }
    log.warn(`Auth: invalid or expired share token from ${req.ip}`);
    next();
  }

  // Pages
  app.get('/', autoLogin, auth.middleware, (_req, res) =>
    res.sendFile('index.html', { root: PUBLIC_DIR }),
  );
  app.get('/terminal', autoLogin, auth.middleware, (_req, res) =>
    res.sendFile('terminal.html', { root: PUBLIC_DIR }),
  );

  // Share token — generates a temporary share token for the share button
  app.get('/api/share-token', auth.middleware, (req, res) => {
    if (!auth.password) return res.status(404).json({ error: 'auth disabled' });
    const shareToken = auth.generateShareToken();
    const base = (state && state.shareBaseUrl) || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base}/?ott=${shareToken}` });
  });

  // Session API
  app.get('/api/sessions', auth.middleware, (_req, res) => {
    res.json(sessions.list());
  });

  app.post('/api/sessions', auth.middleware, (req, res) => {
    const { name, shell, args: shellArgs, cwd, initialCommand, color, cols, rows } = req.body || {};

    // Validate shell field
    if (shell) {
      const availableShells = detectShells();
      const isValid = availableShells.some((s) => s.path === shell || s.cmd === shell);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid shell' });
      }
    }

    // Validate cwd field
    if (cwd) {
      if (!path.isAbsolute(cwd)) {
        return res.status(400).json({ error: 'cwd must be an absolute path' });
      }
      // Normalize path to resolve any traversal sequences (after confirming absolute)
      const resolvedCwd = path.resolve(cwd);
      try {
        if (!fs.statSync(resolvedCwd).isDirectory()) {
          return res.status(400).json({ error: 'cwd is not a directory' });
        }
      } catch {
        return res.status(400).json({ error: 'cwd does not exist' });
      }
    }

    const id = sessions.create({
      name: name || `Session ${sessions.sessions.size + 1}`,
      shell: shell || config.defaultShell,
      args: shellArgs || [],
      cwd: (cwd ? path.resolve(cwd) : config.cwd),
      initialCommand: initialCommand || null,
      color: color || null,
      cols: typeof cols === 'number' && cols > 0 && cols <= 500 ? Math.floor(cols) : undefined,
      rows: typeof rows === 'number' && rows > 0 && rows <= 200 ? Math.floor(rows) : undefined,
    });
    res.json({ id, url: `/terminal?id=${id}` });
  });

  // Available shells
  app.get('/api/shells', auth.middleware, (_req, res) => {
    const shells = detectShells();
    const ds = config.defaultShell;
    const match = shells.find((s) => s.cmd === ds || s.path === ds || s.name === ds);
    res.json({ shells, default: match ? match.cmd : ds, cwd: config.cwd });
  });

  app.get('/api/sessions/:id/detect-port', auth.middleware, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });

    const buf = session.scrollbackBuf || '';
    const regex = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/g;
    let lastPort = null;
    let match;
    while ((match = regex.exec(buf)) !== null) {
      const port = parseInt(match[1], 10);
      if (port >= 1 && port <= 65535) lastPort = port;
    }

    if (lastPort !== null) {
      res.json({ detected: true, port: lastPort });
    } else {
      res.json({ detected: false });
    }
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

  // Image upload
  app.post('/api/upload', auth.middleware, (req, res) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      log.warn(`Upload rejected: invalid content-type "${contentType}"`);
      return res.status(400).json({ error: 'Invalid content type' });
    }

    const chunks = [];
    let size = 0;
    let aborted = false;
    const limit = 10 * 1024 * 1024;

    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > limit) {
        aborted = true;
        log.warn(`Upload rejected: file too large (${size} bytes)`);
        res.status(413).json({ error: 'File too large' });
        req.resume(); // drain remaining data
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) {
        return res.status(400).json({ error: 'No image data' });
      }
      if (!validateMagicBytes(buffer, contentType)) {
        log.warn(`Upload rejected: content-type "${contentType}" does not match file signature`);
        return res.status(400).json({ error: 'File content does not match declared image type' });
      }
      const ext =
        {
          'image/png': '.png',
          'image/jpeg': '.jpg',
          'image/gif': '.gif',
          'image/webp': '.webp',
          'image/bmp': '.bmp',
        }[contentType] || '.png';
      const id = crypto.randomUUID();
      const filename = `termbeam-${id}${ext}`;
      const filepath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(filepath, buffer);
      uploadedFiles.set(id, filepath);
      log.info(`Upload: ${filename} (${buffer.length} bytes)`);
      res.json({ id, url: `/uploads/${id}`, path: filepath });
    });

    req.on('error', (err) => {
      log.error(`Upload error: ${err.message}`);
      res.status(500).json({ error: 'Upload failed' });
    });
  });

  // Serve uploaded files by opaque ID
  app.get('/uploads/:id', auth.middleware, (req, res) => {
    const filepath = uploadedFiles.get(req.params.id);
    if (!filepath) return res.status(404).json({ error: 'not found' });
    if (!fs.existsSync(filepath)) {
      uploadedFiles.delete(req.params.id);
      return res.status(404).json({ error: 'not found' });
    }
    res.sendFile(filepath);
  });

  // Directory listing for folder browser
  app.get('/api/dirs', auth.middleware, (req, res) => {
    const query = req.query.q || config.cwd + path.sep;
    const endsWithSep = query.endsWith('/') || query.endsWith('\\');
    const dir = path.resolve(endsWithSep ? query : path.dirname(query));
    const prefix = endsWithSep ? '' : path.basename(query);

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

function cleanupUploadedFiles() {
  for (const [_id, filepath] of uploadedFiles) {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch (err) {
      log.error(`Failed to cleanup ${filepath}: ${err.message}`);
    }
  }
  uploadedFiles.clear();
}

module.exports = { setupRoutes, cleanupUploadedFiles };
