#!/usr/bin/env node
'use strict';

const { chromium } = require(
  require.resolve('playwright', { paths: ['/Users/dorlugasigal/Projects/termbeam'] })
);
const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3456';
const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const SHOWCASE_DIR = path.join(__dirname, '..', 'public', 'showcase');
const TEMP_DIR = path.join(__dirname, '..', '.video-tmp');

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 720 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function createSession(name) {
  const res = await apiRequest('POST', '/api/sessions', {
    name,
    cwd: '/Users/dorlugasigal/Projects/termbeam',
  });
  return res;
}

async function deleteSession(id) {
  return apiRequest('DELETE', `/api/sessions/${id}`);
}

function convertToMp4(input, output) {
  execSync(
    `"${FFMPEG}" -y -i "${input}" -c:v libx264 -crf 18 -preset slow ` +
      `-an -movflags +faststart -pix_fmt yuv420p "${output}"`,
    { stdio: 'pipe' }
  );
}

async function openContext(browser, size) {
  const dir = path.join(TEMP_DIR, `ctx-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const recordSize = { width: size.width * 2, height: size.height * 2 };
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    recordVideo: { dir, size: recordSize },
    // Suppress permission prompts (microphone etc.)
    permissions: [],
  });
  return context;
}

async function finalize(page, context, outputName) {
  const videoPath = await page.video().path();
  await context.close(); // triggers video save
  const mp4Path = path.join(SHOWCASE_DIR, outputName);
  convertToMp4(videoPath, mp4Path);
  const stat = fs.statSync(mp4Path);
  console.log(`  ✓ ${outputName} (${(stat.size / 1024).toFixed(0)} KB)`);
}

async function focusTerminal(page) {
  await page.locator('.xterm-helper-textarea').first().focus();
}

async function typeCommand(page, cmd) {
  await focusTerminal(page);
  await page.keyboard.type(cmd, { delay: 30 });
  await page.keyboard.press('Enter');
}

// ---------------------------------------------------------------------------
// Recording functions — each showcases a REAL UI feature
// ---------------------------------------------------------------------------

async function recordHubMobile(browser) {
  console.log('Recording hub-mobile — Sessions Hub with session cards...');
  // Create a few sessions so the hub looks populated
  const sessions = [];
  for (const name of ['api-server', 'frontend', 'deploy']) {
    sessions.push(await createSession(name));
  }

  const context = await openContext(browser, MOBILE);
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    // Show the populated sessions list
    await page.waitForSelector('[data-testid="sessions-list"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // Tap the new session button to show the modal
    const newBtn = page.locator('[data-testid="hub-new-session-btn"]');
    await newBtn.click().catch(() => {});
    await page.waitForTimeout(2500);
    await finalize(page, context, 'hub-mobile.mp4');
  } finally {
    for (const s of sessions) await deleteSession(s.id).catch(() => {});
  }
}

async function recordAgentsDesktop(browser) {
  console.log('Recording agents-desktop — Agent launcher modal...');
  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Open new session modal to show agent launcher
  const btn = page.locator('[data-testid="hub-new-session-btn"]');
  await btn.waitFor({ timeout: 5000 }).catch(() => {});
  await btn.click().catch(() => {});
  await page.waitForTimeout(1000);
  await page.waitForSelector('[data-testid="new-session-modal"]', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // Type a session name
  const nameInput = page.locator('[data-testid="ns-name"]');
  await nameInput.fill('my-project').catch(() => {});
  await page.waitForTimeout(1000);
  // Click a color option
  const colorBtn = page.locator('button[aria-label*="Color"]').first();
  await colorBtn.click().catch(() => {});
  await page.waitForTimeout(2000);
  await finalize(page, context, 'agents-desktop.mp4');
}

async function recordTerminalMobile(browser) {
  console.log('Recording terminal-mobile — Touch bar interactions...');
  const session = await createSession('demo-terminal');
  const context = await openContext(browser, MOBILE);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    // Type a command
    await typeCommand(page, 'echo "Hello from TermBeam"');
    await page.waitForTimeout(1000);
    // Tap touch bar buttons to demonstrate them
    const ctrlBtn = page.locator('[data-testid="ctrl-btn"]');
    await ctrlBtn.click().catch(() => {});
    await page.waitForTimeout(600);
    await ctrlBtn.click().catch(() => {}); // toggle off
    await page.waitForTimeout(400);
    // Tap Tab key on touch bar
    const tabBtn = page.locator('button:has-text("Tab")').first();
    await tabBtn.click().catch(() => {});
    await page.waitForTimeout(600);
    // Tap up arrow
    const upBtn = page.locator('button:has-text("↑")').first();
    await upBtn.click().catch(() => {});
    await page.waitForTimeout(600);
    // Type another command
    await typeCommand(page, 'ls -la');
    await page.waitForTimeout(1500);
    await finalize(page, context, 'terminal-mobile.mp4');
  } finally {
    await deleteSession(session.id);
  }
}

async function recordVoiceMobile(browser) {
  console.log('Recording voice-mobile — Mic button press & hold...');
  const session = await createSession('demo-voice');
  const context = await openContext(browser, MOBILE);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    await typeCommand(page, 'git log --oneline -5');
    await page.waitForTimeout(1500);
    await typeCommand(page, 'echo "✓ All tests passed"');
    await page.waitForTimeout(1000);

    // Press and hold mic button to show recording state
    const micBtn = page.locator('[data-testid="mic-btn"]');
    await micBtn.waitFor({ timeout: 3000 }).catch(() => {});
    await micBtn.dispatchEvent('mousedown');
    await page.waitForTimeout(2500); // Show the red recording indicator
    await micBtn.dispatchEvent('mouseup');
    await page.waitForTimeout(1000);
    await finalize(page, context, 'voice-mobile.mp4');
  } finally {
    await deleteSession(session.id);
  }
}

async function recordSessionsDesktop(browser) {
  console.log('Recording sessions-desktop — Multi-tab workspace...');
  // Create multiple sessions to show tabs
  const sessions = [];
  for (const name of ['frontend', 'backend', 'deploy']) {
    sessions.push(await createSession(name));
  }

  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();

  try {
    // Open first session's terminal
    await page.goto(`${BASE_URL}/terminal?session=${sessions[0].id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2000);
    await typeCommand(page, 'npm run dev');
    await page.waitForTimeout(1500);

    // Click tab for second session
    const tabs = page.locator('[data-testid="session-tab"]');
    const tabCount = await tabs.count();
    if (tabCount > 1) {
      await tabs.nth(1).click();
      await page.waitForTimeout(1500);
      await typeCommand(page, 'node server.js');
      await page.waitForTimeout(1000);
      // Switch to third tab
      if (tabCount > 2) {
        await tabs.nth(2).click();
        await page.waitForTimeout(1500);
      }
    }
    await finalize(page, context, 'sessions-desktop.mp4');
  } finally {
    for (const s of sessions) await deleteSession(s.id).catch(() => {});
  }
}

