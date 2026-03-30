/**
 * E2E tests — comprehensive feature coverage for the TermBeam React UI.
 *
 * Covers: session management, theme persistence, hub page, multi-session tabs,
 * search, keyboard shortcuts, upload/share palette actions, connection status,
 * mobile layout, and new-session modal details.
 *
 * Run:  npx playwright test test/e2e-features.test.js
 */
const { test, expect } = require('@playwright/test');
const { createTermBeamServer } = require('../src/server');

const isWindows = process.platform === 'win32';

const baseConfig = {
  port: 0,
  host: '127.0.0.1',
  password: null,
  useTunnel: false,
  persistedTunnel: false,
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
  shellArgs: [],
  cwd: process.cwd(),
  defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
  version: '0.1.0-test',
  logLevel: 'error',
};

let inst;
let consoleErrors;

test.beforeEach(async ({ page }) => {
  inst = createTermBeamServer({ config: { ...baseConfig } });
  await inst.start();

  consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
});

test.afterEach(async () => {
  if (inst) {
    if (isWindows) {
      for (const [, session] of inst.sessions.sessions) {
        try {
          const pid = session.pty.pid;
          require('child_process').execSync(`taskkill /pid ${pid} /T /F`, {
            stdio: 'ignore',
          });
        } catch {
          // Process may already be gone
        }
      }
    }
    await inst.shutdown();
  }

  const unexpected = consoleErrors.filter(
    (e) => !e.includes('net::ERR_') && !e.includes('WebSocket'),
  );
  if (unexpected.length > 0) {
    throw new Error(`Unexpected browser console errors:\n${unexpected.join('\n')}`);
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function getBaseURL() {
  const port = inst.server.address().port;
  return `http://127.0.0.1:${port}`;
}

async function createSessionViaAPI(name) {
  const port = inst.server.address().port;
  const body = name ? { name } : {};
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function navigateToTerminal(page, sessionId) {
  const port = inst.server.address().port;
  await page.goto(`http://127.0.0.1:${port}/terminal?id=${sessionId}`);
  await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
    timeout: 10_000,
  });
}

async function navigateToHub(page) {
  const port = inst.server.address().port;
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForLoadState('domcontentloaded');
  await expect(
    page.locator('[data-testid="hub-new-session-btn"], [data-testid="empty-state"]').first(),
  ).toBeVisible({ timeout: 10_000 });
}

async function openTerminalWithNewSession(page, name) {
  const { id } = await createSessionViaAPI(name);
  await navigateToTerminal(page, id);
  return id;
}

async function getInitialSessions() {
  const port = inst.server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions`);
  return res.json();
}

async function waitForTerminalOutput(page, pattern, timeout = 15_000) {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  await expect(async () => {
    const text = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="terminal-pane"][data-visible="true"]');
      const rows = pane ? pane.querySelector('.xterm-rows') : document.querySelector('.xterm-rows');
      return rows ? rows.innerText : '';
    });
    expect(text).toMatch(regex);
  }).toPass({ timeout });
}

function getTerminalText(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-testid="terminal-pane"][data-visible="true"]');
    const rows = pane ? pane.querySelector('.xterm-rows') : document.querySelector('.xterm-rows');
    return rows ? rows.innerText : '';
  });
}

async function typeInTerminal(page, text) {
  const textarea = page
    .locator('[data-testid="terminal-pane"][data-visible="true"] .xterm-helper-textarea')
    .first();
  await textarea.focus();
  for (const ch of text) {
    await textarea.press(ch);
    await page.waitForTimeout(30);
  }
}

async function runCommand(page, cmd) {
  await typeInTerminal(page, cmd);
  await page.keyboard.press('Enter');
}

async function openPaletteAndClick(page, actionLabel) {
  await page.click('[data-testid="palette-trigger"]');
  await expect(page.locator('[data-testid="palette-panel"][data-open="true"]')).toBeVisible({
    timeout: 3_000,
  });
  await page.click(`[data-testid="palette-action"]:has-text("${actionLabel}")`);
}

// ─── 1. New Session Modal — Hub Page ────────────────────────────────────────

test.describe('New Session Modal — Hub Page', () => {
  test('creating a session adds a new tab and switches to it', async ({ page }) => {
    await navigateToHub(page);

    await page.click('[data-testid="hub-new-session-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');

    // Should navigate to terminal page
    await expect(page).toHaveURL(/\/terminal/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    // Should have two tabs (auto-created + new) and one should be active
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(2, {
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="session-tab"][data-active="true"]')).toHaveCount(1);
  });

  test('session is created with custom name', async ({ page }) => {
    await navigateToHub(page);
    await page.click('[data-testid="hub-new-session-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });

    const customName = `Custom_${Date.now()}`;
    await page.fill('[data-testid="ns-name"]', customName);
    await page.click('[data-testid="ns-create"]');

    // Should navigate to terminal
    await expect(page).toHaveURL(/\/terminal/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    // The active tab should show the custom name
    await expect(
      page.locator('[data-testid="session-tab"][data-active="true"] [data-testid="tab-name"]'),
    ).toHaveText(customName, { timeout: 5_000 });
  });

  test('session is created with selected shell', async ({ page }) => {
    await navigateToHub(page);
    await page.click('[data-testid="hub-new-session-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });

    // Shell dropdown should have options loaded
    const shellSelect = page.locator('[data-testid="ns-shell"]');
    await expect(shellSelect).toBeVisible();
    const optionCount = await shellSelect.locator('option').count();
    expect(optionCount).toBeGreaterThan(0);

    // Select first available shell and create
    await page.click('[data-testid="ns-create"]');

    // Should navigate to terminal and be functional
    await expect(page).toHaveURL(/\/terminal/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });
    const marker = `SHELL_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });

  test('cancel button closes modal without creating', async ({ page }) => {
    await navigateToHub(page);

    await page.click('[data-testid="hub-new-session-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });

    await page.click('[data-testid="ns-cancel"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 3_000,
    });

    // Only the auto-created session should exist
    await expect(page.locator('[data-testid="session-card"]')).toHaveCount(1);
  });
});

