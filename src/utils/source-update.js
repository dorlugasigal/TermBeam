// In-app update for a git checkout run under PM2: fast-forward, bring
// dependencies in line with the lockfiles only when they drifted, then rebuild
// the web app. The caller verifies the version and restarts.

const fs = require('fs');
const path = require('path');
const log = require('./logger');
const { runCommand, describeFailure, logFailure } = require('./update-commands');

const GIT_TIMEOUT_MS = 2 * 60_000;
const LS_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;

function git(args, cwd) {
  return runCommand('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    // A credential prompt would hang until the timeout; fail fast instead.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  });
}

function npm(args, cwd, timeout) {
  return runCommand('npm', args, {
    cwd,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
}

async function attempt(label, kind, timeoutMs, fn) {
  try {
    return await fn();
  } catch (err) {
    logFailure(label, err);
    throw new Error(describeFailure(label, err, { kind, timeoutMs }));
  }
}

/**
 * Whether node_modules in `dir` holds exactly the versions package-lock.json
 * pins. Optional packages are skipped (platform-specific ones are never
 * installed); dev packages only count when `includeDev` is set.
 */
function installedMatchesLockfile(dir, { includeDev }) {
  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  } catch {
    return false;
  }
  if (!lock.packages) return false;
  for (const [location, meta] of Object.entries(lock.packages)) {
    if (!location.startsWith('node_modules/')) continue;
    if (meta.optional || meta.devOptional || meta.link) continue;
    if (meta.dev && !includeDev) continue;
    let installed;
    try {
      installed = JSON.parse(fs.readFileSync(path.join(dir, location, 'package.json'), 'utf8'));
    } catch {
      return false;
    }
    if (meta.version && installed.version !== meta.version) return false;
  }
  return true;
}

/** Whether every installed package still satisfies the ranges that require it. */
async function installedTreeIsValid(dir, { includeDev }) {
  const args = ['ls', '--all', '--json'];
  if (!includeDev) args.push('--omit=dev');
  let stdout;
  try {
    ({ stdout } = await npm(args, dir, LS_TIMEOUT_MS));
  } catch (err) {
    stdout = err.stdout; // npm ls exits 1 when it reports problems
  }
  try {
    const problems = JSON.parse(stdout).problems || [];
    return !problems.some((problem) => /^(missing|invalid)\b/.test(problem));
  } catch {
    return false;
  }
}

async function syncDependencies(dir, { label, includeDev, phase, onPhase, warnings }) {
  if (installedMatchesLockfile(dir, { includeDev })) return;
  onPhase(phase);
  try {
    await npm(['install', '--no-save', '--no-audit', '--no-fund'], dir, INSTALL_TIMEOUT_MS);
  } catch (err) {
    logFailure(label, err);
    const reason = describeFailure(label, err, { timeoutMs: INSTALL_TIMEOUT_MS });
    // A registry mirror can be days behind npmjs.org. The packages already
    // installed are what the running version uses, so go ahead while they
    // still satisfy every declared range.
    if (!(await installedTreeIsValid(dir, { includeDev }))) throw new Error(reason);
    log.warn(`${reason} Continuing with the installed dependencies.`);
    warnings.push(reason);
  }
}

/**
 * @param {{ cwd: string, onPhase?: (phase: string) => void }} options
 * @returns {Promise<{ from: string, to: string, warnings: string[] }>}
 */
async function updateSourceCheckout({ cwd, onPhase = () => {} }) {
  const warnings = [];
  const head = async () =>
    (
      await attempt('git', 'git', GIT_TIMEOUT_MS, () => git(['rev-parse', 'HEAD'], cwd))
    ).stdout.trim();

  onPhase('Pulling the latest code...');
  const from = await head();
  await attempt('git pull', 'git', GIT_TIMEOUT_MS, () => git(['pull', '--ff-only'], cwd));
  const to = await head();
  log.info(
    from === to
      ? 'Source checkout already up to date'
      : `Pulled ${from.slice(0, 7)}..${to.slice(0, 7)}`,
  );

  // `--no-save` keeps a mirror's tarball URLs out of the committed lockfiles,
  // so the next `git pull --ff-only` isn't blocked by local changes.
  await syncDependencies(cwd, {
    label: 'npm install',
    includeDev: false,
    phase: 'Installing dependencies...',
    onPhase,
    warnings,
  });
  const frontend = path.join(cwd, 'src', 'frontend');
  await syncDependencies(frontend, {
    label: 'npm install (web app)',
    includeDev: true, // the build needs its dev tools
    phase: 'Installing web app dependencies...',
    onPhase,
    warnings,
  });

  onPhase('Building the web app...');
  await attempt('web app build', 'build', BUILD_TIMEOUT_MS, () =>
    npm(['run', 'build'], frontend, BUILD_TIMEOUT_MS),
  );
  return { from, to, warnings };
}

module.exports = { updateSourceCheckout, installedMatchesLockfile, installedTreeIsValid };
