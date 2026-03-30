const { execSync, execFileSync, execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');
const log = require('../utils/logger');
const { promptInstall } = require('./install');

const TUNNEL_CONFIG_DIR = path.join(os.homedir(), '.termbeam');
const TUNNEL_CONFIG_PATH = path.join(TUNNEL_CONFIG_DIR, 'tunnel.json');

let tunnelId = null;
let tunnelProc = null;
let devtunnelCmd = 'devtunnel';

// --- Watchdog state ---
const tunnelEvents = new EventEmitter();
let healthCheckInterval = null;
let consecutiveFailures = 0;
let restartAttempts = 0;
let isRestarting = false;
let restartTimer = null;

// --- Auth-wait state ---
let waitingForAuth = false;
let authCheckInterval = null;

const HEALTH_CHECK_INTERVAL = 30_000; // 30s between checks
const HEALTH_CHECK_GRACE = 2; // 2 consecutive failures before restart
const MAX_RESTART_ATTEMPTS = 10;
const BACKOFF_DELAYS = [1000, 2000, 5000, 10_000, 15_000, 30_000]; // then stays at 30s
const AUTH_CHECK_INTERVAL = 30_000; // 30s between auth re-checks

const AUTH_ERROR_PATTERNS = ['login required', 'not logged in', 'sign in required'];

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

const DEVICE_CODE_INITIAL_TIMEOUT = 15000;
const DEVICE_CODE_AUTH_TIMEOUT = 120000;

function isAuthError(message) {
  const lower = (message || '').toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p));
}

