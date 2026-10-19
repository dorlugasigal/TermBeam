const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTermBeamServer } = require('../src/server');

let inst, configDir, previousConfigDir, baseURL, sessionId;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeAll(async () => {
  previousConfigDir = process.env.TERMBEAM_CONFIG_DIR;
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-e2e-keyboard-'));
  process.env.TERMBEAM_CONFIG_DIR = configDir;
  const fixture = path.join(configDir, 'bottom-input.cjs');
  // A real PTY application with a bottom-anchored input, like Codex. Repaint
  // on SIGWINCH and echo keystrokes so the test covers sizing end to end.
  fs.writeFileSync(
    fixture,
    `let input = '';
process.stdin.setRawMode(true);
function render() {
  const rows = process.stdout.rows;
  const promptRow = Math.max(1, rows - 2);
  process.stdout.write('\\x1b[2J\\x1b[HBottom input fixture' +
    '\\x1b[' + promptRow + ';1H> ' + input +
    '\\x1b[' + rows + ';1HSIZE:' + process.stdout.columns + 'x' + rows +
    '\\x1b[' + promptRow + ';' + (input.length + 3) + 'H');
}
process.stdout.on('resize', render);
process.stdin.on('data', data => { input = (input + data.toString()).slice(-32); render(); });
render();
`,
  );
  inst = createTermBeamServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      password: null,
      useTunnel: false,
      shell: process.execPath,
      defaultShell: process.execPath,
      shellArgs: [fixture],
      cwd: configDir,
      configDir,
      version: '0.1.0-test',
      logLevel: 'error',
    },
  });
  ({ defaultId: sessionId } = await inst.start());
  baseURL = `http://127.0.0.1:${inst.server.address().port}`;
});

test.afterAll(async () => {
  await inst?.shutdown();
  if (previousConfigDir === undefined) delete process.env.TERMBEAM_CONFIG_DIR;
  else process.env.TERMBEAM_CONFIG_DIR = previousConfigDir;
  if (configDir) await fs.promises.rm(configDir, { recursive: true, force: true, maxRetries: 5 });
});

for (const mode of ['resizes-content', 'resizes-visual', 'panned-visual']) {
  test(`keeps a bottom input visible with ${mode}`, async ({ page }) => {
    await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), {
        height: 844,
        width: 390,
        offsetTop: 0,
      });
      Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    });
    await page.goto(`${baseURL}/terminal?session=${sessionId}`);
    const rows = page.locator('.xterm-rows');
    await expect(rows).toContainText('SIZE:');
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.fonts).some(
            (font) => font.family === 'NerdFont' && font.status === 'loaded',
          ),
        ),
      )
      .toBe(true);
    const beforeRows = inst.sessions.get(sessionId)._lastRows;
    await page.locator('.xterm-helper-textarea').focus();

    if (mode === 'resizes-content') await page.setViewportSize({ width: 390, height: 504 });
    await page.evaluate((mode) => {
      window.visualViewport.height = 504;
      window.visualViewport.dispatchEvent(new Event('resize'));
      if (mode === 'panned-visual') {
        window.visualViewport.offsetTop = 120;
        window.visualViewport.dispatchEvent(new Event('scroll'));
      }
    }, mode);
    await expect(page.getByTestId('terminal-app')).toHaveAttribute('data-keyboard-open', 'true');
    await expect
      .poll(() => {
        const count = inst.sessions.get(sessionId)._lastRows;
        return count > 5 && count < beforeRows;
      })
      .toBe(true);
    const input = `input-${mode}`;
    await page.keyboard.type(input);
    await expect(rows).toContainText(input);
    await expect
      .poll(async () => {
        const count = inst.sessions.get(sessionId)._lastRows;
        return (
          (await rows.innerText()).includes(
            `SIZE:${inst.sessions.get(sessionId)._lastCols}x${count}`,
          ) && (await rows.locator(':scope > div').count()) === count
        );
      })
      .toBe(true);
    const openRows = inst.sessions.get(sessionId)._lastRows;

    // Compare the actual terminal and TouchBar rectangles to the simulated
    // visible viewport, including its scroll offset.
    const geometry = await page.evaluate(() => {
      const terminal = document.querySelector('.xterm-screen').getBoundingClientRect();
      const touchbar = document.querySelector('[data-collapsed]').getBoundingClientRect();
      const viewport = window.visualViewport;
      return {
        terminalBottom: terminal.bottom,
        touchbarTop: touchbar.top,
        touchbarBottom: touchbar.bottom,
        visibleBottom: viewport.offsetTop + viewport.height,
      };
    });
    expect(geometry.terminalBottom).toBeLessThanOrEqual(geometry.touchbarTop + 1);
    expect(Math.abs(geometry.touchbarBottom - geometry.visibleBottom)).toBeLessThanOrEqual(1);

    // Closing the keyboard restores the available terminal rows and the PTY.
    if (mode === 'resizes-content') await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      window.visualViewport.height = 844;
      window.visualViewport.offsetTop = 0;
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await expect(page.getByTestId('terminal-app')).not.toHaveAttribute('data-keyboard-open');
    await expect.poll(() => inst.sessions.get(sessionId)._lastRows).toBeGreaterThan(openRows);
    await expect(rows).toContainText(input);
  });
}
