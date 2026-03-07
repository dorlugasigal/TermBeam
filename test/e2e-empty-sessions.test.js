/**
 * E2E test — redirect to session hub when /terminal has no sessions.
 *
 * Run:  npx playwright test test/e2e-empty-sessions.test.js
 */
const { test, expect } = require('@playwright/test');
const { createTermBeamServer } = require('../src/server');

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

test.beforeEach(async () => {
  inst = createTermBeamServer({ config: { ...baseConfig } });
  await inst.start();
});

test.afterEach(async () => {
  if (inst) await inst.shutdown();
});

test('redirects from /terminal to session hub when no sessions exist', async ({ page }) => {
  const port = inst.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // Delete all sessions so the terminal page has nothing to show
  const res = await page.request.get(`${base}/api/sessions`);
  const sessions = await res.json();
  for (const s of sessions) {
    await page.request.delete(`${base}/api/sessions/${s.id}`);
  }

  // Navigate to /terminal — should redirect to /
  await page.goto(`${base}/terminal`);
  await expect(page).toHaveURL(`${base}/`, { timeout: 5_000 });
  await expect(page.locator('.empty-state')).toBeVisible();
});
