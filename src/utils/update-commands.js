// Running the package-manager and git commands behind in-app updates, and
// turning their failures into one short sentence for the update banner.

const childProcess = require('child_process');
const log = require('./logger');
const { getChildPids } = require('./processes');

const IS_WIN = process.platform === 'win32';
const MAX_MESSAGE = 300;
const KILL_GRACE_MS = 5_000;
// Package managers and global bins that Windows installs as `.cmd` shims.
const WINDOWS_SHIMS = new Set(['npm', 'npx', 'yarn', 'pnpm', 'termbeam']);

const NETWORK_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPROTO',
  'CERT_HAS_EXPIRED',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const AUTH_CODES = new Set(['E401', 'E403', 'EAUTH', 'ENEEDAUTH']);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** Every process below the given ones, parents before children. */
async function descendantsOf(pids) {
  const seen = new Set(pids);
  const found = [];
  const queue = [...pids];
  while (queue.length && found.length < 512) {
    let children = [];
    try {
      children = (await getChildPids(queue.shift())) || [];
    } catch {
      // It exited mid-scan
    }
    for (const value of children) {
      const pid = Number(value);
      if (seen.has(pid)) continue;
      seen.add(pid);
      found.push(pid);
      queue.push(pid);
    }
  }
  return found;
}

function waitUntilGone(pids, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const check = () => {
      if (!pids.some(isAlive)) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(check, 100);
    };
    check();
  });
}

/**
 * Stop a timed-out command and everything it started, resolving once all of
 * it has exited. Killing only the direct child (cmd.exe on Windows, npm
 * elsewhere) could leave npm or an install script writing to node_modules
 * after the step had failed. The tree is listed before the first signal, so a
 * descendant that ignores SIGTERM and outlives its parent (which reparents it)
 * still gets the SIGKILL that follows the grace period.
 */
async function stopTree(pid, graceMs) {
  if (!pid) return;
  if (IS_WIN) {
    await new Promise((resolve) => {
      childProcess.execFile(
        'taskkill',
        ['/pid', String(pid), '/T', '/F'],
        { windowsHide: true },
        () => resolve(),
      );
    });
    return;
  }
  const known = [pid];
  const signalAll = async (signal) => {
    // Re-list below the live ones, so processes started since are found too.
    for (const found of await descendantsOf(known.filter(isAlive))) {
      if (!known.includes(found)) known.push(found);
    }
    for (const target of [...known].reverse()) {
      try {
        process.kill(target, signal);
      } catch {
        // Already gone
      }
    }
  };
  await signalAll('SIGTERM');
  if (await waitUntilGone(known, graceMs)) return;
  await signalAll('SIGKILL');
  await waitUntilGone(known, graceMs);
}

/**
 * Run a command without a shell. On Windows, `.cmd` shims such as npm only
 * start through one, so their (fixed, internal) command line goes through
 * cmd.exe there instead. When `timeout` expires the whole process tree is
 * stopped (SIGTERM, then SIGKILL after `killGraceMs`), and the promise
 * settles only once all of it has exited.
 * Resolves `{ stdout, stderr }`; rejects with the error carrying both.
 */
function runCommand(cmd, args, options = {}) {
  const { timeout, killGraceMs = KILL_GRACE_MS, ...execOptions } = options;
  const viaShell = IS_WIN && WINDOWS_SHIMS.has(cmd);
  const file = viaShell ? [cmd, ...args].join(' ') : cmd;
  return new Promise((resolve, reject) => {
    let child = null;
    let exited = false;
    let timedOut = false;
    let markStopped;
    const stopped = new Promise((done) => (markStopped = done));
    const timer = timeout
      ? setTimeout(() => {
          timedOut = true;
          stopTree(child && child.pid, killGraceMs)
            .catch(() => {})
            .then(() => {
              markStopped();
              // A process that left the tree before the timeout (it
              // daemonized) could hold the output pipes open for good.
              const release = setTimeout(() => {
                if (exited || !child) return;
                child.stdout?.destroy();
                child.stderr?.destroy();
              }, killGraceMs);
              release.unref?.();
            });
        }, timeout)
      : null;
    child = childProcess.execFile(
      file,
      viaShell ? [] : args,
      {
        encoding: 'utf8',
        windowsHide: true,
        ...execOptions,
        shell: viaShell,
      },
      (err, stdout, stderr) => {
        exited = true;
        clearTimeout(timer);
        const settle = () => {
          if (timedOut) {
            err = Object.assign(err || new Error(`${cmd} timed out`), {
              killed: true,
              signal: (err && err.signal) || 'SIGTERM',
            });
          }
          if (err) {
            err.stdout = stdout;
            err.stderr = stderr;
            reject(err);
          } else {
            resolve({ stdout, stderr });
          }
        };
        if (timedOut) stopped.then(settle);
        else settle();
      },
    );
  });
}

function outputOf(err) {
  return `${err.stderr || ''}\n${err.stdout || ''}`;
}

