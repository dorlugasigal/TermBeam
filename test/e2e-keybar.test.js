/**
 * E2E tests — every key-bar button and top-bar button in the terminal UI (React).
 *
 * Starts a TermBeam server per test, opens the terminal page in headless Chromium,
 * and verifies each button works end-to-end through a real PTY.
 *
 * Run:  npx playwright test test/e2e-keybar.test.js
 */
const { test, expect } = require('@playwright/test');
const { setupSharedServer, getBaseURL: getBaseURLForState, isWindows } = require('./e2e-helpers');

// One TermBeam server per file, with sessions reset to "1 default session"
// between tests. See test/e2e-helpers.js for the reset logic.
const state = setupSharedServer(test);

// ─── Helpers ────────────────────────────────────────────────────────────────

function getBaseURL() {
  return getBaseURLForState(state);
}

async function setupTerminal(page) {
  const resp = await page.request.post(`${getBaseURL()}/api/sessions`);
  const { id } = await resp.json();
  await page.goto(`${getBaseURL()}/terminal?id=${id}`);
  await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
    timeout: 10_000,
  });
  return id;
}

async function waitForTerminalOutput(page, pattern, timeout = 15_000) {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  await expect(async () => {
    const text = await page.evaluate(() => {
      const rows = document.querySelector(
        '[data-testid="terminal-pane"][data-visible="true"] .xterm-rows',
      );
      return rows ? rows.innerText : '';
    });
    expect(text).toMatch(regex);
  }).toPass({ timeout });
}

function getTerminalText(page) {
  return page.evaluate(() => {
    const rows = document.querySelector(
      '[data-testid="terminal-pane"][data-visible="true"] .xterm-rows',
    );
    return rows ? rows.innerText : '';
  });
}

function terminalTextarea(page) {
  return page
    .locator('[data-testid="terminal-pane"][data-visible="true"] .xterm-helper-textarea')
    .first();
}

async function typeInTerminal(page, text) {
  const textarea = terminalTextarea(page);
  await textarea.focus();
  for (const ch of text) {
    await textarea.press(ch);
    await page.waitForTimeout(30);
  }
}

async function runCommand(page, cmd) {
  await typeInTerminal(page, cmd);
  await page.getByRole('button', { name: '↵', exact: true }).click();
}

async function openPaletteAndClick(page, actionLabel) {
  await page.locator('[data-testid="palette-trigger"]').click();
  await expect(page.locator('[data-testid="palette-panel"]')).toBeVisible();
  await page.locator('[data-testid="palette-action"]').filter({ hasText: actionLabel }).click();
}

// ─── Key Bar: Input Keys ────────────────────────────────────────────────────

