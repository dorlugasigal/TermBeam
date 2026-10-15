// In-app update for a git checkout run under PM2: fast-forward, bring
// dependencies in line with the lockfiles only when they drifted, then rebuild
// the web app. The caller verifies the version and restarts.

const fs = require('fs');
const path = require('path');
const log = require('./logger');
const { runCommand, describeFailure, logFailure, isRegistryFailure } = require('./update-commands');

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
 * Whether node_modules in `dir` holds the versions package-lock.json pins.
 * Dev packages only count when `includeDev` is set. A package that is
 * optional in that scope may be absent (npm skips other platforms' binaries
 * and failed optional builds), but if it is installed its version must match.
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
    if (!location.startsWith('node_modules/') || meta.link) continue;
    if (meta.dev && !includeDev) continue;
    // devOptional: a dev dependency that is also optional for production.
    const optional = meta.optional || (meta.devOptional && !includeDev);
    let installed;
    try {
      installed = JSON.parse(fs.readFileSync(path.join(dir, location, 'package.json'), 'utf8'));
    } catch {
      if (optional) continue;
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
  let failed = false;
  try {
    ({ stdout } = await npm(args, dir, LS_TIMEOUT_MS));
  } catch (err) {
    failed = true; // npm ls exits 1 (ELSPROBLEMS) when it lists problems
    stdout = err.stdout;
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return false;
  }
  // An `error` report (EOVERRIDE, a broken lockfile…) validated nothing.
  if (report.error) return false;
  const problems = Array.isArray(report.problems) ? report.problems : null;
  if (failed && !problems) return false;
  return !(problems || []).some((problem) => /^(missing|invalid)\b/.test(problem));
}

async function syncDependencies(dir, { label, includeDev, phase, onPhase, warnings }) {
  if (installedMatchesLockfile(dir, { includeDev })) return;
  onPhase(phase);
  try {
    await npm(['install', '--no-save', '--no-audit', '--no-fund'], dir, INSTALL_TIMEOUT_MS);
  } catch (err) {
    logFailure(label, err);
    const reason = describeFailure(label, err, { timeoutMs: INSTALL_TIMEOUT_MS });
    // A registry mirror can be days behind npmjs.org. When npm only failed to
    // download, it rolled back, and node_modules still holds what the running
    // version uses: go ahead while those packages satisfy every declared range.
    // A failed install script or a timeout may have left broken binaries.
    if (!isRegistryFailure(err) || !(await installedTreeIsValid(dir, { includeDev }))) {
      throw new Error(reason);
    }
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
