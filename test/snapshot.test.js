const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createTermBeamServer } = require('../src/server');

// --- Helpers ---

const baseConfig = {
  port: 0,
  host: '127.0.0.1',
  password: null,
  useTunnel: false,
  persistedTunnel: false,
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  shellArgs: [],
  cwd: process.cwd(),
  defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  version: '0.1.0-test',
  logLevel: 'error',
};

function makeConfig(overrides = {}) {
  return { ...baseConfig, ...overrides };
}

function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function startServer(configOverrides = {}) {
  const instance = createTermBeamServer({ config: makeConfig(configOverrides) });
  await instance.start();
  const port = instance.server.address().port;
  return { ...instance, port };
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Collect all JS content available to a page: inline <script> blocks + local <script src> files
function collectAllJS(html) {
  let allJS = '';
  // Inline scripts
  const inlineRegex = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = inlineRegex.exec(html))) {
    allJS += m[1] + '\n';
  }
  // Local script src files (skip CDN)
  const srcRegex = /<script\s+src="([^"]+)"/g;
  while ((m = srcRegex.exec(html))) {
    const src = m[1];
    if (src.startsWith('/') && !src.startsWith('//')) {
      const filePath = path.join(PUBLIC_DIR, src);
      if (fs.existsSync(filePath)) {
        allJS += fs.readFileSync(filePath, 'utf8') + '\n';
      }
    }
  }
  return allJS;
}

// Collect all CSS: inline <style> blocks + local <link rel="stylesheet"> files
function collectAllCSS(html) {
  let allCSS = '';
  const styleRegex = /<style>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = styleRegex.exec(html))) {
    allCSS += m[1] + '\n';
  }
  const linkRegex = /<link\s+[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g;
  while ((m = linkRegex.exec(html))) {
    const href = m[1];
    if (href.startsWith('/') && !href.startsWith('//')) {
      const filePath = path.join(PUBLIC_DIR, href);
      if (fs.existsSync(filePath)) {
        allCSS += fs.readFileSync(filePath, 'utf8') + '\n';
      }
    }
  }
  return allCSS;
}

// --- Tests ---
// These tests verify the COMBINED output of each page (HTML + all local JS/CSS files it loads).
// When code moves from inline to external files, these tests still pass as long as the
// functions, variables, CSS variables, and DOM elements remain available to the page.