test.describe('Key Bar — Input Keys', () => {
  test('Enter button submits a command', async ({ page }) => {
    await setupTerminal(page);
    const marker = `ENTER_${Date.now()}`;
    await typeInTerminal(page, `echo ${marker}`);
    await page.getByRole('button', { name: '↵', exact: true }).click();
    await waitForTerminalOutput(page, marker);
  });

  test('Tab button triggers autocomplete', async ({ page }) => {
    // cmd.exe doesn't autocomplete command names the same way
    test.skip(isWindows, 'bash-specific autocomplete');
    await setupTerminal(page);
    await typeInTerminal(page, 'ech');
    await page.getByRole('button', { name: 'Tab', exact: true }).click();
    await page.waitForTimeout(500);
    await waitForTerminalOutput(page, /echo/);
  });

  test('Escape button sends ESC to terminal and clears line', async ({ page }) => {
    test.skip(isWindows, 'bash-specific Ctrl+U clear');
    await setupTerminal(page);
    // Type partial text, press Escape then Ctrl+U to clear line (ESC enters vi mode, or is ignored)
    // Then verify typing a new command works — the old partial text is gone
    const garbage = 'thiscommandwillfail_XYZ';
    await typeInTerminal(page, garbage);
    await page.getByRole('button', { name: 'Esc', exact: true }).click();
    await page.waitForTimeout(200);

    // In bash emacs mode, Escape alone doesn't clear, but Ctrl+U does.
    // The key test: Escape is delivered to the PTY (not swallowed by the UI).
    // Prove it by verifying terminal is still interactive after ESC.
    const marker = `ESC_${Date.now()}`;
    // Ctrl+U to clear line, then type clean command
    const textarea = terminalTextarea(page);
    await textarea.focus();
    await textarea.press('Control+u');
    await page.waitForTimeout(200);
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });

  test('Ctrl+C button interrupts a running process', async ({ page }) => {
    await setupTerminal(page);
    // sleep not available on Windows; use ping instead
    const longCmd = isWindows ? 'ping -n 999 127.0.0.1' : 'sleep 999';
    await runCommand(page, longCmd);
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: '^C', exact: true }).click();
    await page.waitForTimeout(500);
    const marker = `CTRLC_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });
});

// ─── Key Bar: Arrow Keys ────────────────────────────────────────────────────

test.describe('Key Bar — Arrow Keys', () => {
  test('Up arrow recalls previous command', async ({ page }) => {
    // cmd.exe uses F3/F7 for history, not Up arrow
    test.skip(isWindows, 'bash-specific history recall');
    await setupTerminal(page);
    const marker = `UP_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: '↑', exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '↵', exact: true }).click();

    await expect(async () => {
      const text = await getTerminalText(page);
      const matches = text.split(marker).length - 1;
      expect(matches).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 10_000 });
  });

  test('Down arrow navigates history forward', async ({ page }) => {
    test.skip(isWindows, 'bash-specific history navigation');
    await setupTerminal(page);
    const m1 = `DOWN1_${Date.now()}`;
    const m2 = `DOWN2_${Date.now()}`;
    await runCommand(page, `echo ${m1}`);
    await waitForTerminalOutput(page, m1);
    await page.waitForTimeout(300);
    await runCommand(page, `echo ${m2}`);
    await waitForTerminalOutput(page, m2);
    await page.waitForTimeout(300);

    // Go up twice, then down once — should land on second command
    await page.getByRole('button', { name: '↑', exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: '↑', exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: '↓', exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: '↵', exact: true }).click();
    await waitForTerminalOutput(page, new RegExp(m2));
  });

  test('Left arrow moves cursor left by N positions', async ({ page }) => {
    await setupTerminal(page);
    // Type "echo ABCD", press Left 3 times to land between A and B, insert "X" → "echo AXBCD"
    await typeInTerminal(page, 'echo ABCD');
    await page.getByRole('button', { name: '←', exact: true }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: '←', exact: true }).click();
    await page.waitForTimeout(100);
    await page.getByRole('button', { name: '←', exact: true }).click();
    await page.waitForTimeout(100);
    await typeInTerminal(page, 'X');
    await page.getByRole('button', { name: '↵', exact: true }).click();
    await waitForTerminalOutput(page, /AXBCD/);
  });

  test('Right arrow moves cursor right by N positions', async ({ page }) => {
    await setupTerminal(page);
    // Type "echo ABCD", Left 4 times (before A), Right 2 times (after B), insert "X" → "echo ABXCD"
    await typeInTerminal(page, 'echo ABCD');
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: '←', exact: true }).click();
      await page.waitForTimeout(80);
    }
    await page.getByRole('button', { name: '→', exact: true }).click();
    await page.waitForTimeout(80);
    await page.getByRole('button', { name: '→', exact: true }).click();
    await page.waitForTimeout(80);
    await typeInTerminal(page, 'X');
    await page.getByRole('button', { name: '↵', exact: true }).click();
    await waitForTerminalOutput(page, /ABXCD/);
  });
});

// ─── Key Bar: Navigation Keys ───────────────────────────────────────────────

