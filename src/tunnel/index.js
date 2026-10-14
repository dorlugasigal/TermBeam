const { execSync, execFileSync, execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const dns = require('dns');
const EventEmitter = require('events');
const log = require('../utils/logger');
const { promptInstall, stripQuarantine, resolveBinaryPath, hasQuarantine } = require('./install');

const TUNNEL_CONFIG_DIR = path.join(os.homedir(), '.termbeam');
const TUNNEL_CONFIG_PATH = path.join(TUNNEL_CONFIG_DIR, 'tunnel.json');

/*
 * Tunnel lifecycle + watchdog.
 *
 * Failure modes we recover from (verified against devtunnel CLI 1.0.x):
 *  - host process dies / relay connection drops      → restart `devtunnel host`
 *  - laptop sleeps / wakes                            → immediate health check on wake
 *  - DNS / connectivity loss                          → pause, probe, resume
 *  - host CLI login expired                           → pause until `devtunnel user login`
 *  - tunnel expired or deleted (expiration is a sliding inactivity window, so a
 *    long sleep can outlive it; `devtunnel host` then exits with
 *    "Tunnel not found in <cluster>")                → extend in place, else
 *    re-create the tunnel and announce the new URL ('url-changed')
 *
 * Every periodic check is asynchronous — the previous watchdog used
 * execFileSync and froze the whole server (and every terminal) for the
 * duration of a `devtunnel` call every 30 seconds.
 */

const tunnelEvents = new EventEmitter();

const HEALTH_CHECK_INTERVAL = 30_000;
const HEALTH_CHECK_GRACE = 2; // consecutive failures before restart
const MAX_RESTART_ATTEMPTS = 10;
const BACKOFF_DELAYS = [1000, 2000, 5000, 10_000, 15_000, 30_000];
const AUTH_CHECK_INTERVAL = 30_000;
const NETWORK_CHECK_INTERVAL = 30_000;
const NETWORK_PROBE_HOST = 'global.rel.tunnels.api.visualstudio.com';
const NETWORK_PROBE_TIMEOUT = 5_000;
const TOKEN_EXPIRY_WARN_SECONDS = 3600;
const LOGIN_INFO_REFRESH_MS = 10 * 60_000;
const EXTEND_EXPIRATION_EVERY_MS = 6 * 60 * 60_000;
const RECREATE_COOLDOWN_MS = 2 * 60_000;
const HOST_START_TIMEOUT = 20_000;
const WAKE_TICK_MS = 10_000;
const WAKE_GAP_MS = 45_000; // timer stalled this much longer than expected ⇒ system slept
const OUTPUT_TAIL_CHARS = 4096;

const AUTH_ERROR_PATTERNS = ['login required', 'not logged in', 'sign in required', 'please login'];

// Tunnel no longer exists on the service (expired after inactivity, deleted
// from another machine, or swept by the service).
const GONE_ERROR_PATTERNS = [
  'tunnel not found',
  'tunnel is expired',
  'tunnel expiration',
  'tunnel has expired',
];

// DNS / transient network failures that should NOT burn restart attempts.
// These typically resolve on their own once the host regains connectivity
// (e.g. Wi-Fi sleep/wake, router reboot, upstream DNS hiccup).
const NETWORK_ERROR_PATTERNS = [
  'nodename nor servname',
  'getaddrinfo',
  'enotfound',
  'eai_again',
  'econnrefused',
  'econnreset',
  'etimedout',
  'network is unreachable',
  'no such host',
  'temporary failure in name resolution',
];

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

const DEVICE_CODE_INITIAL_TIMEOUT = 15000;
const DEVICE_CODE_AUTH_TIMEOUT = 120000;

let devtunnelCmd = 'devtunnel';

const state = {
  tunnelId: null,
  port: null,
  persisted: false,
  anonymous: false,
  url: null,
  hostProc: null,
  hostOutput: '',
  healthTimer: null,
  wakeTimer: null,
  lastTick: 0,
  checking: false,
  consecutiveFailures: 0,
  restartAttempts: 0,
  restarting: false,
  restartTimer: null,
  waitingForAuth: false,
  authTimer: null,
  waitingForNetwork: false,
  networkTimer: null,
  recovering: false,
  lastRecreateAt: 0,
  lastRecoveryExtendAt: 0,
  lastExtendAt: 0,
  loginInfo: null,
  loginInfoAt: 0,
  expiryWarned: false,
  stopped: true,
};

function matches(message, patterns) {
  const lower = String(message || '').toLowerCase();
  return patterns.some((p) => lower.includes(p));
}

function isAuthError(message) {
  return matches(message, AUTH_ERROR_PATTERNS);
}

function isNetworkError(message) {
  return matches(message, NETWORK_ERROR_PATTERNS);
}

function isTunnelGoneError(message) {
  return matches(message, GONE_ERROR_PATTERNS);
}

/** @returns {'auth' | 'gone' | 'network' | 'unknown'} */
function classifyError(message) {
  if (isAuthError(message)) return 'auth';
  if (isTunnelGoneError(message)) return 'gone';
  if (isNetworkError(message)) return 'network';
  return 'unknown';
}

// --- Process helpers (swappable in tests) -----------------------------------

function defaultRunner(args, { timeout = 15_000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      devtunnelCmd,
      args,
      { encoding: 'utf-8', timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          error: err ? err.message : '',
        });
      },
    );
  });
}

