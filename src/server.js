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
const { setupRoutes } = require('./routes');
const { setupWebSocket } = require('./websocket');
const { startTunnel, cleanupTunnel } = require('./tunnel');

// --- Config ---
const config = parseArgs();
const auth = createAuth(config.password);
const sessions = new SessionManager();

// --- Express ---
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

setupRoutes(app, { auth, sessions, config });
setupWebSocket(wss, { auth, sessions });

// --- Lifecycle ---
function shutdown() {
  console.log('\n[termbeam] Shutting down...');
  sessions.shutdown();
  cleanupTunnel();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  console.error('[termbeam] Uncaught exception:', err.message);
  cleanupTunnel();
  process.exit(1);
});
process.on('exit', cleanupTunnel);

// --- Start ---
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

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
  console.log(`  Local:    http://localhost:${config.port}`);
  const isLanReachable = config.host === '0.0.0.0' || config.host === '::' || config.host === ip;
  if (isLanReachable) {
    console.log(`  LAN:      ${localUrl}`);
  }
  console.log(`  Shell:    ${config.shell}`);
  console.log(`  Session:  ${defaultId}`);
  const gn = '\x1b[38;5;114m'; // green
  console.log(`  Auth:     ${config.password ? `${gn}🔒 password${rs}` : '🔓 none'}`);

  let publicUrl = null;
  if (config.useTunnel) {
    publicUrl = await startTunnel(config.port, { newTunnel: config.newTunnel });
    if (publicUrl) {
      console.log('');
      console.log(`  🌐 Public:  ${publicUrl}`);
    } else {
      console.log('');
      console.log('  ⚠️  Tunnel failed to start. Using LAN only.');
    }
  }

  const qrUrl = publicUrl || (isLanReachable ? localUrl : `http://localhost:${config.port}`);
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
});
