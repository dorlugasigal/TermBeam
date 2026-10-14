/**
 * Authentication routes: password / QR login, logout, remembered devices and
 * passkeys (WebAuthn).
 *
 *   POST   /api/auth                          password or one-time QR token → session cookie
 *   GET    /api/auth/status                   public: is a password / passkey available here?
 *   POST   /api/auth/logout                   sign this device out
 *   GET    /api/auth/sessions                 list signed-in devices
 *   DELETE /api/auth/sessions/:id             sign a device out
 *   POST   /api/auth/sessions/revoke-others   sign out every other device
 *   POST   /api/auth/passkeys/register/options + /register   add a passkey (signed-in only)
 *   POST   /api/auth/passkeys/login/options    + /login      unlock with a passkey
 *   GET    /api/auth/passkeys                 list passkeys
 *   PATCH  /api/auth/passkeys/:id             rename
 *   DELETE /api/auth/passkeys/:id             remove (also signs its sessions out)
 *
 * Passkeys require a secure context, so they are offered only on the HTTPS
 * tunnel origin or http://localhost — never on plain-http LAN addresses.
 */
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const log = require('../utils/logger');
const webauthn = require('./webauthn');
const { describeUserAgent } = require('./auth');
const { isLoopbackAddress } = require('./origin');

const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const MAX_PENDING_CHALLENGES = 500;

function friendlyHostName() {
  return (os.hostname() || 'this computer').replace(/\.(local|lan|home)$/i, '').slice(0, 48);
}

function sanitizeLabel(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 48);
}

