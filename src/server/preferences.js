const fs = require('fs');
const path = require('path');
const log = require('../utils/logger');

const PREFS_FILENAME = 'prefs.json';

// Maximum allowed JSON body size in bytes for a PUT. Body parsing happens
// globally in src/server/index.js with a default ~100 KB limit, which is well
// above what any reasonable prefs payload should be.

// Defaults reflect the previous-implicit defaults from individual stores.
// Keep this list narrow; only add fields here that we actually round-trip
// through the API. Unknown keys from the client are dropped.
const DEFAULTS = Object.freeze({
  themeId: 'dark',
  fontSize: 14,
  notifications: false,
  haptics: true,
  defaultFolder: '',
  defaultInitialCommand: '',
  touchBarCollapsed: false,
  touchBarKeys: null, // null = use built-in defaults
  startupWorkspace: { enabled: false, sessions: [] },
  workspaces: [],
});

const FONT_MIN = 2;
const FONT_MAX = 32;
const MAX_STARTUP_SESSIONS = 16;
const MAX_TOUCHBAR_KEYS = 32;
const MAX_WORKSPACES = 16;
const MAX_STRING_LEN = 4096;
const MAX_SEND_LEN = 64;

const VALID_KEY_ACTIONS = new Set(['mic', 'copy', 'paste', 'cancel', 'newline']);
// Accept BOTH the new vocabulary (plain/accent/danger/custom) and the legacy
// values from older clients. The client-side normalize() migrates legacy
// values to the new ones on read, so persisted prefs converge over time.
const VALID_KEY_LOOKS = new Set([
  'plain',
  'accent',
  'danger',
  'custom',
  // Legacy — accepted but client will rewrite to the new vocab on next PUT
  'default',
  'special',
  'modifier',
  'icon',
  'enter',
]);
const VALID_KEY_MODIFIERS = new Set(['ctrl', 'alt', 'shift', 'meta']);
const VALID_KEY_SIZES = new Set([1, 2, 3, 4, 5, 6, 7, 8]);

function clampNumber(n, min, max, fallback) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function asString(v, fallback, maxLen = MAX_STRING_LEN) {
  if (typeof v !== 'string') return fallback;
  return v.length > maxLen ? v.slice(0, maxLen) : v;
}

function asBool(v, fallback) {
  return typeof v === 'boolean' ? v : fallback;
}

function sanitizeTouchBarKeys(input) {
  if (input === null) return null;
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const entry of input.slice(0, MAX_TOUCHBAR_KEYS)) {
    if (!entry || typeof entry !== 'object') continue;
    const id = asString(entry.id, '', 64);
    const label = asString(entry.label, '', 16);
    const send = asString(entry.send, '', MAX_SEND_LEN);
    if (!id || !label) continue;
    const key = { id, label, send };
    if (typeof entry.modifier === 'string') {
      const mod = entry.modifier.toLowerCase();
      if (VALID_KEY_MODIFIERS.has(mod)) key.modifier = mod;
    }
    if (typeof entry.action === 'string' && VALID_KEY_ACTIONS.has(entry.action)) {
      key.action = entry.action;
    }
    if (VALID_KEY_SIZES.has(entry.size)) {
      key.size = entry.size;
    }
    if (typeof entry.bg === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(entry.bg)) {
      key.bg = entry.bg;
    }
    if (typeof entry.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(entry.color)) {
      key.color = entry.color;
    }
    if (typeof entry.style === 'string' && VALID_KEY_LOOKS.has(entry.style)) {
      key.style = entry.style;
    }
    out.push(key);
  }
  return out;
}

function sanitizeStartupSession(s) {
  if (!s || typeof s !== 'object') return null;
  const id = asString(s.id, '', 64);
  const name = asString(s.name, '', 128);
  const kindRaw = asString(s.kind, 'shell', 16);
  const kind = kindRaw === 'agent' ? 'agent' : 'shell';
  const cwd = asString(s.cwd, '', 1024);
  const initialCommand = asString(s.initialCommand, '', 1024);
  if (!id || !name) return null;
  const entry = { id, name, kind, cwd, initialCommand };
  if (kind === 'agent' && typeof s.agentId === 'string') {
    entry.agentId = asString(s.agentId, '', 128);
  }
  if (typeof s.shell === 'string' && s.shell) {
    entry.shell = asString(s.shell, '', 256);
  }
  if (typeof s.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(s.color)) {
    entry.color = s.color;
  }
  return entry;
}