// ─── 2. Session Management ─────────────────────────────────────────────────

test.describe('Session Management', () => {
  test('rename session via palette changes the displayed name', async ({ page }) => {
    await openTerminalWithNewSession(page);
    const newName = `Renamed_${Date.now()}`;

    // The rename action uses window.prompt — we must handle the dialog
    page.once('dialog', async (dialog) => {
      await dialog.accept(newName);
    });

    await openPaletteAndClick(page, 'Rename session');

    // Verify the session name is updated in the top bar
    await expect(page.locator('[data-testid="session-name-display"]')).toHaveText(newName, {
      timeout: 5_000,
    });

    // Verify it's also updated in the active tab
    await expect(
      page.locator('[data-testid="session-tab"][data-active="true"] [data-testid="tab-name"]'),
    ).toHaveText(newName, { timeout: 5_000 });
  });

  test('multiple sessions can exist simultaneously', async ({ page }) => {
    await openTerminalWithNewSession(page);

    // Create a second session via tab-new-btn
    await page.click('[data-testid="tab-new-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });

    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(3, {
      timeout: 5_000,
    });

    // Both sessions should be functional — type in second
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });
    const marker2 = `S2_${Date.now()}`;
    await runCommand(page, `echo ${marker2}`);
    await waitForTerminalOutput(page, marker2);

    // Switch to first session
    await page.locator('[data-testid="session-tab"]').first().click();

    // Wait for terminal to become connected and show content
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    // Type in first — should work
    const marker1 = `S1_${Date.now()}`;
    await runCommand(page, `echo ${marker1}`);
    await waitForTerminalOutput(page, marker1);
  });

  test('switching between sessions preserves terminal content', async ({ page }) => {
    test.skip(isWindows, 'bash-specific');
    await openTerminalWithNewSession(page);

    // Output a unique marker in first session
    const marker1 = `FIRST_${Date.now()}`;
    await runCommand(page, `echo ${marker1}`);
    await waitForTerminalOutput(page, marker1);

    // Create second session
    await page.click('[data-testid="tab-new-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    // Output a marker in second session
    const marker2 = `SECOND_${Date.now()}`;
    await runCommand(page, `echo ${marker2}`);
    await waitForTerminalOutput(page, marker2);

    // Switch back to the API-created session (index 1; index 0 is auto-created)
    await page.locator('[data-testid="session-tab"]').nth(1).click();

    // First session should still show its marker
    await waitForTerminalOutput(page, marker1);
    const text = await getTerminalText(page);
    expect(text).not.toContain(marker2);
  });
});

