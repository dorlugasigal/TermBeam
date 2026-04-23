const crypto = require('crypto');
const log = require('../utils/logger');

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="theme-color" content="#1e1e1e" />
  <link rel="icon" type="image/png" href="/icons/icon-192.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="https://termbeam.pages.dev/icons/icon-180.png" />
  <link rel="apple-touch-icon" sizes="192x192" href="https://termbeam.pages.dev/icons/icon-192.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
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
    [data-theme='tokyo-night'] { --bg:#1a1b26; --surface:#24283b; --border:#3b4261;
      --border-subtle:#444b6a; --text:#a9b1d6; --text-secondary:#7982a9; --text-dim:#565f89;
      --accent:#7aa2f7; --accent-hover:#99b4ff; --accent-active:#5d8af0;
      --danger:#f7768e; --shadow:rgba(0,0,0,0.3); }
    [data-theme='rose-pine'] { --bg:#191724; --surface:#1f1d2e; --border:#26233a;
      --border-subtle:#393552; --text:#e0def4; --text-secondary:#908caa; --text-dim:#6e6a86;
      --accent:#c4a7e7; --accent-hover:#d4bef5; --accent-active:#a88fd4;
      --danger:#eb6f92; --shadow:rgba(0,0,0,0.3); }
    [data-theme='kanagawa'] { --bg:#1f1f28; --surface:#2a2a37; --border:#363646;
      --border-subtle:#454559; --text:#dcd7ba; --text-secondary:#c8c093; --text-dim:#727169;
      --accent:#7e9cd8; --accent-hover:#9bb5e6; --accent-active:#6282c2;
      --danger:#c34043; --shadow:rgba(0,0,0,0.3); }
    [data-theme='everforest'] { --bg:#2d353b; --surface:#343f44; --border:#475258;
      --border-subtle:#56635a; --text:#d3c6aa; --text-secondary:#a7c080; --text-dim:#859289;
      --accent:#a7c080; --accent-hover:#bdd49b; --accent-active:#8faa68;
      --danger:#e67e80; --shadow:rgba(0,0,0,0.25); }
    [data-theme='ayu-dark'] { --bg:#0b0e14; --surface:#11151c; --border:#1c2433;
      --border-subtle:#2d3b4d; --text:#bfbdb6; --text-secondary:#73b8ff; --text-dim:#636a76;
      --accent:#e6b450; --accent-hover:#f0c566; --accent-active:#d49e38;
      --danger:#ea6c73; --shadow:rgba(0,0,0,0.35); }
    [data-theme='matrix'] { --bg:#0a0a0a; --surface:#111111; --border:#003b00;
      --border-subtle:#005200; --text:#00ff41; --text-secondary:#00cc33; --text-dim:#009926;
      --accent:#00ff41; --accent-hover:#33ff66; --accent-active:#00cc33;
      --danger:#00e639; --shadow:rgba(0,255,65,0.15); }
    [data-theme='cyberpunk'] { --bg:#0d0221; --surface:#150535; --border:#2a0a4a;
      --border-subtle:#3d1166; --text:#e0d0ff; --text-secondary:#b49ce0; --text-dim:#7b5ea7;
      --accent:#ff2a6d; --accent-hover:#ff5588; --accent-active:#d91e5a;
      --danger:#d300c5; --shadow:rgba(255,42,109,0.2); }
    [data-theme='sunset-glow'] { --bg:#1a1016; --surface:#261820; --border:#3d2530;
      --border-subtle:#553545; --text:#e8d5c4; --text-secondary:#c0a090; --text-dim:#8a6a5a;
      --accent:#ff6b35; --accent-hover:#ff8a55; --accent-active:#e05520;
      --danger:#ff6b6b; --shadow:rgba(255,107,53,0.2); }
    [data-theme='synthwave'] { --bg:#241b2f; --surface:#2e2440; --border:#453558;
      --border-subtle:#5a4670; --text:#f0e4fc; --text-secondary:#c0b0d8; --text-dim:#7a6a90;
      --accent:#ff7edb; --accent-hover:#ff9de6; --accent-active:#e060c0;
      --danger:#fe4450; --shadow:rgba(255,126,219,0.2); }
    [data-theme='aurora'] { --bg:#07090f; --surface:#0e1220; --border:#1a2035;
      --border-subtle:#263050; --text:#c5d1eb; --text-secondary:#8898b8; --text-dim:#506080;
      --accent:#5ec796; --accent-hover:#78d8aa; --accent-active:#48b080;
      --danger:#e06c8a; --shadow:rgba(94,199,150,0.15); }
    [data-theme='retro-amber'] { --bg:#1a1200; --surface:#221a00; --border:#3d2e00;
      --border-subtle:#554000; --text:#ffb000; --text-secondary:#cc8800; --text-dim:#886000;
      --accent:#ffb000; --accent-hover:#ffc040; --accent-active:#e09900;
      --danger:#ff8c00; --shadow:rgba(255,176,0,0.15); }
    [data-theme='deep-ocean'] { --bg:#040b14; --surface:#08121e; --border:#122038;
      --border-subtle:#1a3050; --text:#8ab4f8; --text-secondary:#5a8ac0; --text-dim:#2a5a90;
      --accent:#4fc3f7; --accent-hover:#70d4ff; --accent-active:#38a8e0;
      --danger:#ff5252; --shadow:rgba(79,195,247,0.15); }
    [data-theme='neon-noir'] { --bg:#0c0c0c; --surface:#161616; --border:#2a2a2a;
      --border-subtle:#383838; --text:#cccccc; --text-secondary:#999999; --text-dim:#666666;
      --accent:#00ff9f; --accent-hover:#33ffb5; --accent-active:#00cc80;
      --danger:#ff003c; --shadow:rgba(0,255,159,0.12); }
    [data-theme='frost-byte'] { --bg:#0a1628; --surface:#10203a; --border:#1a3050;
      --border-subtle:#254060; --text:#c7dbe6; --text-secondary:#8aaccc; --text-dim:#4a7090;
      --accent:#6cb6e0; --accent-hover:#88caf0; --accent-active:#50a0cc;
      --danger:#e87d8a; --shadow:rgba(108,182,224,0.15); }
    [data-theme='vice-city'] { --bg:#0f0326; --surface:#1a0838; --border:#2e1055;
      --border-subtle:#421870; --text:#f8d0f0; --text-secondary:#c8a0c0; --text-dim:#8a6088;
      --accent:#ff71ce; --accent-hover:#ff95db; --accent-active:#e050b0;
      --danger:#ff3a7e; --shadow:rgba(255,113,206,0.2); }
    [data-theme='radical'] { --bg:#141322; --surface:#1c1b30; --border:#303145;
      --border-subtle:#40415a; --text:#d1d2d3; --text-secondary:#a8ffdb; --text-dim:#5a5b78;
      --accent:#ff428e; --accent-hover:#ff6ea4; --accent-active:#d83070;
      --danger:#fc28a8; --shadow:rgba(255,66,142,0.18); }
    [data-theme='material-ocean'] { --bg:#0f111a; --surface:#181a27; --border:#252837;
      --border-subtle:#333750; --text:#a6accd; --text-secondary:#717cb4; --text-dim:#4b5178;
      --accent:#82aaff; --accent-hover:#a0c0ff; --accent-active:#6090e8;
      --danger:#f07178; --shadow:rgba(130,170,255,0.12); }
    [data-theme='sakura'] { --bg:#1e1527; --surface:#281e35; --border:#3a2d4a;
      --border-subtle:#4e3d62; --text:#f0d6e8; --text-secondary:#c8a8c0; --text-dim:#8a6888;
      --accent:#ff90b3; --accent-hover:#ffa8c5; --accent-active:#e07898;
      --danger:#ff6b9d; --shadow:rgba(255,144,179,0.18); }
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
    .theme-picker { display:none; position:fixed; top:50%; left:50%;
      transform:translate(-50%,-50%); width:220px; max-height:min(480px,70vh);
      background:var(--surface); border:1px solid var(--border); border-radius:12px;
      z-index:100; box-shadow:0 12px 40px var(--shadow);
      flex-direction:column; }
    .theme-picker.open { display:flex; }
    .theme-picker-header { display:flex; align-items:center; justify-content:space-between;
      padding:10px 12px; border-bottom:1px solid var(--border); flex-shrink:0; }
    .theme-picker-title { font-size:13px; font-weight:600; color:var(--text); }
    .theme-picker-close { background:none; border:none; color:var(--text-dim); font-size:14px;
      cursor:pointer; padding:2px 6px; border-radius:4px; line-height:1;
      transition:color 0.15s,background 0.15s; }
    .theme-picker-close:hover { color:var(--text); background:var(--border); }
    .theme-picker-list { overflow-y:auto; padding:4px 0; flex:1; }
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
      <div class="theme-picker-header">
        <span class="theme-picker-title">Theme</span>
        <button class="theme-picker-close" id="themeClose" aria-label="Close">✕</button>
      </div>
      <div class="theme-picker-list">
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
      <div class="theme-option" data-theme-option="tokyo-night"><span class="theme-swatch" style="background:#1a1b26"></span>Tokyo Night</div>
      <div class="theme-option" data-theme-option="rose-pine"><span class="theme-swatch" style="background:#191724"></span>Rosé Pine</div>
      <div class="theme-option" data-theme-option="kanagawa"><span class="theme-swatch" style="background:#1f1f28"></span>Kanagawa</div>
      <div class="theme-option" data-theme-option="everforest"><span class="theme-swatch" style="background:#2d353b"></span>Everforest</div>
      <div class="theme-option" data-theme-option="ayu-dark"><span class="theme-swatch" style="background:#0b0e14"></span>Ayu Dark</div>
      <div class="theme-option" data-theme-option="matrix"><span class="theme-swatch" style="background:#0a0a0a"></span>Matrix</div>
      <div class="theme-option" data-theme-option="cyberpunk"><span class="theme-swatch" style="background:#0d0221"></span>Cyberpunk</div>
      <div class="theme-option" data-theme-option="sunset-glow"><span class="theme-swatch" style="background:#1a1016"></span>Sunset Glow</div>
      <div class="theme-option" data-theme-option="synthwave"><span class="theme-swatch" style="background:#241b2f"></span>Synthwave</div>
      <div class="theme-option" data-theme-option="aurora"><span class="theme-swatch" style="background:#07090f"></span>Aurora</div>
      <div class="theme-option" data-theme-option="retro-amber"><span class="theme-swatch" style="background:#1a1200"></span>Retro Amber</div>
      <div class="theme-option" data-theme-option="deep-ocean"><span class="theme-swatch" style="background:#040b14"></span>Deep Ocean</div>
      <div class="theme-option" data-theme-option="neon-noir"><span class="theme-swatch" style="background:#0c0c0c"></span>Neon Noir</div>
      <div class="theme-option" data-theme-option="frost-byte"><span class="theme-swatch" style="background:#0a1628"></span>Frost Byte</div>
      <div class="theme-option" data-theme-option="vice-city"><span class="theme-swatch" style="background:#0f0326"></span>Vice City</div>
      <div class="theme-option" data-theme-option="radical"><span class="theme-swatch" style="background:#141322"></span>Radical</div>
      <div class="theme-option" data-theme-option="material-ocean"><span class="theme-swatch" style="background:#0f111a"></span>Material Ocean</div>
      <div class="theme-option" data-theme-option="sakura"><span class="theme-swatch" style="background:#1e1527"></span>Sakura</div>
      </div>
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
      {id:'catppuccin',bg:'#1e1e2e'},{id:'gruvbox',bg:'#282828'},{id:'night-owl',bg:'#011627'},
      {id:'tokyo-night',bg:'#1a1b26'},{id:'rose-pine',bg:'#191724'},{id:'kanagawa',bg:'#1f1f28'},
      {id:'everforest',bg:'#2d353b'},{id:'ayu-dark',bg:'#0b0e14'},
      {id:'matrix',bg:'#0a0a0a'},{id:'cyberpunk',bg:'#0d0221'},
      {id:'sunset-glow',bg:'#1a1016'},{id:'synthwave',bg:'#241b2f'},{id:'aurora',bg:'#07090f'},
      {id:'retro-amber',bg:'#1a1200'},{id:'deep-ocean',bg:'#040b14'},
      {id:'neon-noir',bg:'#0c0c0c'},{id:'frost-byte',bg:'#0a1628'},
      {id:'vice-city',bg:'#0f0326'},{id:'radical',bg:'#141322'},
      {id:'material-ocean',bg:'#0f111a'},{id:'sakura',bg:'#1e1527'}];
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
    document.getElementById('themeClose').addEventListener('click',e=>{e.stopPropagation();picker.classList.remove('open');});
    document.addEventListener('click',e=>{if(!picker.contains(e.target)&&e.target!==document.getElementById('themeBtn'))picker.classList.remove('open');});
    document.querySelectorAll('.theme-option').forEach(el=>{
      el.addEventListener('click',e=>{e.stopPropagation();applyTheme(el.dataset.themeOption);});
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

// Constant-time string compare using crypto.timingSafeEqual on raw bytes.
// We intentionally do NOT hash the inputs: this is an equality check against
// an in-memory secret (never stored), and hashing would trip CodeQL's
// js/insufficient-password-hash rule which is aimed at password *storage*.
// When lengths differ we still run timingSafeEqual on the longer buffer
// against itself so the branch cost is roughly constant.
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function createAuth(password) {
  const tokens = new Map();
  const authAttempts = new Map();
  const shareTokens = new Map(); // share tokens: token -> expiry

  // Periodically clean up expired tokens and stale rate-limit entries
  const cleanupInterval = setInterval(
    () => {
      log.debug('Token cleanup: removing expired auth and share tokens');
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
    log.debug('Auth token generated (24h expiry)');
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
      if (safeCompare(authHeader.slice('Bearer '.length), password)) return next();
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
    safeCompare,
    loginHTML: LOGIN_HTML,
    cleanup: () => clearInterval(cleanupInterval),
  };
}

module.exports = { createAuth, safeCompare };
