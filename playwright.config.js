// @ts-check
const { defineConfig } = require('@playwright/test');

const isCI = !!process.env.CI;

module.exports = defineConfig({
  testDir: './test',
  testMatch: 'e2e-*.test.js',
  timeout: 30_000,
  retries: isCI ? 1 : 0,
  workers: 1, // sequential — each test starts its own server
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