function defaultSpawner(args) {
  return spawn(devtunnelCmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
}

let run = defaultRunner;
let spawnHost = defaultSpawner;

function outputOf(res) {
  return [res.stderr, res.stdout, res.error].filter(Boolean).join('\n');
}

function isNetworkReachable() {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, NETWORK_PROBE_TIMEOUT);
    try {
      dns.lookup(NETWORK_PROBE_HOST, (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(!err);
      });
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(false);
      }
    }
  });
}

// One-time per-session flag so the "stripped quarantine" warning isn't
// spammed if the auth-poll loop trips it repeatedly during a brew upgrade.
let quarantineWarned = false;

/**
 * On macOS, brew upgrades silently re-tag the devtunnel binary with
 * com.apple.quarantine, which makes Gatekeeper block our spawns. Returns
 * true when the attribute was found and stripped (caller should retry).
 */
function healQuarantine() {
  if (process.platform !== 'darwin') return false;
  const resolved = resolveBinaryPath(devtunnelCmd);
  if (!resolved || !hasQuarantine(resolved)) return false;
  const result = stripQuarantine(devtunnelCmd);
  if (result === 'stripped') {
    if (!quarantineWarned) {
      log.warn(
        'devtunnel was quarantined by macOS Gatekeeper (likely after a brew upgrade); ' +
          'stripped com.apple.quarantine and retrying',
      );
      quarantineWarned = true;
    }
    return true;
  }
  if (result === 'failed' && !quarantineWarned) {
    log.error(
      'devtunnel is quarantined by macOS Gatekeeper but quarantine removal failed. ' +
        `Run manually: xattr -dr com.apple.quarantine "${resolved}"`,
    );
    quarantineWarned = true;
  }
  return false;
}

/** Synchronous login check — only used during startup (before serving). */
function isLoggedIn() {
  const tryShow = () =>
    execFileSync(devtunnelCmd, ['user', 'show'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
      windowsHide: true,
    });
  try {
    const out = tryShow();
    return !!out && !out.toLowerCase().includes('not logged in');
  } catch (err) {
    if (err && err.code !== 'ENOENT' && healQuarantine()) {
      try {
        const out = tryShow();
        return !!out && !out.toLowerCase().includes('not logged in');
      } catch {
        // fall through and return false
      }
    }
    return false;
  }
}

/** Non-blocking login check used by the watchdog. */
async function checkLoggedIn() {
  let res = await run(['user', 'show'], { timeout: 10_000 });
  if (!res.ok && !/ENOENT/.test(res.error) && healQuarantine()) {
    res = await run(['user', 'show'], { timeout: 10_000 });
  }
  return res.ok && !res.stdout.toLowerCase().includes('not logged in');
}

function getLoginInfo() {
  try {
    const out = execFileSync(devtunnelCmd, ['user', 'show', '-v'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
      windowsHide: true,
    });
    return parseLoginInfo(out);
  } catch {
    return null;
  }
}

async function refreshLoginInfo() {
  const res = await run(['user', 'show', '-v'], { timeout: 10_000 });
  state.loginInfo = res.ok ? parseLoginInfo(res.stdout) : null;
  state.loginInfoAt = Date.now();
  return state.loginInfo;
}

/** Last known login info — never blocks (safe to call from HTTP handlers). */
function getCachedLoginInfo() {
  return state.loginInfo;
}

