// @ts-check
const { defineConfig } = require('@playwright/test');

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './test',
  testMatch: 'e2e-*.test.js',
  timeout: isCI ? 60_000 : 30_000,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : 3, // parallelize across e2e files; CI is more conservative
  reporter: isCI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