function setupAuthRoutes(app, { auth, config, state }) {
  const noop = (_req, _res, next) => next();
  const passkeyLimit = config.disableRateLimit
    ? noop
    : rateLimit({
        windowMs: 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) =>
          res.status(429).json({ error: 'Too many attempts. Try again in a minute.' }),
      });
  const statusLimit = config.disableRateLimit
    ? noop
    : rateLimit({
        windowMs: 60 * 1000,
        max: 120,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => res.status(429).json({ error: 'Too many requests' }),
      });

  const challenges = new Map();

  function issueChallenge(entry) {
    const now = Date.now();
    for (const [key, value] of challenges) {
      if (value.expiresAt < now) challenges.delete(key);
    }
    while (challenges.size >= MAX_PENDING_CHALLENGES) {
      challenges.delete(challenges.keys().next().value);
    }
    const challenge = crypto.randomBytes(32).toString('base64url');
    challenges.set(challenge, { ...entry, expiresAt: now + CHALLENGE_TTL_MS });
    return challenge;
  }

  /** Single-use lookup: the challenge is consumed whether or not it verifies. */
  function consumeChallenge(credential, purpose) {
    const challenge = webauthn.peekChallenge(credential);
    if (!challenge) return null;
    const entry = challenges.get(challenge);
    if (!entry) return null;
    challenges.delete(challenge);
    if (entry.purpose !== purpose || entry.expiresAt < Date.now()) return null;
    return { challenge, ...entry };
  }

  function hostCandidates(req) {
    const hosts = new Set(['localhost']);
    if (req.hostname) hosts.add(String(req.hostname).toLowerCase());
    const hostHeader = String(req.headers.host || '').toLowerCase();
    if (hostHeader) hosts.add(hostHeader.replace(/:\d+$/, ''));
    // Local reverse proxies (devtunnel host, cloudflared, tailscale serve…)
    // reach us over loopback and name the public host here.
    if (isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
      const fwd = String(req.headers['x-forwarded-host'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();
      if (fwd) hosts.add(fwd.replace(/:\d+$/, ''));
    }
    for (const url of [state && state.publicUrl, config && config.publicUrl]) {
      if (!url) continue;
      try {
        hosts.add(new URL(url).hostname.toLowerCase());
      } catch {
        /* ignore */
      }
    }
    return hosts;
  }

  /**
   * Validate a browser origin for WebAuthn: it must be a secure context
   * (https, or http://localhost), use a DNS name (IP literals can't be RP IDs),
   * and name a host this server is actually being reached at.
   */
  function originContext(origin, req) {
    if (typeof origin !== 'string' || origin.length > 512) return null;
    let url;
    try {
      url = new URL(origin);
    } catch {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    const secure =
      url.protocol === 'https:' || (url.protocol === 'http:' && hostname === 'localhost');
    if (!secure || net.isIP(hostname.replace(/^\[|\]$/g, ''))) return null;
    if (!hostCandidates(req).has(hostname)) return null;
    return { origin: url.origin, rpId: hostname };
  }

  /**
   * The page origin a passkey ceremony runs on. Browsers report it in the
   * body because the Dev Tunnels relay rewrites a same-origin `Origin` header
   * to http://localhost:<port>, which would yield the wrong RP ID. The value
   * is still validated by originContext(), and the browser binds the real
   * origin into clientDataJSON, which is checked against it on verify.
   */
  function ceremonyOrigin(req) {
    const claimed = req.body && req.body.origin;
    return typeof claimed === 'string' && claimed ? claimed : req.headers.origin;
  }

  function sendWebAuthnError(res, err, fallback) {
    if (err instanceof webauthn.WebAuthnError) {
      log.warn(`Passkey: ${fallback} — ${err.message}`);
      return res.status(400).json({ error: `${fallback}: ${err.message}` });
    }
    log.error(`Passkey: ${fallback} — ${err && err.message}`);
    return res.status(500).json({ error: fallback });
  }

  function clientMeta(req) {
    return {
      userAgent: String(req.headers['user-agent'] || ''),
      ip: req.ip || (req.socket && req.socket.remoteAddress) || '',
    };
  }

  // --- Password / one-time-token login -------------------------------------

  app.post('/api/auth', auth.rateLimit, (req, res) => {
    const { password, ott, remember } = req.body || {};
    let method = null;
    if (typeof ott === 'string' && ott && auth.password && auth.validateShareToken(ott)) {
      method = 'qr';
    } else if (auth.safeCompare(password, auth.password)) {
      method = 'password';
    }
    if (!method) {
      log.warn(`Auth: login failed from ${req.ip}`);
      return res.status(401).json({ error: 'wrong password' });
    }
    const { token, session } = auth.createSession({
      method,
      remember: remember !== false,
      ...clientMeta(req),
    });
    auth.setSessionCookie(req, res, token, session);
    log.info(`Auth: ${method === 'qr' ? 'one-time link' : 'password'} login from ${req.ip}`);
    res.json({ ok: true });
  });

  app.get('/api/auth/status', statusLimit, (req, res) => {
    const token = req.cookies && req.cookies[auth.cookieName];
    const session = auth.password && token ? auth.getSession(token) : null;
    const authenticated = !auth.password || !!session;
    const ctx = auth.password ? originContext(req.query.origin, req) : null;
    res.set('Cache-Control', 'no-store');
    res.json({
      passwordRequired: !!auth.password,
      authenticated,
      passkeys: {
        enabled: !!ctx,
        registered: ctx ? auth.passkeysForRp(ctx.rpId).length > 0 : false,
      },
      session: session ? { method: session.method, createdAt: session.createdAt } : null,
    });
  });

  app.post('/api/auth/logout', auth.middleware, (req, res) => {
    if (req.authSession) auth.revokeSession(req.authSession.id);
    auth.clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // --- Remembered devices -------------------------------------------------

  app.get('/api/auth/sessions', auth.middleware, (req, res) => {
    res.json({ sessions: auth.listSessions(req.authSession ? req.authSession.id : null) });
  });

  app.delete('/api/auth/sessions/:id', auth.middleware, (req, res) => {
    const id = String(req.params.id);
    if (!auth.revokeSession(id)) return res.status(404).json({ error: 'not found' });
    if (req.authSession && req.authSession.id === id) auth.clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.post('/api/auth/sessions/revoke-others', auth.middleware, (req, res) => {
    if (!req.authSession) {
      return res.status(400).json({ error: 'Sign in from a browser to manage devices' });
    }
    const revoked = auth.revokeOtherSessions(req.authSession.id);
    log.info(`Auth: signed out ${revoked} other device(s)`);
    res.json({ ok: true, revoked });
  });

  // --- Passkeys -------------------------------------------------------------

  app.get('/api/auth/passkeys', auth.middleware, (_req, res) => {
    res.json({ passkeys: auth.listPasskeys() });
  });

  app.post('/api/auth/passkeys/register/options', auth.middleware, passkeyLimit, (req, res) => {
    if (!auth.password) return res.status(400).json({ error: 'Passkeys need password auth' });
    if (!req.authSession) {
      return res.status(400).json({ error: 'Sign in from a browser to add a passkey' });
    }
    const ctx = originContext(ceremonyOrigin(req), req);
    if (!ctx) {
      return res.status(400).json({
        error:
          'Passkeys need a secure address — open TermBeam via its https tunnel URL or localhost',
      });
    }
    const challenge = issueChallenge({
      purpose: 'register',
      rpId: ctx.rpId,
      origin: ctx.origin,
      sessionId: req.authSession.id,
    });
    const host = friendlyHostName();
    res.json({
      publicKey: {
        challenge,
        rp: { id: ctx.rpId, name: 'TermBeam' },
        user: { id: auth.userHandle, name: `termbeam@${host}`, displayName: `TermBeam · ${host}` },
        pubKeyCredParams: webauthn.SUPPORTED_ALGS.map((alg) => ({ type: 'public-key', alg })),
        timeout: 120000,
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          requireResidentKey: false,
          userVerification: 'required',
        },
        excludeCredentials: auth.passkeysForRp(ctx.rpId).map((p) => ({
          type: 'public-key',
          id: p.id,
          transports: p.transports,
        })),
      },
    });
  });

  app.post('/api/auth/passkeys/register', auth.middleware, passkeyLimit, (req, res) => {
    const { credential, name } = req.body || {};
    const entry = consumeChallenge(credential, 'register');
    if (!entry || !req.authSession || entry.sessionId !== req.authSession.id) {
      return res.status(400).json({ error: 'Passkey setup expired — please try again' });
    }
    try {
      const record = webauthn.verifyRegistration(credential, {
        challenge: entry.challenge,
        rpId: entry.rpId,
        isOriginAllowed: (o) => o === entry.origin,
      });
      const label = sanitizeLabel(name) || describeUserAgent(req.headers['user-agent']);
      const saved = auth.addPasskey({ ...record, name: label });
      res.json({
        ok: true,
        passkey: { id: saved.id, name: saved.name, rpId: saved.rpId, createdAt: saved.createdAt },
      });
    } catch (err) {
      if (err instanceof webauthn.WebAuthnError)
        return sendWebAuthnError(res, err, 'Passkey setup failed');
      return res.status(400).json({ error: err.message || 'Passkey setup failed' });
    }
  });

  app.post('/api/auth/passkeys/login/options', passkeyLimit, (req, res) => {
    if (!auth.password) return res.status(400).json({ error: 'Authentication is disabled' });
    const ctx = originContext(ceremonyOrigin(req), req);
    if (!ctx) return res.status(400).json({ error: 'Passkeys are not available on this address' });
    const creds = auth.passkeysForRp(ctx.rpId);
    if (creds.length === 0) {
      return res.status(404).json({ error: 'No passkeys are registered for this address yet' });
    }
    const challenge = issueChallenge({ purpose: 'login', rpId: ctx.rpId, origin: ctx.origin });
    res.json({
      publicKey: {
        challenge,
        rpId: ctx.rpId,
        timeout: 60000,
        userVerification: 'required',
        allowCredentials: creds.map((p) => ({
          type: 'public-key',
          id: p.id,
          transports: p.transports,
        })),
      },
    });
  });

  app.post('/api/auth/passkeys/login', passkeyLimit, (req, res) => {
    const { credential, remember } = req.body || {};
    const entry = consumeChallenge(credential, 'login');
    if (!entry)
      return res.status(400).json({ error: 'Sign-in request expired — please try again' });
    const stored =
      credential && typeof credential.id === 'string' ? auth.getPasskey(credential.id) : null;
    if (!stored || stored.rpId !== entry.rpId) {
      log.warn(`Passkey: unknown credential presented from ${req.ip}`);
      return res.status(401).json({ error: 'This passkey is not registered with TermBeam' });
    }
    const userHandle = credential.response && credential.response.userHandle;
    if (userHandle && userHandle !== auth.userHandle) {
      return res.status(401).json({ error: 'This passkey belongs to a different TermBeam host' });
    }
    try {
      const { signCount, backedUp } = webauthn.verifyAuthentication(credential, stored, {
        challenge: entry.challenge,
        isOriginAllowed: (o) => o === entry.origin,
      });
      auth.updatePasskey(stored.id, { signCount, backedUp, lastUsedAt: Date.now() });
    } catch (err) {
      return sendWebAuthnError(res, err, 'Passkey sign-in failed');
    }
    const { token, session } = auth.createSession({
      method: 'passkey',
      remember: remember !== false,
      passkeyId: stored.id,
      ...clientMeta(req),
    });
    auth.setSessionCookie(req, res, token, session);
    log.info(`Auth: passkey "${stored.name}" sign-in from ${req.ip}`);
    res.json({ ok: true });
  });

  app.patch('/api/auth/passkeys/:id', auth.middleware, (req, res) => {
    const name = sanitizeLabel(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const updated = auth.updatePasskey(String(req.params.id), { name });
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  app.delete('/api/auth/passkeys/:id', auth.middleware, (req, res) => {
    if (!auth.removePasskey(String(req.params.id))) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ ok: true });
  });
}

module.exports = { setupAuthRoutes };
