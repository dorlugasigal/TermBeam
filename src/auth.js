const crypto = require('crypto');
const log = require('./logger');

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="theme-color" content="#1e1e1e" />
  <title>TermBeam — Login</title>
  <style>
    :root { --bg:#1e1e1e; --surface:#252526; --border:#3c3c3c; --border-subtle:#474747;
      --text:#d4d4d4; --text-secondary:#858585; --text-dim:#6e6e6e;
      --accent:#0078d4; --accent-hover:#1a8ae8; --accent-active:#005a9e;
      --danger:#f14c4c; --shadow:rgba(0,0,0,0.15); }
    [data-theme='light'] { --bg:#ffffff; --surface:#f3f3f3; --border:#e0e0e0;
      --border-subtle:#d0d0d0; --text:#1e1e1e; --text-secondary:#616161;
      --text-dim:#767676; --accent:#0078d4; --accent-hover:#106ebe;
      --accent-active:#005a9e; --danger:#e51400; --shadow:rgba(0,0,0,0.06); }
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { height:100%; background:var(--bg); color:var(--text);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      transition:background 0.3s,color 0.3s;
      padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .theme-toggle { position:fixed; top:16px; right:16px; background:none;
      border:1px solid var(--border); color:var(--text-dim); width:32px; height:32px;
      border-radius:8px; cursor:pointer; display:flex; align-items:center;
      justify-content:center; font-size:16px; transition:color 0.15s,border-color 0.15s,background 0.15s;
      -webkit-tap-highlight-color:transparent; z-index:10; }
    .theme-toggle:hover { color:var(--text); border-color:var(--border-subtle); background:var(--border); }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:12px;
      padding:32px 24px; width:320px; max-width:calc(100vw - 32px); text-align:center;
      box-shadow:0 2px 8px var(--shadow); transition:background 0.3s,border-color 0.3s,box-shadow 0.3s; }
    h1 { font-size:22px; font-weight:700; margin-bottom:4px; }
    h1 span { color:var(--accent); }
    .subtitle { font-size:13px; color:var(--text-secondary); margin-bottom:24px; }
    input { width:100%; padding:12px; background:var(--bg); border:1px solid var(--border);
      border-radius:8px; color:var(--text); font-size:16px; outline:none;
      text-align:center; letter-spacing:2px; transition:border-color 0.15s,background 0.3s,color 0.3s; }
    input:focus { border-color:var(--accent); }
    .btn { width:100%; padding:12px; margin-top:16px; background:var(--accent);
      color:#fff; border:none; border-radius:8px; font-size:16px;
      font-weight:600; cursor:pointer; transition:background 0.15s; }
    .btn:hover { background:var(--accent-hover); }
    .btn:active { background:var(--accent-active); }
    .error { color:var(--danger); font-size:13px; margin-top:12px; display:none; transition:color 0.3s; }
    .tagline { margin-top:24px; font-size:12px; color:var(--text-dim); transition:color 0.3s; }
  </style>
</head>
<body>
  <button class="theme-toggle" id="themeBtn" aria-label="Toggle theme">🌙</button>
  <div class="card">
    <h1>📡 Term<span>Beam</span></h1>
    <p class="subtitle">Enter the access password</p>
    <form id="form">
      <input type="password" id="pw" placeholder="Password" autocomplete="off" autofocus />
      <button type="submit" class="btn">Unlock</button>
    </form>
    <div class="error" id="err">Incorrect password</div>
  </div>
  <p class="tagline">Beam your terminal to any device</p>
  <script>
    const t=document.getElementById('themeBtn'), h=document.documentElement;
    function applyTheme(light){h.setAttribute('data-theme',light?'light':'');t.textContent=light?'☀️':'🌙';
      document.querySelector('meta[name=theme-color]').content=light?'#ffffff':'#1e1e1e';}
    applyTheme(localStorage.getItem('theme')==='light');
    t.addEventListener('click',()=>{const light=h.getAttribute('data-theme')!=='light';
      localStorage.setItem('theme',light?'light':'dark');applyTheme(light);});
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
  const shareTokens = new Map(); // share tokens: token -> expiry

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
      for (const [st, expiry] of shareTokens) {
        if (now > expiry) shareTokens.delete(st);
      }
    },
    60 * 60 * 1000,
  ).unref();

  function generateShareToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 5 * 60 * 1000;
    shareTokens.set(token, expiry); // 5 minute expiry
    log.info('Share: created new token (expires in 5m)');
    log.debug(`Share: token expires at ${new Date(expiry).toISOString()}`);
    return token;
  }

  function validateShareToken(token) {
    const expiry = shareTokens.get(token);
    if (!expiry) {
      log.warn('Share: unknown token presented');
      return false;
    }
    const remaining = Math.round((expiry - Date.now()) / 1000);
    if (remaining <= 0) {
      shareTokens.delete(token);
      log.warn('Share: expired token presented');
      return false;
    }
    shareTokens.delete(token);
    log.info('share token consumed');
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
    if (authHeader && authHeader.startsWith('Bearer ')) {
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
      if (authHeader === `Bearer ${password}`) return next();
      recent.push(now);
      authAttempts.set(ip, recent);
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
    res.redirect('/login');
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
    generateShareToken,
    validateShareToken,
    middleware,
    rateLimit,
    parseCookies,
    loginHTML: LOGIN_HTML,
  };
}

module.exports = { createAuth };
