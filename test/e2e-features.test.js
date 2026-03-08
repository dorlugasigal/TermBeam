/**
 * E2E tests — comprehensive feature coverage for the TermBeam UI.
 *
 * Covers: session management, theme persistence, hub page, multi-session tabs,
 * search, keyboard shortcuts, upload/share palette actions, reconnect status,
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

async function waitForTerminalOutput(page, pattern, timeout = 15_000) {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  await expect(async () => {
    const text = await page.evaluate(() => {
      const pane = document.querySelector('.terminal-pane.visible');
      const rows = pane ? pane.querySelector('.xterm-rows') : document.querySelector('.xterm-rows');
      return rows ? rows.innerText : '';
    });
    expect(text).toMatch(regex);
  }).toPass({ timeout });
}

function getTerminalText(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('.terminal-pane.visible');
    const rows = pane ? pane.querySelector('.xterm-rows') : document.querySelector('.xterm-rows');
    return rows ? rows.innerText : '';
  });
}

async function typeInTerminal(page, text) {
  const textarea = page.locator('.terminal-pane.visible .xterm-helper-textarea').first();
  await textarea.focus();
  for (const ch of text) {
    await textarea.press(ch);
    await page.waitForTimeout(30);
  }
}

async function openTerminal(page) {
  const port = inst.server.address().port;
  await page.goto(`http://127.0.0.1:${port}/terminal`);
  await expect(page.locator('#status-dot.connected')).toBeVisible({
    timeout: 10_000,
  });
}

async function runCommand(page, cmd) {
  await typeInTerminal(page, cmd);
  await page.click('button[data-key="enter"]');
}

async function openPaletteAndClick(page, actionLabel) {
  await page.click('#palette-trigger');
  await expect(page.locator('.palette-panel')).toHaveClass(/open/);
  await page.click(`.palette-action:has-text("${actionLabel}")`);
  await page.waitForTimeout(300);
}

async function openHub(page) {
  const port = inst.server.address().port;
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForLoadState('networkidle');
}

// ─── 1. New Session Modal from Terminal Page ────────────────────────────────

test.describe('New Session Modal — Terminal Page', () => {
  test('creating a session adds a new tab and switches to it', async ({ page }) => {
    await openTerminal(page);
    const tabsBefore = await page.locator('.session-tab').count();

    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });

    // Wait for new tab to appear
    await expect(page.locator('.session-tab')).toHaveCount(tabsBefore + 1, {
      timeout: 5_000,
    });

    // New tab should be active
    const lastTab = page.locator('.session-tab').last();
    await expect(lastTab).toHaveClass(/active/, { timeout: 5_000 });

    // Terminal should be connected
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('session is created with custom name', async ({ page }) => {
    await openTerminal(page);
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);

    const customName = `Custom_${Date.now()}`;
    await page.fill('#ns-name', customName);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });

    // The new tab should show the custom name
    await expect(page.locator('.session-tab.active .tab-name')).toHaveText(customName, {
      timeout: 5_000,
    });
  });

  test('session is created with selected shell', async ({ page }) => {
    await openTerminal(page);
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);

    // Shell dropdown should have options loaded
    await expect(page.locator('#ns-shell option')).not.toHaveCount(0, {
      timeout: 5_000,
    });

    // Select first available shell and create
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });

    // Verify the terminal is functional
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });
    const marker = `SHELL_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });

  test('cancel button closes modal without creating', async ({ page }) => {
    await openTerminal(page);
    const tabsBefore = await page.locator('.session-tab').count();

    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-cancel');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 3_000 });

    // Tab count should not change
    await expect(page.locator('.session-tab')).toHaveCount(tabsBefore);
  });
});

// ─── 2. Session Management ─────────────────────────────────────────────────

test.describe('Session Management', () => {
  test('rename session via palette changes the displayed name', async ({ page }) => {
    await openTerminal(page);
    const newName = `Renamed_${Date.now()}`;

    // The rename action uses window.prompt — we must handle the dialog
    page.once('dialog', async (dialog) => {
      await dialog.accept(newName);
    });

    await openPaletteAndClick(page, 'Rename session');

    // Verify the session name is updated in the top bar
    await expect(page.locator('#session-name')).toHaveText(newName, {
      timeout: 5_000,
    });

    // Verify it's also updated in the active tab
    await expect(page.locator('.session-tab.active .tab-name')).toHaveText(newName, {
      timeout: 5_000,
    });
  });

  test('multiple sessions can exist simultaneously', async ({ page }) => {
    await openTerminal(page);

    // Create a second session
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });

    await expect(page.locator('.session-tab')).toHaveCount(2, {
      timeout: 5_000,
    });

    // Both sessions should be functional — type in second
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });
    const marker2 = `S2_${Date.now()}`;
    await runCommand(page, `echo ${marker2}`);
    await waitForTerminalOutput(page, marker2);

    // Switch to first session
    await page.locator('.session-tab').first().click();
    await page.waitForTimeout(500);

    // Type in first — should work
    const marker1 = `S1_${Date.now()}`;
    await runCommand(page, `echo ${marker1}`);
    await waitForTerminalOutput(page, marker1);
  });

  test('switching between sessions preserves terminal content', async ({ page }) => {
    test.skip(isWindows, 'bash-specific');
    await openTerminal(page);

    // Output a unique marker in first session
    const marker1 = `FIRST_${Date.now()}`;
    await runCommand(page, `echo ${marker1}`);
    await waitForTerminalOutput(page, marker1);

    // Create second session
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });

    // Output a marker in second session
    const marker2 = `SECOND_${Date.now()}`;
    await runCommand(page, `echo ${marker2}`);
    await waitForTerminalOutput(page, marker2);

    // Switch back to first session
    await page.locator('.session-tab').first().click();
    await page.waitForTimeout(500);

    // First session should still show its marker
    await waitForTerminalOutput(page, marker1);
    const text = await getTerminalText(page);
    expect(text).not.toContain(marker2);
  });
});

// ─── 3. Theme System ────────────────────────────────────────────────────────

test.describe('Theme System', () => {
  test('theme persists across page reload', async ({ page }) => {
    await openTerminal(page);

    // Open palette and click Theme to open subpanel
    await openPaletteAndClick(page, 'Theme');
    await expect(page.locator('#theme-subpanel')).toHaveClass(/open/, {
      timeout: 3_000,
    });

    // Apply 'nord' theme
    await page.click('.theme-subpanel-item[data-tid="nord"]');
    await page.waitForTimeout(300);

    // Verify theme is applied
    const themeAttr = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(themeAttr).toBe('nord');

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });

    const themeAfterReload = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(themeAfterReload).toBe('nord');
  });

  test('theme applies to both hub and terminal pages', async ({ page }) => {
    await openTerminal(page);

    // Set theme on terminal page
    await openPaletteAndClick(page, 'Theme');
    await expect(page.locator('#theme-subpanel')).toHaveClass(/open/, {
      timeout: 3_000,
    });
    await page.click('.theme-subpanel-item[data-tid="dracula"]');
    await page.waitForTimeout(300);

    // Navigate to hub
    await openHub(page);

    // Hub should also have dracula theme
    const hubTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(hubTheme).toBe('dracula');
  });

  test('all 12 themes can be applied without errors', async ({ page }) => {
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

    await openTerminal(page);
    await openPaletteAndClick(page, 'Theme');
    await expect(page.locator('#theme-subpanel')).toHaveClass(/open/, {
      timeout: 3_000,
    });

    for (const theme of themes) {
      await page.click(`.theme-subpanel-item[data-tid="${theme}"]`);
      await page.waitForTimeout(150);

      const applied = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      );
      expect(applied).toBe(theme);
    }
  });

  test('theme picker in palette shows theme options', async ({ page }) => {
    await openTerminal(page);
    await openPaletteAndClick(page, 'Theme');
    await expect(page.locator('#theme-subpanel')).toHaveClass(/open/, {
      timeout: 3_000,
    });

    // Should show at least 12 theme options
    const count = await page.locator('.theme-subpanel-item').count();
    expect(count).toBeGreaterThanOrEqual(12);

    // Current theme should be marked active
    await expect(page.locator('.theme-subpanel-item.active')).toHaveCount(1);
  });
});

// ─── 4. Upload & Share Features ─────────────────────────────────────────────

test.describe('Upload & Share Palette Actions', () => {
  test('upload files action exists in palette', async ({ page }) => {
    await openTerminal(page);
    await page.click('#palette-trigger');
    await expect(page.locator('.palette-panel')).toHaveClass(/open/);

    await expect(page.locator('.palette-action:has-text("Upload files")')).toBeVisible();
  });

  test('copy link action exists in palette', async ({ page }) => {
    await openTerminal(page);
    await page.click('#palette-trigger');
    await expect(page.locator('.palette-panel')).toHaveClass(/open/);

    await expect(page.locator('.palette-action:has-text("Copy link")')).toBeVisible();
  });

  test('about dialog shows version info', async ({ page }) => {
    await openTerminal(page);
    await openPaletteAndClick(page, 'About');

    // About dialog creates a fixed overlay — look for the dynamically created box
    // containing "TermBeam" text. Use a specific selector to avoid matching other elements.
    await expect(page.locator('div').filter({ hasText: /^TermBeam$/ })).toBeVisible({
      timeout: 3_000,
    });

    // The dialog shows links to GitHub and Docs
    await expect(page.locator('a[href*="github.com"]')).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.locator('a:has-text("Docs")')).toBeVisible({
      timeout: 3_000,
    });
  });
});

// ─── 5. Reconnect Behavior ─────────────────────────────────────────────────

test.describe('Connection Status', () => {
  test('terminal shows connected state with green dot', async ({ page }) => {
    await openTerminal(page);

    // Status dot should be visible and have 'connected' class
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });

    // Status dot element should exist with the connected class
    const dotClass = await page.locator('#status-dot').getAttribute('class');
    expect(dotClass).toContain('connected');
  });

  test('session name is displayed in top bar', async ({ page }) => {
    await openTerminal(page);

    // Session name should not be the placeholder
    await expect(page.locator('#session-name')).not.toHaveText('…', {
      timeout: 5_000,
    });
    const name = await page.locator('#session-name').textContent();
    expect(name.length).toBeGreaterThan(0);
  });
});

// ─── 6. Hub Page Features ───────────────────────────────────────────────────

test.describe('Hub Page', () => {
  test('hub page lists all sessions', async ({ page }) => {
    await openHub(page);

    // The default server starts with one session
    await expect(page.locator('.session-card')).toHaveCount(1, {
      timeout: 5_000,
    });
  });

  test('sessions show shell and PID info', async ({ page }) => {
    await openHub(page);

    // Each session card should show PID
    await expect(page.locator('.session-card .pid').first()).toBeVisible({
      timeout: 5_000,
    });
    const pidText = await page.locator('.session-card .pid').first().textContent();
    expect(pidText).toMatch(/PID \d+/);

    // Details should show shell and working directory
    const details = page.locator('.session-card .details').first();
    await expect(details).toBeVisible({ timeout: 5_000 });
    const detailsText = await details.textContent();
    // Should contain directory info and shell info
    expect(detailsText).toBeTruthy();
  });

  test('new session button on hub creates session and navigates to terminal', async ({ page }) => {
    await openHub(page);
    await page.click('#new-session-btn');

    // Modal should open
    await expect(page.locator('#modal')).toHaveClass(/visible/, {
      timeout: 3_000,
    });
    await page.click('#modal-create');

    // Should navigate to terminal page
    await expect(page).toHaveURL(/\/terminal/, { timeout: 10_000 });
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('version is displayed in hub header', async ({ page }) => {
    await openHub(page);

    const versionEl = page.locator('#version');
    await expect(versionEl).toBeVisible({ timeout: 5_000 });
    const versionText = await versionEl.textContent();
    // Version should be non-empty (format: "vX.Y.Z" or similar)
    expect(versionText).toMatch(/v?\d+\.\d+/);
  });

  test('refresh button reloads session list', async ({ page }) => {
    await openHub(page);

    // Session list should have sessions
    await expect(page.locator('.session-card')).toHaveCount(1, {
      timeout: 5_000,
    });

    // Click refresh
    await page.click('#refresh-btn');
    await page.waitForTimeout(1000);

    // Sessions should still be listed after refresh
    await expect(page.locator('.session-card')).toHaveCount(1, {
      timeout: 5_000,
    });
  });

  test('connect button on session card navigates to terminal', async ({ page }) => {
    await openHub(page);

    await expect(page.locator('.session-card')).toHaveCount(1, {
      timeout: 5_000,
    });
    await page.locator('.session-card .connect-btn').first().click();

    await expect(page).toHaveURL(/\/terminal/, { timeout: 10_000 });
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── 7. Multi-Session Tab Behavior ──────────────────────────────────────────

test.describe('Multi-Session Tabs', () => {
  test('creating multiple sessions shows multiple tabs', async ({ page }) => {
    await openTerminal(page);
    await expect(page.locator('.session-tab')).toHaveCount(1, {
      timeout: 5_000,
    });

    // Create second session
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await expect(page.locator('.session-tab')).toHaveCount(2, {
      timeout: 5_000,
    });

    // Create third session
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await expect(page.locator('.session-tab')).toHaveCount(3, {
      timeout: 5_000,
    });
  });

  test('active tab is visually distinguished', async ({ page }) => {
    await openTerminal(page);

    // Create a second session so we have 2 tabs
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await expect(page.locator('.session-tab')).toHaveCount(2, {
      timeout: 5_000,
    });

    // Exactly one tab should be active
    await expect(page.locator('.session-tab.active')).toHaveCount(1);

    // The last tab (newly created) should be active
    const lastTab = page.locator('.session-tab').last();
    await expect(lastTab).toHaveClass(/active/);
  });

  test('tab shows session color dot', async ({ page }) => {
    await openTerminal(page);

    // Each tab should have a colored dot
    const tabDot = page.locator('.session-tab .tab-dot').first();
    await expect(tabDot).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a tab switches to that session', async ({ page }) => {
    test.skip(isWindows, 'bash-specific');
    await openTerminal(page);

    // Mark first session
    const marker1 = `TAB1_${Date.now()}`;
    await runCommand(page, `echo ${marker1}`);
    await waitForTerminalOutput(page, marker1);

    // Create second session
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });

    // Mark second session
    const marker2 = `TAB2_${Date.now()}`;
    await runCommand(page, `echo ${marker2}`);
    await waitForTerminalOutput(page, marker2);

    // Click first tab
    await page.locator('.session-tab').first().click();
    await page.waitForTimeout(500);

    // Should see first session content
    await waitForTerminalOutput(page, marker1);
  });

  test('close button on tab removes the tab', async ({ page }) => {
    await openTerminal(page);

    // Create a second session
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await expect(page.locator('.session-tab')).toHaveCount(2, {
      timeout: 5_000,
    });

    // Accept the confirm dialog that fires when closing a tab
    page.once('dialog', (dialog) => dialog.accept());

    // Hover over last tab to reveal close button, then click it
    const lastTab = page.locator('.session-tab').last();
    await lastTab.hover();
    await lastTab.locator('.tab-close').click();

    // Should be back to 1 tab
    await expect(page.locator('.session-tab')).toHaveCount(1, {
      timeout: 5_000,
    });
  });

  test('closing active tab switches to adjacent session', async ({ page }) => {
    await openTerminal(page);

    // Create second session
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await expect(page.locator('.session-tab')).toHaveCount(2, {
      timeout: 5_000,
    });

    // Accept the confirm dialog that fires when closing a tab
    page.once('dialog', (dialog) => dialog.accept());

    // The second tab is active; close it
    const lastTab = page.locator('.session-tab').last();
    await expect(lastTab).toHaveClass(/active/);
    await lastTab.hover();
    await lastTab.locator('.tab-close').click();

    // First tab should now be active
    await expect(page.locator('.session-tab')).toHaveCount(1, {
      timeout: 5_000,
    });
    await expect(page.locator('.session-tab').first()).toHaveClass(/active/, {
      timeout: 5_000,
    });

    // Terminal should still be connected
    await expect(page.locator('#status-dot.connected')).toBeVisible({
      timeout: 10_000,
    });
  });
});

// ─── 8. Search Functionality ────────────────────────────────────────────────

test.describe('Search', () => {
  test('search bar opens via palette "Find in terminal"', async ({ page }) => {
    await openTerminal(page);
    await openPaletteAndClick(page, 'Find in terminal');

    await expect(page.locator('#search-bar')).toHaveClass(/visible/, {
      timeout: 3_000,
    });
    await expect(page.locator('#search-input')).toBeFocused();
  });

  test('search finds text in terminal output', async ({ page }) => {
    test.skip(isWindows, 'bash-specific');
    await openTerminal(page);

    // Output some searchable text
    const marker = `SEARCHME_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);

    // Open search and type the marker
    await openPaletteAndClick(page, 'Find in terminal');
    await expect(page.locator('#search-bar')).toHaveClass(/visible/);
    await page.fill('#search-input', marker);
    await page.waitForTimeout(500);

    // Search count should indicate found
    const countText = await page.locator('#search-count').textContent();
    expect(countText).toContain('Found');
  });

  test('search navigation (prev/next) buttons exist', async ({ page }) => {
    await openTerminal(page);
    await openPaletteAndClick(page, 'Find in terminal');

    await expect(page.locator('#search-prev')).toBeVisible();
    await expect(page.locator('#search-next')).toBeVisible();
  });

  test('closing search bar hides it', async ({ page }) => {
    await openTerminal(page);
    await openPaletteAndClick(page, 'Find in terminal');

    await expect(page.locator('#search-bar')).toHaveClass(/visible/);
    await page.click('#search-close');
    await expect(page.locator('#search-bar')).not.toHaveClass(/visible/, {
      timeout: 3_000,
    });
  });

  test('Escape key closes search bar', async ({ page }) => {
    await openTerminal(page);
    await openPaletteAndClick(page, 'Find in terminal');

    await expect(page.locator('#search-bar')).toHaveClass(/visible/);
    await page.locator('#search-input').press('Escape');
    await expect(page.locator('#search-bar')).not.toHaveClass(/visible/, {
      timeout: 3_000,
    });
  });
});

// ─── 9. Keyboard Shortcuts ─────────────────────────────────────────────────

test.describe('Keyboard Shortcuts', () => {
  test('Ctrl+K opens command palette', async ({ page }) => {
    await openTerminal(page);

    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette-panel')).toHaveClass(/open/, {
      timeout: 3_000,
    });
  });

  test('Escape closes command palette', async ({ page }) => {
    await openTerminal(page);

    await page.keyboard.press('Control+k');
    await expect(page.locator('.palette-panel')).toHaveClass(/open/, {
      timeout: 3_000,
    });

    await page.keyboard.press('Escape');
    await expect(page.locator('.palette-panel')).not.toHaveClass(/open/, {
      timeout: 3_000,
    });
  });

  test('Ctrl+F opens search bar', async ({ page }) => {
    await openTerminal(page);

    await page.keyboard.press('Control+f');
    await expect(page.locator('#search-bar')).toHaveClass(/visible/, {
      timeout: 3_000,
    });
    await expect(page.locator('#search-input')).toBeFocused();
  });
});

// ─── 10. Mobile Layout ─────────────────────────────────────────────────────

test.describe('Mobile Layout', () => {
  test('hamburger menu visible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminal(page);

    await expect(page.locator('#panel-toggle')).toBeVisible({ timeout: 5_000 });
  });

  test('tab bar hidden on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminal(page);

    await expect(page.locator('#tab-list')).not.toBeVisible();
  });

  test('side panel opens on hamburger click', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminal(page);

    await page.click('#panel-toggle');
    await expect(page.locator('#side-panel')).toHaveClass(/open/, {
      timeout: 3_000,
    });

    // Side panel should show session list and brand
    await expect(page.locator('.side-panel-brand')).toBeVisible();
  });

  test('side panel shows new session button', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminal(page);

    await page.click('#panel-toggle');
    await expect(page.locator('#side-panel')).toHaveClass(/open/, {
      timeout: 3_000,
    });

    await expect(page.locator('#side-panel-new-btn')).toBeVisible();
  });

  test('back button hidden on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openTerminal(page);

    // Back button should be hidden on mobile
    await expect(page.locator('#back-btn')).not.toBeVisible();
  });
});
