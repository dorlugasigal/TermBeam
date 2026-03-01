const { execSync, execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

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
  fs.writeFileSync(TUNNEL_CONFIG_PATH, JSON.stringify({ tunnelId: id, createdAt: new Date().toISOString() }, null, 2));
}

function deletePersisted() {
  const persisted = loadPersistedTunnel();
  if (persisted) {
    try {
      if (SAFE_ID_RE.test(persisted.tunnelId)) {
        execFileSync(devtunnelCmd, ['delete', persisted.tunnelId, '-f'], { stdio: 'pipe' });
        console.log(`[termbeam] Deleted persisted tunnel ${persisted.tunnelId}`);
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
    execFileSync(devtunnelCmd, ['show', id, '--json'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

let isPersisted = false;

async function startTunnel(port, options = {}) {
  // Check if devtunnel CLI is installed
  const found = findDevtunnel();
  if (!found) {
    console.error('[termbeam] ❌ devtunnel CLI is not installed.');
    console.error('');
    console.error('  The --tunnel flag requires the Azure Dev Tunnels CLI.');
    console.error('');
    console.error('  Install it:');
    console.error('    Windows:  winget install Microsoft.devtunnel');
    console.error('             or: Invoke-WebRequest -Uri https://aka.ms/TunnelsCliDownload/win-x64 -OutFile devtunnel.exe');
    console.error('    macOS:    brew install --cask devtunnel');
    console.error('    Linux:    curl -sL https://aka.ms/DevTunnelCliInstall | bash');
    console.error('');
    console.error('  Then restart your terminal and try again.');
    console.error('  Docs: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started');
    console.error('');
    return null;
  }
  devtunnelCmd = found;

  console.log('[termbeam] Starting devtunnel...');
  try {
    // Ensure user is logged in
    let loggedIn = false;
    try {
      const userOut = execFileSync(devtunnelCmd, ['user', 'show'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      // user show can succeed but show "not logged in" status
      loggedIn = userOut && !userOut.toLowerCase().includes('not logged in');
    } catch {}

    if (!loggedIn) {
      console.log('[termbeam] devtunnel not logged in, launching login...');
      console.log('[termbeam] A browser window will open for authentication.');
      execFileSync(devtunnelCmd, ['user', 'login'], { stdio: 'inherit' });
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
        console.log(`[termbeam] Reusing persisted tunnel ${tunnelId}`);
      } else {
        if (saved) {
          console.log('[termbeam] Persisted tunnel expired, creating new one');
        }
        const createOut = execFileSync(devtunnelCmd, ['create', '--expiration', '30d', '--json'], { encoding: 'utf-8' });
        const tunnelData = JSON.parse(createOut);
        tunnelId = tunnelData.tunnel.tunnelId;
        savePersistedTunnel(tunnelId);
        console.log(`[termbeam] Created new persisted tunnel ${tunnelId}`);
      }
    } else {
      tunnelMode = 'ephemeral';
      tunnelExpiry = '1 day';
      // Ephemeral tunnel — create fresh, will be deleted on shutdown
      const createOut = execFileSync(devtunnelCmd, ['create', '--expiration', '1d', '--json'], { encoding: 'utf-8' });
      const tunnelData = JSON.parse(createOut);
      tunnelId = tunnelData.tunnel.tunnelId;
      console.log(`[termbeam] Created ephemeral tunnel ${tunnelId}`);
    }

    // Idempotent port and access setup
    try {
      execFileSync(devtunnelCmd, ['port', 'create', tunnelId, '-p', String(port), '--protocol', 'http'], { stdio: 'pipe' });
    } catch {}
    try {
      execFileSync(devtunnelCmd, ['access', 'create', tunnelId, '-p', String(port), '--anonymous'], { stdio: 'pipe' });
    } catch {}

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
        console.error(`[termbeam] Tunnel process error: ${err.message}`);
        clearTimeout(timeout);
        resolve(null);
      });
    });
  } catch (e) {
    console.error(`[termbeam] Tunnel error: ${e.message}`);
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
          execFileSync('taskkill', ['/pid', String(tunnelProc.pid), '/T', '/F'], { stdio: 'pipe', timeout: 5000 });
        } catch { /* best effort */ }
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
      console.log('[termbeam] Tunnel host stopped (tunnel preserved for reuse)');
    } else {
      try {
        execFileSync(devtunnelCmd, ['delete', id, '-f'], { stdio: 'pipe', timeout: 10000 });
        console.log('[termbeam] Tunnel cleaned up');
      } catch {
        /* best effort — tunnel will expire on its own */
      }
    }
  }
}

module.exports = { startTunnel, cleanupTunnel };
