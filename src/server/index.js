#!/usr/bin/env node
const os = require('os');
const path = require('path');
const readline = require('readline');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const { parseArgs } = require('../cli');
const { createAuth } = require('./auth');
const { SessionManager } = require('./sessions');
const { setupRoutes, cleanupUploadedFiles } = require('./routes');
const { setupWebSocket } = require('./websocket');
const {
  startTunnel,
  cleanupTunnel,
  findDevtunnel,
  tunnelEvents,
  getLoginInfo,
} = require('../tunnel');
const { createPreviewProxy } = require('./preview');
const { writeConnectionConfig, removeConnectionConfig } = require('../cli/resume');
const { checkForUpdate, detectInstallMethod } = require('../utils/update-check');
const { PushManager } = require('./push');
const { readPreferences } = require('./preferences');

// --- Helpers ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function confirmPublicTunnel() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('  Do you want to continue with public access? (y/N): ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * Create a TermBeam server instance without starting it.
 * @param {object} [overrides] - Optional overrides
 * @param {object} [overrides.config] - Full config object (skips parseArgs)
 * @returns {{ app, server, wss, sessions, config, auth, start, shutdown }}
 */
function createTermBeamServer(overrides = {}) {
  const config = overrides.config || parseArgs();
  const log = require('../utils/logger');
  if (config.logLevel) log.setLevel(config.logLevel);
  const auth = createAuth(config.password);
  const sessions = new SessionManager();

  // Push notification manager
  const configDir = process.env.TERMBEAM_CONFIG_DIR || path.join(os.homedir(), '.termbeam');
  const pushManager = new PushManager(configDir);
  pushManager.init().catch((err) => {
    log.warn(`Push notification init failed: ${err.message}`);
  });
  sessions.onCommandComplete = ({ sessionId, sessionName }) => {
    void pushManager
      .notify({
        title: 'Command finished',
        body: `Session: ${sessionName}`,
        tag: `termbeam-cmd-${sessionId}-${Date.now()}`,
        url: `/terminal`,
        type: 'command-complete',
        sessionId,
      })
      .catch((err) => {
        log.warn(`Push notification failed: ${err.message}`);
      });
  };

  // --- Express ---
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, res, next) => {
    // Don't apply TermBeam's security headers to proxied preview content
    if (req.path.startsWith('/preview/')) return next();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // PWA assets (icons, manifest) must be cacheable for Safari iOS home screen icons.
    // Safari skips apple-touch-icon entirely when Cache-Control: no-store is set.
    const isPwaAsset = req.path.startsWith('/icons/') || req.path === '/manifest.webmanifest';
    res.setHeader('Cache-Control', isPwaAsset ? 'public, max-age=86400' : 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://img.shields.io https://github.com https://raw.githubusercontent.com https://avatars.githubusercontent.com https://api.securityscorecards.dev https://termbeam.pages.dev; connect-src 'self' ws: wss: https://cdn.jsdelivr.net; font-src 'self' https://cdn.jsdelivr.net",
    );
    next();
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 * 1024 * 1024 });

  let copilotService = null;
  try {
    const { CopilotService } = require('./copilot-sdk');
    if (CopilotService) copilotService = new CopilotService();
  } catch {
    log.info('Copilot SDK not available — agent features disabled');
  }

  const state = { shareBaseUrl: null, updateInfo: null, wss, tunnelStatus: null, getLoginInfo };
  app.use('/preview', auth.middleware, createPreviewProxy());
  setupRoutes(app, { auth, sessions, config, state, pushManager, copilotService, configDir });
  setupWebSocket(wss, { auth, sessions, copilotService });

  // --- Lifecycle ---
  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutdown initiated');
    auth.cleanup();
    sessions.shutdown();
    if (copilotService) copilotService.shutdown().catch(() => {});
    cleanupUploadedFiles();
    tunnelEvents.removeAllListeners();
    cleanupTunnel();
    removeConnectionConfig();
    for (const client of wss.clients) {
      client.close(1001, 'Server shutting down');
    }
    server.close();
    wss.close();
  }

  // Shutdown endpoint for --force (loopback only)
  app.post('/api/shutdown', auth.middleware, (req, res) => {
    const remoteAddress = req.socket && req.socket.remoteAddress;
    if (
      remoteAddress !== '127.0.0.1' &&
      remoteAddress !== '::1' &&
      remoteAddress !== '::ffff:127.0.0.1'
    ) {
      res.status(403).json({ error: 'Shutdown is only available from localhost' });
      return;
    }
    res.json({ ok: true });
    console.log('\n[termbeam] Shutdown requested by another instance. Goodbye!');
    setTimeout(() => {
      shutdown();
      process.exit(0);
    }, 100);
  });

  async function start() {
    // If tunnel mode is on but devtunnel is missing, offer to install it
    if (config.useTunnel && !findDevtunnel()) {
      const { promptInstall } = require('../tunnel/install');
      const installed = await promptInstall();
      if (!installed) {
        log.error('❌ DevTunnel CLI is not available.');
        log.error('');
        log.error('  Use --no-tunnel for LAN-only mode, or install manually:');
        log.error('    Windows:  winget install Microsoft.devtunnel');
        log.error('    macOS:    brew install --cask devtunnel');
        log.error('    Linux:    curl -sL https://aka.ms/DevTunnelCliInstall | bash');
        log.error('');
        log.error(
          '  Docs: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started',
        );
        log.error('');
        process.exit(1);
      }
    }

    // Warn and require consent for public tunnel access
    if (config.useTunnel && config.publicTunnel) {
      const rd = '\x1b[31m';
      const yl = '\x1b[33m';
      const rs = '\x1b[0m';
      const bd = '\x1b[1m';
      console.log('');
      console.log(`  ${rd}${bd}⚠️  DANGER: Public tunnel access requested${rs}`);
      console.log('');
      console.log(`  ${yl}This will make your terminal accessible to ANYONE with the URL.${rs}`);
      console.log(`  ${yl}No Microsoft login will be required to reach the tunnel.${rs}`);
      console.log(`  ${yl}Only the TermBeam password will protect your terminal.${rs}`);
      console.log('');
      const confirmed = await confirmPublicTunnel();
      if (!confirmed) {
        console.log('');
        console.log('  Aborted. Restart without --public for private access.');
        console.log('');
        process.exit(1);
      }
    }

    return new Promise((resolve) => {
      server.listen(config.port, config.host, async () => {
        const actualPort = server.address().port;
        const ip = getLocalIP();
        const localUrl = `http://${ip}:${actualPort}`;

        // Save connection info for `termbeam resume` auto-discovery
        try {
          const connHost =
            config.host === '0.0.0.0' ||
            config.host === '127.0.0.1' ||
            config.host === '::' ||
            config.host === '::1'
              ? 'localhost'
              : config.host;
          writeConnectionConfig({
            port: actualPort,
            host: connHost,
            password: config.password || null,
          });
        } catch {
          /* non-critical — resume will fall back to defaults */
        }

        // Skip the default session when the user has a saved workspace
        // that will auto-start client-side (workspaces[].default OR the
        // legacy startupWorkspace.enabled with sessions). The autoboot
        // in App.tsx checks `existing.length === 0` before spawning, so
        // creating a default session here would block the workspace from
        // ever opening.
        let skipDefaultSession = false;
        try {
          const { prefs } = readPreferences(configDir);
          const hasDefaultWorkspace = (prefs.workspaces || []).some(
            (w) => w.default && Array.isArray(w.sessions) && w.sessions.length > 0,
          );
          const hasLegacyEnabled =
            prefs.startupWorkspace &&
            prefs.startupWorkspace.enabled &&
            Array.isArray(prefs.startupWorkspace.sessions) &&
            prefs.startupWorkspace.sessions.length > 0;
          // If there's exactly one named workspace (treated as default by
          // the client even without an explicit flag), skip too.
          const hasSingleNamedWorkspace =
            (prefs.workspaces || []).length === 1 &&
            Array.isArray(prefs.workspaces[0].sessions) &&
            prefs.workspaces[0].sessions.length > 0;
          skipDefaultSession = hasDefaultWorkspace || hasLegacyEnabled || hasSingleNamedWorkspace;
        } catch {
          // best-effort: if prefs read fails, fall back to creating the default
        }

        let defaultId;
        if (!skipDefaultSession) {
          defaultId = sessions.create({
            name: path.basename(config.cwd),
            shell: config.shell,
            args: config.shellArgs,
            cwd: config.cwd,
          });
        } else {
          log.info(
            'Skipping default startup session (saved workspace will be auto-launched by client)',
          );
        }

        const lp = '\x1b[38;5;141m'; // light purple
        const rs = '\x1b[0m'; // reset
        console.log('');
        console.log(
          `${lp}  ████████╗███████╗██████╗ ███╗   ███╗██████╗ ███████╗ █████╗ ███╗   ███╗${rs}`,
        );
        console.log(
          `${lp}  ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔════╝██╔══██╗████╗ ████║${rs}`,
        );
        console.log(
          `${lp}     ██║   █████╗  ██████╔╝██╔████╔██║██████╔╝█████╗  ███████║██╔████╔██║${rs}`,
        );
        console.log(
          `${lp}     ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║${rs}`,
        );
        console.log(
          `${lp}     ██║   ███████╗██║  ██║██║ ╚═╝ ██║██████╔╝███████╗██║  ██║██║ ╚═╝ ██║${rs}`,
        );
        console.log(
          `${lp}     ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝${rs}`,
        );
        console.log('');
        console.log(`  Beam your terminal to any device 📡  v${config.version}`);
        console.log('');
        const isLanReachable =
          config.host === '0.0.0.0' || config.host === '::' || config.host === ip;
        state.shareBaseUrl = isLanReachable ? localUrl : `http://localhost:${actualPort}`;
        const gn = '\x1b[38;5;114m'; // green
        const _dm = '\x1b[2m'; // dim

        const bl = '\x1b[38;5;75m'; // light blue

        let publicUrl = null;
        if (config.useTunnel) {
          // Wire up tunnel events BEFORE starting (startTunnel emits during setup)
          tunnelEvents.removeAllListeners();
          tunnelEvents.on('disconnected', () => {
            log.warn('Tunnel disconnected — watchdog will attempt to reconnect');
            state.tunnelStatus = { state: 'disconnected' };
          });
          tunnelEvents.on('auth-expired', () => {
            log.warn('Tunnel auth expired — run "devtunnel user login" on host to restore');
            state.tunnelStatus = { state: 'auth-expired' };
          });
          tunnelEvents.on('auth-restored', () => {
            log.info('Tunnel auth restored — resuming reconnection');
          });
          tunnelEvents.on('reconnecting', ({ attempt, delay }) => {
            log.info(`Tunnel reconnecting (attempt ${attempt}, backoff ${delay}ms)`);
          });
          tunnelEvents.on('connected', ({ url }) => {
            log.info(`Tunnel connected: ${url}`);
            state.tunnelStatus = { state: 'connected' };
          });
          tunnelEvents.on('failed', ({ attempts }) => {
            log.error(
              `Tunnel watchdog gave up after ${attempts} attempts — tunnel URL is unreachable`,
            );
            state.tunnelStatus = { state: 'failed' };
          });

          const tunnel = await startTunnel(actualPort, {
            persisted: config.persistedTunnel,
            anonymous: config.publicTunnel,
          });
          if (tunnel) {
            publicUrl = tunnel.url;
            state.shareBaseUrl = publicUrl;
          } else {
            // Check if failure is due to missing auth
            const loginInfo = getLoginInfo();
            if (!loginInfo) {
              log.warn('Tunnel failed to start — not authenticated.');
              console.log('  ⚠️  Tunnel auth required. Log in with: devtunnel user login -e -d');
              state.tunnelStatus = { state: 'auth-expired' };
            } else {
              log.warn('Tunnel failed to start, falling back to LAN-only');
              console.log('  ⚠️  Tunnel failed to start. Using LAN only.');
            }
          }
        }

        console.log(`  Shell:    ${config.shell}`);
        if (defaultId) {
          console.log(`  Session:  ${defaultId}`);
        } else {
          console.log(`  Session:  (workspace auto-launches on connect)`);
        }
        console.log(`  Auth:     ${config.password ? `${gn}🔒 password${rs}` : '🔓 none'}`);
        if (isLanReachable) {
          console.log(`  Bind:     ${config.host} (LAN accessible)`);
        } else {
          console.log(`  Bind:     ${config.host} (localhost only)`);
        }
        console.log('');

        if (publicUrl) {
          console.log(`  Public:   ${bl}${publicUrl}${rs}`);
        }
        console.log(`  Local:    http://localhost:${actualPort}`);
        if (isLanReachable) {
          console.log(`  LAN:      ${localUrl}`);
        }

        const qrUrl = publicUrl || (isLanReachable ? localUrl : `http://localhost:${actualPort}`);
        const qrDisplayUrl = qrUrl; // clean URL shown in console text
        const qrCodeUrl = config.password ? `${qrUrl}?ott=${auth.generateShareToken()}` : qrUrl;
        console.log('');
        try {
          const qr = await QRCode.toString(qrCodeUrl, { type: 'terminal', small: true });
          console.log(qr);
        } catch {
          /* ignore */
        }

        console.log(`  Scan the QR code or open: ${bl}${qrDisplayUrl}${rs}`);
        if (config.password) process.stdout.write(`  Password: ${gn}${config.password}${rs}\n`);
        console.log('');
        console.log(`${_dm}  From another terminal:${rs}`);
        console.log(`${_dm}    termbeam list        List active sessions${rs}`);
        console.log(
          `${_dm}    termbeam resume      Attach to a session (or: termbeam attach)${rs}`,
        );
        console.log('');

        // Show post-update success message if this is the first start after an update
        const { readUpdateResult, clearUpdateResult } = require('../utils/update-executor');
        const updateResult = readUpdateResult();
        if (updateResult) {
          const gn2 = '\x1b[38;5;114m';
          console.log(
            `  ${gn2}✓ Successfully updated from v${updateResult.fromVersion} to v${updateResult.toVersion}${rs}`,
          );
          console.log('');
          clearUpdateResult();
        }

        // Non-blocking update check — runs after banner, never delays startup.
        // Skip under the Node test runner and CI to avoid network requests in tests.
        // Accept any version containing a semver-like pattern (including dev builds).
        const versionParts = config.version.match(/(\d{1,10})\.(\d{1,10})\.(\d{1,10})/);
        if (
          versionParts &&
          !process.env.NODE_TEST_CONTEXT &&
          !process.env.CI &&
          !process.argv.includes('--test')
        ) {
          const installInfo = detectInstallMethod();
          checkForUpdate({ currentVersion: config.version })
            .then((info) => {
              state.updateInfo = { ...info, ...installInfo };
              if (info.updateAvailable) {
                const yl = '\x1b[33m';
                const gn2 = '\x1b[38;5;114m';
                const dm = '\x1b[2m';
                console.log('');
                console.log(
                  `  ${yl}Update available:${rs} ${dm}${info.current}${rs} → ${gn2}${info.latest}${rs}`,
                );
                if (installInfo.method === 'npx') {
                  console.log(`  Next time, run: ${gn2}npx termbeam@latest${rs}`);
                } else {
                  console.log(`  Run: ${gn2}${installInfo.command}${rs}`);
                }
                console.log('');
              }
            })
            .catch(() => {
              // Silent failure — update check is non-critical
            });
        }

        resolve({ url: `http://localhost:${actualPort}`, defaultId });
      });
    });
  }

  return { app, server, wss, sessions, config, auth, pushManager, start, shutdown };
}

module.exports = { createTermBeamServer, getLocalIP };

// Auto-start when run directly (e.g. `node src/server.js`)
if (require.main === module) {
  const instance = createTermBeamServer();
  const log = require('../utils/logger');

  process.on('SIGINT', () => {
    log.info('Received SIGINT signal');
    console.log('\n[termbeam] Shutting down...');
    instance.shutdown();
    setTimeout(() => process.exit(0), 500).unref();
  });
  process.on('SIGTERM', () => {
    log.info('Received SIGTERM signal');
    console.log('\n[termbeam] Shutting down...');
    instance.shutdown();
    setTimeout(() => process.exit(0), 500).unref();
  });
  process.on('uncaughtException', (err) => {
    log.error(`Uncaught exception: ${err.message}`);
    console.error('[termbeam] Uncaught exception:', err.message);
    cleanupTunnel();
    process.exit(1);
  });

  instance.start();
}
