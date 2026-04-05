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

const CAPTURE_FPS = 20;
const OUTPUT_FPS = 30;

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
  return apiRequest('POST', '/api/sessions', {
    name,
    cwd: '/Users/dorlugasigal/Projects/termbeam',
  });
}

async function deleteSession(id) {
  return apiRequest('DELETE', `/api/sessions/${id}`);
}

async function openContext(browser, size) {
  return browser.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    permissions: [],
  });
}

async function startCapture(page) {
  const interval = 1000 / CAPTURE_FPS;
  const dir = path.join(TEMP_DIR, `frames-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  let frameNum = 0;
  let running = true;

  const captureLoop = async () => {
    while (running) {
      const framePath = path.join(dir, `frame-${String(frameNum).padStart(5, '0')}.png`);
      const start = Date.now();
      await page.screenshot({ path: framePath }).catch(() => {});
      frameNum++;
      const elapsed = Date.now() - start;
      const wait = Math.max(0, interval - elapsed);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  };

  const promise = captureLoop();
  return {
    dir,
    frameCount: () => frameNum,
    stop: async () => {
      running = false;
      await promise;
    },
  };
}

async function saveVideo(capture, outputName) {
  await capture.stop();
  const mp4Path = path.join(SHOWCASE_DIR, outputName);
  execSync(
    `"${FFMPEG}" -y -framerate ${CAPTURE_FPS} -i "${capture.dir}/frame-%05d.png" ` +
      `-c:v libx264 -crf 22 -preset slow -r ${OUTPUT_FPS} ` +
      `-an -movflags +faststart -pix_fmt yuv420p "${mp4Path}"`,
    { stdio: 'pipe' }
  );
  fs.rmSync(capture.dir, { recursive: true, force: true });
  const stat = fs.statSync(mp4Path);
  const dur = execSync(
    `"${FFMPEG}" -i "${mp4Path}" 2>&1 | grep Duration | sed 's/.*Duration: //' | sed 's/,.*//'`
  )
    .toString()
    .trim();
  console.log(`  ✓ ${outputName} — ${dur} — ${(stat.size / 1024).toFixed(0)} KB`);
}

async function focusTerminal(page, timeout = 5000) {
  await page
    .waitForFunction(
      () => {
        const rows = document.querySelector('.xterm-rows');
        return rows && rows.textContent && rows.textContent.trim().length > 5;
      },
      { timeout }
    )
    .catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.xterm-screen').first().click().catch(() => {});
  await page.waitForTimeout(150);
}

async function cleanupSessions() {
  const sessions = await apiRequest('GET', '/api/sessions');
  if (Array.isArray(sessions)) {
    for (const s of sessions) await deleteSession(s.id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Recording functions — each showcases the ACTUAL UI feature
// ---------------------------------------------------------------------------

// 01: Sessions Hub → click a session → view its terminal
async function recordHubMobile(browser) {
  console.log('Recording hub-mobile — Sessions Hub → open session...');
  await cleanupSessions();
  const sessions = [];
  for (const name of ['api-server', 'frontend', 'deploy']) {
    sessions.push(await createSession(name));
  }

  const context = await openContext(browser, MOBILE);
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="sessions-list"]', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const capture = await startCapture(page);
    // Show the hub with session cards
    await page.waitForTimeout(1800);
    // Click a session card to open its terminal
    const card = page.locator('[data-testid="session-card"]').first();
    await card.click().catch(() => {});
    // Wait for terminal to load
    await page.waitForTimeout(2500);
    await saveVideo(capture, 'hub-mobile.mp4');
    await context.close();
  } finally {
    for (const s of sessions) await deleteSession(s.id).catch(() => {});
  }
}

// 02: AI Agents — open new session → click Claude Code agent card
async function recordAgentsDesktop(browser) {
  console.log('Recording agents-desktop — New session → launch Claude Code...');
  await cleanupSessions();
  const s = await createSession('workspace');

  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);

    const capture = await startCapture(page);
    await page.waitForTimeout(1000);
    // Open new session modal
    const btn = page.locator('[data-testid="hub-new-session-btn"]');
    await btn.waitFor({ timeout: 5000 }).catch(() => {});
    await btn.click().catch(() => {});
    await page.waitForSelector('[data-testid="new-session-modal"]', { timeout: 5000 }).catch(
      () => {}
    );
    await page.waitForTimeout(1200);
    // Look for Claude Code agent card and click it
    const claudeCard = page.locator('button:has-text("Claude")').first();
    const hasClaudeCard = await claudeCard.count();
    if (hasClaudeCard > 0) {
      await claudeCard.click().catch(() => {});
      await page.waitForTimeout(2500);
    } else {
      // If no agents available, type name and show the modal
      const nameInput = page.locator('[data-testid="ns-name"]');
      await nameInput.type('claude-code', { delay: 60 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    await saveVideo(capture, 'agents-desktop.mp4');
    await context.close();
  } finally {
    await deleteSession(s.id).catch(() => {});
  }
}

// 03: Mobile Terminal — interact with touch bar: arrows, enter, tab
async function recordTerminalMobile(browser) {
  console.log('Recording terminal-mobile — Touch bar key interactions...');
  await cleanupSessions();
  const session = await createSession('dev');
  const context = await openContext(browser, MOBILE);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    await focusTerminal(page);

    const capture = await startCapture(page);
    // Type a command to show terminal is live
    await page.keyboard.type('ls', { delay: 60 });
    await page.waitForTimeout(300);
    // Tap Tab on touch bar for autocomplete
    const tabBtn = page.locator('button:has-text("Tab")').first();
    await tabBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    // Tap Enter on touch bar
    const enterBtn = page.locator('button:has-text("↵")').first();
    await enterBtn.click().catch(() => {});
    await page.waitForTimeout(800);
    // Tap arrow up to recall previous command
    const upArrow = page.locator('button:has-text("↑")').first();
    await upArrow.click().catch(() => {});
    await page.waitForTimeout(500);
    // Tap arrow down
    const downArrow = page.locator('button:has-text("↓")').first();
    await downArrow.click().catch(() => {});
    await page.waitForTimeout(400);
    // Tap Ctrl to show modifier toggle
    const ctrlBtn = page.locator('[data-testid="ctrl-btn"]');
    await ctrlBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    // Type 'c' for Ctrl+C
    await page.keyboard.type('c');
    await page.waitForTimeout(400);
    // Deactivate Ctrl
    await ctrlBtn.click().catch(() => {});
    await page.waitForTimeout(400);
    await saveVideo(capture, 'terminal-mobile.mp4');
    await context.close();
  } finally {
    await deleteSession(session.id).catch(() => {});
  }
}

// 04: Voice — press mic, then paste a predefined message as if dictated
async function recordVoiceMobile(browser) {
  console.log('Recording voice-mobile — Mic press → voice dictation...');
  await cleanupSessions();
  const session = await createSession('voice-demo');
  const context = await openContext(browser, MOBILE);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    await focusTerminal(page);
    // Have some content in terminal
    await page.keyboard.type('echo "ready"', { delay: 25 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    const capture = await startCapture(page);
    await page.waitForTimeout(600);
    // Press and hold mic button to show recording state
    const micBtn = page.locator('[data-testid="mic-btn"]');
    await micBtn.waitFor({ timeout: 5000 }).catch(() => {});
    const box = await micBtn.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(1800);
      await page.mouse.up();
    }
    await page.waitForTimeout(400);
    // Simulate voice result: type the "dictated" command
    await focusTerminal(page, 2000);
    await page.keyboard.type('git status', { delay: 80 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await saveVideo(capture, 'voice-mobile.mp4');
    await context.close();
  } finally {
    await deleteSession(session.id).catch(() => {});
  }
}

// 05: Workspace — tabs + command palette + split view
async function recordSessionsDesktop(browser) {
  console.log('Recording sessions-desktop — Workspace with tabs & palette...');
  await cleanupSessions();
  const sessions = [];
  for (const name of ['frontend', 'backend', 'deploy']) {
    sessions.push(await createSession(name));
  }
  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${sessions[0].id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    await focusTerminal(page, 3000);
    await page.keyboard.type('npm run dev', { delay: 25 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const capture = await startCapture(page);
    await page.waitForTimeout(600);
    // Switch tabs to show multi-session workspace
    const tabs = page.locator('[data-testid="session-tab"]');
    const tabCount = await tabs.count();
    if (tabCount > 1) {
      await tabs.nth(1).click();
      await page.waitForTimeout(800);
    }
    if (tabCount > 2) {
      await tabs.nth(2).click();
      await page.waitForTimeout(800);
    }
    // Open command palette to show rich tooling
    const paletteTrigger = page.locator('[data-testid="palette-trigger"]');
    await paletteTrigger.click().catch(() => {});
    await page.waitForTimeout(1500);
    // Close palette
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // Back to first tab
    if (tabCount > 0) {
      await tabs.nth(0).click();
      await page.waitForTimeout(600);
    }
    await saveVideo(capture, 'sessions-desktop.mp4');
    await context.close();
  } finally {
    for (const s of sessions) await deleteSession(s.id).catch(() => {});
  }
}

// 06: Resume — open resume browser, see agent sessions, click one
async function recordResumeDesktop(browser) {
  console.log('Recording resume-desktop — Resume browser with agent sessions...');
  await cleanupSessions();
  const session = await createSession('main');
  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();

  try {
    // Navigate to a terminal page first (resume browser opens from terminal)
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    await focusTerminal(page, 3000);

    const capture = await startCapture(page);
    await page.waitForTimeout(500);
    // Open command palette
    const paletteTrigger = page.locator('[data-testid="palette-trigger"]');
    await paletteTrigger.click().catch(() => {});
    await page.waitForTimeout(800);
    // Click "Resume agent session" action in palette
    const resumeAction = page.locator('[data-testid="palette-action"]:has-text("Resume")').first();
    const hasResumeAction = await resumeAction.count();
    if (hasResumeAction > 0) {
      await resumeAction.click().catch(() => {});
      await page.waitForTimeout(2000);
      // The resume browser should now be open showing agent sessions
      // Click a session if available
      const resumeCard = page.locator('button:has-text("Untitled")').first();
      const hasCard = await resumeCard.count();
      if (hasCard > 0) {
        await resumeCard.click().catch(() => {});
        await page.waitForTimeout(1500);
      } else {
        await page.waitForTimeout(1500);
      }
    } else {
      // Fallback: close palette and show hub instead
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
    }
    await saveVideo(capture, 'resume-desktop.mp4');
    await context.close();
  } finally {
    await deleteSession(session.id).catch(() => {});
  }
}

// 07: Git Diff — open code viewer → git changes → click a non-binary file
async function recordGitdiffDesktop(browser) {
  console.log('Recording gitdiff-desktop — Code viewer → git changes → diff...');
  await cleanupSessions();
  const session = await createSession('git-review');
  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    await focusTerminal(page, 3000);

    const capture = await startCapture(page);
    await page.waitForTimeout(500);
    // Open command palette
    const paletteTrigger = page.locator('[data-testid="palette-trigger"]');
    await paletteTrigger.click().catch(() => {});
    await page.waitForTimeout(800);
    // Click "Git changes" action
    const gitAction = page.locator('[data-testid="palette-action"]:has-text("Git changes")').first();
    const hasGitAction = await gitAction.count();
    if (hasGitAction > 0) {
      await gitAction.click().catch(() => {});
      await page.waitForTimeout(1500);
      // Code viewer opens with git changes panel — click a non-binary file
      // Look for files with .js, .ts, .json, .css, .md extensions
      const fileButtons = page.locator('button[aria-label*=".js"], button[aria-label*=".ts"], button[aria-label*=".json"], button[aria-label*=".css"], button[aria-label*=".md"], button[aria-label*=".cjs"]');
      const fileCount = await fileButtons.count();
      if (fileCount > 0) {
        await fileButtons.first().click();
        await page.waitForTimeout(2000);
        // Click a second file if available
        if (fileCount > 1) {
          await fileButtons.nth(1).click();
          await page.waitForTimeout(1500);
        }
      } else {
        await page.waitForTimeout(2000);
      }
    } else {
      // Fallback: open "View code" instead
      const codeAction = page.locator('[data-testid="palette-action"]:has-text("View code")').first();
      if ((await codeAction.count()) > 0) {
        await codeAction.click().catch(() => {});
        await page.waitForTimeout(1500);
        // Switch to changes tab
        const changesTab = page.locator('button:has-text("Changes")').first();
        if ((await changesTab.count()) > 0) {
          await changesTab.click().catch(() => {});
          await page.waitForTimeout(2000);
        }
      }
      await page.waitForTimeout(1500);
    }
    await saveVideo(capture, 'gitdiff-desktop.mp4');
    await context.close();
  } finally {
    await deleteSession(session.id).catch(() => {});
  }
}

// 08: Files & Clipboard — code viewer file explorer, browse files
async function recordUploadDesktop(browser) {
  console.log('Recording upload-desktop — Code viewer file explorer...');
  await cleanupSessions();
  const session = await createSession('files');
  const context = await openContext(browser, DESKTOP);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE_URL}/terminal?session=${session.id}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(2500);
    await focusTerminal(page, 3000);

    const capture = await startCapture(page);
    await page.waitForTimeout(500);
    // Open command palette
    const paletteTrigger = page.locator('[data-testid="palette-trigger"]');
    await paletteTrigger.click().catch(() => {});
    await page.waitForTimeout(800);
    // Click "View code" to open file explorer
    const codeAction = page.locator('[data-testid="palette-action"]:has-text("View code")').first();
    const hasCodeAction = await codeAction.count();
    if (hasCodeAction > 0) {
      await codeAction.click().catch(() => {});
      await page.waitForTimeout(1500);
      // Click on src/ folder to expand it
      const srcFolder = page.locator('button:has-text("src")').first();
      if ((await srcFolder.count()) > 0) {
        await srcFolder.click().catch(() => {});
        await page.waitForTimeout(800);
      }
      // Click on a JS/TS file to view it
      const jsFile = page.locator('button:has-text(".js")').first();
      if ((await jsFile.count()) > 0) {
        await jsFile.click().catch(() => {});
        await page.waitForTimeout(2000);
      } else {
        await page.waitForTimeout(1500);
      }
    } else {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      // Fallback to terminal file listing
      await focusTerminal(page, 2000);
      await page.keyboard.type('ls -la --color', { delay: 30 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2500);
    }
    await saveVideo(capture, 'upload-desktop.mp4');
    await context.close();
  } finally {
    await deleteSession(session.id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(SHOWCASE_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  console.log(`Output directory: ${SHOWCASE_DIR}`);
  console.log(`Temp directory:   ${TEMP_DIR}`);
  console.log(`Capture FPS:      ${CAPTURE_FPS}`);
  console.log(`Output FPS:       ${OUTPUT_FPS}\n`);

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
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }

  console.log('\n✅ All 8 showcase videos recorded and optimized!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