function sanitizeStartupWorkspace(input) {
  if (!input || typeof input !== 'object') return { ...DEFAULTS.startupWorkspace };
  const enabled = asBool(input.enabled, false);
  const rawSessions = Array.isArray(input.sessions) ? input.sessions : [];
  const sessions = [];
  for (const s of rawSessions.slice(0, MAX_STARTUP_SESSIONS)) {
    const entry = sanitizeStartupSession(s);
    if (entry) sessions.push(entry);
  }
  return { enabled, sessions };
}

function sanitizeWorkspaces(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  let defaultsSeen = 0;
  for (const w of input.slice(0, MAX_WORKSPACES)) {
    if (!w || typeof w !== 'object') continue;
    const id = asString(w.id, '', 64);
    const name = asString(w.name, '', 128);
    if (!id || !name) continue;
    const sessions = [];
    const rawSessions = Array.isArray(w.sessions) ? w.sessions : [];
    for (const s of rawSessions.slice(0, MAX_STARTUP_SESSIONS)) {
      const entry = sanitizeStartupSession(s);
      if (entry) sessions.push(entry);
    }
    const entry = { id, name, sessions };
    if (asBool(w.default, false) && defaultsSeen === 0) {
      entry.default = true;
      defaultsSeen += 1;
    }
    out.push(entry);
  }
  return out;
}

/**
 * Coerce arbitrary client input into a known-good preferences object.
 * Unknown keys are dropped; bad types fall back to defaults.
 */
function sanitize(prefs) {
  const src = prefs && typeof prefs === 'object' ? prefs : {};
  return {
    themeId: asString(src.themeId, DEFAULTS.themeId, 64),
    fontSize: clampNumber(src.fontSize, FONT_MIN, FONT_MAX, DEFAULTS.fontSize),
    notifications: asBool(src.notifications, DEFAULTS.notifications),
    haptics: asBool(src.haptics, DEFAULTS.haptics),
    defaultFolder: asString(src.defaultFolder, DEFAULTS.defaultFolder, 1024),
    defaultInitialCommand: asString(
      src.defaultInitialCommand,
      DEFAULTS.defaultInitialCommand,
      1024,
    ),
    touchBarCollapsed: asBool(src.touchBarCollapsed, DEFAULTS.touchBarCollapsed),
    touchBarKeys: sanitizeTouchBarKeys(src.touchBarKeys),
    startupWorkspace: sanitizeStartupWorkspace(src.startupWorkspace),
    workspaces: sanitizeWorkspaces(src.workspaces),
  };
}

function getDefaults() {
  return sanitize({});
}

function prefsPath(configDir) {
  return path.join(configDir, PREFS_FILENAME);
}

function readPreferences(configDir) {
  const file = prefsPath(configDir);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const prefs = sanitize(parsed && parsed.prefs);
    const version = Number.isInteger(parsed && parsed.version) ? parsed.version : 0;
    return { prefs, version };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      log.warn(`prefs: failed to read ${file}: ${err.message}`);
    }
    return { prefs: getDefaults(), version: 0 };
  }
}

function writePreferences(configDir, prefs) {
  const sanitized = sanitize(prefs);
  const current = readPreferences(configDir);
  const next = { prefs: sanitized, version: current.version + 1 };
  const file = prefsPath(configDir);
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
    // Ensure mode is correct even when the file already existed with different
    // permissions (writeFileSync mode is only honored on create on some FS).
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // best-effort
    }
  } catch (err) {
    log.error(`prefs: failed to write ${file}: ${err.message}`);
    throw err;
  }
  return next;
}

function setupPreferenceRoutes(app, { auth, configDir, apiRateLimit }) {
  app.get('/api/preferences', apiRateLimit, auth.middleware, (_req, res) => {
    const state = readPreferences(configDir);
    res.json(state);
  });

  app.put('/api/preferences', apiRateLimit, auth.middleware, (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || !body.prefs || typeof body.prefs !== 'object') {
      return res.status(400).json({ error: 'Body must be { prefs: object }' });
    }
    try {
      const next = writePreferences(configDir, body.prefs);
      res.json(next);
    } catch {
      res.status(500).json({ error: 'Failed to persist preferences' });
    }
  });
}

// `express.json` body parser is applied globally in index.js; this module
// just defines route handlers.

module.exports = {
  setupPreferenceRoutes,
  readPreferences,
  writePreferences,
  sanitize,
  getDefaults,
  PREFS_FILENAME,
};