function parseLoginInfo(output) {
  if (!output || output.toLowerCase().includes('not logged in')) return null;

  let provider = 'unknown';
  if (output.toLowerCase().includes('github')) provider = 'github';
  else if (output.toLowerCase().includes('microsoft')) provider = 'microsoft';

  // Parse "Token lifetime: H:MM:SS" from verbose output
  let tokenLifetimeSeconds = null;
  const ltMatch = output.match(/Token lifetime:\s*(\d+):(\d+):(\d+)/);
  if (ltMatch) {
    tokenLifetimeSeconds =
      parseInt(ltMatch[1], 10) * 3600 + parseInt(ltMatch[2], 10) * 60 + parseInt(ltMatch[3], 10);
  }

  return { provider, tokenLifetimeSeconds };
}

/** Extract hostConnections from `devtunnel show <id> --json` (or plain) output. */
function parseHostConnections(output) {
  const text = String(output || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1));
      const n = data && data.tunnel ? data.tunnel.hostConnections : undefined;
      if (Number.isInteger(n)) return n;
    } catch {
      // fall back to the human-readable format
    }
  }
  const match = text.match(/Host connections\s*:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function deviceCodeLogin(cmd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, ['user', 'login', '-e', '-d'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let gotOutput = false;

    const initialTimer = setTimeout(() => {
      if (!gotOutput) {
        proc.kill();
        reject(
          new Error(
            'Device code flow produced no output — devtunnel may not work in this environment.\n' +
              '  Try logging in manually first: devtunnel user login',
          ),
        );
      }
    }, DEVICE_CODE_INITIAL_TIMEOUT);

    const overallTimer = setTimeout(() => {
      proc.kill();
      reject(new Error('Device code login timed out — authentication was not completed in time.'));
    }, DEVICE_CODE_AUTH_TIMEOUT);

    proc.stdout.on('data', (data) => {
      gotOutput = true;
      process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
      gotOutput = true;
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      clearTimeout(initialTimer);
      clearTimeout(overallTimer);
      if (code === 0) resolve();
      else reject(new Error(`Device code login exited with code ${code}`));
    });

    proc.on('error', (err) => {
      clearTimeout(initialTimer);
      clearTimeout(overallTimer);
      reject(err);
    });
  });
}

function findDevtunnel() {
  // Try devtunnel directly
  try {
    execSync('devtunnel --version', { stdio: 'pipe', windowsHide: true });
    return 'devtunnel';
  } catch {}

  // On Windows, check common install locations
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'devtunnel.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'devtunnel', 'devtunnel.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }

  // Check ~/bin (where the Linux install script places it)
  const homeBin = path.join(
    os.homedir(),
    'bin',
    process.platform === 'win32' ? 'devtunnel.exe' : 'devtunnel',
  );
  if (fs.existsSync(homeBin)) {
    try {
      execFileSync(homeBin, ['--version'], { stdio: 'pipe', windowsHide: true });
      return homeBin;
    } catch {}
  }

  return null;
}