async function recordResumeDesktop(browser) {
  console.log('Recording resume-desktop — Session list & reconnect...');
  // Create sessions with some terminal history
  const s1 = await createSession('api-server');
  const s2 = await createSession('debug-logs');
  const s3 = await createSession('monitoring');

  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();

  try {
    // Show sessions hub with multiple sessions
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.waitForSelector('[data-testid="sessions-list"]', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Click a session card to resume it
    const card = page.locator('[data-testid="session-card"]').first();
    await card.waitFor({ timeout: 3000 }).catch(() => {});
    await card.click().catch(() => {});
    await page.waitForTimeout(2500);
    await finalize(page, context, 'resume-desktop.mp4');
  } finally {
    await deleteSession(s1.id).catch(() => {});
    await deleteSession(s2.id).catch(() => {});
    await deleteSession(s3.id).catch(() => {});
  }
}

async function recordGitdiffDesktop(browser) {
  console.log('Recording gitdiff-desktop — Git panel & diff viewer...');
  const session = await createSession('demo-diff');
  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);

    // Open command palette and look for git/file explorer
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(800);
    // Look for a "Git" or "Explorer" action in the palette
    const gitAction = page.locator('[data-testid="palette-action"]:has-text("Git"), [data-testid="palette-action"]:has-text("git"), [data-testid="palette-action"]:has-text("Explorer"), [data-testid="palette-action"]:has-text("explorer")').first();
    await gitAction.click().catch(async () => {
      // Close palette and try the git changes tab directly
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    });
    await page.waitForTimeout(800);

    // Try clicking the Git changes tab in the side panel / code viewer
    const gitTab = page.locator('button[aria-label="Git changes"]').first();
    await gitTab.click().catch(() => {});
    await page.waitForTimeout(1500);

    // Click a modified file to show the diff
    const modifiedFile = page.locator('button[aria-label*="(M)"], button[aria-label*="modified"]').first();
    await modifiedFile.click().catch(() => {});
    await page.waitForTimeout(2500);

    await finalize(page, context, 'gitdiff-desktop.mp4');
  } finally {
    await deleteSession(session.id);
  }
}

async function recordUploadDesktop(browser) {
  console.log('Recording upload-desktop — File browser & explorer...');
  const session = await createSession('demo-files');
  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);

    // Open command palette to access file explorer
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(800);
    const explorerAction = page.locator('[data-testid="palette-action"]:has-text("Explorer"), [data-testid="palette-action"]:has-text("File"), [data-testid="palette-action"]:has-text("Browse")').first();
    await explorerAction.click().catch(async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    });
    await page.waitForTimeout(800);

    // Try clicking the file explorer tab
    const fileTab = page.locator('button[aria-label="File explorer"]').first();
    await fileTab.click().catch(() => {});
    await page.waitForTimeout(1500);

    // Click on a file/folder to navigate
    const fileItem = page.locator('button[aria-label*="src"], button[aria-label*="package"]').first();
    await fileItem.click().catch(() => {});
    await page.waitForTimeout(1500);

    // Click another item
    const fileItem2 = page.locator('button[aria-label*=".js"], button[aria-label*=".json"]').first();
    await fileItem2.click().catch(() => {});
    await page.waitForTimeout(2000);

    await finalize(page, context, 'upload-desktop.mp4');
  } finally {
    await deleteSession(session.id);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(SHOWCASE_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  console.log(`Output directory: ${SHOWCASE_DIR}`);
  console.log(`Temp directory:   ${TEMP_DIR}\n`);

  const browser = await chromium.launch({ headless: true });

  try {
    await recordHubMobile(browser);
    await recordAgentsDesktop(browser);
    await recordTerminalMobile(browser);
    await recordVoiceMobile(browser);
    await recordSessionsDesktop(browser);
    await recordResumeDesktop(browser);
    await recordGitdiffDesktop(browser);
    await recordUploadDesktop(browser);
  } finally {
    await browser.close();
    // Clean up temp recordings
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  console.log('\n✅ All 8 showcase videos recorded and optimized!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
