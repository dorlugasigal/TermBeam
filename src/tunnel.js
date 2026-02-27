const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TUNNEL_CONFIG_DIR = path.join(os.homedir(), '.termbeam');
const TUNNEL_CONFIG_PATH = path.join(TUNNEL_CONFIG_DIR, 'tunnel.json');

let tunnelId = null;
let tunnelProc = null;
let devtunnelCmd = 'devtunnel';

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
      execSync(`"${devtunnelCmd}" delete ${persisted.tunnelId} -f`, { stdio: 'pipe' });
      console.log(`[termbeam] Deleted persisted tunnel ${persisted.tunnelId}`);
    } catch {}
    try {
      fs.unlinkSync(TUNNEL_CONFIG_PATH);
    } catch {}
  }
}

function isTunnelValid(id) {
  try {
    execSync(`"${devtunnelCmd}" show ${id} --json`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
      const userOut = execSync(`"${devtunnelCmd}" user show`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      // user show can succeed but show "not logged in" status
      loggedIn = userOut && !userOut.toLowerCase().includes('not logged in');
    } catch {}

    if (!loggedIn) {
      console.log('[termbeam] devtunnel not logged in, launching login...');
      console.log('[termbeam] A browser window will open for authentication.');
      execSync(`"${devtunnelCmd}" user login`, { stdio: 'inherit' });
    }

    const persisted = options.persisted;
    isPersisted = !!persisted;

    // Try to reuse persisted tunnel
    if (persisted) {
      const saved = loadPersistedTunnel();
      if (saved && isTunnelValid(saved.tunnelId)) {
        tunnelId = saved.tunnelId;
        console.log(`[termbeam] Reusing persisted tunnel ${tunnelId}`);
      } else {
        if (saved) {
          console.log('[termbeam] Persisted tunnel expired, creating new one');
        }
        const expiration = '30d';
        const createOut = execSync(`"${devtunnelCmd}" create --expiration ${expiration} --json`, { encoding: 'utf-8' });
        const tunnelData = JSON.parse(createOut);
        tunnelId = tunnelData.tunnel.tunnelId;
        savePersistedTunnel(tunnelId);
        console.log(`[termbeam] Created new persisted tunnel ${tunnelId}`);
      }
    } else {
      // Ephemeral tunnel — create fresh, will be deleted on shutdown
      const createOut = execSync(`"${devtunnelCmd}" create --expiration 1d --json`, { encoding: 'utf-8' });
      const tunnelData = JSON.parse(createOut);
      tunnelId = tunnelData.tunnel.tunnelId;
      console.log(`[termbeam] Created ephemeral tunnel ${tunnelId}`);
    }

    // Idempotent port and access setup
    try {
      execSync(`"${devtunnelCmd}" port create ${tunnelId} -p ${port} --protocol http`, { stdio: 'pipe' });
    } catch {}
    try {
      execSync(`"${devtunnelCmd}" access create ${tunnelId} -p ${port} --anonymous`, { stdio: 'pipe' });
    } catch {}

    const hostProc = spawn(devtunnelCmd, ['host', tunnelId], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
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
          resolve(match[1]);
        }
      });
      hostProc.stderr.on('data', (data) => {
        output += data.toString();
      });
      hostProc.on('error', () => {
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
  if (tunnelProc) {
    try {
      tunnelProc.kill();
    } catch {
      /* best effort */
    }
    tunnelProc = null;
  }
  if (tunnelId) {
    if (isPersisted) {
      console.log('[termbeam] Tunnel host stopped (tunnel preserved for reuse)');
    } else {
      try {
        execSync(`"${devtunnelCmd}" delete ${tunnelId} -f`, { stdio: 'pipe' });
        console.log('[termbeam] Tunnel cleaned up');
      } catch {
        /* best effort */
      }
    }
    tunnelId = null;
  }
}

module.exports = { startTunnel, cleanupTunnel };