function loadPersistedTunnel() {
  try {
    if (fs.existsSync(TUNNEL_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(TUNNEL_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return null;
}

function savePersistedTunnel(id) {
  fs.mkdirSync(TUNNEL_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    TUNNEL_CONFIG_PATH,
    JSON.stringify({ tunnelId: id, createdAt: new Date().toISOString() }, null, 2),
  );
}

function expirationArg() {
  return state.persisted ? '30d' : '1d';
}

/** Create + configure a tunnel (port, access). Returns the new tunnel id. */
async function createTunnel() {
  const res = await run(['create', '--expiration', expirationArg(), '--json'], { timeout: 30_000 });
  if (!res.ok) throw new Error(`devtunnel create failed: ${outputOf(res).trim().slice(0, 300)}`);
  const start = res.stdout.indexOf('{');
  const data = JSON.parse(res.stdout.slice(start));
  const id = data && data.tunnel && data.tunnel.tunnelId;
  if (!id || !SAFE_ID_RE.test(id)) throw new Error('devtunnel create returned no tunnel id');
  await configureTunnel(id);
  return id;
}

/** Idempotent port and access setup. */
async function configureTunnel(id) {
  await run(['port', 'create', id, '-p', String(state.port), '--protocol', 'http'], {
    timeout: 20_000,
  });
  if (state.anonymous) {
    await run(['access', 'create', id, '-p', String(state.port), '--anonymous'], {
      timeout: 20_000,
    });
  } else {
    // Remove any existing anonymous access to ensure the tunnel is private
    await run(['access', 'reset', id], { timeout: 20_000 });
  }
}

// --- Watchdog -----------------------------------------------------------------

function startHealthCheck() {
  stopHealthCheck();
  state.consecutiveFailures = 0;
  state.healthTimer = setInterval(() => {
    checkTunnelHealth().catch((err) => log.debug(`Tunnel health check error: ${err.message}`));
  }, HEALTH_CHECK_INTERVAL);
  state.healthTimer.unref();
}

function stopHealthCheck() {
  if (state.healthTimer) {
    clearInterval(state.healthTimer);
    state.healthTimer = null;
  }
}

/**
 * Detect system sleep: a 10s interval that fires minutes late means the
 * machine was suspended. The relay connection rarely survives that, so
 * check immediately instead of waiting for two failed 30s health checks.
 */
function startWakeDetector() {
  stopWakeDetector();
  state.lastTick = Date.now();
  state.wakeTimer = setInterval(() => {
    const now = Date.now();
    const gap = now - state.lastTick;
    state.lastTick = now;
    if (gap > WAKE_TICK_MS + WAKE_GAP_MS) onSystemResume(gap);
  }, WAKE_TICK_MS);
  state.wakeTimer.unref();
}

function stopWakeDetector() {
  if (state.wakeTimer) {
    clearInterval(state.wakeTimer);
    state.wakeTimer = null;
  }
}

function onSystemResume(sleptMs) {
  if (state.stopped) return;
  log.info(`System resumed after ~${Math.max(1, Math.round(sleptMs / 60_000))}m — checking tunnel`);
  tunnelEvents.emit('resumed', { sleptMs });
  if (state.waitingForNetwork) {
    probeNetwork();
    return;
  }
  if (state.waitingForAuth || state.restarting) return;
  // One more failure after wake is enough to restart.
  state.consecutiveFailures = HEALTH_CHECK_GRACE - 1;
  checkTunnelHealth().catch(() => {});
}

function countFailure(reason) {
  state.consecutiveFailures++;
  log.warn(`Tunnel health check: ${reason} (${state.consecutiveFailures}/${HEALTH_CHECK_GRACE})`);
  if (state.consecutiveFailures >= HEALTH_CHECK_GRACE) {
    log.warn('Tunnel connection lost — initiating restart');
    handleTunnelFailure();
  }
}

async function checkTunnelHealth() {
  if (state.stopped || !state.tunnelId || !state.hostProc) return;
  if (state.restarting || state.waitingForAuth || state.waitingForNetwork || state.recovering) {
    return;
  }
  if (state.checking) return;
  state.checking = true;
  try {
    const res = await run(['show', state.tunnelId, '--json'], { timeout: 10_000 });
    if (state.stopped || state.restarting || state.recovering) return;

    if (!res.ok) {
      const kind = classifyError(outputOf(res));
      if (kind === 'auth') return handleAuthExpiration();
      if (kind === 'gone') return recoverGoneTunnel('health check');
      if (kind === 'network') {
        log.warn('Tunnel health check: network unreachable — pausing until connectivity returns');
        stopHealthCheck();
        killHostProc();
        tunnelEvents.emit('disconnected');
        startNetworkWait();
        return;
      }
      // An unexplained failure can still be an expired login.
      if (!(await checkLoggedIn())) return handleAuthExpiration();
      return countFailure(`error: ${outputOf(res).trim().split('\n')[0] || 'unknown'}`);
    }

    const hostConnections = parseHostConnections(res.stdout);
    if (hostConnections === null) return countFailure('could not parse host connections');
    if (hostConnections > 0) {
      if (state.consecutiveFailures > 0) {
        log.info(`Tunnel health restored (${hostConnections} host connection(s))`);
      }
      state.consecutiveFailures = 0;
      maybeExtendExpiration();
      maybeCheckTokenExpiry();
      return;
    }
    countFailure('0 host connections');
  } finally {
    state.checking = false;
  }
}

/** Sliding expiration insurance: push the tunnel's expiry out while healthy. */
function maybeExtendExpiration() {
  const now = Date.now();
  if (now - state.lastExtendAt < EXTEND_EXPIRATION_EVERY_MS) return;
  state.lastExtendAt = now;
  const id = state.tunnelId;
  run(['update', id, '--expiration', expirationArg()], { timeout: 20_000 })
    .then((res) => {
      if (res.ok) log.debug(`Tunnel ${id} expiration extended (${expirationArg()})`);
      else log.debug(`Tunnel expiration extend failed: ${outputOf(res).split('\n')[0]}`);
    })
    .catch(() => {});
}

function maybeCheckTokenExpiry() {
  if (Date.now() - state.loginInfoAt < LOGIN_INFO_REFRESH_MS) return;
  refreshLoginInfo()
    .then((info) => {
      if (!info || info.tokenLifetimeSeconds === null) return;
      const remaining = info.tokenLifetimeSeconds;
      if (remaining <= TOKEN_EXPIRY_WARN_SECONDS && !state.expiryWarned) {
        state.expiryWarned = true;
        log.warn(`DevTunnel token expires in ${Math.round(remaining / 60)}m (will auto-refresh)`);
      } else if (remaining > TOKEN_EXPIRY_WARN_SECONDS) {
        if (state.expiryWarned) log.info('DevTunnel token was auto-refreshed');
        state.expiryWarned = false;
      }
    })
    .catch(() => {});
}

function handleTunnelFailure() {
  if (state.restarting || state.recovering) return;
  stopHealthCheck();
  killHostProc();
  tunnelEvents.emit('disconnected');
  scheduleRestart();
}

function killHostProc() {
  const proc = state.hostProc;
  if (!proc) return;
  state.hostProc = null;
  try {
    if (process.platform === 'win32' && proc.pid) {
      try {
        execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
          stdio: 'pipe',
          timeout: 5000,
          windowsHide: true,
        });
      } catch {
        /* best effort */
      }
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    /* best effort */
  }
}

// --- Auth-expiration handling ---

function handleAuthExpiration() {
  if (state.waitingForAuth) return;
  stopHealthCheck();
  killHostProc();
  tunnelEvents.emit('disconnected');
  tunnelEvents.emit('auth-expired');
  startAuthWait();
}

function startAuthWait() {
  if (state.waitingForAuth) return;
  state.waitingForAuth = true;
  state.restarting = false;
  state.restartAttempts = 0;
  state.consecutiveFailures = 0;

  log.warn('DevTunnel login on this computer has expired.');
  log.warn('Tunnel is paused — re-authenticate on the host machine to restore:');
  log.warn('  devtunnel user login -d');
  log.warn('Tunnel will auto-reconnect once auth is restored.');

  state.authTimer = setInterval(async () => {
    if (!state.waitingForAuth) return;
    if (await checkLoggedIn()) {
      log.info('DevTunnel auth restored — resuming tunnel');
      stopAuthWait();
      tunnelEvents.emit('auth-restored');
      scheduleRestart();
    }
  }, AUTH_CHECK_INTERVAL);
  state.authTimer.unref();
}

function stopAuthWait() {
  state.waitingForAuth = false;
  if (state.authTimer) {
    clearInterval(state.authTimer);
    state.authTimer = null;
  }
}

// --- Network-wait handling ---

async function probeNetwork() {
  if (!state.waitingForNetwork) return;
  if (await isNetworkReachable()) {
    if (!state.waitingForNetwork) return;
    // If auth expired while we were offline, switch to auth-wait instead.
    if (!(await checkLoggedIn())) {
      log.warn('DevTunnel auth expired during network outage — waiting for re-authentication');
      stopNetworkWait();
      handleAuthExpiration();
      return;
    }
    log.info('Network connectivity restored — resuming tunnel');
    stopNetworkWait();
    tunnelEvents.emit('network-restored');
    scheduleRestart();
  }
}

function startNetworkWait() {
  if (state.waitingForNetwork) return;
  state.waitingForNetwork = true;
  state.restarting = false;
  state.restartAttempts = 0;
  state.consecutiveFailures = 0;

  log.warn('Tunnel paused — waiting for network connectivity.');
  log.warn('Will auto-resume when the tunnel service is reachable.');
  tunnelEvents.emit('network-lost');

  state.networkTimer = setInterval(() => probeNetwork(), NETWORK_CHECK_INTERVAL);
  state.networkTimer.unref();
  // Also probe once immediately in case the outage already cleared.
  probeNetwork();
}

function stopNetworkWait() {
  state.waitingForNetwork = false;
  if (state.networkTimer) {
    clearInterval(state.networkTimer);
    state.networkTimer = null;
  }
}

// --- Restart / recovery ---

function scheduleRestart() {
  if (state.stopped || state.waitingForNetwork || state.waitingForAuth || state.recovering) return;
  if (state.restartTimer) return; // a restart is already queued

  if (state.restartAttempts >= MAX_RESTART_ATTEMPTS) {
    log.warn(
      `Tunnel restart failed after ${MAX_RESTART_ATTEMPTS} attempts — entering network-wait mode.`,
    );
    tunnelEvents.emit('failed', { attempts: state.restartAttempts });
    state.restarting = false;
    startNetworkWait();
    return;
  }

  state.restarting = true;
  const delay = BACKOFF_DELAYS[Math.min(state.restartAttempts, BACKOFF_DELAYS.length - 1)];
  state.restartAttempts++;

  log.info(
    `Restarting tunnel in ${delay}ms (attempt ${state.restartAttempts}/${MAX_RESTART_ATTEMPTS})`,
  );
  tunnelEvents.emit('reconnecting', { attempt: state.restartAttempts, delay });

  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    attemptRestart().catch((err) => {
      log.error(`Tunnel restart error: ${err.message}`);
      state.restarting = false;
      scheduleRestart();
    });
  }, delay);
  state.restartTimer.unref();
}

async function attemptRestart() {
  if (state.stopped) return;
  if (!(await checkLoggedIn())) {
    log.warn('DevTunnel auth expired during restart — waiting for re-authentication');
    state.restarting = false;
    handleAuthExpiration();
    return;
  }

  const result = await hostTunnel();
  if (state.stopped) return;
  if (result.url) {
    onHosted(result.url);
    log.info('Tunnel reconnected successfully');
    return;
  }

  state.restarting = false;
  if (result.kind === 'gone') {
    await recoverGoneTunnel('restart');
    return;
  }
  if (result.kind === 'auth') {
    handleAuthExpiration();
    return;
  }
  log.warn(`Tunnel restart did not come up (${result.kind || 'no URL'})`);
  // If the host appears to be offline, stop burning attempts.
  if (result.kind === 'network' || !(await isNetworkReachable())) {
    startNetworkWait();
    return;
  }
  scheduleRestart();
}

function onHosted(url) {
  const previousUrl = state.url;
  state.url = url;
  state.restartAttempts = 0;
  state.restarting = false;
  state.consecutiveFailures = 0;
  tunnelEvents.emit('connected', { url });
  if (previousUrl && previousUrl !== url) {
    tunnelEvents.emit('url-changed', { url, previousUrl });
  }
  startHealthCheck();
}

/**
 * The tunnel no longer exists on the service (expired after inactivity or
 * deleted). First try to extend it in place; if that fails, create a fresh
 * tunnel with the same settings. The public URL changes in that case, which
 * is announced via 'url-changed' (console QR + connected clients).
 */
async function recoverGoneTunnel(source) {
  if (state.recovering || state.stopped) return;
  state.recovering = true;
  stopHealthCheck();
  killHostProc();
  tunnelEvents.emit('disconnected');
  try {
    const oldId = state.tunnelId;
    log.warn(`Tunnel ${oldId} no longer exists on the service (${source}) — recovering`);

    // Extending in place keeps the URL. Skip it if we already tried moments
    // ago and the host still reported the tunnel missing.
    const recentlyExtended = Date.now() - state.lastRecoveryExtendAt < RECREATE_COOLDOWN_MS;
    if (!recentlyExtended) {
      const ext = await run(['update', oldId, '--expiration', expirationArg()], {
        timeout: 20_000,
      });
      if (ext.ok) {
        state.lastRecoveryExtendAt = Date.now();
        log.info('Tunnel expiration extended in place — restarting host');
        state.recovering = false;
        scheduleRestart();
        return;
      }
    }

    if (Date.now() - state.lastRecreateAt < RECREATE_COOLDOWN_MS) {
      log.warn('Tunnel was re-created moments ago — backing off before trying again');
      state.recovering = false;
      scheduleRestart();
      return;
    }
    state.lastRecreateAt = Date.now();

    const newId = await createTunnel();
    state.tunnelId = newId;
    if (state.persisted) savePersistedTunnel(newId);
    log.warn(`Created replacement tunnel ${newId} — the public URL will change`);
    tunnelEvents.emit('recreated', { tunnelId: newId, previousId: oldId });

    const result = await hostTunnel();
    state.recovering = false;
    if (state.stopped) return;
    if (result.url) {
      onHosted(result.url);
      return;
    }
    scheduleRestart();
  } catch (err) {
    log.error(`Tunnel recovery failed: ${err.message}`);
    state.recovering = false;
    if (isNetworkError(err.message) || !(await isNetworkReachable())) {
      startNetworkWait();
      return;
    }
    scheduleRestart();
  }
}

/**
 * Spawn `devtunnel host` for the current tunnelId and wait for the URL.
 * Resolves `{ url }` on success or `{ kind, output }` when the process fails
 * to come up (exit, spawn error or timeout). Never rejects.
 */
function hostTunnel() {
  const hostProc = spawnHost(['host', state.tunnelId]);
  state.hostProc = hostProc;
  state.hostOutput = '';

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };

    const onData = (data) => {
      const text = data.toString();
      state.hostOutput = (state.hostOutput + text).slice(-OUTPUT_TAIL_CHARS);
      if (!settled) {
        // Wait for a terminator so a chunk boundary can't cut the URL short
        // (e.g. before a `:port`), and stop at commas: some CLI versions list
        // several URLs on one line.
        const match = state.hostOutput.match(/(https:\/\/[^\s,]+devtunnels\.ms[^\s,]*)[\s,]/);
        if (match) settle({ url: match[1].replace(/\/$/, '') });
      } else if (state.hostProc === hostProc) {
        for (const line of text.split(/\r?\n/)) {
          if (/relay.*(lost|closed|disconnected|reconnecting)/i.test(line)) {
            log.warn(`Tunnel: ${line.trim()}`);
            tunnelEvents.emit('relay-lost');
          } else if (/relay.*restored/i.test(line)) {
            log.info(`Tunnel: ${line.trim()}`);
            tunnelEvents.emit('relay-restored');
          }
        }
      }
    };
    hostProc.stdout.on('data', onData);
    hostProc.stderr.on('data', onData);

    const timeout = setTimeout(() => {
      // Kill the process if URL wasn't detected in time
      try {
        hostProc.kill('SIGKILL');
      } catch {
        /* best effort */
      }
      if (state.hostProc === hostProc) state.hostProc = null;
      const kind = classifyError(state.hostOutput);
      settle({ kind: kind === 'unknown' ? 'timeout' : kind, output: state.hostOutput });
    }, HOST_START_TIMEOUT);

    hostProc.on('error', (err) => {
      log.error(`Tunnel process error: ${err.message}`);
      if (state.hostProc === hostProc) state.hostProc = null;
      settle({ kind: classifyError(err.message), output: err.message });
    });

    hostProc.on('exit', (code, signal) => {
      const stale = state.hostProc !== hostProc;
      if (!stale) state.hostProc = null;
      if (!settled) {
        const kind = classifyError(state.hostOutput);
        log.warn(`Tunnel host exited before connecting (code=${code}, ${kind})`);
        settle({ kind, output: state.hostOutput });
        return;
      }
      if (stale || state.stopped) return;
      log.warn(`Tunnel process exited (code=${code}, signal=${signal})`);
      if (state.restarting || state.recovering) return;
      stopHealthCheck();
      tunnelEvents.emit('disconnected');
      if (classifyError(state.hostOutput) === 'gone') {
        recoverGoneTunnel('host exit').catch(() => {});
      } else {
        scheduleRestart();
      }
    });
  });
}

