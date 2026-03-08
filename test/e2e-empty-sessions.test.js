/**
 * E2E test — React SPA shows empty-state hub when no sessions exist.
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

test('shows empty-state hub when no sessions exist', async ({ page }) => {
  const port = inst.server.address().port;
  const base = `http://127.0.0.1:${port}`;

  // Delete all auto-created sessions so the hub has nothing to show
  const res = await page.request.get(`${base}/api/sessions`);
  const sessions = await res.json();
  for (const s of sessions) {
    await page.request.delete(`${base}/api/sessions/${s.id}`);
  }

  // Navigate to the SPA root — with no sessions, the hub renders the empty state
  await page.goto(`${base}/`);
  const emptyText = page.getByText('No active sessions');
  await expect(emptyText).toBeVisible({ timeout: 5_000 });
});
