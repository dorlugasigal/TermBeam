const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('./logger');

const INSTALL_TIMEOUT_MS = 120_000; // 2 minutes for npm install
const VERIFY_TIMEOUT_MS = 5_000;

function getConfigDir() {
  return process.env.TERMBEAM_CONFIG_DIR || path.join(os.homedir(), '.termbeam');
}

function getUpdateResultPath() {
  return path.join(getConfigDir(), 'update-result.json');
}

// ── State Machine ────────────────────────────────────────────────────────────

/**
 * @typedef {'idle'|'checking-permissions'|'installing'|'verifying'|'restarting'|'complete'|'failed'} UpdateStatus
 * @typedef {{
 *   status: UpdateStatus,
 *   phase: string|null,
 *   progress: string|null,
 *   error: string|null,
 *   fromVersion: string|null,
 *   toVersion: string|null,
 *   startedAt: number|null,
 *   restartStrategy: string|null,
 * }} UpdateState
 */

/** @type {UpdateState} */
const updateState = {
  status: 'idle',
  phase: null,
  progress: null,
  error: null,
  fromVersion: null,
  toVersion: null,
  startedAt: null,
  restartStrategy: null,
};

function getUpdateState() {
  return { ...updateState };
}

function setState(updates) {
  Object.assign(updateState, updates);
}

function resetState() {
  setState({
    status: 'idle',
    phase: null,
    progress: null,
    error: null,
    fromVersion: null,
    toVersion: null,
    startedAt: null,
    restartStrategy: null,
  });
}

// ── Permission Check ─────────────────────────────────────────────────────────

/**
 * Check if we can write to the npm global prefix directory.
 * Returns { canUpdate, reason } — if canUpdate is false, reason explains why.
 */
async function checkPermissions(method) {
  // Source installs use git, not a package manager
  if (method === 'source') {
    try {
      await execFilePromise('git', ['--version'], { timeout: VERIFY_TIMEOUT_MS });
    } catch {
      return { canUpdate: false, reason: 'git not found on PATH' };
    }
    return { canUpdate: true, reason: null };
  }

  const cmd = method === 'yarn' ? 'yarn' : method === 'pnpm' ? 'pnpm' : 'npm';

  // Check if the package manager is available by running it directly
  try {
    await execFilePromise(cmd, ['--version'], { timeout: VERIFY_TIMEOUT_MS });
  } catch {
    return { canUpdate: false, reason: `${cmd} not found on PATH` };
  }

  // Check if npm global directory is writable (only for npm — yarn/pnpm have different paths)
  if (cmd === 'npm') {
    try {
      // Use `npm root -g` for the actual global node_modules path (cross-platform)
      const globalRoot = (
        await execFilePromise('npm', ['root', '-g'], { timeout: VERIFY_TIMEOUT_MS })
      ).stdout.trim();
      await fs.promises.access(globalRoot, fs.constants.W_OK);
    } catch {
      return {
        canUpdate: false,
        reason: 'npm global directory is not writable (may need sudo)',
      };
    }
  }

  return { canUpdate: true, reason: null };
}

// ── Update Execution ─────────────────────────────────────────────────────────

/**
 * Execute the update process. Calls onProgress for real-time status updates.
 *
 * @param {object} options
 * @param {string} options.currentVersion - Version before update
 * @param {string} options.installCmd - The executable to run (e.g. "npm")
 * @param {string[]} options.installArgs - Arguments for the install command
 * @param {string} options.command - Display string for the full command
 * @param {string} options.method - Package manager (npm/yarn/pnpm)
 * @param {string} options.restartStrategy - 'pm2' or 'exit'
 * @param {(state: UpdateState) => void} [options.onProgress] - Progress callback
 * @param {() => Promise<void>} [options.performRestart] - Called to execute restart
 * @returns {Promise<UpdateState>}
 */
