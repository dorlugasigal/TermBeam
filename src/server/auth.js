const crypto = require('crypto');
const EventEmitter = require('events');
const log = require('../utils/logger');
const { createAuthStore } = require('./auth-store');

const COOKIE_NAME = 'pty_token';

// "Remember this device" sessions slide with use but never outlive the
// absolute cap. Session-only logins (shared devices) are short-lived and are
// never written to disk.
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REMEMBER_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_ONLY_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_ONLY_IDLE_MS = 2 * 60 * 60 * 1000;
// lastSeenAt is tracked in memory on every request but only flushed to disk
// when it moved by more than this, so busy terminals don't thrash the file.
const TOUCH_PERSIST_MS = 10 * 60 * 1000;

const SHARE_TOKEN_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_ATTEMPTS = 5;

// Constant-time string compare using crypto.timingSafeEqual on raw bytes.
// We intentionally do NOT hash the inputs: this is an equality check against
// an in-memory secret (never stored), and hashing would trip CodeQL's
// js/insufficient-password-hash rule which targets password *storage*.
//
// To avoid leaking length via early-return, both inputs are copied into
// fixed-length zero-padded buffers before timingSafeEqual, and the final
// result is AND-ed with a real length check.
const SAFE_COMPARE_LEN = 256;
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length > SAFE_COMPARE_LEN || bb.length > SAFE_COMPARE_LEN) return false;
  const ap = Buffer.alloc(SAFE_COMPARE_LEN);
  const bp = Buffer.alloc(SAFE_COMPARE_LEN);
  ab.copy(ap);
  bb.copy(bp);
  const bytesEqual = crypto.timingSafeEqual(ap, bp);
  return bytesEqual && ab.length === bb.length;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Only same-origin, path-absolute redirect targets are allowed — rejects
 * protocol-relative (`//evil.com`) and backslash tricks (`/\evil.com`).
 */
