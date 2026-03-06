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
    [data-theme='monokai'] { --bg:#272822; --surface:#1e1f1c; --border:#49483e;
      --border-subtle:#5c5c4f; --text:#f8f8f2; --text-secondary:#a59f85; --text-dim:#75715e;
      --accent:#a6e22e; --accent-hover:#b8f53c; --accent-active:#8acc16;
      --danger:#f92672; --shadow:rgba(0,0,0,0.3); }
    [data-theme='solarized-dark'] { --bg:#002b36; --surface:#073642; --border:#586e75;
      --border-subtle:#657b83; --text:#839496; --text-secondary:#657b83; --text-dim:#586e75;
      --accent:#268bd2; --accent-hover:#379ce3; --accent-active:#1a7abf;
      --danger:#dc322f; --shadow:rgba(0,0,0,0.25); }
    [data-theme='solarized-light'] { --bg:#fdf6e3; --surface:#eee8d5; --border:#93a1a1;
      --border-subtle:#839496; --text:#657b83; --text-secondary:#93a1a1; --text-dim:#a0a0a0;
      --accent:#268bd2; --accent-hover:#379ce3; --accent-active:#1a7abf;
      --danger:#dc322f; --shadow:rgba(0,0,0,0.08); }
    [data-theme='nord'] { --bg:#2e3440; --surface:#3b4252; --border:#434c5e;
      --border-subtle:#4c566a; --text:#d8dee9; --text-secondary:#b0bac9; --text-dim:#7b88a1;
      --accent:#88c0d0; --accent-hover:#9fd4e4; --accent-active:#6aafbf;
      --danger:#bf616a; --shadow:rgba(0,0,0,0.2); }
    [data-theme='dracula'] { --bg:#282a36; --surface:#343746; --border:#44475a;
      --border-subtle:#525568; --text:#f8f8f2; --text-secondary:#c1c4d2; --text-dim:#8e92a4;
      --accent:#bd93f9; --accent-hover:#d0b0ff; --accent-active:#a77de7;
      --danger:#ff5555; --shadow:rgba(0,0,0,0.25); }
    [data-theme='github-dark'] { --bg:#0d1117; --surface:#161b22; --border:#30363d;
      --border-subtle:#3d444d; --text:#c9d1d9; --text-secondary:#8b949e; --text-dim:#6e7681;
      --accent:#58a6ff; --accent-hover:#79b8ff; --accent-active:#388bfd;
      --danger:#f85149; --shadow:rgba(0,0,0,0.3); }
    [data-theme='one-dark'] { --bg:#282c34; --surface:#21252b; --border:#3e4452;
      --border-subtle:#4b5263; --text:#abb2bf; --text-secondary:#7f848e; --text-dim:#5c6370;
      --accent:#61afef; --accent-hover:#7dc0ff; --accent-active:#4d9ede;
      --danger:#e06c75; --shadow:rgba(0,0,0,0.25); }
    [data-theme='catppuccin'] { --bg:#1e1e2e; --surface:#313244; --border:#45475a;
      --border-subtle:#585b70; --text:#cdd6f4; --text-secondary:#a6adc8; --text-dim:#7f849c;
      --accent:#89b4fa; --accent-hover:#b4d0ff; --accent-active:#5c9de3;
      --danger:#f38ba8; --shadow:rgba(0,0,0,0.2); }
    [data-theme='gruvbox'] { --bg:#282828; --surface:#3c3836; --border:#504945;
      --border-subtle:#665c54; --text:#ebdbb2; --text-secondary:#d5c4a1; --text-dim:#a89984;
      --accent:#83a598; --accent-hover:#9dbfb4; --accent-active:#6a8f8a;
      --danger:#fb4934; --shadow:rgba(0,0,0,0.25); }
    [data-theme='night-owl'] { --bg:#011627; --surface:#0d2a45; --border:#1d3b53;
      --border-subtle:#264863; --text:#d6deeb; --text-secondary:#8badc1; --text-dim:#5f7e97;
      --accent:#7fdbca; --accent-hover:#9ff0e0; --accent-active:#62c5b5;
      --danger:#ef5350; --shadow:rgba(0,0,0,0.3); }
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { height:100%; background:var(--bg); color:var(--text);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      transition:background 0.3s,color 0.3s;
      padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .theme-wrap { position:fixed; top:16px; right:16px; z-index:10; }
    .theme-toggle { background:none; border:1px solid var(--border); color:var(--text-dim);
      width:32px; height:32px; border-radius:8px; cursor:pointer; display:flex;
      align-items:center; justify-content:center; font-size:16px;
      transition:color 0.15s,border-color 0.15s,background 0.15s;
      -webkit-tap-highlight-color:transparent; }
    .theme-toggle:hover { color:var(--text); border-color:var(--border-subtle); background:var(--border); }
    .theme-picker { display:none; position:absolute; top:calc(100% + 4px); right:0;
      background:var(--surface); border:1px solid var(--border); border-radius:8px;
      min-width:160px; padding:4px 0; box-shadow:0 4px 12px var(--shadow); }
    .theme-picker.open { display:block; }
    .theme-option { display:flex; align-items:center; gap:8px; padding:7px 12px;
      cursor:pointer; font-size:13px; color:var(--text); transition:background 0.1s; white-space:nowrap; }
    .theme-option:hover { background:var(--border); }
    .theme-option.active { color:var(--accent); }
    .theme-swatch { width:14px; height:14px; border-radius:50%; display:inline-block;
      flex-shrink:0; border:1px solid rgba(128,128,128,0.3); }
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
  <div class="theme-wrap" id="themeWrap">
    <button class="theme-toggle" id="themeBtn" aria-label="Switch theme">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
      </svg>
    </button>
    <div class="theme-picker" id="themePicker">
      <div class="theme-option" data-theme-option="dark"><span class="theme-swatch" style="background:#1e1e1e"></span>Dark</div>
      <div class="theme-option" data-theme-option="light"><span class="theme-swatch" style="background:#ffffff"></span>Light</div>
      <div class="theme-option" data-theme-option="monokai"><span class="theme-swatch" style="background:#272822"></span>Monokai</div>
      <div class="theme-option" data-theme-option="solarized-dark"><span class="theme-swatch" style="background:#002b36"></span>Solarized Dark</div>
      <div class="theme-option" data-theme-option="solarized-light"><span class="theme-swatch" style="background:#fdf6e3"></span>Solarized Light</div>
      <div class="theme-option" data-theme-option="nord"><span class="theme-swatch" style="background:#2e3440"></span>Nord</div>
      <div class="theme-option" data-theme-option="dracula"><span class="theme-swatch" style="background:#282a36"></span>Dracula</div>
      <div class="theme-option" data-theme-option="github-dark"><span class="theme-swatch" style="background:#0d1117"></span>GitHub Dark</div>
      <div class="theme-option" data-theme-option="one-dark"><span class="theme-swatch" style="background:#282c34"></span>One Dark</div>
      <div class="theme-option" data-theme-option="catppuccin"><span class="theme-swatch" style="background:#1e1e2e"></span>Catppuccin</div>
      <div class="theme-option" data-theme-option="gruvbox"><span class="theme-swatch" style="background:#282828"></span>Gruvbox</div>
      <div class="theme-option" data-theme-option="night-owl"><span class="theme-swatch" style="background:#011627"></span>Night Owl</div>
    </div>
  </div>
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
    const THEMES=[{id:'dark',bg:'#1e1e1e'},{id:'light',bg:'#f3f3f3'},{id:'monokai',bg:'#272822'},
      {id:'solarized-dark',bg:'#002b36'},{id:'solarized-light',bg:'#fdf6e3'},{id:'nord',bg:'#2e3440'},
      {id:'dracula',bg:'#282a36'},{id:'github-dark',bg:'#0d1117'},{id:'one-dark',bg:'#282c34'},
      {id:'catppuccin',bg:'#1e1e2e'},{id:'gruvbox',bg:'#282828'},{id:'night-owl',bg:'#011627'}];
    const h=document.documentElement, picker=document.getElementById('themePicker');
    function applyTheme(theme){
      h.setAttribute('data-theme',theme);
      const t=THEMES.find(x=>x.id===theme)||THEMES[0];
      document.querySelector('meta[name=theme-color]').content=t.bg;
      localStorage.setItem('termbeam-theme',theme);
      document.querySelectorAll('.theme-option').forEach(el=>el.classList.toggle('active',el.dataset.themeOption===theme));
    }
    applyTheme(localStorage.getItem('termbeam-theme')||'dark');
    document.getElementById('themeBtn').addEventListener('click',e=>{e.stopPropagation();picker.classList.toggle('open');});
    document.addEventListener('click',()=>picker.classList.remove('open'));
    document.querySelectorAll('.theme-option').forEach(el=>{
      el.addEventListener('click',e=>{e.stopPropagation();applyTheme(el.dataset.themeOption);picker.classList.remove('open');});
    });
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
  const cleanupInterval = setInterval(
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
    cleanup: () => clearInterval(cleanupInterval),
  };
}

module.exports = { createAuth };
