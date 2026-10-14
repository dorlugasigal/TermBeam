/**
 * Persistent auth state: remembered device sessions + registered passkeys.
 *
 * Stored at `<configDir>/auth.json` (mode 0600). Session tokens are never
 * written to disk — only their SHA-256 hashes, so a leaked file can't be
 * replayed as a cookie. Sessions are bound to a password "epoch" (scrypt
 * fingerprint of the access password): starting TermBeam with a different
 * password revokes every remembered session, preserving the old
 * "new password = everyone signs in again" guarantee. Passkeys are explicit
 * credentials and survive password changes until revoked (Settings → Security,
 * or `termbeam --reset-auth`).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('../utils/logger');

const FILE_NAME = 'auth.json';
const FILE_VERSION = 1;
const MAX_SESSIONS = 200;
const MAX_PASSKEYS = 50;

function emptyState() {
  return {
    version: FILE_VERSION,
    epoch: null,
    userHandle: crypto.randomBytes(16).toString('base64url'),
    sessions: [],
    passkeys: [],
  };
}

function passwordEpoch(password, salt) {
  const saltBuf = salt ? Buffer.from(salt, 'base64') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), saltBuf, 32, { N: 16384, r: 8, p: 1 });
  return { salt: saltBuf.toString('base64'), hash: hash.toString('base64') };
}

function epochMatches(epoch, password) {
  if (!epoch || typeof epoch.salt !== 'string' || typeof epoch.hash !== 'string') return false;
  try {
    const expected = Buffer.from(epoch.hash, 'base64');
    const actual = Buffer.from(passwordEpoch(password, epoch.salt).hash, 'base64');
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sanitizeSession(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.id !== 'string' || typeof s.tokenHash !== 'string') return null;
  if (!/^[a-f0-9]{64}$/.test(s.tokenHash)) return null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: s.id.slice(0, 64),
    tokenHash: s.tokenHash,
    createdAt: num(s.createdAt) ?? Date.now(),
    lastSeenAt: num(s.lastSeenAt) ?? Date.now(),
    expiresAt: num(s.expiresAt) ?? 0,
    idleTimeoutMs: num(s.idleTimeoutMs),
    remember: s.remember !== false,
    method: typeof s.method === 'string' ? s.method.slice(0, 16) : 'password',
    userAgent: typeof s.userAgent === 'string' ? s.userAgent.slice(0, 300) : '',
    ip: typeof s.ip === 'string' ? s.ip.slice(0, 64) : '',
    passkeyId: typeof s.passkeyId === 'string' ? s.passkeyId.slice(0, 1400) : null,
  };
}

function sanitizePasskey(p) {
  if (!p || typeof p !== 'object') return null;
  if (typeof p.id !== 'string' || !p.publicKey || typeof p.publicKey !== 'object') return null;
  if (typeof p.rpId !== 'string' || !Number.isInteger(p.alg)) return null;
  return {
    id: p.id,
    publicKey: p.publicKey,
    alg: p.alg,
    signCount: Number.isInteger(p.signCount) ? p.signCount : 0,
    rpId: p.rpId,
    name: typeof p.name === 'string' ? p.name.slice(0, 64) : 'Passkey',
    transports: Array.isArray(p.transports)
      ? p.transports.filter((t) => typeof t === 'string')
      : [],
    backupEligible: !!p.backupEligible,
    backedUp: !!p.backedUp,
    aaguid: typeof p.aaguid === 'string' ? p.aaguid : null,
    createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
    lastUsedAt: Number.isFinite(p.lastUsedAt) ? p.lastUsedAt : null,
  };
}

/**
 * Create a store. When `configDir` is null the store is memory-only
 * (used by unit tests and `--no-password` mode).
 */
function createAuthStore({ configDir = null, password = null } = {}) {
  const filePath = configDir ? path.join(configDir, FILE_NAME) : null;
  let state = emptyState();

  if (filePath) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (raw && raw.version === FILE_VERSION) {
        state.userHandle =
          typeof raw.userHandle === 'string' && raw.userHandle ? raw.userHandle : state.userHandle;
        state.passkeys = (Array.isArray(raw.passkeys) ? raw.passkeys : [])
          .map(sanitizePasskey)
          .filter(Boolean)
          .slice(0, MAX_PASSKEYS);
        const savedSessions = Array.isArray(raw.sessions) ? raw.sessions : [];
        // Only pay the scrypt cost when there is something to restore. The
        // epoch is recomputed lazily on the next persist otherwise, so a
        // stale epoch from a different password can never be carried over.
        if (password && savedSessions.length > 0) {
          if (epochMatches(raw.epoch, password)) {
            state.epoch = raw.epoch;
            const now = Date.now();
            state.sessions = savedSessions
              .map(sanitizeSession)
              .filter((s) => s && s.remember && s.expiresAt > now)
              .slice(0, MAX_SESSIONS);
          } else {
            log.info('Auth: access password changed — remembered devices were signed out');
          }
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log.warn(`Auth: could not read ${FILE_NAME} (${err.message}) — starting fresh`);
      }
    }
  }

  function persist() {
    if (!filePath) return;
    if (password && !state.epoch && state.sessions.some((s) => s.remember)) {
      state.epoch = passwordEpoch(password);
    }
    const data = {
      version: FILE_VERSION,
      epoch: state.epoch,
      userHandle: state.userHandle,
      // Session-only ("don't remember me") logins never touch the disk.
      sessions: state.sessions.filter((s) => s.remember),
      passkeys: state.passkeys,
    };
    const tmp = `${filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, filePath);
      try {
        fs.chmodSync(filePath, 0o600);
      } catch {
        /* best effort (Windows) */
      }
    } catch (err) {
      log.warn(`Auth: failed to persist ${FILE_NAME}: ${err.message}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  function reset() {
    state = emptyState();
    persist();
  }

  return {
    get state() {
      return state;
    },
    persist,
    reset,
    limits: { MAX_SESSIONS, MAX_PASSKEYS },
  };
}

module.exports = { createAuthStore, passwordEpoch, epochMatches, FILE_NAME };