async function startTunnel(port, options = {}) {
  // Check if devtunnel CLI is installed
  let found = findDevtunnel();
  if (!found) {
    found = await promptInstall();
  }
  if (!found) {
    log.error('❌ DevTunnel CLI is not available.');
    log.error('');
    log.error('  Use --no-tunnel for LAN-only mode, or install manually:');
    log.error('    Windows:  winget install Microsoft.devtunnel');
    log.error('    macOS:    brew install --cask devtunnel');
    log.error('    Linux:    curl -sL https://aka.ms/DevTunnelCliInstall | bash');
    log.error('');
    log.error('  Docs: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started');
    log.error('');
    return null;
  }
  devtunnelCmd = found;

  // On macOS, brew --cask installs (and upgrades) tag the binary with
  // com.apple.quarantine. The first time we spawn devtunnel from a
  // non-interactive context Gatekeeper would block it and prompt the user.
  // Strip the attribute on every startup so brew upgrades don't break us.
  stripQuarantine(devtunnelCmd);

  log.info('Starting devtunnel...');
  try {
    // Ensure user is logged in. Prefer Entra over GitHub — Entra tokens auto-refresh
    // via MSAL, while GitHub logins have historically needed re-authentication.
    const loggedIn = isLoggedIn();
    const loginInfo = loggedIn ? getLoginInfo() : null;
    state.loginInfo = loginInfo;
    state.loginInfoAt = Date.now();

    if (loggedIn && loginInfo) {
      const { provider, tokenLifetimeSeconds } = loginInfo;
      if (provider === 'github') {
        log.warn(
          'Logged in with GitHub — if the tunnel drops after a while, switch to Microsoft: ' +
            'devtunnel user login -e -d',
        );
      }
      if (tokenLifetimeSeconds !== null) {
        const h = Math.floor(tokenLifetimeSeconds / 3600);
        const m = Math.round((tokenLifetimeSeconds % 3600) / 60);
        log.info(`DevTunnel token expires in ${h}h ${m}m`);
      }
    }

    if (!loggedIn) {
      log.info('Logging in to DevTunnel with Microsoft Entra (recommended for long sessions)...');
      try {
        execFileSync(devtunnelCmd, ['user', 'login', '-e'], {
          stdio: 'inherit',
          timeout: 30000,
          windowsHide: true,
        });
      } catch {
        log.info('Browser login failed or unavailable, falling back to device code flow...');
        log.info('A code will be displayed — open the URL on any device to authenticate.');
        try {
          await deviceCodeLogin(devtunnelCmd);
        } catch (_loginErr) {
          log.error('');
          log.error('  DevTunnel login failed. To use tunnels, run:');
          log.error('    devtunnel user login -e -d');
          log.error('');
          log.error('  Or start without a tunnel:');
          log.error('    termbeam --no-tunnel');
          log.error('');
          return null;
        }
      }
      refreshLoginInfo().catch(() => {});
    }

    state.port = port;
    state.persisted = !!options.persisted;
    state.anonymous = !!options.anonymous;
    state.stopped = false;
    state.url = null;

    if (state.persisted) {
      const saved = loadPersistedTunnel();
      const savedId = saved && typeof saved.tunnelId === 'string' ? saved.tunnelId : null;
      let reused = false;
      if (savedId && SAFE_ID_RE.test(savedId)) {
        const res = await run(['show', savedId, '--json'], { timeout: 15_000 });
        if (res.ok) {
          state.tunnelId = savedId;
          reused = true;
          log.info(`Reusing persisted tunnel ${savedId}`);
          await configureTunnel(savedId);
          // Push the inactivity expiry out again on every start.
          await run(['update', savedId, '--expiration', expirationArg()], { timeout: 20_000 });
          state.lastExtendAt = Date.now();
        } else {
          log.info('Persisted tunnel expired, creating new one');
        }
      }
      if (!reused) {
        state.tunnelId = await createTunnel();
        savePersistedTunnel(state.tunnelId);
        log.info(`Created new persisted tunnel ${state.tunnelId}`);
      }
    } else {
      // Ephemeral tunnel — create fresh, will be deleted on shutdown
      state.tunnelId = await createTunnel();
      log.info(`Created ephemeral tunnel ${state.tunnelId}`);
    }
    log.info(
      state.anonymous
        ? 'Tunnel access: public (anonymous)'
        : 'Tunnel access: private (owner-only via Microsoft login)',
    );

    const result = await hostTunnel();
    if (!result.url) {
      log.error(`Tunnel host did not start (${result.kind || 'timeout'})`);
      killHostProc();
      return null;
    }
    state.url = result.url;
    state.restartAttempts = 0;
    startHealthCheck();
    startWakeDetector();
    tunnelEvents.emit('connected', { url: result.url });
    return {
      url: result.url,
      mode: state.persisted ? 'persisted' : 'ephemeral',
      expiry: state.persisted ? '30 days' : '1 day',
    };
  } catch (e) {
    log.error(`Tunnel error: ${e.message}`);
    return null;
  }
}