async function executeUpdate({
  currentVersion,
  installCmd,
  installArgs,
  command,
  method,
  restartStrategy,
  onProgress,
  performRestart,
  cwd,
}) {
  if (updateState.status !== 'idle' && updateState.status !== 'failed') {
    return { ...updateState, error: 'Update already in progress' };
  }

  const notify = (updates) => {
    setState(updates);
    if (onProgress) {
      try {
        onProgress(getUpdateState());
      } catch {
        // Don't let callback errors break the update
      }
    }
  };

  setState({
    status: 'checking-permissions',
    phase: 'Checking permissions...',
    progress: null,
    error: null,
    fromVersion: currentVersion,
    toVersion: null,
    startedAt: Date.now(),
    restartStrategy,
  });
  notify({});

  try {
    // Step 1: Permission check
    const { canUpdate, reason } = await checkPermissions(method);
    if (!canUpdate) {
      notify({ status: 'failed', phase: 'Permission check failed', error: reason });
      return getUpdateState();
    }

    // Step 2: Install
    notify({ status: 'installing', phase: 'Installing update...', progress: '' });

    log.info(`Executing update: ${command}`);

    const { stdout, stderr } = await execFilePromise(installCmd, installArgs, {
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10 MB — package manager installs can be verbose
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
      cwd: cwd || undefined,
    });

    const output = (stdout + '\n' + stderr).trim();
    notify({ progress: output.slice(-500) }); // Keep last 500 chars
    log.debug(`Install output: ${output.slice(0, 200)}`);

    // Step 3: Verify
    notify({ status: 'verifying', phase: 'Verifying update...' });

    const newVersion = await verifyInstalledVersion(method, cwd);
    if (!newVersion) {
      notify({
        status: 'failed',
        phase: 'Verification failed',
        error: 'Could not determine new version after install',
      });
      return getUpdateState();
    }

    const { isNewerVersion } = require('./update-check');
    if (newVersion === currentVersion) {
      // Same version reinstalled (cache, registry delay) — treat as success
      log.info(`Update reinstalled same version (${newVersion})`);
    } else if (!isNewerVersion(currentVersion, newVersion)) {
      notify({
        status: 'failed',
        phase: 'Verification failed',
        error: `Unexpected version after update: ${newVersion} (was ${currentVersion})`,
      });
      return getUpdateState();
    }

    notify({ toVersion: newVersion });

    // Step 4: Write result marker for post-restart verification
    writeUpdateResult({ fromVersion: currentVersion, toVersion: newVersion });

    // Step 5: Restart
    notify({ status: 'restarting', phase: `Update to v${newVersion} complete. Restarting...` });

    if (performRestart) {
      // Give clients a moment to receive the status update
      await sleep(500);
      await performRestart();
    }

    notify({ status: 'complete', phase: `Updated to v${newVersion}` });
    return getUpdateState();
  } catch (err) {
    log.error(`Update failed: ${err.message}`);
    notify({
      status: 'failed',
      phase: 'Update failed',
      error: err.message,
    });
    return getUpdateState();
  }
}

// ── Version Verification ─────────────────────────────────────────────────────

async function verifyInstalledVersion(method, cwd) {
  // Source installs: read version from the repo's package.json after git pull
  if (method === 'source') {
    try {
      const pkgPath = cwd
        ? path.join(cwd, 'package.json')
        : path.resolve(__dirname, '../../package.json');
      const content = await fs.promises.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(content);
      return pkg.version || null;
    } catch (err) {
      log.debug(`Version verification via package.json failed: ${err.message}`);
    }
    return null;
  }

  const cmd = method === 'yarn' ? 'yarn' : method === 'pnpm' ? 'pnpm' : 'npm';
  try {
    // Use npm/yarn/pnpm to read the installed version
    let args;
    if (cmd === 'npm') {
      args = ['ls', '-g', 'termbeam', '--depth=0', '--json'];
    } else if (cmd === 'yarn') {
      args = ['global', 'list', '--json', '--pattern', 'termbeam'];
    } else {
      args = ['list', '-g', 'termbeam', '--json'];
    }

    const { stdout } = await execFilePromise(cmd, args, { timeout: VERIFY_TIMEOUT_MS });

    if (cmd === 'npm') {
      const data = JSON.parse(stdout);
      const deps = data.dependencies || {};
      if (deps.termbeam && deps.termbeam.version) {
        return deps.termbeam.version;
      }
    }

    // Fallback: try parsing version from output
    const match = stdout.match(/termbeam@(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch (err) {
    log.debug(`Version verification via ${cmd} failed: ${err.message}`);
  }

  // Fallback: try running the new termbeam binary directly
  try {
    const { stdout } = await execFilePromise('termbeam', ['--version'], {
      timeout: VERIFY_TIMEOUT_MS,
    });
    const match = stdout.trim().match(/(\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch {
    log.debug('Version verification via termbeam --version failed');
  }

  return null;
}

// ── Update Result Marker ─────────────────────────────────────────────────────

function writeUpdateResult({ fromVersion, toVersion }) {
  try {
    const resultPath = getUpdateResultPath();
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(
      resultPath,
      JSON.stringify({ fromVersion, toVersion, updatedAt: Date.now() }) + '\n',
      { mode: 0o600 },
    );
  } catch (err) {
    log.debug(`Could not write update result: ${err.message}`);
  }
}

function readUpdateResult() {
  try {
    const data = JSON.parse(fs.readFileSync(getUpdateResultPath(), 'utf8'));
    if (data && data.fromVersion && data.toVersion) return data;
  } catch {
    // No result or corrupt
  }
  return null;
}

function clearUpdateResult() {
  try {
    fs.unlinkSync(getUpdateResultPath());
  } catch {
    // Already gone
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function execFilePromise(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: 'utf8', windowsHide: true, ...options },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  getUpdateState,
  resetState,
  executeUpdate,
  checkPermissions,
  verifyInstalledVersion,
  writeUpdateResult,
  readUpdateResult,
  clearUpdateResult,
};
