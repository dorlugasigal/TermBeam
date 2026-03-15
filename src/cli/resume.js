const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const log = require('../utils/logger');
const { createTerminalClient } = require('./client');
const { bold, dim, red, yellow, choose, createRL, ask } = require('./prompts');

const CONFIG_DIR = process.env.TERMBEAM_CONFIG_DIR || path.join(os.homedir(), '.termbeam');
const CONNECTION_FILE = path.join(CONFIG_DIR, 'connection.json');

// ── Connection config ────────────────────────────────────────────────────────

function readConnectionConfig() {
  log.debug('Reading connection config');
  try {
    return JSON.parse(fs.readFileSync(CONNECTION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeConnectionConfig({ port, host, password }) {
  log.debug('Writing connection config');
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONNECTION_FILE, JSON.stringify({ port, host, password }, null, 2) + '\n', {
    mode: 0o600,
  });
  // Ensure restrictive permissions even if the file already existed
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(CONNECTION_FILE, 0o600);
    } catch {
      /* best-effort */
    }
  }
}

function removeConnectionConfig() {
  log.debug('Removing connection config');
  try {
    fs.unlinkSync(CONNECTION_FILE);
  } catch {
    /* ignore */
  }
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

function parseDetachKey(value) {
  // \xNN hex escape → control character
  const hexMatch = value.match(/^\\x([0-9a-fA-F]{2})$/);
  if (hexMatch) return String.fromCharCode(parseInt(hexMatch[1], 16));
  // ^X or ctrl+X → control character
  const caretMatch = value.match(/^\^([A-Za-z])$/);
  if (caretMatch) return String.fromCharCode(caretMatch[1].toUpperCase().charCodeAt(0) - 64);
  const ctrlMatch = value.match(/^ctrl\+([A-Za-z])$/i);
  if (ctrlMatch) return String.fromCharCode(ctrlMatch[1].toUpperCase().charCodeAt(0) - 64);
  return value;
}

function parseResumeArgs(args) {
  let name = null;
  let port = null;
  let host = null;
  let password = null;
  let detachKey = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[++i];
    } else if (args[i] === '--password' && args[i + 1]) {
      password = args[++i];
    } else if (args[i].startsWith('--password=')) {
      password = args[i].split('=')[1];
    } else if (args[i] === '--detach-key' && args[i + 1]) {
      detachKey = parseDetachKey(args[++i]);
    } else if (args[i] === '--help' || args[i] === '-h') {
      return { help: true };
    } else if (args[i].startsWith('--')) {
      console.error(`Unknown flag: ${args[i]}`);
      process.exitCode = 1;
      return { help: true };
    } else if (!args[i].startsWith('-')) {
      name = args[i];
    }
  }

  return { name, port, host, password, detachKey };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function httpRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOpts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: options.method || 'GET',
      headers: { ...options.headers },
    };
    log.debug(`HTTP ${reqOpts.method} ${url.hostname}:${url.port}${url.pathname}`);

    const req = http.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchSessions(baseUrl, password) {
  const headers = {};
  if (password) headers.Authorization = `Bearer ${password}`;

  const res = await httpRequest(`${baseUrl}/api/sessions`, { headers });
  if (res.status === 401) {
    log.warn('Session fetch unauthorized');
    throw new Error('unauthorized');
  }
  if (res.status >= 400) {
    throw new Error(`HTTP ${res.status}: ${res.body}`);
  }
  return JSON.parse(res.body);
}

// ── Formatting ───────────────────────────────────────────────────────────────

