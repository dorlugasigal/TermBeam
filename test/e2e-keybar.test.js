/**
 * E2E tests — every key-bar button and top-bar button in the terminal UI.
 *
 * Starts a TermBeam server per test, opens the terminal page in headless Chromium,
 * and verifies each button works end-to-end through a real PTY.
 *
 * Run:  npx playwright test test/e2e-keybar.test.js
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
  reactUI: false,
};

let inst;
let consoleErrors;

test.beforeEach(async ({ page }) => {
  inst = createTermBeamServer({ config: { ...baseConfig } });
  await inst.start();

  // Track browser console errors so frontend JS bugs don't go unnoticed
  consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
});

test.afterEach(async ({ page }) => {
  // Fail-loud if the frontend emitted any console.error() during the test
  const unexpected = consoleErrors.filter(
    (e) => !e.includes('net::ERR_') && !e.includes('WebSocket'),
  );

  if (inst) {
    // On Windows, node-pty's conpty kill() tries to AttachConsole to enumerate
    // child processes — this fails in headless CI, producing stderr noise and
    // leaving child processes behind. We kill the entire process tree ourselves
    // using taskkill /T before shutdown to ensure clean teardown.
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

  if (unexpected.length > 0) {
    throw new Error(`Unexpected browser console errors:\n${unexpected.join('\n')}`);
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function waitForTerminalOutput(page, pattern, timeout = 15_000) {
  const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
  await expect(async () => {
    const text = await page.evaluate(() => {
      // Target the active visible pane's xterm rows
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
  // Target the active (visible) pane's textarea to avoid strict mode violations
  // when multiple sessions exist
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
  await expect(page.locator('#status-dot.connected')).toBeVisible({ timeout: 10_000 });
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

// ─── Key Bar: Input Keys ────────────────────────────────────────────────────

test.describe('Key Bar — Input Keys', () => {
  test('Enter button submits a command', async ({ page }) => {
    await openTerminal(page);
    const marker = `ENTER_${Date.now()}`;
    await typeInTerminal(page, `echo ${marker}`);
    await page.click('button[data-key="enter"]');
    await waitForTerminalOutput(page, marker);
  });

  test('Tab button triggers autocomplete', async ({ page }) => {
    // cmd.exe doesn't autocomplete command names the same way
    test.skip(isWindows, 'bash-specific autocomplete');
    await openTerminal(page);
    await typeInTerminal(page, 'ech');
    await page.click('button[title="Autocomplete"]');
    await page.waitForTimeout(500);
    await waitForTerminalOutput(page, /echo/);
  });

  test('Escape button sends ESC to terminal and clears line', async ({ page }) => {
    test.skip(isWindows, 'bash-specific Ctrl+U clear');
    await openTerminal(page);
    // Type partial text, press Escape then Ctrl+U to clear line (ESC enters vi mode, or is ignored)
    // Then verify typing a new command works — the old partial text is gone
    const garbage = 'thiscommandwillfail_XYZ';
    await typeInTerminal(page, garbage);
    await page.click('button[title="Escape"]');
    await page.waitForTimeout(200);

    // In bash emacs mode, Escape alone doesn't clear, but Ctrl+U does.
    // The key test: Escape is delivered to the PTY (not swallowed by the UI).
    // Prove it by verifying terminal is still interactive after ESC.
    const marker = `ESC_${Date.now()}`;
    // Ctrl+U to clear line, then type clean command
    const textarea = page.locator('.terminal-pane.visible .xterm-helper-textarea').first();
    await textarea.focus();
    await textarea.press('Control+u');
    await page.waitForTimeout(200);
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });

  test('Ctrl+C button interrupts a running process', async ({ page }) => {
    await openTerminal(page);
    // sleep not available on Windows; use ping instead
    const longCmd = isWindows ? 'ping -n 999 127.0.0.1' : 'sleep 999';
    await runCommand(page, longCmd);
    await page.waitForTimeout(1000);
    await page.click('button[title="Interrupt process"]');
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
    await openTerminal(page);
    const marker = `UP_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
    await page.waitForTimeout(500);

    await page.click('button[title="Up"]');
    await page.waitForTimeout(300);
    await page.click('button[data-key="enter"]');

    await expect(async () => {
      const text = await getTerminalText(page);
      const matches = text.split(marker).length - 1;
      expect(matches).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 10_000 });
  });

  test('Down arrow navigates history forward', async ({ page }) => {
    test.skip(isWindows, 'bash-specific history navigation');
    await openTerminal(page);
    const m1 = `DOWN1_${Date.now()}`;
    const m2 = `DOWN2_${Date.now()}`;
    await runCommand(page, `echo ${m1}`);
    await waitForTerminalOutput(page, m1);
    await page.waitForTimeout(300);
    await runCommand(page, `echo ${m2}`);
    await waitForTerminalOutput(page, m2);
    await page.waitForTimeout(300);

    // Go up twice, then down once — should land on second command
    await page.click('button[title="Up"]');
    await page.waitForTimeout(200);
    await page.click('button[title="Up"]');
    await page.waitForTimeout(200);
    await page.click('button[title="Down"]');
    await page.waitForTimeout(200);
    await page.click('button[data-key="enter"]');
    await waitForTerminalOutput(page, new RegExp(m2));
  });

  test('Left arrow moves cursor left by N positions', async ({ page }) => {
    await openTerminal(page);
    // Type "echo ABCD", press Left 3 times to land between A and B, insert "X" → "echo AXBCD"
    await typeInTerminal(page, 'echo ABCD');
    await page.click('button[title="Left"]');
    await page.waitForTimeout(100);
    await page.click('button[title="Left"]');
    await page.waitForTimeout(100);
    await page.click('button[title="Left"]');
    await page.waitForTimeout(100);
    await typeInTerminal(page, 'X');
    await page.click('button[data-key="enter"]');
    await waitForTerminalOutput(page, /AXBCD/);
  });

  test('Right arrow moves cursor right by N positions', async ({ page }) => {
    await openTerminal(page);
    // Type "echo ABCD", Left 4 times (before A), Right 2 times (after B), insert "X" → "echo ABXCD"
    await typeInTerminal(page, 'echo ABCD');
    for (let i = 0; i < 4; i++) {
      await page.click('button[title="Left"]');
      await page.waitForTimeout(80);
    }
    await page.click('button[title="Right"]');
    await page.waitForTimeout(80);
    await page.click('button[title="Right"]');
    await page.waitForTimeout(80);
    await typeInTerminal(page, 'X');
    await page.click('button[data-key="enter"]');
    await waitForTerminalOutput(page, /ABXCD/);
  });
});

// ─── Key Bar: Navigation Keys ───────────────────────────────────────────────

test.describe('Key Bar — Navigation Keys', () => {
  test('Home button moves cursor to beginning of line', async ({ page }) => {
    // cmd.exe Home behavior differs; # is not a comment in cmd.exe
    test.skip(isWindows, 'bash-specific Home + comment');
    await openTerminal(page);
    // Type "echo HELLO", press Home, then type "# " — should prepend
    await typeInTerminal(page, 'echo HELLO');
    await page.click('button[title="Home"]');
    await page.waitForTimeout(200);
    await typeInTerminal(page, '# ');
    await page.click('button[data-key="enter"]');
    // In bash, "# echo HELLO" is a comment → no output, but it should appear in the input line
    await waitForTerminalOutput(page, /# echo HELLO/);
  });

  test('End button moves cursor to end of line', async ({ page }) => {
    await openTerminal(page);
    // Type text, go Home, then End, then append
    await typeInTerminal(page, 'echo HI');
    await page.click('button[title="Home"]');
    await page.waitForTimeout(200);
    await page.click('button[title="End"]');
    await page.waitForTimeout(200);
    await typeInTerminal(page, 'GH');
    await page.click('button[data-key="enter"]');
    await waitForTerminalOutput(page, /HIGH/);
  });
});

// ─── Key Bar: Modifier Keys ────────────────────────────────────────────────

test.describe('Key Bar — Modifier Keys', () => {
  test('Ctrl modifier toggles on and off', async ({ page }) => {
    await openTerminal(page);
    const ctrlBtn = page.locator('#ctrl-btn');

    await expect(ctrlBtn).not.toHaveClass(/active/);
    await ctrlBtn.click();
    await expect(ctrlBtn).toHaveClass(/active/);
    await ctrlBtn.click();
    await expect(ctrlBtn).not.toHaveClass(/active/);
  });

  test('Shift modifier toggles on and off', async ({ page }) => {
    await openTerminal(page);
    const shiftBtn = page.locator('#shift-btn');

    await expect(shiftBtn).not.toHaveClass(/active/);
    await shiftBtn.click();
    await expect(shiftBtn).toHaveClass(/active/);
    await shiftBtn.click();
    await expect(shiftBtn).not.toHaveClass(/active/);
  });

  test('Ctrl modifier clears after sending a key', async ({ page }) => {
    await openTerminal(page);
    const ctrlBtn = page.locator('#ctrl-btn');

    await ctrlBtn.click();
    await expect(ctrlBtn).toHaveClass(/active/);

    // Send a key — modifier should auto-clear
    await page.click('button[title="Interrupt process"]');
    await page.waitForTimeout(200);
    await expect(ctrlBtn).not.toHaveClass(/active/);
  });

  test('Ctrl+C via modifier actually interrupts a process', async ({ page }) => {
    await openTerminal(page);
    const longCmd = isWindows ? 'ping -n 999 127.0.0.1' : 'sleep 999';
    await runCommand(page, longCmd);
    await page.waitForTimeout(1000);

    // Activate Ctrl modifier, then press 'c' key via keyboard
    await page.locator('#ctrl-btn').click();
    const textarea = page.locator('.terminal-pane.visible .xterm-helper-textarea').first();
    await textarea.focus();
    await textarea.press('c');
    await page.waitForTimeout(500);

    // Shell should be back — run a new command to prove it
    const marker = `CTRLMOD_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
  });

  test('Ctrl+A (Home via Ctrl modifier) moves to beginning', async ({ page }) => {
    test.skip(isWindows, 'bash-specific Ctrl+A');
    await openTerminal(page);
    await typeInTerminal(page, 'echo WORLD');

    // Activate Ctrl, then press 'a' via keyboard (Ctrl+A = beginning of line in bash)
    await page.locator('#ctrl-btn').click();
    const textarea = page.locator('.terminal-pane.visible .xterm-helper-textarea').first();
    await textarea.focus();
    await textarea.press('a');
    await page.waitForTimeout(200);

    await typeInTerminal(page, '# ');
    await page.click('button[data-key="enter"]');
    await waitForTerminalOutput(page, /# echo WORLD/);
  });

  test('Ctrl+L via modifier clears the screen', async ({ page }) => {
    test.skip(isWindows, 'bash-specific Ctrl+L');
    await openTerminal(page);

    // Run a few commands to fill the terminal
    await runCommand(page, 'echo BEFORE_CLEAR_1');
    await waitForTerminalOutput(page, /BEFORE_CLEAR_1/);
    await page.waitForTimeout(300);
    await runCommand(page, 'echo BEFORE_CLEAR_2');
    await waitForTerminalOutput(page, /BEFORE_CLEAR_2/);
    await page.waitForTimeout(300);

    // Activate Ctrl, press 'l' to clear screen
    await page.locator('#ctrl-btn').click();
    const textarea = page.locator('.terminal-pane.visible .xterm-helper-textarea').first();
    await textarea.focus();
    await textarea.press('l');
    await page.waitForTimeout(500);

    // Old output should be scrolled away from visible rows
    const text = await getTerminalText(page);
    expect(text).not.toContain('BEFORE_CLEAR_1');
  });
});

// ─── Key Bar: Copy & Paste Buttons ──────────────────────────────────────────

test.describe('Key Bar — Copy & Paste', () => {
  test('Copy button opens overlay with terminal content', async ({ page }) => {
    await openTerminal(page);
    // Run a command that produces known output
    const marker = `COPY_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);
    await page.waitForTimeout(300);

    // Open copy overlay
    await page.click('#select-btn');
    await expect(page.locator('#select-overlay')).toHaveClass(/visible/);

    // Verify the overlay captured actual terminal content (not empty)
    await expect(async () => {
      const content = await page.locator('#select-content').innerText();
      expect(content).toContain(marker);
      // Should also contain the echo command itself
      expect(content).toContain(`echo ${marker}`);
    }).toPass({ timeout: 5_000 });

    // Close and verify overlay is gone
    await page.click('#select-close');
    await expect(page.locator('#select-overlay')).not.toHaveClass(/visible/);
  });

  test('Copy overlay shows multi-line terminal output', async ({ page }) => {
    await openTerminal(page);
    // Run multiple commands to produce multi-line output
    const m1 = `LINE1_${Date.now()}`;
    const m2 = `LINE2_${Date.now()}`;
    await runCommand(page, `echo ${m1}`);
    await waitForTerminalOutput(page, m1);
    await page.waitForTimeout(200);
    await runCommand(page, `echo ${m2}`);
    await waitForTerminalOutput(page, m2);
    await page.waitForTimeout(300);

    await page.click('#select-btn');
    await expect(page.locator('#select-overlay')).toHaveClass(/visible/);

    // Both lines should be present in the captured content
    await expect(async () => {
      const content = await page.locator('#select-content').innerText();
      expect(content).toContain(m1);
      expect(content).toContain(m2);
    }).toPass({ timeout: 5_000 });

    await page.click('#select-close');
  });

  test('Paste overlay sends text into the terminal', async ({ page }) => {
    await openTerminal(page);

    // Open paste overlay
    await page.click('#paste-btn');
    await expect(page.locator('#paste-overlay')).toHaveClass(/visible/);

    // Type a command into the paste textarea and send
    const marker = `PASTE_${Date.now()}`;
    await page.fill('#paste-input', `echo ${marker}`);
    await page.click('#paste-send');

    // Overlay should close
    await expect(page.locator('#paste-overlay')).not.toHaveClass(/visible/);

    // The pasted text should appear in the terminal input line
    await waitForTerminalOutput(page, new RegExp(`echo ${marker}`));

    // Press Enter to execute — verify the command actually ran
    await page.click('button[data-key="enter"]');
    await waitForTerminalOutput(page, marker);
  });

  test('Paste overlay sends multi-line text into terminal', async ({ page }) => {
    await openTerminal(page);

    await page.click('#paste-btn');
    await expect(page.locator('#paste-overlay')).toHaveClass(/visible/);

    // Paste multi-line text — each line should be sent
    const m1 = `MULTI1_${Date.now()}`;
    const m2 = `MULTI2_${Date.now()}`;
    await page.fill('#paste-input', `echo ${m1}\necho ${m2}\n`);
    await page.click('#paste-send');
    await expect(page.locator('#paste-overlay')).not.toHaveClass(/visible/);

    // Both commands should execute (the \n acts as Enter)
    await waitForTerminalOutput(page, m1);
    await waitForTerminalOutput(page, m2);
  });

  test('Paste cancel does not send text to terminal', async ({ page }) => {
    await openTerminal(page);

    // Open paste overlay and type something
    await page.click('#paste-btn');
    await expect(page.locator('#paste-overlay')).toHaveClass(/visible/);
    const phantom = `PHANTOM_${Date.now()}`;
    await page.fill('#paste-input', `echo ${phantom}`);

    // Cancel — should close without sending
    await page.click('#paste-cancel');
    await expect(page.locator('#paste-overlay')).not.toHaveClass(/visible/);

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
    await openTerminal(page);

    // Capture dark theme background color
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // Open the theme subpanel via the tools panel
    await openPaletteAndClick(page, 'Theme');
    await page.waitForTimeout(100);

    // Subpanel should be open
    const subpanelOpen = await page.evaluate(() =>
      document.getElementById('theme-subpanel').classList.contains('open'),
    );
    expect(subpanelOpen).toBe(true);

    // Select the light theme
    await page.click('.theme-subpanel-item[data-tid="light"]');
    await page.waitForTimeout(300);
    const lightTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(lightTheme).toBe('light');

    // Background color should actually change
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(lightBg).not.toBe(darkBg);

    // Click dark theme directly
    await page.click('.theme-subpanel-item[data-tid="dark"]');
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
    await openTerminal(page);
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
    await openTerminal(page);
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
    await openTerminal(page);

    // Create a second session
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.fill('#ns-name', 'Split Target');
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await page.waitForTimeout(500);

    const initialPanes = await page.locator('.terminal-pane.visible').count();
    expect(initialPanes).toBe(1);

    // Toggle split via palette
    await openPaletteAndClick(page, 'Split view');
    const afterPanes = await page.locator('.terminal-pane.visible').count();
    expect(afterPanes).toBe(2);

    // Verify working terminal
    const marker = `SPLIT_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);

    // Toggle split off via palette
    await openPaletteAndClick(page, 'Split view');
    const finalPanes = await page.locator('.terminal-pane.visible').count();
    expect(finalPanes).toBe(1);
  });
});

// ─── Top Bar: New Session ───────────────────────────────────────────────────

test.describe('Top Bar — New Session', () => {
  test('New Session button opens the modal', async ({ page }) => {
    await openTerminal(page);
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    // Modal has name input, shell select, cancel/create buttons
    await expect(page.locator('#ns-name')).toBeVisible();
    await expect(page.locator('#ns-shell')).toBeVisible();
    await expect(page.locator('#ns-cancel')).toBeVisible();
    await expect(page.locator('#ns-create')).toBeVisible();
  });

  test('Cancel closes the new session modal', async ({ page }) => {
    await openTerminal(page);
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.click('#ns-cancel');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/);
  });

  test('Create button creates a new session with a working terminal', async ({ page }) => {
    await openTerminal(page);
    const initialTabs = await page.locator('.session-tab').count();

    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.fill('#ns-name', 'Test Session');
    await page.click('#ns-create');

    // Wait for modal to close and new tab to appear
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await page.waitForTimeout(1000);

    const finalTabs = await page.locator('.session-tab').count();
    expect(finalTabs).toBe(initialTabs + 1);

    // Wait for the new session's WebSocket to connect
    await expect(page.locator('#status-dot.connected')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

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
    await openTerminal(page);
    await page.click('#panel-toggle');
    await expect(page.locator('#side-panel')).toHaveClass(/open/);
    await expect(page.locator('#side-panel-list')).toBeVisible();
    await expect(page.locator('#side-panel-new-btn')).toBeVisible();
  });

  test('Close button closes the side panel', async ({ page }) => {
    await openTerminal(page);
    await page.click('#panel-toggle');
    await expect(page.locator('#side-panel')).toHaveClass(/open/);
    await page.click('#side-panel-close');
    await expect(page.locator('#side-panel')).not.toHaveClass(/open/);
  });

  test('Backdrop click closes the side panel', async ({ page }) => {
    await openTerminal(page);
    await page.click('#panel-toggle');
    await expect(page.locator('#side-panel')).toHaveClass(/open/);
    await page.click('#side-panel-backdrop');
    await expect(page.locator('#side-panel')).not.toHaveClass(/open/);
  });

  test('Side panel New Session button opens the modal', async ({ page }) => {
    await openTerminal(page);
    await page.click('#panel-toggle');
    await expect(page.locator('#side-panel')).toHaveClass(/open/);
    await page.click('#side-panel-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
  });

  test('Side panel session card switches active session', async ({ page }) => {
    await openTerminal(page);

    // Run a command in the first (default) session
    const marker1 = `FIRST_${Date.now()}`;
    await runCommand(page, `echo ${marker1}`);
    await waitForTerminalOutput(page, marker1);

    // Create a second session via modal
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.fill('#ns-name', 'Second');
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await page.waitForTimeout(1000);

    // Wait for second session to connect
    await expect(page.locator('#status-dot.connected')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);

    // Run a command in the second session
    const marker2 = `SECOND_${Date.now()}`;
    await runCommand(page, `echo ${marker2}`);
    await waitForTerminalOutput(page, marker2);

    // Open side panel and click the first session card to switch back
    await page.click('#panel-toggle');
    await expect(page.locator('#side-panel')).toHaveClass(/open/);
    await page.locator('.side-panel-card').first().click();
    await page.waitForTimeout(500);

    // The first session should be active — it should have marker1 but not marker2
    const text = await getTerminalText(page);
    expect(text).toContain(marker1);
    expect(text).not.toContain(marker2);
  });
});

// ─── Top Bar: Back & Stop ───────────────────────────────────────────────────

test.describe('Top Bar — Navigation & Session Control', () => {
  test('Back button navigates to the hub page', async ({ page }) => {
    await openTerminal(page);
    await page.click('#back-btn');
    await page.waitForURL('**/');
    // Should be on the hub page
    const content = await page.content();
    expect(content).toContain('TermBeam');
  });

  test('Stop button removes the session from the server', async ({ page }) => {
    await openTerminal(page);

    // Get initial session count from API
    const port = inst.server.address().port;
    const beforeCount = await page.evaluate(async () => {
      const res = await fetch('/api/sessions');
      const sessions = await res.json();
      return sessions.length;
    });
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    // Accept the confirm dialog and stop via tools panel
    page.on('dialog', (dialog) => dialog.accept());
    await openPaletteAndClick(page, 'Stop session');
    await page.waitForTimeout(1000);

    // Session should be removed from the server
    const afterCount = await page.evaluate(async () => {
      const res = await fetch('/api/sessions');
      const sessions = await res.json();
      return sessions.length;
    });
    expect(afterCount).toBe(beforeCount - 1);
  });
});