function cleanupTunnel() {
  // Stop watchdog, auth-wait, and network-wait to prevent restart during cleanup
  state.stopped = true;
  stopHealthCheck();
  stopWakeDetector();
  stopAuthWait();
  stopNetworkWait();
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }

  const id = state.tunnelId;
  killHostProc();
  if (id) {
    state.tunnelId = null;
    if (state.persisted) {
      log.info('Tunnel host stopped (tunnel preserved for reuse)');
    } else {
      try {
        execFileSync(devtunnelCmd, ['delete', id, '-f'], {
          stdio: 'pipe',
          timeout: 10000,
          windowsHide: true,
        });
        log.info('Tunnel cleaned up');
      } catch {
        /* best effort — tunnel will expire on its own */
      }
    }
  }

  // Reset watchdog state
  state.consecutiveFailures = 0;
  state.restartAttempts = 0;
  state.restarting = false;
  state.recovering = false;
  state.checking = false;
  state.expiryWarned = false;
  state.url = null;
}

module.exports = {
  startTunnel,
  cleanupTunnel,
  findDevtunnel,
  tunnelEvents,
  getLoginInfo,
  getCachedLoginInfo,
  parseLoginInfo,
  // Exported for tests
  _internal: {
    isNetworkError,
    isAuthError,
    isTunnelGoneError,
    classifyError,
    parseHostConnections,
    checkTunnelHealth,
    hostTunnel,
    recoverGoneTunnel,
    onSystemResume,
    state,
    constants: { HEALTH_CHECK_GRACE, MAX_RESTART_ATTEMPTS, WAKE_GAP_MS, WAKE_TICK_MS },
    setRunner(fn) {
      run = fn || defaultRunner;
    },
    setSpawner(fn) {
      spawnHost = fn || defaultSpawner;
    },
  },
};