function formatUptime(createdAt) {
  const ms = Date.now() - new Date(createdAt).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function shortId(id) {
  return id.slice(0, 8);
}

// ── Help text ────────────────────────────────────────────────────────────────

function detachKeyLabel(key) {
  if (!key || key === '\x02') return 'Ctrl+B';
  if (key.length === 1 && key.charCodeAt(0) < 27) {
    return `Ctrl+${String.fromCharCode(key.charCodeAt(0) + 64)}`;
  }
  return key;
}

function printResumeHelp() {
  console.log(`
${bold('termbeam resume')} (alias: ${bold('attach')}) — Reconnect to a running session

${bold('Usage:')}
  termbeam resume [name] [options]

${bold('Arguments:')}
  name                  Session name to connect to (auto-selects if unique match)

${bold('Options:')}
  --port <port>         Server port (default: from ~/.termbeam/connection.json or 3456)
  --host <host>         Server host (default: from config or localhost)
  --password <pw>       Server password (default: from config or prompt)
  --detach-key <key>    Detach key combo (default: Ctrl+B)
  -h, --help            Show this help

${bold('Examples:')}
  termbeam resume                     Select from running sessions
  termbeam resume my-project          Connect to session named "my-project"
  termbeam resume --port 4000         Connect to server on port 4000

${dim('Press Ctrl+B to detach from a session without closing it.')}
`);
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function resolveConnection(args) {
  const opts = parseResumeArgs(args);
  if (opts.help) return { help: true };

  const saved = readConnectionConfig();
  const host = opts.host || (saved && saved.host) || 'localhost';
  const port = opts.port || (saved && saved.port) || 3456;
  let password = opts.password || (saved && saved.password) || null;
  const connHost = host === 'localhost' ? '127.0.0.1' : host;
  const baseUrl = `http://${connHost}:${port}`;
  const displayUrl = `http://${connHost === '127.0.0.1' ? 'localhost' : connHost}:${port}`;

  // Try to fetch sessions, handle auth errors
  let sessions;
  try {
    sessions = await fetchSessions(baseUrl, password);
  } catch (err) {
    if (err.message === 'unauthorized') {
      // Prompt for password if none was explicitly provided
      if (!opts.password) {
        const rl = createRL();
        password = await ask(rl, `  Password for ${displayUrl}:`);
        rl.close();
        try {
          sessions = await fetchSessions(baseUrl, password);
        } catch {
          console.error(red('  Authentication failed.'));
          process.exit(1);
        }
      } else {
        console.error(red('  Authentication failed.'));
        process.exit(1);
      }
    } else if (err.code === 'ECONNREFUSED') {
      return { refused: true, displayUrl };
    } else {
      throw err;
    }
  }

  return { host, port, password, baseUrl, displayUrl, sessions, opts };
}

async function resume(args) {
  if (process.env.TERMBEAM_SESSION) {
    console.error(red('  Already inside a TermBeam session. Detach first (Ctrl+B).'));
    process.exit(1);
  }

  const conn = await resolveConnection(args);
  if (conn.help) {
    printResumeHelp();
    return;
  }
  if (conn.refused) {
    console.error(red('  No TermBeam server is running.'));
    process.exit(1);
  }

  const { host, port, password, sessions, opts } = conn;

  if (sessions.length === 0) {
    console.error(red(`  Connected to server on ${conn.displayUrl} — no active sessions.`));
    process.exit(1);
  }

  let session;

  if (opts.name) {
    // Match by name (case-insensitive) or by ID prefix
    session =
      sessions.find((s) => s.name.toLowerCase() === opts.name.toLowerCase()) ||
      sessions.find((s) => s.id.startsWith(opts.name));

    if (!session) {
      console.error(red(`  No session matching "${opts.name}".`));
      console.log(dim('  Available sessions:'));
      for (const s of sessions) {
        console.log(dim(`    ${s.name} (${shortId(s.id)})`));
      }
      process.exit(1);
    }
  } else if (sessions.length === 1) {
    session = sessions[0];
  } else {
    // Interactive chooser
    const rl = createRL();
    const choices = sessions.map((s) => ({
      label: `${s.name}  ${dim(shortId(s.id))}`,
      hint: `${s.cwd}  ·  ${formatUptime(s.createdAt)}  ·  ${s.clients} client${s.clients !== 1 ? 's' : ''}`,
    }));

    console.log('');
    const { index } = await choose(rl, `  ${bold('Select a session:')}`, choices);
    rl.close();
    session = sessions[index];
  }

  const wsHost = host === 'localhost' ? '127.0.0.1' : host;
  const wsUrl = `ws://${wsHost}:${port}/ws`;
  const detachKey = opts.detachKey || '\x02';

  try {
    log.info(`Connecting to session: ${session.name || session.id}`);
    const { reason } = await createTerminalClient({
      url: wsUrl,
      password,
      sessionId: session.id,
      sessionName: session.name,
      detachKey,
      detachLabel: detachKeyLabel(detachKey),
    });

    console.log('');
    if (reason === 'detached') {
      console.log(yellow(`  Detached from ${bold(session.name)}.`));
    } else if (reason && reason.startsWith('session exited')) {
      console.log(dim(`  Session ${bold(session.name)} ended.`));
    } else {
      console.log(dim(`  Disconnected from ${bold(session.name)}.`));
    }
  } catch (err) {
    log.error(`Connection failed: ${err.message}`);
    console.error(red(`  Connection failed: ${err.message}`));
    process.exit(1);
  }
}

async function list() {
  log.info('Listing sessions');
  const saved = readConnectionConfig();
  const host = (saved && saved.host) || 'localhost';
  const port = (saved && saved.port) || 3456;
  let password = (saved && saved.password) || null;
  const connHost = host === 'localhost' ? '127.0.0.1' : host;
  const baseUrl = `http://${connHost}:${port}`;
  const displayUrl = `http://${connHost === '127.0.0.1' ? 'localhost' : connHost}:${port}`;

  let sessions;
  try {
    sessions = await fetchSessions(baseUrl, password);
  } catch (err) {
    if (err.message === 'unauthorized') {
      if (!password) {
        const rl = createRL();
        password = await ask(rl, `  Password for ${displayUrl}:`);
        rl.close();
        try {
          sessions = await fetchSessions(baseUrl, password);
        } catch {
          console.error(red('  Authentication failed.'));
          process.exit(1);
        }
      } else {
        console.error(red('  Authentication failed.'));
        process.exit(1);
      }
    } else if (err.code === 'ECONNREFUSED') {
      console.log(dim('  No TermBeam server is running.'));
      return;
    } else {
      console.error(red(`  Connection failed: ${err.message}`));
      process.exit(1);
    }
  }

  if (sessions.length === 0) {
    console.log(dim(`  Connected to server on ${displayUrl} — no active sessions.`));
    return;
  }

  console.log('');
  console.log(
    bold(`  ${sessions.length} session${sessions.length !== 1 ? 's' : ''} on ${displayUrl}`),
  );
  console.log('');

  // Table header
  const nameW = Math.max(6, ...sessions.map((s) => s.name.length));
  const cwdW = Math.max(4, ...sessions.map((s) => s.cwd.length));

  console.log(
    dim(
      `  ${'NAME'.padEnd(nameW)}  ${'ID'.padEnd(8)}  ${'CWD'.padEnd(cwdW)}  ${'UPTIME'.padEnd(8)}  CLIENTS`,
    ),
  );

  for (const s of sessions) {
    const uptime = formatUptime(s.createdAt);
    console.log(
      `  ${bold(s.name.padEnd(nameW))}  ${dim(shortId(s.id).padEnd(8))}  ${s.cwd.padEnd(cwdW)}  ${uptime.padEnd(8)}  ${s.clients}`,
    );
  }
  console.log('');
}

module.exports = {
  resume,
  list,
  writeConnectionConfig,
  removeConnectionConfig,
  readConnectionConfig,
  printResumeHelp,
  parseDetachKey,
  CONFIG_DIR,
  CONNECTION_FILE,
};
