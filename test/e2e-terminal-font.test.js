const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTermBeamServer } = require('../src/server');

let inst, configDir, previousConfigDir, baseURL, sessionId;

test.beforeAll(async () => {
  previousConfigDir = process.env.TERMBEAM_CONFIG_DIR;
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-e2e-font-'));
  process.env.TERMBEAM_CONFIG_DIR = configDir;
  // Use an existing dependency's real WOFF2 font; no extra binary fixture.
  const font = path.join(
    __dirname,
    '../src/frontend/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  );
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  inst = createTermBeamServer({
    config: {
      port: 0,
      host: '127.0.0.1',
      password: null,
      useTunnel: false,
      shell,
      defaultShell: shell,
      shellArgs: [],
      cwd: configDir,
      configDir,
      font,
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
  if (configDir)
    await fs.promises.rm(configDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
});

async function expectCustomFont(page) {
  await page.goto(`${baseURL}/terminal?session=${sessionId}`);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fonts = Array.from(document.fonts);
        return (
          fonts.some((font) => font.family === 'TermBeamCustomFont' && font.status === 'loaded') &&
          fonts.some((font) => font.family === 'NerdFont' && font.status === 'loaded') &&
          getComputedStyle(document.querySelector('.xterm-rows')).fontFamily.includes(
            'TermBeamCustomFont',
          )
        );
      }),
    )
    .toBe(true);
}

test('uses the configured WOFF2 font in the desktop terminal', async ({ page }) => {
  await expectCustomFont(page);
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('uses the configured WOFF2 font in the mobile terminal', async ({ page }) => {
    await expectCustomFont(page);
  });
});