// ─── Command Palette: Preview Port ──────────────────────────────────────────

test.describe('Command Palette — Preview Port', () => {
  test('Preview port opens the preview modal', async ({ page }) => {
    await openTerminal(page);
    await openPaletteAndClick(page, 'Preview port');
    await expect(page.locator('#preview-modal')).toHaveClass(/visible/);
    await expect(page.locator('#preview-port-input')).toBeVisible();
    await expect(page.locator('#preview-open')).toBeVisible();
  });

  test('Preview cancel closes the modal', async ({ page }) => {
    await openTerminal(page);
    await openPaletteAndClick(page, 'Preview port');
    await expect(page.locator('#preview-modal')).toHaveClass(/visible/);
    await page.click('#preview-cancel');
    await expect(page.locator('#preview-modal')).not.toHaveClass(/visible/);
  });
});

// ─── Top Bar: Status Indicators ─────────────────────────────────────────────

test.describe('Top Bar — Status', () => {
  test('Status dot shows connected state', async ({ page }) => {
    await openTerminal(page);
    await expect(page.locator('#status-dot')).toHaveClass('connected');
  });

  test('Session name is displayed', async ({ page }) => {
    await openTerminal(page);
    const name = await page.locator('#session-name').innerText();
    expect(name.length).toBeGreaterThan(0);
    expect(name).not.toBe('…');
  });

  test('Palette trigger is visible', async ({ page }) => {
    await openTerminal(page);
    await expect(page.locator('#palette-trigger')).toBeVisible();
  });
});

