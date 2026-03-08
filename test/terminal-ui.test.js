const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
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
  reactUI: false,
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

// --- Tests ---

describe('Terminal UI features', () => {
  let inst;
  let html;

  // Start a single server and fetch terminal.html once for all tests
  after(() => inst?.shutdown());

  async function getTerminalHTML() {
    if (html) return html;
    inst = await startServer();
    const res = await httpRequest({
      hostname: '127.0.0.1',
      port: inst.port,
      path: '/terminal',
      method: 'GET',
    });
    assert.strictEqual(res.statusCode, 200);
    html = res.data;
    return html;
  }

  // === Command completion notification (#62) ===

  describe('Command completion notification', () => {
    it('should include the notification toggle in command palette', async () => {
      const page = await getTerminalHTML();
      assert.ok(
        page.includes("'Notifications (on)'") || page.includes("'Notifications (off)'"),
        'Should have notifications action with state indicator in palette',
      );
    });

    it('notification toggle palette action should have notification category', async () => {
      const page = await getTerminalHTML();
      assert.ok(
        page.includes("category: 'Notifications'"),
        'Should have Notifications category in palette',
      );
    });

    it('notification toggle button should have notify-btn class', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('notify-btn'), 'Should have notify-btn CSS class');
    });

    it('should include notification CSS for active state', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('.notify-btn.active'), 'Should have .notify-btn.active CSS rule');
    });

    it('should include localStorage notification state management', async () => {
      const page = await getTerminalHTML();
      assert.ok(
        page.includes("localStorage.getItem('termbeam-notifications')"),
        'Should read notification state from localStorage',
      );
      assert.ok(
        page.includes("localStorage.setItem('termbeam-notifications'"),
        'Should persist notification state to localStorage',
      );
    });

    it('should include Notification API permission request', async () => {
      const page = await getTerminalHTML();
      assert.ok(
        page.includes('Notification.requestPermission'),
        'Should request Notification permission',
      );
    });

    it('should include silence timer logic for command detection', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('silenceTimer'), 'Should have silence timer for command completion');
    });
  });

  // === Terminal search (#64) ===

  describe('Terminal search', () => {
    it('should load the xterm SearchAddon from CDN', async () => {
      const page = await getTerminalHTML();
      assert.ok(
        page.includes('@xterm/addon-search@0.15.0/lib/addon-search.min.js'),
        'Should include SearchAddon CDN script',
      );
    });

    it('should include the search bar overlay', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('id="search-bar"'), 'Should have search-bar element');
      assert.ok(page.includes('class="search-bar"'), 'Should have search-bar CSS class on element');
    });

    it('should include search input field', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('id="search-input"'), 'Should have search input');
      assert.ok(
        page.includes('placeholder="Search…"'),
        'Search input should have placeholder text',
      );
    });

    it('should include search navigation buttons', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('id="search-prev"'), 'Should have search-prev button');
      assert.ok(page.includes('id="search-next"'), 'Should have search-next button');
      assert.ok(page.includes('id="search-close"'), 'Should have search-close button');
    });

    it('should include regex toggle button', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('id="search-regex"'), 'Should have search-regex toggle');
    });

    it('should include search result count display', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('id="search-count"'), 'Should have search-count element');
    });

    it('should include search bar CSS styles', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('.search-bar {'), 'Should have .search-bar CSS rule');
      assert.ok(
        page.includes('.search-bar.visible'),
        'Should have .search-bar.visible CSS rule for toggling',
      );
    });
  });

  // === Command palette (#65) ===

  describe('Command palette', () => {
    it('should include the palette trigger button', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('id="palette-trigger"'), 'Should have palette-trigger button');
    });

    it('FAB button should have correct title with keyboard shortcut', async () => {
      const page = await getTerminalHTML();
      assert.ok(
        page.includes('title="Tools (Ctrl+K)"'),
        'FAB should show Ctrl+K shortcut in title',
      );
    });

    it('should include the palette panel structure', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('id="palette-panel"'), 'Should have palette-panel');
      assert.ok(page.includes('id="palette-backdrop"'), 'Should have palette-backdrop');
      assert.ok(page.includes('id="palette-body"'), 'Should have palette-body');
      assert.ok(page.includes('id="palette-close"'), 'Should have palette-close button');
    });

    it('palette header should display "Tools" title', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('<span>Tools</span>'), 'Palette header should contain "Tools" text');
    });

    it('should include palette CSS styles', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('.palette-panel {'), 'Should have .palette-panel CSS');
      assert.ok(page.includes('.palette-backdrop {'), 'Should have .palette-backdrop CSS');
      assert.ok(page.includes('.palette-action-icon {'), 'Should have .palette-action-icon CSS');
      assert.ok(page.includes('.palette-panel.open'), 'Should have .palette-panel.open CSS');
      assert.ok(page.includes('.palette-backdrop.open'), 'Should have .palette-backdrop.open CSS');
    });

    it('should include palette action categories in JS', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes("category: 'Session'"), 'Should have Session category');
      assert.ok(page.includes("category: 'Search'"), 'Should have Search category');
      assert.ok(page.includes("category: 'View'"), 'Should have View category');
      assert.ok(page.includes("category: 'Share'"), 'Should have Share category');
      assert.ok(page.includes("category: 'Notifications'"), 'Should have Notifications category');
      assert.ok(page.includes("category: 'System'"), 'Should have System category');
    });

    it('should include palette action CSS styles', async () => {
      const page = await getTerminalHTML();
      assert.ok(page.includes('.palette-action {'), 'Should have .palette-action CSS');
      assert.ok(page.includes('.palette-category {'), 'Should have .palette-category CSS');
      assert.ok(page.includes('.palette-action-icon'), 'Should have .palette-action-icon CSS');
    });
  });
});
