const crypto = require('crypto');
const log = require('./logger');

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta name="theme-color" content="#1a1a2e" />
  <title>TermBeam — Login</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #1a1a2e; color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; align-items: center; justify-content: center; }
    .card { background: #16213e; border: 1px solid #0f3460; border-radius: 16px;
      padding: 32px 24px; width: 320px; text-align: center; }
    h1 { font-size: 20px; margin-bottom: 8px; }
    h1 span { color: #533483; }
    p { font-size: 13px; color: #888; margin-bottom: 24px; }
    input { width: 100%; padding: 12px; background: #1a1a2e; border: 1px solid #0f3460;
      border-radius: 8px; color: #e0e0e0; font-size: 16px; outline: none;
      text-align: center; letter-spacing: 2px; }
    input:focus { border-color: #533483; }
    button { width: 100%; padding: 12px; margin-top: 16px; background: #533483;
      color: white; border: none; border-radius: 8px; font-size: 16px;
      font-weight: 600; cursor: pointer; }
    button:active { background: #6a42a8; }
    .error { color: #e74c3c; font-size: 13px; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>📡 Term<span>Beam</span></h1>
    <p>Enter the access password</p>
    <form id="form">
      <input type="password" id="pw" placeholder="Password" autocomplete="off" autofocus />
      <button type="submit">Unlock</button>
    </form>
    <div class="error" id="err">Incorrect password</div>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = document.getElementById('pw').value;
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) { location.href = '/'; }
      else {
        document.getElementById('err').style.display = 'block';
        document.getElementById('pw').value = '';
      }
    });
  </script>
</body>
</html>`;

function createAuth(password) {
  const tokens = new Map();
  const authAttempts = new Map();
  const otts = new Map(); // one-time tokens: token -> expiry

  // Periodically clean up expired tokens and stale rate-limit entries
  setInterval(
    () => {
      const now = Date.now();
      for (const [token, expiry] of tokens) {
        if (now > expiry) tokens.delete(token);
      }
      for (const [ip, attempts] of authAttempts) {
        const recent = attempts.filter((t) => now - t < 60 * 1000);
        if (recent.length === 0) authAttempts.delete(ip);
        else authAttempts.set(ip, recent);
      }
      for (const [ott, expiry] of otts) {
        if (now > expiry) otts.delete(ott);
      }
    },
    60 * 60 * 1000,
  ).unref();

  function generateOTT() {
    const ott = crypto.randomBytes(32).toString('hex');
    otts.set(ott, Date.now() + 5 * 60 * 1000); // 5 minute expiry
    return ott;
  }

  function validateAndConsumeOTT(ott) {
    const expiry = otts.get(ott);
    if (!expiry) return false;
    otts.delete(ott); // single use — always delete
    if (Date.now() > expiry) return false;
    return true;
  }

  function generateToken() {
    const token = crypto.randomBytes(32).toString('hex');
    tokens.set(token, Date.now() + 24 * 60 * 60 * 1000);
    return token;
  }

  function validateToken(token) {
    const expiry = tokens.get(token);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      tokens.delete(token);
      return false;
    }
    return true;
  }

  function middleware(req, res, next) {
    if (!password) return next();
    if (req.cookies.pty_token && validateToken(req.cookies.pty_token)) return next();
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${password}`) return next();
    if (req.accepts('html')) return res.redirect('/login');
    res.status(401).json({ error: 'unauthorized' });
  }

  function rateLimit(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress;
    const now = Date.now();
    const window = 60 * 1000;
    const maxAttempts = 5;
    const attempts = authAttempts.get(ip) || [];
    const recent = attempts.filter((t) => now - t < window);
    if (recent.length >= maxAttempts) {
      log.warn(`Auth: rate limit exceeded for ${ip}`);
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    recent.push(now);
    authAttempts.set(ip, recent);
    next();
  }

  function parseCookies(str) {
    const cookies = {};
    str.split(';').forEach((c) => {
      const [k, ...v] = c.trim().split('=');
      if (k) cookies[k] = v.join('=');
    });
    return cookies;
  }

  return {
    password,
    generateToken,
    validateToken,
    generateOTT,
    validateAndConsumeOTT,
    middleware,
    rateLimit,
    parseCookies,
    loginHTML: LOGIN_HTML,
  };
}

module.exports = { createAuth };