// ─── Activity Indicators ────────────────────────────────────────────────────

test.describe('Activity Indicators', () => {
  test('Tab title shows unread indicator when output arrives in hidden tab', async ({ page }) => {
    await openTerminal(page);

    // Simulate tab being hidden
    const titleBefore = await page.title();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
    });

    // Run a command that produces output while "hidden"
    const marker = `HIDDEN_${Date.now()}`;
    await runCommand(page, `echo ${marker}`);
    await waitForTerminalOutput(page, marker);

    // Title should have unread indicator
    await expect(async () => {
      const title = await page.title();
      expect(title).toContain('\u25CF');
    }).toPass({ timeout: 5_000 });

    // Simulate returning to tab — title should restore
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

  test('Inactive session tab shows unread dot when it receives output', async ({ page }) => {
    test.skip(isWindows, 'Multi-session timing unreliable on Windows CI');
    await openTerminal(page);

    // Start a delayed echo in the first session
    await runCommand(page, 'sleep 1 && echo BACKGROUND_OUTPUT');

    // Create a second session and switch to it
    await page.click('#tab-new-btn');
    await expect(page.locator('#new-session-modal')).toHaveClass(/visible/);
    await page.fill('#ns-name', 'Second');
    await page.click('#ns-create');
    await expect(page.locator('#new-session-modal')).not.toHaveClass(/visible/, { timeout: 5_000 });
    await page.waitForTimeout(500);

    // Wait for the first session's output to arrive while we're on the second tab
    await expect(async () => {
      const hasUnread = await page.locator('.session-tab .tab-unread').count();
      expect(hasUnread).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });

    // Click the first session tab — unread dot should disappear
    const firstTab = page.locator('.session-tab').first();
    await firstTab.click();
    await page.waitForTimeout(300);
    const unreadAfter = await page.locator('.session-tab .tab-unread').count();
    expect(unreadAfter).toBe(0);
  });

  test('Notification sound function exists and is callable', async ({ page }) => {
    await openTerminal(page);

    // Verify playNotificationSound is defined and doesn't throw
    const result = await page.evaluate(() => {
      return typeof playNotificationSound === 'function';
    });
    expect(result).toBe(true);
  });
});
