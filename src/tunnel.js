const { execSync, execFileSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('./logger');

const TUNNEL_CONFIG_DIR = path.join(os.homedir(), '.termbeam');
const TUNNEL_CONFIG_PATH = path.join(TUNNEL_CONFIG_DIR, 'ngrok.json');

let tunnelProc = null;
let ngrokCmd = 'ngrok';

function findNgrok() {
  // Try ngrok directly
  try {
    execSync('ngrok version', { stdio: 'pipe' });
    return 'ngrok';
  } catch {}

  // On Windows, check common install locations
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'ngrok', 'ngrok.exe'),
      path.join(process.env.PROGRAMFILES || '', 'ngrok', 'ngrok.exe'),
      path.join(os.homedir(), 'ngrok', 'ngrok.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }

  // On macOS/Linux, check common locations
  if (process.platform !== 'win32') {
    const candidates = [
      '/usr/local/bin/ngrok',
      '/opt/homebrew/bin/ngrok',
      path.join(os.homedir(), 'ngrok'),
      path.join(os.homedir(), '.local', 'bin', 'ngrok'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        return p;
      }
    }
  }

  return null;
}

function loadPersistedConfig() {
  try {
    if (fs.existsSync(TUNNEL_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(TUNNEL_CONFIG_PATH, 'utf-8'));
    }
  } catch {}
  return null;
}

function savePersistedConfig(domain) {
  fs.mkdirSync(TUNNEL_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    TUNNEL_CONFIG_PATH,
    JSON.stringify({ domain, createdAt: new Date().toISOString() }, null, 2),
  );
}

let isPersisted = false;

async function startTunnel(port, options = {}) {
  // Check if ngrok CLI is installed
  const found = findNgrok();
  if (!found) {
    log.error('❌ ngrok CLI is not installed.');
    log.error('');
    log.error('  The --tunnel flag requires ngrok.');
    log.error('');
    log.error('  Install it:');
    log.error('    macOS:    brew install ngrok/ngrok/ngrok');
    log.error('    Windows:  choco install ngrok');
    log.error('              or download from https://ngrok.com/download');
    log.error('    Linux:    snap install ngrok');
    log.error('              or download from https://ngrok.com/download');
    log.error('');
    log.error('  Then authenticate with your ngrok authtoken:');
    log.error('    ngrok config add-authtoken <your-token>');
    log.error('');
    log.error('  Get your authtoken at: https://dashboard.ngrok.com/get-started/your-authtoken');
    log.error('');
    return null;
  }
  ngrokCmd = found;

  log.info('Starting ngrok tunnel...');
  try {
    // Check if ngrok is authenticated
    let authenticated = false;
    try {
      const configOut = execFileSync(ngrokCmd, ['config', 'check'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      authenticated = !configOut.toLowerCase().includes('error');
    } catch {
      // config check may fail if no config exists, but ngrok might still work
      // with environment variable NGROK_AUTHTOKEN
      authenticated = !!process.env.NGROK_AUTHTOKEN;
    }

    if (!authenticated) {
      log.warn('ngrok may not be authenticated.');
      log.warn('If tunnel fails, run: ngrok config add-authtoken <your-token>');
    }

    const persisted = options.persisted;
    isPersisted = !!persisted;

    // Build ngrok command arguments
    const ngrokArgs = ['http', String(port)];

    // For persisted tunnels, try to use a saved domain or request a static one
    if (persisted) {
      const saved = loadPersistedConfig();
      if (saved && saved.domain) {
        // Use the saved domain
        ngrokArgs.push('--domain', saved.domain);
        log.info(`Reusing persisted domain: ${saved.domain}`);
      } else {
        log.info('Creating new tunnel (domain will be saved for reuse)');
      }
    }

    // Start ngrok process
    const ngrokProc = spawn(ngrokCmd, ngrokArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    tunnelProc = ngrokProc;

    return new Promise((resolve) => {
      let output = '';
      const timeout = setTimeout(() => {
        log.error('Tunnel startup timed out');
        resolve(null);
      }, 15000);

      // ngrok outputs to stderr for logs
      ngrokProc.stderr.on('data', (data) => {
        output += data.toString();
        log.debug(`ngrok stderr: ${data.toString().trim()}`);
      });

      ngrokProc.stdout.on('data', (data) => {
        output += data.toString();
        log.debug(`ngrok stdout: ${data.toString().trim()}`);
      });

      ngrokProc.on('error', (err) => {
        log.error(`Tunnel process error: ${err.message}`);
        clearTimeout(timeout);
        resolve(null);
      });

      ngrokProc.on('close', (code) => {
        if (code !== null && code !== 0) {
          log.error(`ngrok exited with code ${code}`);
          log.debug(`ngrok output: ${output}`);
          clearTimeout(timeout);
          resolve(null);
        }
      });

      // Poll the ngrok API to get the public URL
      // ngrok exposes a local API at http://127.0.0.1:4040
      const pollForUrl = async () => {
        const http = require('http');
        const maxAttempts = 30;
        let attempts = 0;

        const checkApi = () => {
          attempts++;
          const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => {
              try {
                const data = JSON.parse(body);
                if (data.tunnels && data.tunnels.length > 0) {
                  const tunnel = data.tunnels.find((t) => t.proto === 'https') || data.tunnels[0];
                  const publicUrl = tunnel.public_url;
                  clearTimeout(timeout);

                  // Extract domain for persistence
                  if (isPersisted && publicUrl) {
                    try {
                      const url = new URL(publicUrl);
                      savePersistedConfig(url.hostname);
                      log.info(`Saved domain for reuse: ${url.hostname}`);
                    } catch {}
                  }

                  const tunnelMode = isPersisted ? 'persisted' : 'ephemeral';
                  resolve({ url: publicUrl, mode: tunnelMode, expiry: 'session' });
                  return;
                }
              } catch {}

              if (attempts < maxAttempts) {
                setTimeout(checkApi, 500);
              } else {
                clearTimeout(timeout);
                resolve(null);
              }
            });
          });

          req.on('error', () => {
            if (attempts < maxAttempts) {
              setTimeout(checkApi, 500);
            } else {
              clearTimeout(timeout);
              resolve(null);
            }
          });
        };

        // Give ngrok a moment to start before polling
        setTimeout(checkApi, 1000);
      };

      pollForUrl();
    });
  } catch (e) {
    log.error(`Tunnel error: ${e.message}`);
    return null;
  }
}

function cleanupTunnel() {
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
        tunnelProc.kill('SIGTERM');
        // Give it a moment to exit gracefully, then force kill
        setTimeout(() => {
          try {
            tunnelProc.kill('SIGKILL');
          } catch {
            /* already dead */
          }
        }, 1000);
      }
    } catch {
      /* best effort */
    }
    tunnelProc = null;
    log.info('Tunnel stopped');
  }
}

module.exports = { startTunnel, cleanupTunnel };
