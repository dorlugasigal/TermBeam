#!/usr/bin/env node
const os = require('os');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const { parseArgs } = require('./cli');
const { createAuth } = require('./auth');
const { SessionManager } = require('./sessions');
const { setupRoutes, cleanupUploadedFiles } = require('./routes');
const { setupWebSocket } = require('./websocket');
const { startTunnel, cleanupTunnel } = require('./tunnel');

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

/**
 * Create a TermBeam server instance without starting it.
 * @param {object} [overrides] - Optional overrides
 * @param {object} [overrides.config] - Full config object (skips parseArgs)
 * @returns {{ app, server, wss, sessions, config, auth, start, shutdown }}
 */
function createTermBeamServer(overrides = {}) {
  const config = overrides.config || parseArgs();
  const log = require('./logger');
  if (config.logLevel) log.setLevel(config.logLevel);
  const auth = createAuth(config.password);
  const sessions = new SessionManager();

  // --- Express ---
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' ws: wss:; font-src 'self' https://cdn.jsdelivr.net");
    next();
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 * 1024 * 1024 });

  setupRoutes(app, { auth, sessions, config });
  setupWebSocket(wss, { auth, sessions });

  // --- Lifecycle ---
  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    sessions.shutdown();
    cleanupUploadedFiles();
    cleanupTunnel();
    server.close();
    wss.close();
  }

  function start() {
    return new Promise((resolve) => {
      server.listen(config.port, config.host, async () => {
        const ip = getLocalIP();
        const localUrl = `http://${ip}:${config.port}`;

        const defaultId = sessions.create({
          name: path.basename(config.cwd),
          shell: config.shell,
          args: config.shellArgs,
          cwd: config.cwd,
        });

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
        const isLanReachable = config.host === '0.0.0.0' || config.host === '::' || config.host === ip;
        const gn = '\x1b[38;5;114m'; // green
        const dm = '\x1b[2m'; // dim

        let publicUrl = null;
        if (config.useTunnel) {
          const tunnel = await startTunnel(config.port, { persisted: config.persistedTunnel });
          if (tunnel) {
            publicUrl = tunnel.url;
          } else {
            console.log('  ⚠️  Tunnel failed to start. Using LAN only.');
          }
        }

        console.log(`  Shell:    ${config.shell}`);
        console.log(`  Session:  ${defaultId}`);
        console.log(`  Auth:     ${config.password ? `${gn}🔒 password${rs}` : '🔓 none'}`);
        console.log('');

        if (publicUrl) {
          console.log(`  🌐 Public:  ${publicUrl}`);
        }
        console.log(`  Local:    http://localhost:${config.port}`);
        if (isLanReachable) {
          console.log(`  LAN:      ${localUrl}`);
        }

        const qrUrl = publicUrl || (isLanReachable ? localUrl : `http://localhost:${config.port}`);
        console.log('');
        console.log(`  ${dm}📋 Clipboard requires HTTPS — use the Public or localhost URL${rs}`);
        console.log('');
        try {
          const qr = await QRCode.toString(qrUrl, { type: 'terminal', small: true });
          console.log(qr);
        } catch {
          /* ignore */
        }

        console.log(`  Scan the QR code or open: ${qrUrl}`);
        if (config.password) console.log(`  Password: ${gn}${config.password}${rs}`);
        console.log('');

        resolve({ url: `http://localhost:${config.port}`, defaultId });
      });
    });
  }

  return { app, server, wss, sessions, config, auth, start, shutdown };
}

module.exports = { createTermBeamServer };

// Auto-start when run directly (CLI entry point)
if (require.main === module || process.argv[1]?.endsWith('termbeam.js')) {
  const instance = createTermBeamServer();

  process.on('SIGINT', () => {
    console.log('\n[termbeam] Shutting down...');
    instance.shutdown();
    setTimeout(() => process.exit(0), 500).unref();
  });
  process.on('SIGTERM', () => {
    console.log('\n[termbeam] Shutting down...');
    instance.shutdown();
    setTimeout(() => process.exit(0), 500).unref();
  });
  process.on('uncaughtException', (err) => {
    console.error('[termbeam] Uncaught exception:', err.message);
    cleanupTunnel();
    process.exit(1);
  });

  instance.start();
}