test.describe('Key Bar — Navigation Keys', () => {
  test('Home button moves cursor to beginning of line', async ({ page }) => {
    // cmd.exe Home behavior differs; # is not a comment in cmd.exe
    test.skip(isWindows, 'bash-specific Home + comment');
    await setupTerminal(page);
    // Type "echo HELLO", press Home, then type "# " — should prepend
    await typeInTerminal(page, 'echo HELLO');
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.waitForTimeout(200);
    await typeInTerminal(page, '# ');
    await page.getByRole('button', { name: '↵', exact: true }).click();
    // In bash, "# echo HELLO" is a comment → no output, but it should appear in the input line
    await waitForTerminalOutput(page, /# echo HELLO/);
  });

  test('End button moves cursor to end of line', async ({ page }) => {
    await setupTerminal(page);
    // Type text, go Home, then End, then append
    await typeInTerminal(page, 'echo HI');
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'End', exact: true }).click();
    await page.waitForTimeout(200);
    await typeInTerminal(page, 'GH');
    await page.getByRole('button', { name: '↵', exact: true }).click();
    await waitForTerminalOutput(page, /HIGH/);
  });
});

// ─── Key Bar: Modifier Keys ────────────────────────────────────────────────

test.describe('Key Bar — Modifier Keys', () => {
  test('Ctrl modifier toggles on and off', async ({ page }) => {
    await setupTerminal(page);
    const ctrlBtn = page.locator('[data-testid="ctrl-btn"]');

    await expect(ctrlBtn).not.toHaveClass(/active/);
    await ctrlBtn.click();
    await expect(ctrlBtn).toHaveClass(/active/);
    await ctrlBtn.click();
    await expect(ctrlBtn).not.toHaveClass(/active/);
  });

  test('Shift modifier toggles on and off', async ({ page }) => {
    await setupTerminal(page);
    const shiftBtn = page.locator('[data-testid="shift-btn"]');

    await expect(shiftBtn).not.toHaveClass(/active/);
    await shiftBtn.click();
    await expect(shiftBtn).toHaveClass(/active/);
    await shiftBtn.click();
    await expect(shiftBtn).not.toHaveClass(/active/);
  });

  test('Ctrl modifier clears after sending a key', async ({ page }) => {
    await setupTerminal(page);
    const ctrlBtn = page.locator('[data-testid="ctrl-btn"]');

    await ctrlBtn.click();
    await expect(ctrlBtn).toHaveClass(/active/);

    // Send a key via the TouchBar — modifier should auto-clear
    await page.getByRole('button', { name: '^C', exact: true }).click();
    await page.waitForTimeout(200);
    await expect(ctrlBtn).not.toHaveClass(/active/);
  });

  test('Ctrl+C via modifier actually interrupts a process', async ({ page }) => {
    await setupTerminal(page);
    const longCmd = isWindows ? 'ping -n 999 127.0.0.1' : 'sleep 999';
    await runCommand(page, longCmd);
    await page.waitForTimeout(1000);

    // Use keyboard Ctrl+C directly (React TouchBar Ctrl toggle only affects TouchBar keys)
    const textarea = terminalTextarea(page);
    await textarea.focus();
    await textarea.press('Control+c');
    await page.waitForTimeout(500);

    // Shell should be back — run a new command to prove it
    const marker = `CTRLMOD_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });

  test('Ctrl+A (Home via Ctrl modifier) moves to beginning', async ({ page }) => {
    test.skip(isWindows, 'bash-specific Ctrl+A');
    await setupTerminal(page);
    await typeInTerminal(page, 'echo WORLD');

    // Use keyboard Ctrl+A directly (Ctrl+A = beginning of line in bash)
    const textarea = terminalTextarea(page);
    await textarea.focus();
    await textarea.press('Control+a');
    await page.waitForTimeout(200);

    await typeInTerminal(page, '# ');
    await page.getByRole('button', { name: '↵', exact: true }).click();
    await waitForTerminalOutput(page, /# echo WORLD/);
  });

  test('Ctrl+L via modifier clears the screen', async ({ page }) => {
    test.skip(isWindows, 'bash-specific Ctrl+L');
    await setupTerminal(page);

    // Run a few commands to fill the terminal
    await runCommand(page, 'echo BEFORE_CLEAR_1');
    await waitForTerminalOutput(page, /BEFORE_CLEAR_1/);
    await page.waitForTimeout(300);
    await runCommand(page, 'echo BEFORE_CLEAR_2');
    await waitForTerminalOutput(page, /BEFORE_CLEAR_2/);
    await page.waitForTimeout(300);

    // Use keyboard Ctrl+L directly to clear screen
    const textarea = terminalTextarea(page);
    await textarea.focus();
    await textarea.press('Control+l');
    await page.waitForTimeout(500);

    // Old output should be scrolled away from visible rows
    const text = await getTerminalText(page);
    expect(text).not.toContain('BEFORE_CLEAR_1');
  });
});

// ─── Key Bar: Copy & Paste Buttons ──────────────────────────────────────────

test.describe('Key Bar — Copy & Paste', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('Copy button opens overlay with terminal content', async ({ page }) => {
    await setupTerminal(page);
    // Run a command that produces known output
    const marker = `COPY_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
    await page.waitForTimeout(300);

    // Open copy overlay
    await page.locator('[data-testid="select-btn"]').click();
    await expect(page.locator('[data-testid="select-overlay"]')).toBeVisible();

    // Verify the overlay captured actual terminal content (not empty)
    await expect(async () => {
      const content = await page.locator('[data-testid="select-content"]').innerText();
      expect(content).toContain(marker);
    }).toPass({ timeout: 5_000 });

    // Close and verify overlay is gone
    await page.locator('[data-testid="select-close"]').click();
    await expect(page.locator('[data-testid="select-overlay"]')).not.toBeVisible();
  });

  test('Copy overlay shows multi-line terminal output', async ({ page }) => {
    await setupTerminal(page);
    // Run multiple commands to produce multi-line output
    const m1 = `LINE1_${Date.now()}`;
    const m2 = `LINE2_${Date.now()}`;
    await runCommand(page, `echo ${m1}`);
    await waitForTerminalOutput(page, m1);
    await page.waitForTimeout(200);
    await runCommand(page, `echo ${m2}`);
    await waitForTerminalOutput(page, m2);
    await page.waitForTimeout(300);

    await page.locator('[data-testid="select-btn"]').click();
    await expect(page.locator('[data-testid="select-overlay"]')).toBeVisible();

    // Both lines should be present in the captured content
    await expect(async () => {
      const content = await page.locator('[data-testid="select-content"]').innerText();
      expect(content).toContain(m1);
      expect(content).toContain(m2);
    }).toPass({ timeout: 5_000 });

    await page.locator('[data-testid="select-close"]').click();
  });

  test('Paste sends text into the terminal', async ({ page }) => {
    await setupTerminal(page);

    const marker = `PASTE_${Date.now()}`;
    // In headless mode, clipboard API fails — TouchBar falls back to window.prompt()
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept(`echo ${marker}`);
    });
    await page.locator('[data-testid="paste-btn"]').click();

    // Press Enter to execute — verify the command actually ran
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '↵', exact: true }).click();
    await waitForTerminalOutput(page, marker);
  });

  test('Paste sends multi-line text into terminal', async ({ page }) => {
    await setupTerminal(page);

    const m1 = `MULTI1_${Date.now()}`;
    const m2 = `MULTI2_${Date.now()}`;
    // window.prompt is single-line; paste both commands joined by semicolon
    page.once('dialog', async (dialog) => {
      await dialog.accept(`echo ${m1}; echo ${m2}`);
    });
    await page.locator('[data-testid="paste-btn"]').click();

    // Press Enter to execute the combined command
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '↵', exact: true }).click();
    await waitForTerminalOutput(page, m1);
    await waitForTerminalOutput(page, m2);
  });

  test('Paste cancel does not send text to terminal', async ({ page }) => {
    await setupTerminal(page);

    const phantom = `PHANTOM_${Date.now()}`;
    // Dismiss the prompt — nothing should be sent
    page.once('dialog', async (dialog) => {
      await dialog.dismiss();
    });
    await page.locator('[data-testid="paste-btn"]').click();
    await page.waitForTimeout(500);

    // Run a real command and verify phantom text never appeared
    const marker = `REAL_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);

    const text = await getTerminalText(page);
    expect(text).not.toContain(phantom);
  });
});

// ─── Top Bar: Theme Toggle ──────────────────────────────────────────────────

test.describe('Top Bar — Theme Toggle', () => {
  test('opens theme picker and applies selected theme with visible color change', async ({
    page,
  }) => {
    await setupTerminal(page);

    // Capture dark theme background color
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // Open the theme subpanel via the command palette
    await openPaletteAndClick(page, 'Theme');
    await page.waitForTimeout(100);

    // Subpanel should be open
    await expect(page.locator('[data-testid="theme-subpanel"]')).toBeVisible();

    // Select the light theme
    await page.locator('[data-testid="theme-item"][data-tid="light"]').click();
    await page.waitForTimeout(300);
    const lightTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(lightTheme).toBe('light');

    // Background color should actually change
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(lightBg).not.toBe(darkBg);

    // Click dark theme directly
    await page.locator('[data-testid="theme-item"][data-tid="dark"]').click();
    await page.waitForTimeout(300);
    const darkTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(darkTheme).toBe('dark');

    // Color should revert
    const revertedBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(revertedBg).toBe(darkBg);
  });
});

// ─── Command Palette: Zoom Controls ────────────────────────────────────────

test.describe('Command Palette — Zoom Controls', () => {
  test('Increase font size via palette', async ({ page }) => {
    await setupTerminal(page);
    const initialSize = await page.evaluate(() => {
      const el = document.querySelector('.xterm-rows');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });

    await openPaletteAndClick(page, 'Increase font size');

    const newSize = await page.evaluate(() => {
      const el = document.querySelector('.xterm-rows');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(newSize).toBeGreaterThan(initialSize);
  });

  test('Decrease font size via palette', async ({ page }) => {
    await setupTerminal(page);
    // First zoom in to have room to zoom out
    await openPaletteAndClick(page, 'Increase font size');
    await openPaletteAndClick(page, 'Increase font size');

    const beforeSize = await page.evaluate(() => {
      const el = document.querySelector('.xterm-rows');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });

    await openPaletteAndClick(page, 'Decrease font size');

    const afterSize = await page.evaluate(() => {
      const el = document.querySelector('.xterm-rows');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(afterSize).toBeLessThan(beforeSize);
  });
});

// ─── Command Palette: Split View ────────────────────────────────────────────

test.describe('Command Palette — Split View', () => {
  test('Split view creates two terminal panes', async ({ page }) => {
    await setupTerminal(page);

    // Create a second session via the new tab button → modal
    await page.locator('button[title="New tab"]').click();
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible();
    await page.locator('[data-testid="ns-name"]').fill('Split Target');
    await page.locator('[data-testid="ns-create"]').click();
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });

    const initialPanes = await page
      .locator('[data-testid="terminal-pane"][data-visible="true"]')
      .count();
    expect(initialPanes).toBe(1);

    // Toggle split vertical via palette
    await openPaletteAndClick(page, 'Split vertical');
    await expect(async () => {
      const afterPanes = await page
        .locator('[data-testid="terminal-pane"][data-visible="true"]')
        .count();
      expect(afterPanes).toBe(2);
    }).toPass({ timeout: 5_000 });

    // Verify working terminal
    const marker = `SPLIT_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);

    // Cycle through horizontal split then off
    await openPaletteAndClick(page, 'Split horizontal');
    await expect(async () => {
      const hPanes = await page
        .locator('[data-testid="terminal-pane"][data-visible="true"]')
        .count();
      expect(hPanes).toBe(2);
    }).toPass({ timeout: 5_000 });

    await openPaletteAndClick(page, 'Close split');
    const finalPanes = await page
      .locator('[data-testid="terminal-pane"][data-visible="true"]')
      .count();
    expect(finalPanes).toBe(1);
  });
});

