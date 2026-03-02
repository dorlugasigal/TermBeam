const { execSync, execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('./logger');
const { promptInstall } = require('./devtunnel-install');

const TUNNEL_CONFIG_DIR = path.join(os.homedir(), '.termbeam');
const TUNNEL_CONFIG_PATH = path.join(TUNNEL_CONFIG_DIR, 'tunnel.json');

let tunnelId = null;
let tunnelProc = null;
let devtunnelCmd = 'devtunnel';

const SAFE_ID_RE = /^[a-zA-Z0-9._-]+$/;

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

function deletePersisted() {
  const persisted = loadPersistedTunnel();
  if (persisted) {
    try {
      if (SAFE_ID_RE.test(persisted.tunnelId)) {
        execFileSync(devtunnelCmd, ['delete', persisted.tunnelId, '-f'], { stdio: 'pipe' });
        log.info(`Deleted persisted tunnel ${persisted.tunnelId}`);
      }
    } catch {}
    try {
      fs.unlinkSync(TUNNEL_CONFIG_PATH);
    } catch {}
  }
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
    // Ensure user is logged in
    let loggedIn = false;
    try {
      const userOut = execFileSync(devtunnelCmd, ['user', 'show'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // user show can succeed but show "not logged in" status
      loggedIn = userOut && !userOut.toLowerCase().includes('not logged in');
    } catch {}

    if (!loggedIn) {
      log.info('devtunnel not logged in, launching browser login (30s timeout)...');
      try {
        execFileSync(devtunnelCmd, ['user', 'login'], { stdio: 'inherit', timeout: 30000 });
      } catch {
        log.info('Browser login failed or unavailable, falling back to device code flow...');
        log.info('A code will be displayed — open the URL on any device to authenticate.');
        try {
          execFileSync(devtunnelCmd, ['user', 'login', '-d'], { stdio: 'inherit' });
        } catch (loginErr) {
          log.error('');
          log.error('  DevTunnel login failed. To use tunnels, run:');
          log.error('    devtunnel user login');
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

    const hostProc = spawn(devtunnelCmd, ['host', tunnelId], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    tunnelProc = hostProc;

    return new Promise((resolve) => {
      let output = '';
      const timeout = setTimeout(() => resolve(null), 15000);

      hostProc.stdout.on('data', (data) => {
        output += data.toString();
        const match = output.match(/(https:\/\/[^\s]+devtunnels\.ms[^\s]*)/);
        if (match) {
          clearTimeout(timeout);
          resolve({ url: match[1], mode: tunnelMode, expiry: tunnelExpiry });
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
  } catch (e) {
    log.error(`Tunnel error: ${e.message}`);
    return null;
  }
}

function cleanupTunnel() {
  const id = tunnelId;
  if (tunnelProc) {
    try {
      // On Windows, kill the process tree to ensure all children die
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
}

module.exports = { startTunnel, cleanupTunnel, findDevtunnel };