function safeNextPath(next) {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  try {
    const url = new URL(next, 'http://termbeam.invalid');
    if (url.origin !== 'http://termbeam.invalid') return null;
    // Dot-segment resolution can turn "/..//evil.com" into "//evil.com".
    if (url.pathname.startsWith('//')) return null;
    url.searchParams.delete('ott');
    if (url.pathname === '/login') return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** Short, human-readable device label from a User-Agent string. */
function describeUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return 'Unknown device';
  let device = 'Device';
  if (/iPhone/.test(ua)) device = 'iPhone';
  else if (/iPad/.test(ua)) device = 'iPad';
  else if (/Android/.test(ua)) device = /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  else if (/Macintosh|Mac OS X/.test(ua)) device = 'Mac';
  else if (/Windows/.test(ua)) device = 'Windows PC';
  else if (/CrOS/.test(ua)) device = 'Chromebook';
  else if (/Linux/.test(ua)) device = 'Linux';
  let browser = '';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else if (/node|termbeam/i.test(ua)) browser = 'CLI';
  return browser ? `${device} · ${browser}` : device;
}

function createAuth(password, options = {}) {
  const store = createAuthStore({
    configDir: password ? options.configDir || null : null,
    password,
  });
  const events = new EventEmitter();
  const byHash = new Map();
  for (const s of store.state.sessions) byHash.set(s.tokenHash, s);

  const authAttempts = new Map();
  const shareTokens = new Map(); // share token -> expiry
  let touchPending = false;

  function isExpired(s, now = Date.now()) {
    if (now > s.expiresAt) return true;
    const idle = s.idleTimeoutMs || (s.remember ? REMEMBER_IDLE_MS : SESSION_ONLY_IDLE_MS);
    return now - s.lastSeenAt > idle;
  }

  function dropSessions(predicate, reason) {
    const removed = [];
    store.state.sessions = store.state.sessions.filter((s) => {
      if (!predicate(s)) return true;
      byHash.delete(s.tokenHash);
      removed.push(s.id);
      return false;
    });
    if (removed.length > 0) {
      store.persist();
      events.emit('revoked', { ids: removed, reason });
    }
    return removed;
  }

  // Periodically clean up expired sessions/share tokens and stale rate-limit entries
  const cleanupInterval = setInterval(
    () => {
      log.debug('Token cleanup: removing expired sessions and share tokens');
      const now = Date.now();
      dropSessions((s) => isExpired(s, now), 'expired');
      for (const [ip, attempts] of authAttempts) {
        const recent = attempts.filter((t) => now - t < RATE_WINDOW_MS);
        if (recent.length === 0) authAttempts.delete(ip);
        else authAttempts.set(ip, recent);
      }
      for (const [st, expiry] of shareTokens) {
        if (now > expiry) shareTokens.delete(st);
      }
    },
    60 * 60 * 1000,
  ).unref();

  // --- Sessions ---------------------------------------------------------

  function createSession({
    method = 'password',
    remember = true,
    userAgent = '',
    ip = '',
    passkeyId = null,
  } = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const session = {
      id: crypto.randomBytes(9).toString('base64url'),
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + (remember ? REMEMBER_TTL_MS : SESSION_ONLY_TTL_MS),
      idleTimeoutMs: remember ? REMEMBER_IDLE_MS : SESSION_ONLY_IDLE_MS,
      remember: !!remember,
      method,
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : '',
      ip: typeof ip === 'string' ? ip.slice(0, 64) : '',
      passkeyId,
    };
    store.state.sessions.push(session);
    byHash.set(session.tokenHash, session);
    // Bound memory/disk: evict the least recently used sessions first.
    const max = store.limits.MAX_SESSIONS;
    if (store.state.sessions.length > max) {
      const sorted = [...store.state.sessions].sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      const evict = new Set(sorted.slice(0, store.state.sessions.length - max).map((s) => s.id));
      dropSessions((s) => evict.has(s.id), 'evicted');
    }
    if (session.remember) store.persist();
    log.debug(`Auth: session ${session.id} created via ${method} (remember=${session.remember})`);
    return { token, session };
  }

  /** Resolve a token to a live session (sliding its idle timer), or null. */
  function getSession(token) {
    if (typeof token !== 'string' || token.length !== 64) return null;
    const s = byHash.get(hashToken(token));
    if (!s) return null;
    const now = Date.now();
    if (isExpired(s, now)) {
      dropSessions((x) => x.id === s.id, 'expired');
      return null;
    }
    const stale = now - s.lastSeenAt > TOUCH_PERSIST_MS;
    s.lastSeenAt = now;
    if (s.remember) {
      if (stale) {
        touchPending = false;
        store.persist();
      } else {
        touchPending = true;
      }
    }
    return s;
  }

  function validateToken(token) {
    return getSession(token) !== null;
  }

  // Back-compat helper: mint a remembered password session and return the token.
  function generateToken(meta) {
    return createSession(meta).token;
  }

  function revokeSession(id) {
    return dropSessions((s) => s.id === id, 'revoked').length > 0;
  }

  function revokeOtherSessions(keepId) {
    return dropSessions((s) => s.id !== keepId, 'revoked').length;
  }

  function listSessions(currentId = null) {
    const now = Date.now();
    return store.state.sessions
      .filter((s) => !isExpired(s, now))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((s) => ({
        id: s.id,
        device: describeUserAgent(s.userAgent),
        method: s.method,
        remember: s.remember,
        ip: s.ip || null,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: Math.min(
          s.expiresAt,
          s.lastSeenAt +
            (s.idleTimeoutMs || (s.remember ? REMEMBER_IDLE_MS : SESSION_ONLY_IDLE_MS)),
        ),
        current: s.id === currentId,
      }));
  }

  function setSessionCookie(req, res, token, session) {
    const opts = {
      httpOnly: true,
      sameSite: 'strict',
      secure: !!req.secure,
      path: '/',
    };
    // Session-only logins get a browser-session cookie (cleared on close).
    if (session.remember) opts.maxAge = Math.max(0, session.expiresAt - Date.now());
    res.cookie(COOKIE_NAME, token, opts);
  }

  function clearSessionCookie(req, res) {
    res.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'strict',
      secure: !!req.secure,
      path: '/',
    });
  }

  // --- Passkeys --------------------------------------------------------

  function listPasskeys() {
    return store.state.passkeys.map((p) => ({
      id: p.id,
      name: p.name,
      rpId: p.rpId,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
      synced: p.backedUp,
    }));
  }

  function getPasskey(id) {
    return store.state.passkeys.find((p) => p.id === id) || null;
  }

  function passkeysForRp(rpId) {
    return store.state.passkeys.filter((p) => p.rpId === rpId);
  }

  function addPasskey(record) {
    if (store.state.passkeys.length >= store.limits.MAX_PASSKEYS) {
      throw new Error('Too many passkeys registered — remove one first');
    }
    if (getPasskey(record.id)) throw new Error('Passkey already registered');
    const entry = { ...record, createdAt: Date.now(), lastUsedAt: null };
    store.state.passkeys.push(entry);
    store.persist();
    log.info(`Auth: passkey "${entry.name}" registered for ${entry.rpId}`);
    return entry;
  }

  function updatePasskey(id, patch) {
    const p = getPasskey(id);
    if (!p) return null;
    Object.assign(p, patch);
    store.persist();
    return p;
  }

  function removePasskey(id) {
    const before = store.state.passkeys.length;
    store.state.passkeys = store.state.passkeys.filter((p) => p.id !== id);
    if (store.state.passkeys.length === before) return false;
    store.persist();
    // A removed passkey usually means a lost/retired device: sign it out too.
    dropSessions((s) => s.passkeyId === id, 'passkey-removed');
    log.info('Auth: passkey removed');
    return true;
  }

  /** Wipe every remembered session and passkey (`termbeam --reset-auth`). */
  function resetAll() {
    const ids = store.state.sessions.map((s) => s.id);
    byHash.clear();
    store.reset();
    if (ids.length) events.emit('revoked', { ids, reason: 'reset' });
  }

  // --- Share tokens (QR / share-link auto-login) -------------------------

  function generateShareToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + SHARE_TOKEN_TTL_MS;
    shareTokens.set(token, expiry);
    log.info('Share: created new token (expires in 5m)');
    log.debug(`Share: token expires at ${new Date(expiry).toISOString()}`);
    return token;
  }

  function validateShareToken(token) {
    if (typeof token !== 'string') return false;
    const expiry = shareTokens.get(token);
    if (!expiry) {
      log.warn('Share: unknown token presented');
      return false;
    }
    shareTokens.delete(token);
    if (Date.now() > expiry) {
      log.warn('Share: expired token presented');
      return false;
    }
    log.info('share token consumed');
    return true;
  }

  // --- Rate limiting -----------------------------------------------------

  function clientIp(req) {
    return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  }

  function isRateLimited(ip, now = Date.now()) {
    const attempts = authAttempts.get(ip) || [];
    const recent = attempts.filter((t) => now - t < RATE_WINDOW_MS);
    authAttempts.set(ip, recent);
    return recent.length >= RATE_MAX_ATTEMPTS;
  }

  function recordAttempt(ip, now = Date.now()) {
    const attempts = authAttempts.get(ip) || [];
    attempts.push(now);
    authAttempts.set(ip, attempts);
  }

  // --- Express middleware ------------------------------------------------

  function loginRedirectTarget(req) {
    const next = safeNextPath(req.originalUrl || req.url || '');
    if (!next || next === '/') return '/login';
    return `/login?next=${encodeURIComponent(next)}`;
  }

  function middleware(req, res, next) {
    if (!password) return next();
    const cookieToken = req.cookies && req.cookies[COOKIE_NAME];
    if (cookieToken) {
      const session = getSession(cookieToken);
      if (session) {
        req.authSession = session;
        return next();
      }
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const ip = clientIp(req);
      if (isRateLimited(ip)) {
        log.warn(`Auth: rate limit exceeded for ${ip}`);
        return res.status(429).json({ error: 'Too many attempts. Try again later.' });
      }
      if (safeCompare(authHeader.slice('Bearer '.length), password)) return next();
      recordAttempt(ip);
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (req.path && req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    res.redirect(loginRedirectTarget(req));
  }

  function rateLimit(req, res, next) {
    const ip = clientIp(req);
    if (isRateLimited(ip)) {
      log.warn(`Auth: rate limit exceeded for ${ip}`);
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    recordAttempt(ip);
    next();
  }

  function parseCookies(str) {
    const cookies = {};
    (str || '').split(';').forEach((c) => {
      const [k, ...v] = c.trim().split('=');
      if (k) cookies[k] = v.join('=');
    });
    return cookies;
  }

  return {
    password,
    cookieName: COOKIE_NAME,
    events,
    generateToken,
    validateToken,
    getSession,
    createSession,
    revokeSession,
    revokeOtherSessions,
    listSessions,
    setSessionCookie,
    clearSessionCookie,
    get userHandle() {
      return store.state.userHandle;
    },
    listPasskeys,
    getPasskey,
    passkeysForRp,
    addPasskey,
    updatePasskey,
    removePasskey,
    resetAll,
    generateShareToken,
    validateShareToken,
    middleware,
    rateLimit,
    parseCookies,
    safeCompare,
    cleanup: () => {
      clearInterval(cleanupInterval);
      if (touchPending) store.persist();
      touchPending = false;
    },
  };
}

module.exports = {
  createAuth,
  safeCompare,
  safeNextPath,
  describeUserAgent,
  COOKIE_NAME,
  REMEMBER_TTL_MS,
  REMEMBER_IDLE_MS,
  SESSION_ONLY_TTL_MS,
  SESSION_ONLY_IDLE_MS,
};
