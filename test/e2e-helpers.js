/**
 * Shared E2E server helper.
 *
 * Starts a single TermBeam server per test file (via `setupSharedServer(test)`)
 * and resets it to a clean "1 default session" state between tests. Avoids
 * paying the full `createTermBeamServer().start()` cost on every test, which
 * dominates wall-clock time in the e2e suite.
 *
 * The reset mimics what `inst.start()` produces: exactly one auto-created
 * session named after the cwd basename, using the configured shell.
 *
 * Tests get isolation by:
 *   - Playwright giving each test a fresh browser context (cookies/localStorage)
 *   - This helper deleting all sessions and recreating exactly one default
 *   - Per-test console error tracking (asserted in afterEach)
 *
 * This file is intentionally NOT named `*.test.js` so it isn't discovered by
 * Playwright's testMatch ('e2e-*.test.js') or by the node --test runner.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createTermBeamServer } = require('../src/server');

const isWindows = process.platform === 'win32';

const baseConfig = {
  port: 0,
  host: '127.0.0.1',
  password: null,
  useTunnel: false,
  persistedTunnel: false,
  shell: isWindows ? 'cmd.exe' : '/bin/bash',
  shellArgs: [],
  cwd: process.cwd(),
  defaultShell: isWindows ? 'cmd.exe' : '/bin/bash',
  version: '0.1.0-test',
  logLevel: 'error',
  disableRateLimit: true,
};

function createDefaultSession(inst) {
  inst.sessions.create({
    name: path.basename(baseConfig.cwd),
    shell: baseConfig.shell,
    args: baseConfig.shellArgs,
    cwd: baseConfig.cwd,
  });
}

async function waitFor(predicate, timeoutMs = 5000, intervalMs = 25) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return true;
}

function taskkillTree(pid) {
  if (!isWindows) return;
  try {
    require('child_process').execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
  } catch {
    // already gone
  }
}

async function resetSessions(inst) {
  const ids = [...inst.sessions.sessions.keys()];

  // On Windows, ConPTY's kill() doesn't reliably reap the entire child tree
  // in headless CI. taskkill /T /F first to ensure a clean teardown.
  if (isWindows) {
    for (const id of ids) {
      const s = inst.sessions.sessions.get(id);
      if (s) taskkillTree(s.pty.pid);
    }
  }

  for (const id of ids) {
    try {
      inst.sessions.delete(id);
    } catch {
      // ignore
    }
  }

  // Wait for onExit handlers to drain the map. Force-clear if they don't
  // fire promptly so the next test isn't blocked.
  const drained = await waitFor(() => inst.sessions.sessions.size === 0, 2000);
  if (!drained) {
    inst.sessions.sessions.clear();
  }

  createDefaultSession(inst);
}

function killAllSessionsHard(inst) {
  if (!isWindows) return;
  for (const [, session] of inst.sessions.sessions) {
    taskkillTree(session.pty.pid);
  }
}

/**
 * Wires up beforeAll/afterAll/beforeEach/afterEach hooks on the given test
 * runner so the file shares a single TermBeam server.
 *
 * Returns a state object. Read `state.inst` lazily (inside tests/helpers,
 * not at module load) — it's populated in beforeAll and reset between tests.
 */
function setupSharedServer(test) {
  const state = {
    inst: null,
    consoleErrors: [],
    isWindows,
    baseConfig,
  };

  test.beforeAll(async () => {
    // Per-worker temp configDir so parallel workers don't race on
    // ~/.termbeam/connection.json or vapid.json.
    state.configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-e2e-'));
    process.env.TERMBEAM_CONFIG_DIR = state.configDir;
    state.inst = createTermBeamServer({ config: { ...baseConfig } });
    await state.inst.start();
  });

  test.afterAll(async () => {
    if (state.inst) {
      killAllSessionsHard(state.inst);
      await state.inst.shutdown();
      state.inst = null;
    }
    if (state.configDir) {
      try {
        fs.rmSync(state.configDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      state.configDir = null;
    }
  });

  test.beforeEach(async ({ page }) => {
    await resetSessions(state.inst);

    state.consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') state.consoleErrors.push(msg.text());
    });
  });

  test.afterEach(async () => {
    const unexpected = state.consoleErrors.filter(
      (e) => !e.includes('net::ERR_') && !e.includes('WebSocket'),
    );
    if (unexpected.length > 0) {
      throw new Error(`Unexpected browser console errors:\n${unexpected.join('\n')}`);
    }
  });

  return state;
}

function getBaseURL(state) {
  return `http://127.0.0.1:${state.inst.server.address().port}`;
}

module.exports = {
  setupSharedServer,
  getBaseURL,
  baseConfig,
  isWindows,
};