function lines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function firstHost(text) {
  const match = text.match(/https?:\/\/[^\s'"`]+/);
  if (!match) return null;
  try {
    return new URL(match[0]).host;
  } catch {
    return null;
  }
}

function npmLines(output) {
  return lines(output)
    .map((line) => line.match(/^npm (?:error|ERR!)\s*(.*)$/)?.[1])
    .filter(Boolean);
}

function npmCode(output) {
  return npmLines(output)
    .map((line) => line.match(/^code (\S+)/)?.[1])
    .find(Boolean);
}

/**
 * Whether npm failed fetching a package (missing version, HTTP or network
 * error, bad checksum), as opposed to a failed install script or a timeout.
 * npm rolls such an install back, so node_modules is left as it was.
 */
function isRegistryFailure(err) {
  if (err.killed) return false;
  const code = npmCode(outputOf(err));
  if (!code) return false;
  return (
    /^E[45]\d\d$/.test(code) ||
    code === 'ETARGET' ||
    code === 'EINTEGRITY' ||
    AUTH_CODES.has(code) ||
    NETWORK_CODES.has(code)
  );
}

function describeNpm(output) {
  const errors = npmLines(output);
  if (!errors.length) return null;

  const code = npmCode(output);
  const host = firstHost(errors.join('\n'));
  const where = host ? ` from ${host}` : '';

  if (code === 'E404' || code === 'ETARGET') {
    const what =
      output.match(/\/-\/([^/\s'"]+\.tgz)/)?.[1] ||
      output.match(/No matching version found for (\S+?)\.?(?:\s|$)/)?.[1] ||
      output.match(/'([^']+)' is not in this registry/)?.[1] ||
      'a package';
    const hint =
      host && host !== 'registry.npmjs.org'
        ? ' Registry mirrors can lag behind npmjs.org; try again later.'
        : '';
    return `${what} isn't available${where} (${code}).${hint}`;
  }
  if (code && AUTH_CODES.has(code)) {
    return `${host || 'the npm registry'} refused the request (${code}). Check your npm login for it.`;
  }
  if (code && NETWORK_CODES.has(code)) {
    return `couldn't reach ${host || 'the npm registry'} (${code}).`;
  }
  if (code && /^\d+$/.test(code)) {
    // A lifecycle script exited non-zero; npm names the package in `path`.
    const where = errors.map((line) => line.match(/^path (.+)$/)?.[1]).find(Boolean);
    const pkg = where?.split(/node_modules[\\/]/).pop();
    return `${pkg ? `${pkg}'s` : 'an'} install script failed (exit ${code}).`;
  }
  const detail = errors.find(
    (line) => !/^(code|errno|syscall|path|command|workspace|location|A complete log)\b/.test(line),
  );
  if (!detail) return code ? `npm exited with ${code}.` : null;
  return `${detail.replace(/[.:]$/, '')}${code ? ` (${code})` : ''}.`;
}

function describeGit(output) {
  const all = lines(output);
  // Most refusals start with fatal:/error:; "no tracking information" has no prefix.
  const line = all.find((l) => /^(fatal|error):/.test(l)) || all.find((l) => !/^hint:/.test(l));
  if (!line) return null;
  const message = line.replace(/^(fatal|error):\s*/, '').replace(/[.:]$/, '');
  let hint = '';
  if (/not possible to fast-forward|divergent/i.test(output)) {
    hint = ' Local commits block a fast-forward; update this checkout by hand.';
  } else if (/would be overwritten/i.test(output)) {
    hint = ' Commit or stash local changes, then retry.';
  } else if (/no tracking information/i.test(output)) {
    hint = ' Check out a branch that tracks a remote (such as main), then retry.';
  } else if (
    /could not read username|authentication failed|terminal prompts disabled/i.test(output)
  ) {
    hint = ' Git needs credentials for this remote.';
  }
  return `${message}.${hint}`;
}

function describeBuild(output) {
  const line = lines(output).find((l) => /error TS\d+:|\bERROR:|^Error:|^\[vite[^\]]*\]/.test(l));
  return line ? line.replace(/[.:]$/, '') + '.' : null;
}

/**
 * Why an update step failed, as "<step>: <reason>". The banner prefixes it
 * with "Update failed:".
 * @param {string} label - Step name, e.g. "npm install".
 * @param {Error & { code?: unknown, path?: string, killed?: boolean, signal?: string, stdout?: string, stderr?: string }} err
 * @param {{ kind?: 'install'|'git'|'build', timeoutMs?: number }} [options]
 */
function describeFailure(label, err, { kind = 'install', timeoutMs } = {}) {
  let detail;
  if (err.code === 'ENOENT') {
    detail = `${err.path || 'the command'} isn't installed or isn't on PATH.`;
  } else if (err.killed && err.signal) {
    const minutes = timeoutMs ? Math.round(timeoutMs / 60_000) : 0;
    detail = minutes ? `timed out after ${minutes} min.` : 'timed out.';
  } else {
    const output = outputOf(err);
    const parsers =
      kind === 'git'
        ? [describeGit, describeNpm]
        : kind === 'build'
          ? [describeBuild, describeNpm]
          : [describeNpm, describeGit];
    detail = parsers.map((parse) => parse(output)).find(Boolean);
    if (!detail) {
      const first = lines(String(err.message || 'unknown error'))[0] || 'unknown error';
      detail = first.replace(/[.:]$/, '') + '.';
    }
  }
  const message = `${label}: ${detail}`;
  return message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message;
}

/** Log a failed step with the tail of its output, for diagnosing what the banner summarises. */
function logFailure(label, err) {
  const output = outputOf(err).trim();
  const first = lines(String(err.message || ''))[0] || 'failed';
  log.error(`${label} failed: ${first}${output ? `\n${output.slice(-4000)}` : ''}`);
}

module.exports = { runCommand, describeFailure, logFailure, isRegistryFailure };
