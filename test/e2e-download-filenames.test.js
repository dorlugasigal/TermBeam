const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupSharedServer, getBaseURL, baseConfig } = require('./e2e-helpers');

const state = setupSharedServer(test);

test('downloads Unicode filenames without changing file bytes', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-e2e-download-'));
  const names = ['한글 보고서.md', '日本語 中文.txt', '결과 🚀.json', 'literal%20한글.txt'];
  const content = Buffer.concat([Buffer.from('한글 UTF-8 본문\n'), Buffer.from([0, 255, 128])]);
  const sessionId = state.inst.sessions.create({
    name: 'Downloads',
    shell: baseConfig.shell,
    args: [],
    cwd: dir,
  });
  try {
    for (const name of names) fs.writeFileSync(path.join(dir, name), content);
    await page.goto(`${getBaseURL(state)}/terminal?session=${sessionId}`);
    await page.getByTestId('palette-trigger').click();
    await page.getByRole('button', { name: 'Download file', exact: true }).click();

    for (const name of names) {
      await page.getByTitle(`Download ${name}`, { exact: true }).click();
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const download = await event;
      expect(download.suggestedFilename()).toBe(name);
      expect(fs.readFileSync(await download.path())).toEqual(content);
    }
  } finally {
    state.inst.sessions.delete(sessionId);
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