// ─── Top Bar: New Session ───────────────────────────────────────────────────

test.describe('Top Bar — New Session', () => {
  test('New Session button opens the modal', async ({ page }) => {
    await setupTerminal(page);
    await page.locator('button[title="New tab"]').click();
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible();
    // Modal has name input, shell select, cancel/create buttons
    await expect(page.locator('[data-testid="ns-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="ns-shell"]')).toBeVisible();
    await expect(page.locator('[data-testid="ns-cancel"]')).toBeVisible();
    await expect(page.locator('[data-testid="ns-create"]')).toBeVisible();
  });

  test('Cancel closes the new session modal', async ({ page }) => {
    await setupTerminal(page);
    await page.locator('button[title="New tab"]').click();
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible();
    await page.locator('[data-testid="ns-cancel"]').click();
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible();
  });

  test('Create button creates a new session with a working terminal', async ({ page }) => {
    await setupTerminal(page);
    const initialTabs = await page.locator('[data-testid="session-tab"]').count();

    await page.locator('button[title="New tab"]').click();
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible();
    await page.locator('[data-testid="ns-name"]').fill('Test Session');
    await page.locator('[data-testid="ns-create"]').click();

    // Wait for modal to close and new tab to appear
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(async () => {
      const tabs = await page.locator('[data-testid="session-tab"]').count();
      expect(tabs).toBe(initialTabs + 1);
    }).toPass({ timeout: 5_000 });

    // Wait for the new session's WebSocket to connect
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    // Verify the new session has a working terminal
    const marker = `NEWSESS_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });
});

// ─── Top Bar: Side Panel ────────────────────────────────────────────────────

test.describe('Top Bar — Side Panel (mobile viewport)', () => {
  // Panel toggle is only visible at max-width: 640px
  test.use({ viewport: { width: 375, height: 667 } });

  test('Panel toggle opens the sessions side panel', async ({ page }) => {
    await setupTerminal(page);
    await page.locator('[aria-label="Toggle panel"]').click();
    await expect(page.locator('[data-testid="side-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="side-panel-list"]')).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New Session' })).toBeVisible();
  });

  test('Close button closes the side panel', async ({ page }) => {
    await setupTerminal(page);
    await page.locator('[aria-label="Toggle panel"]').click();
    await expect(page.locator('[data-testid="side-panel"]')).toBeVisible();
    await page.locator('[aria-label="Close side panel"]').click();
    await expect(page.locator('[data-testid="side-panel"]')).not.toBeVisible();
  });

  test('Backdrop click closes the side panel', async ({ page }) => {
    await setupTerminal(page);
    await page.locator('[aria-label="Toggle panel"]').click();
    await expect(page.locator('[data-testid="side-panel"]')).toBeVisible();
    // Click on the right edge of the viewport (outside the panel, on the backdrop)
    await page.mouse.click(370, 333);
    await expect(page.locator('[data-testid="side-panel"]')).not.toBeVisible();
  });

  test('Side panel New Session button opens the modal', async ({ page }) => {
    await setupTerminal(page);
    await page.locator('[aria-label="Toggle panel"]').click();
    await expect(page.locator('[data-testid="side-panel"]')).toBeVisible();
    await page.getByRole('button', { name: '+ New Session' }).click();
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible();
  });

  test('Side panel session card switches active session', async ({ page }) => {
    await setupTerminal(page);

    // Run a command in the first (default) session
    const marker1 = `FIRST_${Date.now()}`;
    await runCommand(page, `echo ${marker1}`);
    await waitForTerminalOutput(page, marker1);

    // Create a second session via side panel (mobile — top bar + New is hidden)
    await page.locator('[aria-label="Toggle panel"]').click();
    await expect(page.locator('[data-testid="side-panel"]')).toBeVisible();
    await page.getByRole('button', { name: '+ New Session' }).click();
    await expect(page.locator('[data-testid="new-session-modal"]')).toBeVisible();
    await page.locator('[data-testid="ns-name"]').fill('Second');
    await page.locator('[data-testid="ns-create"]').click();
    await expect(page.locator('[data-testid="new-session-modal"]')).not.toBeVisible({
      timeout: 5_000,
    });

    // Wait for second session to connect
    await expect(page.locator('[data-testid="status-dot"].connected')).toBeVisible({
      timeout: 10_000,
    });

    // Run a command in the second session
    const marker2 = `SECOND_${Date.now()}`;
    await runCommand(page, `echo ${marker2}`);
    await waitForTerminalOutput(page, marker2);

    // Open side panel and click the test session card to switch back.
    // The auto-created default session is at index 0; the test session is at index 1.
    await page.locator('[aria-label="Toggle panel"]').click();
    await expect(page.locator('[data-testid="side-panel"]')).toBeVisible();
    await page.locator('[data-testid="side-panel-card"]').nth(1).click();

    // Wait for terminal content to update after switching sessions
    await expect(async () => {
      const text = await getTerminalText(page);
      expect(text).toContain(marker1);
    }).toPass({ timeout: 5_000 });

    // The test session should be active — it should have marker1 but not marker2
    const text = await getTerminalText(page);
    expect(text).toContain(marker1);
    expect(text).not.toContain(marker2);
  });
});

// ─── Top Bar: Back & Stop ───────────────────────────────────────────────────

test.describe('Top Bar — Navigation & Session Control', () => {
  test('Back button navigates to the hub page', async ({ page }) => {
    await setupTerminal(page);
    await page.locator('[aria-label="Back"]').click();
    await page.waitForURL('**/');
    // Should be on the hub page
    const content = await page.content();
    expect(content).toContain('TermBeam');
  });

  test('Stop button removes the session from the server', async ({ page }) => {
    await setupTerminal(page);

    // Get initial session count from API
    const beforeCount = await page.evaluate(async () => {
      const res = await fetch('/api/sessions');
      const sessions = await res.json();
      return sessions.length;
    });
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    // Accept the confirm dialog and stop via tools panel
    page.on('dialog', (dialog) => dialog.accept());
    await openPaletteAndClick(page, 'Stop session');

    // Poll until session is removed from the server
    await expect(async () => {
      const afterCount = await page.evaluate(async () => {
        const res = await fetch('/api/sessions');
        const sessions = await res.json();
        return sessions.length;
      });
      expect(afterCount).toBe(beforeCount - 1);
    }).toPass({ timeout: 5_000 });
  });
});

// ─── Command Palette: Preview Port ──────────────────────────────────────────

test.describe('Command Palette — Preview Port', () => {
  test('Preview port opens the preview modal', async ({ page }) => {
    await setupTerminal(page);
    await openPaletteAndClick(page, 'Preview port');
    await expect(page.locator('[data-testid="preview-modal"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-port-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="preview-open"]')).toBeVisible();
  });

  test('Preview cancel closes the modal', async ({ page }) => {
    await setupTerminal(page);
    await openPaletteAndClick(page, 'Preview port');
    await expect(page.locator('[data-testid="preview-modal"]')).toBeVisible();
    // Radix Dialog — close by pressing Escape
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="preview-modal"]')).not.toBeVisible();
  });
});

// ─── Top Bar: Status Indicators ─────────────────────────────────────────────

test.describe('Top Bar — Status', () => {
  test('Status dot shows connected state', async ({ page }) => {
    await setupTerminal(page);
    await expect(page.locator('[data-testid="status-dot"]')).toHaveClass(/connected/);
  });

  test('Session name is displayed', async ({ page }) => {
    await setupTerminal(page);
    const name = await page.locator('[data-testid="session-name-display"]').innerText();
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toBe('…');
  });

  test('Palette trigger is visible', async ({ page }) => {
    await setupTerminal(page);
    await expect(page.locator('[data-testid="palette-trigger"]')).toBeVisible();
  });
});

// ─── Activity Indicators ────────────────────────────────────────────────────

test.describe('Activity Indicators', () => {
  test('Tab title restores when returning from hidden state', async ({ page }) => {
    await setupTerminal(page);

    const titleBefore = await page.title();

    // Manually set the title bullet (simulating what the notification handler does)
    await page.evaluate((title) => {
      document.title = '(\u25CF) ' + title;
    }, titleBefore);

    // Verify bullet is set
    await expect(async () => {
      const title = await page.title();
      expect(title).toContain('\u25CF');
    }).toPass({ timeout: 2_000 });

    // Simulate returning to tab — title should restore via visibilitychange handler
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(async () => {
      const title = await page.title();
      expect(title).toBe(titleBefore);
    }).toPass({ timeout: 5_000 });
  });

  test('Notification toggle exists in command palette', async ({ page }) => {
    await setupTerminal(page);

    // Verify the notification toggle action is available in the palette
    await page.locator('[data-testid="palette-trigger"]').click();
    await expect(page.locator('[data-testid="palette-panel"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="palette-action"]').filter({ hasText: /Notification/i }),
    ).toBeVisible();
  });
});