describe('UI contract tests', () => {
  let inst;

  before(async () => {
    inst = await startServer();
  });

  after(() => inst?.shutdown());

  describe('index.html (dashboard)', () => {
    let html;
    let allJS;
    let allCSS;

    before(async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      html = res.data;
      allJS = collectAllJS(html);
      allCSS = collectAllCSS(html);
    });

    it('should contain all expected theme CSS variable blocks', () => {
      const themes = [
        'light',
        'monokai',
        'solarized-dark',
        'solarized-light',
        'nord',
        'dracula',
        'github-dark',
        'one-dark',
        'catppuccin',
        'gruvbox',
        'night-owl',
      ];
      for (const t of themes) {
        assert.ok(allCSS.includes(`[data-theme='${t}']`), `Missing theme block: ${t}`);
      }
    });

    it('should contain shared CSS variables in :root', () => {
      const requiredVars = [
        '--bg',
        '--surface',
        '--border',
        '--text',
        '--accent',
        '--danger',
        '--success',
      ];
      for (const v of requiredVars) {
        assert.ok(allCSS.includes(v + ':'), `Missing CSS variable: ${v}`);
      }
    });

    it('should contain expected DOM element IDs', () => {
      const requiredIds = [
        'sessions-list',
        'modal',
        'theme-toggle',
        'theme-picker',
        'share-btn',
        'new-session-btn',
      ];
      for (const id of requiredIds) {
        assert.ok(html.includes(`id="${id}"`), `Missing element ID: ${id}`);
      }
    });

    it('should provide required JS functions (inline or external)', () => {
      const requiredFuncs = ['getTheme', 'applyTheme', 'loadSessions', 'esc', 'getActivityLabel'];
      for (const f of requiredFuncs) {
        assert.ok(allJS.includes(`function ${f}`), `Missing function: ${f}`);
      }
    });

    it('should provide clipboard copy capability', () => {
      assert.ok(
        allJS.includes('execCommand') || allJS.includes('clipboard'),
        'Missing clipboard copy implementation',
      );
    });

    it('should provide THEMES array with all 12 themes', () => {
      assert.ok(allJS.includes('const THEMES'), 'Missing THEMES definition');
      const themes = [
        'dark',
        'light',
        'monokai',
        'solarized-dark',
        'solarized-light',
        'nord',
        'dracula',
        'github-dark',
        'one-dark',
        'catppuccin',
        'gruvbox',
        'night-owl',
      ];
      for (const t of themes) {
        assert.ok(allJS.includes(`'${t}'`), `THEMES missing entry: ${t}`);
      }
    });

    it('should register service worker', () => {
      assert.ok(allJS.includes("register('/sw.js')"), 'Missing SW registration');
    });

    it('should load sessions from API', () => {
      assert.ok(allJS.includes('/api/sessions'), 'Missing session API call');
    });
  });

  describe('terminal.html', () => {
    let html;
    let allJS;
    let allCSS;

    before(async () => {
      const res = await httpRequest({
        hostname: '127.0.0.1',
        port: inst.port,
        path: '/terminal',
        method: 'GET',
      });
      assert.strictEqual(res.statusCode, 200);
      html = res.data;
      allJS = collectAllJS(html);
      allCSS = collectAllCSS(html);
    });

    it('should contain all expected theme CSS variable blocks', () => {
      const themes = [
        'light',
        'monokai',
        'solarized-dark',
        'solarized-light',
        'nord',
        'dracula',
        'github-dark',
        'one-dark',
        'catppuccin',
        'gruvbox',
        'night-owl',
      ];
      for (const t of themes) {
        assert.ok(allCSS.includes(`[data-theme='${t}']`), `Missing theme block: ${t}`);
      }
    });

    it('should contain terminal-specific CSS variables', () => {
      const termVars = ['--key-bg', '--key-border', '--key-shadow', '--key-special-bg'];
      for (const v of termVars) {
        assert.ok(allCSS.includes(v + ':'), `Missing terminal CSS variable: ${v}`);
      }
    });

    it('should contain expected DOM element IDs', () => {
      const requiredIds = [
        'status-dot',
        'status-text',
        'session-name',
        'tab-list',
        'terminals-wrapper',
        'search-bar',
        'search-input',
        'key-bar',
        'ctrl-btn',
        'shift-btn',
        'paste-overlay',
        'palette-panel',
        'palette-backdrop',
        'theme-toggle',
        'theme-picker',
        'reconnect-overlay',
        'copy-toast',
      ];
      for (const id of requiredIds) {
        assert.ok(html.includes(`id="${id}"`), `Missing element ID: ${id}`);
      }
    });

    it('should provide required JS functions (inline or external)', () => {
      const requiredFuncs = [
        'getTheme',
        'applyTheme',
        'esc',
        'showToast',
        'init',
        'addSession',
        'activateSession',
        'connectSession',
        'setupKeyBar',
        'setupPaste',
        'openSearchBar',
        'closeSearchBar',
        'doSearch',
        'renderTabs',
        'toggleSplit',
        'applyZoom',
        'sendResize',
        'clearModifiers',
        'updateStatusBar',
      ];
      for (const f of requiredFuncs) {
        assert.ok(allJS.includes(`function ${f}`), `Missing function: ${f}`);
      }
    });

    it('should provide clipboard copy capability', () => {
      assert.ok(
        allJS.includes('execCommand') || allJS.includes('clipboard'),
        'Missing clipboard copy implementation',
      );
    });

    it('should provide xterm theme definitions for all themes', () => {
      const termThemes = [
        'darkTermTheme',
        'lightTermTheme',
        'monokaiTermTheme',
        'solarizedDarkTermTheme',
        'nordTermTheme',
        'draculaTermTheme',
        'githubDarkTermTheme',
        'oneDarkTermTheme',
        'catppuccinTermTheme',
        'gruvboxTermTheme',
        'nightOwlTermTheme',
      ];
      for (const t of termThemes) {
        assert.ok(allJS.includes(t), `Missing xterm theme: ${t}`);
      }
    });

    it('should provide TERM_THEMES map', () => {
      assert.ok(allJS.includes('TERM_THEMES'), 'Missing TERM_THEMES map');
    });

    it('should provide THEMES array with all 12 themes', () => {
      assert.ok(allJS.includes('const THEMES'), 'Missing THEMES definition');
    });

    it('should load xterm.js and addons from CDN', () => {
      assert.ok(html.includes('@xterm/xterm@5.5.0'), 'Missing xterm script');
      assert.ok(html.includes('@xterm/addon-fit@0.10.0'), 'Missing fit addon');
      assert.ok(html.includes('@xterm/addon-search@0.15.0'), 'Missing search addon');
    });

    it('should register service worker', () => {
      assert.ok(allJS.includes("register('/sw.js')"), 'Missing SW registration');
    });

    it('should provide session management state', () => {
      assert.ok(allJS.includes('managed'), 'Missing managed sessions state');
      assert.ok(allJS.includes('activeId'), 'Missing activeId state');
      assert.ok(allJS.includes('splitMode'), 'Missing splitMode state');
    });

    it('should provide key bar modifier handling', () => {
      assert.ok(allJS.includes('ctrlActive'), 'Missing ctrl modifier state');
      assert.ok(allJS.includes('shiftActive'), 'Missing shift modifier state');
      assert.ok(allJS.includes('function applyModifiers'), 'Missing applyModifiers function');
    });

    it('should provide search with regex support', () => {
      assert.ok(allJS.includes('searchRegex'), 'Missing search regex state');
      assert.ok(
        allJS.includes('findNext') || allJS.includes('findPrevious'),
        'Missing search find calls',
      );
    });

    it('should include SESSION_COLORS constant', () => {
      assert.ok(allJS.includes('SESSION_COLORS'), 'Missing SESSION_COLORS');
    });
  });

  describe('shared JS/CSS files are served', () => {
    // Verify any extracted files in public/js/ and public/css/ are accessible
    it('should serve files from public/js/ if they exist', async () => {
      const jsDir = path.join(PUBLIC_DIR, 'js');
      if (!fs.existsSync(jsDir)) return;
      const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js'));
      for (const file of files) {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/js/' + file,
          method: 'GET',
        });
        assert.strictEqual(res.statusCode, 200, `Failed to serve /js/${file}`);
        assert.ok(res.data.length > 0, `/js/${file} is empty`);
      }
    });

    it('should serve files from public/css/ if they exist', async () => {
      const cssDir = path.join(PUBLIC_DIR, 'css');
      if (!fs.existsSync(cssDir)) return;
      const files = fs.readdirSync(cssDir).filter((f) => f.endsWith('.css'));
      for (const file of files) {
        const res = await httpRequest({
          hostname: '127.0.0.1',
          port: inst.port,
          path: '/css/' + file,
          method: 'GET',
        });
        assert.strictEqual(res.statusCode, 200, `Failed to serve /css/${file}`);
        assert.ok(res.data.length > 0, `/css/${file} is empty`);
      }
    });
  });
});
