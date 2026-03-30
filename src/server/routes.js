const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { detectShells } = require('../utils/shells');
const log = require('../utils/logger');
const rateLimit = require('express-rate-limit');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
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

function setupRoutes(app, { auth, sessions, config, state, pushManager }) {
  const pageRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: 'Too many requests, please try again later.' }),
  });

  const apiRateLimit = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: 'Too many requests, please try again later.' }),
  });

  // Serve static files
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
        sameSite: 'strict',
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
    log.debug('Version requested');
    const { getVersion } = require('../utils/version');
    res.json({ version: getVersion() });
  });

  // Public config — no auth required
  app.get('/api/config', (_req, res) => {
    res.json({ passwordRequired: !!auth.password });
  });

  // Update check API
  app.get('/api/update-check', apiRateLimit, auth.middleware, async (req, res) => {
    log.debug('Update check requested');
    const { checkForUpdate, detectInstallMethod } = require('../utils/update-check');
    const force = req.query.force === 'true';

    try {
      const info = await checkForUpdate({ currentVersion: config.version, force });
      const { installCmd, installArgs, cwd, ...publicInstallInfo } = detectInstallMethod();
      state.updateInfo = { ...info, ...publicInstallInfo };
      res.json(state.updateInfo);
    } catch (err) {
      log.warn(`Update check failed: ${err.message}`);
      const { installCmd, installArgs, cwd, ...publicInstallInfo } = detectInstallMethod();
      const fallback = {
        current: config.version,
        latest: null,
        updateAvailable: false,
        ...publicInstallInfo,
      };
      state.updateInfo = fallback;
      res.json(fallback);
    }
  });

  // Trigger update — rate limited to 1 per 5 minutes
  const updateTriggerLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) =>
      res
        .status(429)
        .json({ error: 'Update already attempted recently. Try again in a few minutes.' }),
  });

  app.post('/api/update', auth.middleware, updateTriggerLimit, async (req, res) => {
    const { detectInstallMethod } = require('../utils/update-check');
    const { getUpdateState, executeUpdate, resetState } = require('../utils/update-executor');

    const currentState = getUpdateState();
    if (currentState.status !== 'idle' && currentState.status !== 'failed') {
      return res.status(409).json({ error: 'Update already in progress', state: currentState });
    }
    // Reset state if retrying after a failure
    if (currentState.status === 'failed') resetState();

    const installInfo = detectInstallMethod();
    if (!installInfo.canAutoUpdate) {
      return res.status(400).json({
        error: 'Auto-update not available for this installation method',
        method: installInfo.method,
        command: installInfo.command,
        canAutoUpdate: false,
      });
    }

    // Respond immediately — update runs in background
    res.json({ status: 'updating', method: installInfo.method });

    // Broadcast progress to WebSocket clients
    const broadcastProgress = (updateStatus) => {
      if (state.wss) {
        const msg = JSON.stringify({ type: 'update-progress', ...updateStatus });
        state.wss.clients.forEach((client) => {
          if (client.readyState === 1) {
            try {
              client.send(msg);
            } catch {
              // Client may have disconnected
            }
          }
        });
      }
    };

    // Build the restart handler
    const performRestart = async () => {
      if (installInfo.restartStrategy === 'pm2') {
        // PM2 restart — PM2 will bring the process back up
        const { execFile: execFileCb } = require('child_process');
        const serviceName = process.env.pm_id || 'termbeam';
        broadcastProgress({
          status: 'restarting',
          phase: 'Restarting via PM2...',
          restartStrategy: 'pm2',
        });
        // Give WS messages time to reach clients
        await new Promise((r) => setTimeout(r, 1000));
        // Use async execFile so WS messages can flush before the restart
        execFileCb('pm2', ['restart', serviceName], { timeout: 10000, stdio: 'ignore' }, (err) => {
          if (err) {
            log.warn(`PM2 restart failed: ${err.message}`);
            // Fall back to exit
            sessions.shutdown();
            process.exit(0);
          }
        });
      } else {
        // Exit strategy — clean shutdown, user must restart manually
        broadcastProgress({
          status: 'restarting',
          phase: 'Update installed. Server shutting down...',
          restartStrategy: 'exit',
        });
        // Close all WS connections with "Service Restart" close code
        if (state.wss) {
          state.wss.clients.forEach((client) => {
            try {
              client.close(1012, 'Server updated — please restart');
            } catch {
              // ignore
            }
          });
        }
        // Give WS close frames time to be sent
        await new Promise((r) => setTimeout(r, 1000));
        sessions.shutdown();
        process.exit(0);
      }
    };

    // Execute update in background (don't await in request handler)
    executeUpdate({
      currentVersion: config.version,
      installCmd: installInfo.installCmd,
      installArgs: installInfo.installArgs,
      command: installInfo.command,
      method: installInfo.method,
      restartStrategy: installInfo.restartStrategy,
      onProgress: broadcastProgress,
      performRestart,
      cwd: installInfo.cwd,
    }).catch((err) => {
      log.error(`Update execution error: ${err.message}`);
    });
  });

  // Poll update status (fallback for when WS isn't connected)
  app.get('/api/update/status', apiRateLimit, auth.middleware, (_req, res) => {
    const { getUpdateState } = require('../utils/update-executor');
    res.json(getUpdateState());
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
        sameSite: 'strict',
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

  // Pages — always serve React SPA
  app.get('/', pageRateLimit, autoLogin, auth.middleware, (_req, res) =>
    res.sendFile('index.html', { root: PUBLIC_DIR }),
  );
  app.get('/terminal', pageRateLimit, autoLogin, auth.middleware, (_req, res) =>
    res.sendFile('index.html', { root: PUBLIC_DIR }),
  );
  app.get('/code/:sessionId', pageRateLimit, autoLogin, auth.middleware, (_req, res) =>
    res.sendFile('index.html', { root: PUBLIC_DIR }),
  );

  // Share token — generates a temporary share token for the share button
  app.get('/api/share-token', auth.middleware, (req, res) => {
    log.debug('Share token requested');
    if (!auth.password) return res.status(404).json({ error: 'auth disabled' });
    const shareToken = auth.generateShareToken();
    const base = (state && state.shareBaseUrl) || `${req.protocol}://${req.get('host')}`;
    res.json({ url: `${base}/?ott=${shareToken}` });
  });

  // Session API
  app.get('/api/sessions', apiRateLimit, auth.middleware, (_req, res) => {
    log.debug('Sessions list requested');
    res.json(sessions.list());
  });

  app.post('/api/sessions', apiRateLimit, auth.middleware, (req, res) => {
    const { name, shell, args: shellArgs, cwd, initialCommand, color, cols, rows } = req.body || {};

    // Validate shell field
    if (shell) {
      const availableShells = detectShells();
      const isValid = availableShells.some((s) => s.path === shell || s.cmd === shell);
      if (!isValid) {
        log.warn(`Session creation failed: invalid shell "${shell}"`);
        return res.status(400).json({ error: 'Invalid shell' });
      }
    }

    // Validate args field — must be an array of strings
    if (shellArgs !== undefined) {
      if (!Array.isArray(shellArgs) || !shellArgs.every((a) => typeof a === 'string')) {
        log.warn('Session creation failed: args must be an array of strings');
        return res.status(400).json({ error: 'args must be an array of strings' });
      }
    }

    // Validate initialCommand field — must be a string
    if (initialCommand !== undefined && initialCommand !== null) {
      if (typeof initialCommand !== 'string') {
        log.warn('Session creation failed: initialCommand must be a string');
        return res.status(400).json({ error: 'initialCommand must be a string' });
      }
    }

    // Validate cwd field
    if (cwd) {
      if (!path.isAbsolute(cwd)) {
        log.warn(`Session creation failed: cwd must be an absolute path (got "${cwd}")`);
        return res.status(400).json({ error: 'cwd must be an absolute path' });
      }
      try {
        if (!fs.statSync(cwd).isDirectory()) {
          log.warn(`Session creation failed: cwd is not a directory (${cwd})`);
          return res.status(400).json({ error: 'cwd is not a directory' });
        }
      } catch {
        log.warn(`Session creation failed: cwd does not exist (${cwd})`);
        return res.status(400).json({ error: 'cwd does not exist' });
      }
    }

    let id;
    try {
      id = sessions.create({
        name: name || `Session ${sessions.sessions.size + 1}`,
        shell: shell || config.defaultShell,
        args: shellArgs || [],
        cwd: cwd ? path.resolve(cwd) : config.cwd,
        initialCommand: initialCommand ?? null,
        color: color || null,
        cols: typeof cols === 'number' && cols > 0 && cols <= 500 ? Math.floor(cols) : undefined,
        rows: typeof rows === 'number' && rows > 0 && rows <= 200 ? Math.floor(rows) : undefined,
      });
    } catch (err) {
      log.warn(`Session creation failed: ${err.message}`);
      return res.status(400).json({ error: 'Failed to create session' });
    }
    res.status(201).json({ id, url: `/terminal?id=${id}` });
  });

  // Available shells
  app.get('/api/shells', auth.middleware, (_req, res) => {
    log.debug('Available shells requested');
    const shells = detectShells();
    const ds = config.defaultShell;
    const match = shells.find((s) => s.cmd === ds || s.path === ds || s.name === ds);
    res.json({ shells, default: match ? match.cmd : ds, cwd: config.cwd });
  });

  app.get('/api/sessions/:id/detect-port', auth.middleware, (req, res) => {
    log.debug(`Port detection requested for session ${req.params.id}`);
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
      log.debug(`Port detected for session ${req.params.id}: ${lastPort}`);
      res.json({ detected: true, port: lastPort });
    } else {
      res.json({ detected: false });
    }
  });

  app.delete('/api/sessions/:id', auth.middleware, (req, res) => {
    if (sessions.delete(req.params.id)) {
      log.info(`Session deleted: ${req.params.id}`);
      res.status(204).end();
    } else {
      log.warn(`Session delete failed: not found (${req.params.id})`);
      res.status(404).json({ error: 'not found' });
    }
  });

  app.patch('/api/sessions/:id', auth.middleware, (req, res) => {
    const { color, name } = req.body || {};
    const updates = {};
    if (color !== undefined) updates.color = color;
    if (name !== undefined) updates.name = name;
    if (sessions.update(req.params.id, updates)) {
      log.info(`Session updated: ${req.params.id}`);
      res.json({ ok: true });
    } else {
      log.warn(`Session update failed: not found (${req.params.id})`);
      res.status(404).json({ error: 'not found' });
    }
  });

  // Image upload
  app.post('/api/upload', auth.middleware, (req, res) => {
    log.debug('Image upload started');
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
      res.status(201).json({ id, url: `/uploads/${id}`, path: filepath });
    });

    req.on('error', (err) => {
      log.error(`Upload error: ${err.message}`);
      res.status(500).json({ error: 'Upload failed' });
    });
  });

  // Serve uploaded files by opaque ID
  app.get('/uploads/:id', pageRateLimit, auth.middleware, (req, res) => {
    const filepath = uploadedFiles.get(req.params.id);
    if (!filepath) return res.status(404).json({ error: 'not found' });
    if (!fs.existsSync(filepath)) {
      uploadedFiles.delete(req.params.id);
      return res.status(404).json({ error: 'not found' });
    }
    res.sendFile(filepath);
  });

  // General file upload to a session's working directory
  app.post('/api/sessions/:id/upload', apiRateLimit, auth.middleware, (req, res) => {
    log.debug(`File upload started for session ${req.params.id}`);
    const session = sessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const rawName = req.headers['x-filename'];
    if (!rawName || typeof rawName !== 'string') {
      return res.status(400).json({ error: 'Missing X-Filename header' });
    }

    // Sanitize: take only the basename, strip control chars, collapse whitespace
    const sanitized = path
      .basename(rawName)
      .replace(/[\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!sanitized || sanitized === '.' || sanitized === '..') {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    // Resolve target directory: optional X-Target-Dir header, falls back to session cwd
    const rawTargetDir = req.headers['x-target-dir'];
    let targetDir = session.cwd;
    if (rawTargetDir && typeof rawTargetDir === 'string') {
      if (!path.isAbsolute(rawTargetDir)) {
        return res.status(400).json({ error: 'Target directory must be an absolute path' });
      }
      const resolved = path.resolve(rawTargetDir);
      try {
        if (fs.statSync(resolved).isDirectory()) {
          targetDir = resolved;
        } else {
          return res.status(400).json({ error: 'Target directory is not a directory' });
        }
      } catch {
        return res.status(400).json({ error: 'Target directory does not exist' });
      }
    }
    // Defense-in-depth: ensure destPath is still inside targetDir after join
    const destPath = path.join(targetDir, sanitized);
    if (
      !path.resolve(destPath).startsWith(path.resolve(targetDir) + path.sep) &&
      path.resolve(destPath) !== path.resolve(targetDir)
    ) {
      return res.status(400).json({ error: 'Invalid filename' });
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
        log.warn(`File upload rejected: too large (${size} bytes)`);
        res.status(413).json({ error: 'File too large (max 10 MB)' });
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) {
        return res.status(400).json({ error: 'Empty file' });
      }

      // Atomic write with dedup: use wx flag to fail on existing file, retry with suffix
      const ext = path.extname(sanitized);
      const base = path.basename(sanitized, ext);
      let destPath = path.join(targetDir, sanitized);
      let written = false;
      for (let n = 0; n < 100; n++) {
        const candidate = n === 0 ? destPath : path.join(targetDir, `${base} (${n})${ext}`);
        try {
          fs.writeFileSync(candidate, buffer, { flag: 'wx' });
          destPath = candidate;
          written = true;
          break;
        } catch (err) {
          if (err.code === 'EEXIST') continue;
          log.error(`File upload write error: ${err.message}`);
          return res.status(500).json({ error: 'Failed to write file' });
        }
      }
      if (!written) {
        return res.status(409).json({ error: 'Too many filename collisions' });
      }
      const finalName = path.basename(destPath);
      log.info(`File upload: ${finalName} → ${targetDir} (${buffer.length} bytes)`);
      res.status(201).json({ name: finalName, path: destPath, size: buffer.length });
    });

    req.on('error', (err) => {
      log.error(`File upload error: ${err.message}`);
      res.status(500).json({ error: 'Upload failed' });
    });
  });

  // Browse files and directories within a session's CWD
  app.get('/api/sessions/:id/files', apiRateLimit, auth.middleware, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (req.query.dir !== undefined && typeof req.query.dir !== 'string') {
      return res.status(400).json({ error: 'Invalid dir parameter' });
    }

    const rootDir = path.resolve(session.cwd);
    const dir = path.resolve(rootDir, req.query.dir || '.');

    const MAX_ENTRIES = 1000;
    try {
      const dirents = fs.readdirSync(dir, { withFileTypes: true });
      let entries = dirents
        .filter((e) => {
          if (e.name.startsWith('.')) return false;
          try {
            return !fs.lstatSync(path.join(dir, e.name)).isSymbolicLink();
          } catch {
            return false;
          }
        })
        .map((e) => {
          const fullPath = path.join(dir, e.name);
          const isDir = e.isDirectory();
          try {
            const stat = fs.statSync(fullPath);
            return {
              name: e.name,
              type: isDir ? 'directory' : 'file',
              size: isDir ? 0 : stat.size,
              modified: stat.mtime.toISOString(),
            };
          } catch {
            return { name: e.name, type: isDir ? 'directory' : 'file', size: 0, modified: null };
          }
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      const truncated = entries.length > MAX_ENTRIES;
      entries = entries.slice(0, MAX_ENTRIES);

      res.json({ base: dir, rootDir, entries, truncated });
    } catch (err) {
      log.warn(`File browse failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to read directory' });
    }
  });

  // Recursive file tree for a session's CWD
  app.get('/api/sessions/:id/file-tree', apiRateLimit, auth.middleware, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const MAX_DEPTH = 5;
    const MAX_ENTRIES = 2000;
    const EXCLUDED = new Set([
      'node_modules',
      '.git',
      '__pycache__',
      'coverage',
      '.next',
      'dist',
      'build',
    ]);

    let depth = 3;
    if (typeof req.query.depth !== 'undefined') {
      const parsedDepth = parseInt(req.query.depth, 10);
      if (Number.isNaN(parsedDepth)) {
        return res.status(400).json({ error: 'Invalid depth' });
      }
      depth = parsedDepth;
    }
    depth = Math.min(Math.max(depth, 1), MAX_DEPTH);
    const rootDir = path.resolve(session.cwd);
    let totalEntries = 0;

    function buildTree(dir, currentDepth) {
      let dirents;
      try {
        dirents = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }

      const entries = [];
      const filtered = dirents
        .filter((e) => {
          if (e.name.startsWith('.')) return false;
          if (EXCLUDED.has(e.name)) return false;
          try {
            return !fs.lstatSync(path.join(dir, e.name)).isSymbolicLink();
          } catch {
            return false;
          }
        })
        .sort((a, b) => {
          const aDir = a.isDirectory();
          const bDir = b.isDirectory();
          if (aDir !== bDir) return aDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      for (const e of filtered) {
        if (totalEntries >= MAX_ENTRIES) break;
        totalEntries++;

        const fullPath = path.join(dir, e.name);
        const relativePath = path.relative(rootDir, fullPath);
        const isDir = e.isDirectory();

        if (isDir) {
          const children = currentDepth < depth ? buildTree(fullPath, currentDepth + 1) : [];
          entries.push({
            name: e.name,
            type: 'directory',
            path: relativePath.replace(/\\/g, '/'),
            children,
          });
        } else {
          let size = 0;
          try {
            size = fs.statSync(fullPath).size;
          } catch {
            // ignore stat errors
          }
          entries.push({
            name: e.name,
            type: 'file',
            path: relativePath.replace(/\\/g, '/'),
            size,
          });
        }
      }

      return entries;
    }

    try {
      const tree = buildTree(rootDir, 1);
      res.json({ root: rootDir, tree });
    } catch (err) {
      log.warn(`File tree failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to build file tree' });
    }
  });

  // Download a file from within a session's CWD
  app.get('/api/sessions/:id/download', apiRateLimit, auth.middleware, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const file = req.query.file;
    if (!file || typeof file !== 'string') {
      return res.status(400).json({ error: 'Missing file parameter' });
    }

    const rootDir = path.resolve(session.cwd);
    const filePath = path.resolve(rootDir, file);

    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        return res.status(403).json({ error: 'Symbolic links are not allowed' });
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Not a regular file' });
      }
      if (stat.size > 100 * 1024 * 1024) {
        return res.status(413).json({ error: 'File too large (max 100 MB)' });
      }
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath);
  });

  // Serve a file inline (for images in markdown viewer, etc.)
  app.get('/api/sessions/:id/file-raw', apiRateLimit, auth.middleware, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const file = req.query.file;
    if (!file || typeof file !== 'string') {
      return res.status(400).json({ error: 'Missing file parameter' });
    }

    const rootDir = path.resolve(session.cwd);
    const filePath = path.resolve(rootDir, file);

    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        return res.status(403).json({ error: 'Symbolic links are not allowed' });
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Not a regular file' });
      }
      if (stat.size > 20 * 1024 * 1024) {
        return res.status(413).json({ error: 'File too large (max 20 MB)' });
      }
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }

    res.sendFile(filePath);
  });

  // Read file content as text (for markdown viewer, etc.)
  app.get('/api/sessions/:id/file-content', apiRateLimit, auth.middleware, (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const file = req.query.file;
    if (!file || typeof file !== 'string') {
      return res.status(400).json({ error: 'Missing file parameter' });
    }

    const rootDir = path.resolve(session.cwd);
    const filePath = path.resolve(rootDir, file);

    try {
      if (fs.lstatSync(filePath).isSymbolicLink()) {
        return res.status(403).json({ error: 'Symbolic links are not allowed' });
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return res.status(400).json({ error: 'Not a regular file' });
      }
      if (stat.size > 2 * 1024 * 1024) {
        return res.status(413).json({ error: 'File too large (max 2 MB)' });
      }
      const content = fs.readFileSync(filePath, 'utf8');
      res.json({ content, name: path.basename(filePath), size: stat.size });
    } catch {
      return res.status(404).json({ error: 'File not found' });
    }
  });

  // --- Git change endpoints ---

  const { getDetailedStatus, getFileDiff, getFileBlame, getGitLog } = require('../utils/git');

  function validateFilePath(file) {
    if (!file || typeof file !== 'string') return false;
    if (path.isAbsolute(file)) return false;
    const normalized = path.normalize(file);
    if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`)) return false;
    return true;
  }

  app.get('/api/sessions/:id/git/status', apiRateLimit, auth.middleware, async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    try {
      const status = await getDetailedStatus(session.cwd);
      res.json(status);
    } catch (err) {
      log.warn(`Git status failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to get git status' });
    }
  });

  app.get('/api/sessions/:id/git/diff', apiRateLimit, auth.middleware, async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const file = req.query.file;
    if (!validateFilePath(file)) {
      return res.status(400).json({ error: 'Invalid or missing file parameter' });
    }

    const staged = req.query.staged === 'true';
    const untracked = req.query.untracked === 'true';
    let context;
    if (req.query.context !== undefined) {
      const parsed = parseInt(req.query.context, 10);
      if (Number.isFinite(parsed)) {
        context = Math.min(Math.max(parsed, 0), 99999);
      }
    }
    try {
      const diff = await getFileDiff(session.cwd, file, { staged, untracked, context });
      res.json(diff);
    } catch (err) {
      log.warn(`Git diff failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to get diff' });
    }
  });

  app.get('/api/sessions/:id/git/blame', apiRateLimit, auth.middleware, async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const file = req.query.file;
    if (!validateFilePath(file)) {
      return res.status(400).json({ error: 'Invalid or missing file parameter' });
    }

    try {
      const blame = await getFileBlame(session.cwd, file);
      res.json(blame);
    } catch (err) {
      log.warn(`Git blame failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to get blame' });
    }
  });

  app.get('/api/sessions/:id/git/log', apiRateLimit, auth.middleware, async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const file = req.query.file;
    if (file && !validateFilePath(file)) {
      return res.status(400).json({ error: 'Invalid file parameter' });
    }

    try {
      const logResult = await getGitLog(session.cwd, { limit, file: file || null });
      res.json(logResult);
    } catch (err) {
      log.warn(`Git log failed: ${err.message}`);
      res.status(500).json({ error: 'Failed to get git log' });
    }
  });

  // Directory listing for folder browser
  app.get('/api/dirs', apiRateLimit, auth.middleware, (req, res) => {
    log.debug(`Directory listing requested: ${req.query.q || config.cwd}`);
    const query = req.query.q || config.cwd + path.sep;
    const endsWithSep = query.endsWith('/') || query.endsWith('\\');
    const dir = path.resolve(endsWithSep ? query : path.dirname(query));
    const prefix = endsWithSep ? '' : path.basename(query);

    try {
      const MAX_DIRS = 500;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const filtered = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .filter((e) => !prefix || e.name.toLowerCase().startsWith(prefix.toLowerCase()));
      const dirs = filtered.slice(0, MAX_DIRS).map((e) => path.join(dir, e.name));
      res.json({ base: dir, dirs, truncated: filtered.length > MAX_DIRS });
    } catch (err) {
      log.warn(`Directory listing failed: ${err.message}`);
      res.json({ base: dir, dirs: [], truncated: false });
    }
  });

  // --- Push notification endpoints ---
  if (pushManager) {
    app.get('/api/push/vapid-key', apiRateLimit, auth.middleware, (_req, res) => {
      const publicKey = pushManager.getPublicKey();
      if (!publicKey) {
        return res.status(503).json({ error: 'Push notifications not configured' });
      }
      res.json({ publicKey });
    });

    app.post('/api/push/subscribe', apiRateLimit, auth.middleware, (req, res) => {
      const { subscription } = req.body || {};
      if (
        !subscription ||
        !subscription.endpoint ||
        !subscription.keys ||
        !subscription.keys.p256dh ||
        !subscription.keys.auth
      ) {
        return res.status(400).json({ error: 'Invalid subscription object' });
      }
      pushManager.subscribe(subscription);
      res.json({ ok: true });
    });

    app.delete('/api/push/unsubscribe', apiRateLimit, auth.middleware, (req, res) => {
      const { endpoint } = req.body || {};
      if (!endpoint) {
        return res.status(400).json({ error: 'Missing endpoint' });
      }
      pushManager.unsubscribe(endpoint);
      res.json({ ok: true });
    });
  }

  // --- Tunnel token renewal ---
  app.get('/api/tunnel/status', apiRateLimit, auth.middleware, (_req, res) => {
    const tunnelStatus = state.tunnelStatus || { state: 'unknown' };
    // getLoginInfo is called from the tunnel module; avoid importing it
    // here to prevent loading the full tunnel module in test contexts.
    const getLoginInfo = state.getLoginInfo;
    const loginInfo = getLoginInfo ? getLoginInfo() : null;
    res.json({
      ...tunnelStatus,
      provider: loginInfo?.provider ?? null,
      tokenLifetimeSeconds: loginInfo?.tokenLifetimeSeconds ?? null,
    });
  });

  app.post('/api/tunnel/renew', apiRateLimit, auth.middleware, (_req, res) => {
    const { spawn } = require('child_process');
    const proc = spawn('devtunnel', ['user', 'login', '-d'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        proc.kill();
        res.status(504).json({ error: 'Timed out waiting for device code' });
      }
    }, 15000);

    function tryParse(data) {
      if (output.length > 10_000) return; // prevent unbounded accumulation
      output += data;
      // Entra: "open the page https://... and enter the code ABC123 to authenticate"
      // GitHub: "Browse to https://... and enter the code: AB12-CD34"
      const match =
        output.match(/open the page (https:\/\/[^\s]+) and enter the code ([A-Z0-9]+)/i) ||
        output.match(/Browse to (https:\/\/[^\s]+) and enter the code:?\s*([A-Z0-9-]+)/i);
      if (match && !responded) {
        responded = true;
        clearTimeout(timeout);
        res.json({
          url: match[1],
          code: match[2],
        });
      }
    }

    proc.stdout.on('data', (d) => tryParse(d.toString()));
    proc.stderr.on('data', (d) => tryParse(d.toString()));

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (!responded) {
        responded = true;
        if (code === 0) {
          res.json({ ok: true, message: 'Already authenticated' });
        } else {
          res.status(500).json({ error: 'DevTunnel login failed' });
        }
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (!responded) {
        responded = true;
        res.status(500).json({ error: err.message });
      }
    });
  });
}

function cleanupUploadedFiles() {
  log.debug(`Cleaning up ${uploadedFiles.size} uploaded files`);
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