// ─── 3. Theme System ────────────────────────────────────────────────────────

test.describe('Theme System', () => {
  test('theme persists across page reload', async ({ page }) => {
    await openTerminalWithNewSession(page);

    // Open palette and click Theme to open subpanel
    await openPaletteAndClick(page, 'Theme');
    await expect(page.locator('[data-testid="theme-subpanel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });

    // Apply 'nord' theme
    await page.click('[data-testid="theme-item"][data-tid="nord"]');
    await page.waitForTimeout(300);

    // Verify theme is applied
    const themeAttr = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(themeAttr).toBe('nord');

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    const themeAfterReload = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(themeAfterReload).toBe('nord');
  });

  test('theme applies to both hub and terminal pages', async ({ page }) => {
    await openTerminalWithNewSession(page);

    // Set theme on terminal page
    await openPaletteAndClick(page, 'Theme');
    await expect(page.locator('[data-testid="theme-subpanel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="theme-item"][data-tid="dracula"]');
    await page.waitForTimeout(300);

    // Navigate to hub
    await navigateToHub(page);

    // Hub should also have dracula theme
    const hubTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(hubTheme).toBe('dracula');
  });

  test('all 30 themes can be applied without errors', async ({ page }) => {
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
      'tokyo-night',
      'rose-pine',
      'kanagawa',
      'everforest',
      'ayu-dark',
      'matrix',
      'cyberpunk',
      'sunset-glow',
      'synthwave',
      'aurora',
      'retro-amber',
      'deep-ocean',
      'neon-noir',
      'frost-byte',
      'vice-city',
      'radical',
      'material-ocean',
      'sakura',
    ];

    await openTerminalWithNewSession(page);
    await openPaletteAndClick(page, 'Theme');
    await expect(page.locator('[data-testid="theme-subpanel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });

    for (const theme of themes) {
      await page.click(`[data-testid="theme-item"][data-tid="${theme}"]`);
      await page.waitForTimeout(150);

      const applied = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      );
      expect(applied).toBe(theme);
    }
  });

  test('theme picker in palette shows theme options', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await openPaletteAndClick(page, 'Theme');
    await expect(page.locator('[data-testid="theme-subpanel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });

    // Should show at least 30 theme options
    const count = await page.locator('[data-testid="theme-item"]').count();
    expect(count).toBeGreaterThanOrEqual(30);
  });
});

// ─── 4. Upload & Share Features ─────────────────────────────────────────────

test.describe('Upload & Share Palette Actions', () => {
  test('upload files action exists in palette', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await page.click('[data-testid="palette-trigger"]');
    await expect(page.locator('[data-testid="palette-panel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });

    await expect(
      page.locator('[data-testid="palette-action"]:has-text("Upload files")'),
    ).toBeVisible();
  });

  test('copy link action exists in palette', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await page.click('[data-testid="palette-trigger"]');
    await expect(page.locator('[data-testid="palette-panel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });

    await expect(
      page.locator('[data-testid="palette-action"]:has-text("Copy link")'),
    ).toBeVisible();
  });

  test('about dialog shows version info', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await openPaletteAndClick(page, 'About');

    // About modal should show TermBeam branding and version
    await expect(page.getByText(/TermBeam/).first()).toBeVisible({ timeout: 3_000 });

    // The dialog shows links to GitHub and Docs
    await expect(page.locator('a[href*="github.com"]')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('a:has-text("Docs")')).toBeVisible({ timeout: 3_000 });
  });
});

// ─── 5. Connection Status ──────────────────────────────────────────────────

test.describe('Connection Status', () => {
  test('terminal shows connected state with green dot', async ({ page }) => {
    await openTerminalWithNewSession(page);

    // Status dot should be visible and have 'connected' class
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    // Status dot element should exist with the connected class
    const dotClass = await page.locator('[data-testid="status-dot"]').getAttribute('class');
    expect(dotClass).toContain('connected');
  });

  test('session name is displayed in top bar', async ({ page }) => {
    const name = `TestSession_${Date.now()}`;
    await openTerminalWithNewSession(page, name);

    // Session name should show the name we gave it
    await expect(page.locator('[data-testid="session-name-display"]')).toHaveText(name, {
      timeout: 5_000,
    });
  });
});

// ─── 6. Hub Page Features ───────────────────────────────────────────────────

test.describe('Hub Page', () => {
  test('hub page lists all sessions', async ({ page }) => {
    await createSessionViaAPI();
    await navigateToHub(page);

    await expect(page.locator('[data-testid="session-card"]')).toHaveCount(2, {
      timeout: 5_000,
    });
  });

  test('sessions show shell and PID info', async ({ page }) => {
    await createSessionViaAPI();
    await navigateToHub(page);

    // Each session card should show PID
    const pidEl = page.locator('[data-testid="session-pid"]').first();
    await expect(pidEl).toBeVisible({ timeout: 5_000 });
    const pidText = await pidEl.textContent();
    expect(pidText).toMatch(/\d+/);

    // Session card should show shell info
    const shellEl = page.locator('[data-testid="session-shell"]').first();
    await expect(shellEl).toBeVisible({ timeout: 5_000 });
    const shellText = await shellEl.textContent();
    expect(shellText).toBeTruthy();
  });

  test('new session button on hub creates session and navigates to terminal', async ({ page }) => {
    await navigateToHub(page);
    await page.click('[data-testid="hub-new-session-btn"]');

    // Modal should open
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');

    // Should navigate to terminal page
    await expect(page).toHaveURL(/\/terminal/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('version is displayed in hub header', async ({ page }) => {
    await navigateToHub(page);

    const versionEl = page.locator('[data-testid="hub-version"]');
    await expect(versionEl).toBeVisible({ timeout: 5_000 });
    const versionText = await versionEl.textContent();
    // Version should be non-empty (format: "vX.Y.Z" or similar)
    expect(versionText).toMatch(/v?\d+\.\d+/);
  });

  test('refresh button reloads session list', async ({ page }) => {
    await createSessionViaAPI();
    await navigateToHub(page);

    // Session list should have sessions (auto-created + API-created)
    await expect(page.locator('[data-testid="session-card"]')).toHaveCount(2, {
      timeout: 5_000,
    });

    // Click refresh
    await page.click('[data-testid="hub-refresh-btn"]');

    // Sessions should still be listed after refresh
    await expect(page.locator('[data-testid="session-card"]')).toHaveCount(2, {
      timeout: 5_000,
    });
  });

  test('connect button on session card navigates to terminal', async ({ page }) => {
    await createSessionViaAPI();
    await navigateToHub(page);

    await expect(page.locator('[data-testid="session-card"]')).toHaveCount(2, {
      timeout: 5_000,
    });
    await page.locator('[data-testid="session-card"]').first().click();

    await expect(page).toHaveURL(/\/terminal/, { timeout: 10_000 });
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── 7. Multi-Session Tab Behavior ──────────────────────────────────────────

test.describe('Multi-Session Tabs', () => {
  test('creating multiple sessions shows multiple tabs', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(2, {
      timeout: 5_000,
    });

    // Create second session via tab-new-btn (opens modal)
    await page.click('[data-testid="tab-new-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(3, {
      timeout: 5_000,
    });

    // Create third session
    await page.click('[data-testid="tab-new-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(4, {
      timeout: 5_000,
    });
  });

  test('active tab is visually distinguished', async ({ page }) => {
    await openTerminalWithNewSession(page);

    // Create a second session so we have 2 tabs
    await page.click('[data-testid="tab-new-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(3, {
      timeout: 5_000,
    });

    // Exactly one tab should be active
    await expect(page.locator('[data-testid="session-tab"][data-active="true"]')).toHaveCount(1);

    // The last tab (newly created) should be active
    const lastTab = page.locator('[data-testid="session-tab"]').last();
    await expect(lastTab).toHaveAttribute('data-active', 'true');
  });

  test('tab shows session status dot', async ({ page }) => {
    await openTerminalWithNewSession(page);

    // Each tab should have a status dot
    const tabDot = page.locator('[data-testid="tab-status-dot"]').first();
    await expect(tabDot).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a tab switches to that session', async ({ page }) => {
    test.skip(isWindows, 'bash-specific');
    await openTerminalWithNewSession(page);

    // Mark first session
    const marker1 = `TAB1_${Date.now()}`;
    await runCommand(page, `echo ${marker1}`);
    await waitForTerminalOutput(page, marker1);

    // Create second session
    await page.click('[data-testid="tab-new-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    // Mark second session
    const marker2 = `TAB2_${Date.now()}`;
    await runCommand(page, `echo ${marker2}`);
    await waitForTerminalOutput(page, marker2);

    // Click the API-created session tab (index 1; index 0 is auto-created)
    await page.locator('[data-testid="session-tab"]').nth(1).click();

    // Should see first session content
    await waitForTerminalOutput(page, marker1);
  });

  test('close button on tab removes the tab', async ({ page }) => {
    await openTerminalWithNewSession(page);

    // Create a second session
    await page.click('[data-testid="tab-new-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(3, {
      timeout: 5_000,
    });

    // Accept the confirm dialog that fires when closing a tab
    page.once('dialog', (dialog) => dialog.accept());

    // Hover over last tab to reveal close button, then click it
    const lastTab = page.locator('[data-testid="session-tab"]').last();
    await lastTab.hover();
    await lastTab.locator('[data-testid="tab-close"]').click();

    // Should be back to 2 tabs (auto-created + API-created)
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(2, {
      timeout: 5_000,
    });
  });

  test('closing active tab switches to adjacent session', async ({ page }) => {
    await openTerminalWithNewSession(page);

    // Create second session
    await page.click('[data-testid="tab-new-btn"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible({
      timeout: 3_000,
    });
    await page.click('[data-testid="ns-create"]');
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(3, {
      timeout: 5_000,
    });

    // Accept the confirm dialog that fires when closing a tab
    page.once('dialog', (dialog) => dialog.accept());

    // The last tab is active; close it
    const lastTab = page.locator('[data-testid="session-tab"]').last();
    await expect(lastTab).toHaveAttribute('data-active', 'true');
    await lastTab.hover();
    await lastTab.locator('[data-testid="tab-close"]').click();

    // Should have 2 tabs remaining and one should be active
    await expect(page.locator('[data-testid="session-tab"]')).toHaveCount(2, {
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="session-tab"][data-active="true"]')).toHaveCount(1, {
      timeout: 5_000,
    });

    // Terminal should still be connected
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── 8. Search Functionality ────────────────────────────────────────────────

test.describe('Search', () => {
  test('search bar opens via palette "Find in terminal"', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await openPaletteAndClick(page, 'Find in terminal');

    await expect(page.locator('[data-testid="search-bar"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.locator('[data-testid="search-input"]')).toBeFocused();
  });

  test('search finds text in terminal output', async ({ page }) => {
    test.skip(isWindows, 'bash-specific');
    await openTerminalWithNewSession(page);

    // Output some searchable text
    const marker = `SEARCHME_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);

    // Open search and type the marker
    await openPaletteAndClick(page, 'Find in terminal');
    await expect(page.locator('[data-testid="search-bar"][data-open="true"]')).toBeVisible();
    await page.fill('[data-testid="search-input"]', marker);

    // Search indicator should show a match (e.g. "1 of 1" or "Found")
    await expect(async () => {
      const barText = await page.locator('[data-testid="search-bar"]').innerText();
      expect(barText).toMatch(/Found|\d+ of \d+/);
    }).toPass({ timeout: 5_000 });
  });

  test('search navigation (prev/next) buttons exist', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await openPaletteAndClick(page, 'Find in terminal');

    await expect(page.locator('[data-testid="search-prev"]')).toBeVisible();
    await expect(page.locator('[data-testid="search-next"]')).toBeVisible();
  });

  test('closing search bar hides it', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await openPaletteAndClick(page, 'Find in terminal');

    await expect(page.locator('[data-testid="search-bar"][data-open="true"]')).toBeVisible();
    await page.click('[data-testid="search-close"]');
    await expect(page.locator('[data-testid="search-bar"][data-open="true"]')).not.toBeVisible({
      timeout: 3_000,
    });
  });

  test('Escape key closes search bar', async ({ page }) => {
    await openTerminalWithNewSession(page);
    await openPaletteAndClick(page, 'Find in terminal');

    await expect(page.locator('[data-testid="search-bar"][data-open="true"]')).toBeVisible();
    await page.locator('[data-testid="search-input"]').press('Escape');
    await expect(page.locator('[data-testid="search-bar"][data-open="true"]')).not.toBeVisible({
      timeout: 3_000,
    });
  });
});

// ─── 9. Keyboard Shortcuts ─────────────────────────────────────────────────

test.describe('Keyboard Shortcuts', () => {
  test('Ctrl+K opens command palette', async ({ page }) => {
    await openTerminalWithNewSession(page);

    await page.keyboard.press('Control+k');
    await expect(page.locator('[data-testid="palette-panel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });
  });

  test('Escape closes command palette', async ({ page }) => {
    await openTerminalWithNewSession(page);

    await page.keyboard.press('Control+k');
    await expect(page.locator('[data-testid="palette-panel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="palette-panel"][data-open="true"]')).not.toBeVisible({
      timeout: 3_000,
    });
  });

  test('Ctrl+F opens search bar', async ({ page }) => {
    await openTerminalWithNewSession(page);

    await page.keyboard.press('Control+f');
    await expect(page.locator('[data-testid="search-bar"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.locator('[data-testid="search-input"]')).toBeFocused();
  });
});

// ─── 10. Mobile Layout ─────────────────────────────────────────────────────

test.describe('Mobile Layout', () => {
  test('terminal loads and connects on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminalWithNewSession(page);

    await expect(page.locator('[data-testid="terminal-app"]')).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('palette trigger visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminalWithNewSession(page);

    await expect(page.locator('[data-testid="palette-trigger"]')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('command palette works on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminalWithNewSession(page);

    await page.click('[data-testid="palette-trigger"]');
    await expect(page.locator('[data-testid="palette-panel"][data-open="true"]')).toBeVisible({
      timeout: 3_000,
    });
  });

  test('hub page works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await createSessionViaAPI();
    await navigateToHub(page);

    await expect(page.locator('[data-testid="session-card"]')).toHaveCount(2, {
      timeout: 5_000,
    });
  });

  test('terminal is functional on mobile viewport', async ({ page }) => {
    test.skip(isWindows, 'bash-specific');
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminalWithNewSession(page);

    const marker = `MOBILE_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });
});