function isLoggedIn() {
  try {
    const out = execFileSync(devtunnelCmd, ['user', 'show'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return out && !out.toLowerCase().includes('not logged in');
  } catch {
    return false;
  }
}

function getLoginInfo() {
  try {
    const out = execFileSync(devtunnelCmd, ['user', 'show', '-v'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    if (!out || out.toLowerCase().includes('not logged in')) return null;

    let provider = 'unknown';
    if (out.toLowerCase().includes('github')) provider = 'github';
    else if (out.toLowerCase().includes('microsoft')) provider = 'microsoft';

    // Parse "Token lifetime: H:MM:SS" from verbose output
    let tokenLifetimeHours = null;
    const ltMatch = out.match(/Token lifetime:\s*(\d+):(\d+):(\d+)/);
    if (ltMatch) {
      tokenLifetimeHours =
        parseInt(ltMatch[1], 10) + parseInt(ltMatch[2], 10) / 60 + parseInt(ltMatch[3], 10) / 3600;
    }

    return { provider, tokenLifetimeHours };
  } catch {
    return null;
  }
}

function deviceCodeLogin(cmd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, ['user', 'login', '-e', '-d'], {
      stdio: ['inherit', 'pipe', 'pipe'],
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
    execSync('devtunnel --version', { stdio: 'pipe' });
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
      execFileSync(homeBin, ['--version'], { stdio: 'pipe' });
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

function isTunnelValid(id) {
  try {
    if (!SAFE_ID_RE.test(id)) return false;
    execFileSync(devtunnelCmd, ['show', id, '--json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

let isPersisted = false;

// --- Watchdog: health check & auto-restart ---

function checkTunnelHealth() {
  if (!tunnelId || !tunnelProc || isRestarting || waitingForAuth) return;

  const abortCtrl = new AbortController();
  const timer = setTimeout(() => abortCtrl.abort(), 10_000);

  execFile(
    devtunnelCmd,
    ['show', tunnelId],
    { encoding: 'utf-8', signal: abortCtrl.signal },
    (err, stdout) => {
      clearTimeout(timer);

      if (err) {
        // Auth errors are handled separately — no restart countdown
        if (isAuthError(err.message) || isAuthError(err.stderr)) {
          handleAuthExpiration();
          return;
        }

        consecutiveFailures++;
        log.warn(
          `Tunnel health check error: ${err.message} (${consecutiveFailures}/${HEALTH_CHECK_GRACE})`,
        );
        if (consecutiveFailures >= HEALTH_CHECK_GRACE) {
          handleTunnelFailure();
        }
        return;
      }

      const match = stdout.match(/Host connections\s*:\s*(\d+)/i);
      if (!match) {
        consecutiveFailures++;
        log.warn(
          `Tunnel health check: could not parse host connections (${consecutiveFailures}/${HEALTH_CHECK_GRACE})`,
        );
        if (consecutiveFailures >= HEALTH_CHECK_GRACE) {
          handleTunnelFailure();
        }
        return;
      }

      const hostConns = parseInt(match[1], 10);
      if (hostConns > 0) {
        if (consecutiveFailures > 0) {
          log.info(`Tunnel health restored (${hostConns} host connection(s))`);
        }
        consecutiveFailures = 0;
        return;
      }

      consecutiveFailures++;
      log.warn(
        `Tunnel health check: 0 host connections (${consecutiveFailures}/${HEALTH_CHECK_GRACE})`,
      );

      if (consecutiveFailures >= HEALTH_CHECK_GRACE) {
        log.warn('Tunnel connection lost — initiating restart');
        handleTunnelFailure();
      }
    },
  );
}

function startHealthCheck() {
  stopHealthCheck();
  consecutiveFailures = 0;
  healthCheckInterval = setInterval(checkTunnelHealth, HEALTH_CHECK_INTERVAL);
  healthCheckInterval.unref();
}

function stopHealthCheck() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

function handleTunnelFailure() {
  if (isRestarting) return;
  stopHealthCheck();
  killTunnelProc();

  tunnelEvents.emit('disconnected');
  scheduleRestart();
}

// --- Auth-expiration handling ---

function killTunnelProc() {
  if (!tunnelProc) return;
  try {
    if (process.platform === 'win32' && tunnelProc.pid) {
      try {
        execFileSync('taskkill', ['/pid', String(tunnelProc.pid), '/T', '/F'], {
          stdio: 'pipe',
          timeout: 5000,
        });
      } catch {
        /* best effort */
      }
    } else {
      tunnelProc.kill('SIGKILL');
    }
  } catch {
    /* best effort */
  }
  tunnelProc = null;
}

function handleAuthExpiration() {
  if (waitingForAuth) return;
  stopHealthCheck();
  killTunnelProc();

  tunnelEvents.emit('disconnected');
  tunnelEvents.emit('auth-expired');
  startAuthWait();
}

function startAuthWait() {
  if (waitingForAuth) return;
  waitingForAuth = true;
  isRestarting = false;
  restartAttempts = 0;
  consecutiveFailures = 0;

  log.warn('DevTunnel auth token expired (Microsoft tokens expire after a few days).');
  log.warn('Tunnel is paused — re-authenticate on the host machine to restore:');
  log.warn('  devtunnel user login -d');
  log.warn('Tunnel will auto-reconnect once auth is restored.');

  authCheckInterval = setInterval(() => {
    if (isLoggedIn()) {
      log.info('DevTunnel auth restored — resuming tunnel');
      stopAuthWait();
      tunnelEvents.emit('auth-restored');
      scheduleRestart();
    }
  }, AUTH_CHECK_INTERVAL);
  authCheckInterval.unref();
}

function stopAuthWait() {
  waitingForAuth = false;
  if (authCheckInterval) {
    clearInterval(authCheckInterval);
    authCheckInterval = null;
  }
}

function scheduleRestart() {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    log.error(
      `Tunnel restart failed after ${MAX_RESTART_ATTEMPTS} attempts — giving up. Tunnel URL is unreachable.`,
    );
    tunnelEvents.emit('failed', { attempts: restartAttempts });
    isRestarting = false;
    return;
  }

  isRestarting = true;
  const delay = BACKOFF_DELAYS[Math.min(restartAttempts, BACKOFF_DELAYS.length - 1)];
  restartAttempts++;

  log.info(`Restarting tunnel in ${delay}ms (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})`);
  tunnelEvents.emit('reconnecting', { attempt: restartAttempts, delay });

  restartTimer = setTimeout(async () => {
    restartTimer = null;

    // If auth expired since restart was scheduled, switch to auth-wait mode
    if (!isLoggedIn()) {
      log.warn('DevTunnel auth expired during restart — waiting for re-authentication');
      isRestarting = false;
      handleAuthExpiration();
      return;
    }

    try {
      const result = await hostTunnel();
      if (result) {
        log.info('Tunnel reconnected successfully');
        restartAttempts = 0;
        isRestarting = false;
        tunnelEvents.emit('connected', { url: result.url });
        startHealthCheck();
      } else {
        log.warn('Tunnel restart returned no URL');
        isRestarting = false;
        scheduleRestart();
      }
    } catch (err) {
      log.error(`Tunnel restart error: ${err.message}`);
      isRestarting = false;
      scheduleRestart();
    }
  }, delay);
  restartTimer.unref();
}

/**
 * Spawn `devtunnel host` for the current tunnelId and wait for the URL.
 * Used by both initial start and watchdog restarts.
 */
function hostTunnel() {
  const hostProc = spawn(devtunnelCmd, ['host', tunnelId], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  tunnelProc = hostProc;

  // Attach exit handler for crash detection
  hostProc.on('exit', (code, signal) => {
    if (tunnelProc !== hostProc) return; // stale reference
    log.warn(`Tunnel process exited (code=${code}, signal=${signal})`);
    tunnelProc = null;
    if (!isRestarting) {
      tunnelEvents.emit('disconnected');
      scheduleRestart();
    }
  });

  return new Promise((resolve) => {
    let output = '';
    const timeout = setTimeout(() => {
      // Kill the process if URL wasn't detected in time
      try {
        hostProc.kill('SIGKILL');
      } catch {
        /* best effort */
      }
      if (tunnelProc === hostProc) tunnelProc = null;
      resolve(null);
    }, 15_000);

    hostProc.stdout.on('data', (data) => {
      output += data.toString();
      const match = output.match(/(https:\/\/[^\s]+devtunnels\.ms[^\s]*)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ url: match[1] });
      }
    });
    hostProc.stderr.on('data', (data) => {
      output += data.toString();
    });
    hostProc.on('error', (err) => {
      log.error(`Tunnel process error: ${err.message}`);
      clearTimeout(timeout);
      resolve(null);
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

  log.info('Starting devtunnel...');
  try {
    // Ensure user is logged in. Prefer Entra over GitHub — Entra tokens auto-refresh
    // for weeks via MSAL, while GitHub tokens expire after 8 hours.
    let loggedIn = isLoggedIn();
    const loginInfo = loggedIn ? getLoginInfo() : null;

    if (loggedIn && loginInfo) {
      const { provider, tokenLifetimeHours } = loginInfo;
      if (provider === 'github') {
        log.warn(
          'Logged in with GitHub — tokens expire every 8 hours. ' +
            'For longer sessions, use: devtunnel user login -e -d',
        );
      }
      if (tokenLifetimeHours !== null) {
        const h = Math.floor(tokenLifetimeHours);
        const m = Math.round((tokenLifetimeHours - h) * 60);
        log.info(`DevTunnel token expires in ${h}h ${m}m`);
      }
    }

    if (!loggedIn) {
      log.info('Logging in to DevTunnel with Microsoft Entra (recommended for long sessions)...');
      try {
        execFileSync(devtunnelCmd, ['user', 'login', '-e'], { stdio: 'inherit', timeout: 30000 });
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
    }

    const persisted = options.persisted;
    isPersisted = !!persisted;

    // Try to reuse persisted tunnel
    let tunnelMode, tunnelExpiry;
    if (persisted) {
      tunnelMode = 'persisted';
      tunnelExpiry = '30 days';
      const saved = loadPersistedTunnel();
      if (saved && isTunnelValid(saved.tunnelId)) {
        tunnelId = saved.tunnelId;
        log.info(`Reusing persisted tunnel ${tunnelId}`);
      } else {
        if (saved) {
          log.info('Persisted tunnel expired, creating new one');
        }
        const createOut = execFileSync(devtunnelCmd, ['create', '--expiration', '30d', '--json'], {
          encoding: 'utf-8',
        });
        const tunnelData = JSON.parse(createOut);
        tunnelId = tunnelData.tunnel.tunnelId;
        savePersistedTunnel(tunnelId);
        log.info(`Created new persisted tunnel ${tunnelId}`);
      }
    } else {
      tunnelMode = 'ephemeral';
      tunnelExpiry = '1 day';
      // Ephemeral tunnel — create fresh, will be deleted on shutdown
      const createOut = execFileSync(devtunnelCmd, ['create', '--expiration', '1d', '--json'], {
        encoding: 'utf-8',
      });
      const tunnelData = JSON.parse(createOut);
      tunnelId = tunnelData.tunnel.tunnelId;
      log.info(`Created ephemeral tunnel ${tunnelId}`);
    }

    // Idempotent port and access setup
    try {
      execFileSync(
        devtunnelCmd,
        ['port', 'create', tunnelId, '-p', String(port), '--protocol', 'http'],
        { stdio: 'pipe' },
      );
    } catch {}
    // Set tunnel access: public (anonymous) or private (owner-only via Microsoft login)
    if (options.anonymous) {
      try {
        execFileSync(
          devtunnelCmd,
          ['access', 'create', tunnelId, '-p', String(port), '--anonymous'],
          { stdio: 'pipe' },
        );
      } catch {}
      log.info('Tunnel access: public (anonymous)');
    } else {
      // Remove any existing anonymous access to ensure the tunnel is private
      try {
        execFileSync(devtunnelCmd, ['access', 'reset', tunnelId], {
          stdio: 'pipe',
        });
      } catch {}
      log.info('Tunnel access: private (owner-only via Microsoft login)');
    }

    const result = await hostTunnel();
    if (result) {
      result.mode = tunnelMode;
      result.expiry = tunnelExpiry;
      startHealthCheck();
      tunnelEvents.emit('connected', { url: result.url });
    }
    return result;
  } catch (e) {
    log.error(`Tunnel error: ${e.message}`);
    return null;
  }
}

function cleanupTunnel() {
  // Stop watchdog and auth-wait to prevent restart during cleanup
  stopHealthCheck();
  stopAuthWait();
  isRestarting = true; // prevent exit handler from restarting
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  const id = tunnelId;
  killTunnelProc();
  if (id) {
    tunnelId = null;
    if (isPersisted) {
      log.info('Tunnel host stopped (tunnel preserved for reuse)');
    } else {
      try {
        execFileSync(devtunnelCmd, ['delete', id, '-f'], { stdio: 'pipe', timeout: 10000 });
        log.info('Tunnel cleaned up');
      } catch {
        /* best effort — tunnel will expire on its own */
      }
    }
  }

  // Reset watchdog state
  consecutiveFailures = 0;
  restartAttempts = 0;
  isRestarting = false;
}

module.exports = { startTunnel, cleanupTunnel, findDevtunnel, tunnelEvents };
