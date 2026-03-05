const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('./logger');

function printHelp() {
  console.log(`
termbeam — Beam your terminal to any device

Usage:
  termbeam [options] [shell] [args...]
  termbeam resume [name] [options]     Reconnect to a running session
  termbeam sessions [options]          List running sessions
  termbeam service <action>            Manage as a background service (PM2)

Actions (service):
  install      Interactive setup & start as PM2 service
  uninstall    Stop & remove from PM2
  status       Show service status
  logs         Tail service logs
  restart      Restart the service

Options:
  --password <pw>       Set access password (or TERMBEAM_PASSWORD env var)
  --generate-password   Auto-generate a secure password (default: auto)
  --no-password         Disable password authentication
  --tunnel              Create a devtunnel URL (default: on, private access)
  --no-tunnel           Disable tunnel (LAN-only mode)
  --persisted-tunnel    Create a reusable devtunnel URL (stable across restarts)
  --public              Allow public tunnel access (default: private, owner-only)
  --port <port>         Set port (default: 3456, or PORT env var)
  --host <addr>         Bind address (default: 127.0.0.1)
  --lan                 Bind to 0.0.0.0 (allow LAN access, default: localhost only)
  --log-level <level>   Set log verbosity: error, warn, info, debug (default: info)
  --force               Stop any existing server before starting a new one
  -i, --interactive     Interactive setup wizard (guided configuration)
  -h, --help            Show this help
  -v, --version         Show version

Defaults:
  By default, TermBeam enables tunnel + auto-generated password for secure
  mobile access (clipboard, HTTPS). Tunnels are private (owner-only via
  Microsoft login). Use --public for public access, or
  --no-tunnel for LAN-only mode.

Examples:
  termbeam                          Start with tunnel + auto password
  termbeam --no-tunnel              LAN-only, no tunnel
  termbeam --no-tunnel --no-password  LAN-only, no auth (local use)
  termbeam --password secret        Start with specific password
  termbeam --persisted-tunnel       Stable tunnel URL across restarts
  termbeam /bin/bash                Use bash instead of default shell
  termbeam --interactive               Guided setup wizard
  termbeam service install          Set up as background service (PM2)
  termbeam resume                   Reconnect to an active session
  termbeam sessions                 List all active sessions

Environment:
  PORT                  Server port (default: 3456)
  TERMBEAM_PASSWORD     Access password
  TERMBEAM_CWD          Working directory
  TERMBEAM_LOG_LEVEL    Log level (default: info)
`);
}

/**
 * Get ancestor process names on Windows by walking up the process tree.
 * Fetches all processes in a single wmic call, then walks the tree in memory.
 */
function getWindowsAncestors(startPid, maxDepth = 4) {
  const { execFileSync } = require('child_process');
  const names = [];
  const safePid = parseInt(startPid, 10);
  if (!Number.isFinite(safePid) || safePid <= 0) return names;

  try {
    const result = execFileSync(
      'wmic',
      ['process', 'get', 'Name,ParentProcessId,ProcessId', '/format:csv'],
      { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8', timeout: 5000 },
    );

    // Parse CSV output — first non-empty line is the header
    const lines = result.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return names;

    const header = lines[0].split(',').map((h) => h.trim());
    const nameIdx = header.indexOf('Name');
    const pidIdx = header.indexOf('ProcessId');
    const ppidIdx = header.indexOf('ParentProcessId');
    if (nameIdx === -1 || pidIdx === -1 || ppidIdx === -1) return names;

    const processes = new Map();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length <= Math.max(nameIdx, pidIdx, ppidIdx)) continue;
      const pid = parseInt(cols[pidIdx], 10);
      if (Number.isFinite(pid)) {
        processes.set(pid, {
          name: cols[nameIdx].trim().toLowerCase(),
          ppid: parseInt(cols[ppidIdx], 10),
        });
      }
    }

    // Walk up the tree in memory — no more subprocess calls
    let currentPid = safePid;
    for (let i = 0; i < maxDepth; i++) {
      const proc = processes.get(currentPid);
      if (!proc) break;
      log.debug(`Process tree: ${proc.name}`);
      names.push(proc.name);
      if (!Number.isFinite(proc.ppid) || proc.ppid === 0 || proc.ppid === currentPid) break;
      currentPid = proc.ppid;
    }
  } catch (err) {
    log.debug(`Could not query process tree: ${err.message}`);
  }

  return names;
}

/**
 * Check if a process name is a known Unix shell by comparing against
 * /etc/shells entries and a hardcoded fallback list.
 */
function isKnownShell(name) {
  if (!name || name.includes(' ')) return false;
  const basename = path.basename(name);
  const knownNames = new Set([
    'sh',
    'bash',
    'zsh',
    'fish',
    'dash',
    'ksh',
    'csh',
    'tcsh',
    'ash',
    'mksh',
    'elvish',
    'nu',
    'pwsh',
    'xonsh',
    'ion',
  ]);
  if (knownNames.has(basename)) return true;

  // Check against /etc/shells
  try {
    const content = fs.readFileSync('/etc/shells', 'utf8');
    for (const line of content.split('\n')) {
      const entry = line.trim();
      if (entry && !entry.startsWith('#')) {
        if (entry === name || path.basename(entry) === basename) return true;
      }
    }
  } catch {
    // /etc/shells not available — rely on knownNames
  }
  return false;
}

function getDefaultShell() {
  const { execFileSync } = require('child_process');
  const ppid = process.ppid;
  log.debug(`Detecting shell (parent PID: ${ppid}, platform: ${os.platform()})`);

  if (os.platform() === 'win32') {
    // Walk up the process tree (up to 4 ancestors) to find the real user shell.
    // npx/npm on Windows spawns cmd.exe as intermediary, so the immediate
    // parent is often cmd.exe or node.exe rather than the user's actual shell.
    const ancestors = getWindowsAncestors(ppid);
    const preferredShells = ['pwsh.exe', 'powershell.exe'];

    let foundCmd = false;
    for (const name of ancestors) {
      if (preferredShells.includes(name)) {
        log.debug(`Found shell in process tree: ${name}`);
        return name;
      }
      if (name === 'cmd.exe') foundCmd = true;
    }

    if (foundCmd) {
      log.debug(`Using detected shell: cmd.exe`);
      return 'cmd.exe';
    }
    const fallback = process.env.COMSPEC || 'cmd.exe';
    log.debug(`Falling back to: ${fallback}`);
    return fallback;
  }

  // Unix: detect parent shell via ps
  try {
    const result = execFileSync('ps', ['-o', 'comm=', '-p', String(ppid)], {
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 3000,
    });
    const comm = result.trim();
    if (comm) {
      const shell = comm.startsWith('-') ? comm.slice(1) : comm;
      log.debug(`Detected parent process: ${shell}`);
      // Validate it's a real shell by checking against /etc/shells and common names.
      // When run via npx, the parent is "node" or "npm exec ..." — not a shell.
      if (isKnownShell(shell)) {
        log.debug(`Using detected shell: ${shell}`);
        return shell;
      }
      log.debug(`Parent process "${shell}" is not a known shell, falling back`);
    }
  } catch (err) {
    log.debug(`Could not detect parent shell: ${err.message}`);
  }

  // Fallback to SHELL env or /bin/sh
  const fallback = process.env.SHELL || '/bin/sh';
  log.debug(`Falling back to: ${fallback}`);
  return fallback;
}

function parseArgs() {
  let port = parseInt(process.env.PORT || '3456', 10);
  let host = '127.0.0.1';

  // Resolve log level early (env + args) so shell detection logs are visible
  let logLevel = process.env.TERMBEAM_LOG_LEVEL || 'info';
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--log-level=')) {
      logLevel = arg.split('=')[1];
      break;
    }
  }
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--log-level' && process.argv[i + 1]) {
      logLevel = process.argv[i + 1];
      break;
    }
  }
  log.setLevel(logLevel);

  const defaultShell = getDefaultShell();
  const cwd = process.env.TERMBEAM_CWD || process.env.PTY_CWD || process.cwd();
  let password = process.env.TERMBEAM_PASSWORD || process.env.PTY_PASSWORD || null;
  let useTunnel = true;
  let noTunnel = false;
  let persistedTunnel = false;
  let publicTunnel = false;
  let interactive = false;
  let force = false;
  let explicitPassword = !!password;

  const args = process.argv.slice(2);
  const filteredArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--password' && args[i + 1]) {
      password = args[++i];
      explicitPassword = true;
    } else if (args[i] === '--tunnel') {
      useTunnel = true;
    } else if (args[i] === '--no-tunnel') {
      noTunnel = true;
    } else if (args[i] === '--persisted-tunnel') {
      useTunnel = true;
      persistedTunnel = true;
    } else if (args[i] === '--public') {
      publicTunnel = true;
    } else if (args[i].startsWith('--password=')) {
      password = args[i].split('=')[1];
      explicitPassword = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    } else if (args[i] === '--version' || args[i] === '-v') {
      const { getVersion } = require('./version');
      console.log(`termbeam v${getVersion()}`);
      process.exit(0);
    } else if (args[i] === '--generate-password') {
      password = crypto.randomBytes(16).toString('base64url');
      explicitPassword = true;
    } else if (args[i] === '--no-password') {
      password = null;
      explicitPassword = true;
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i] === '--lan') {
      host = '0.0.0.0';
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[++i];
    } else if (args[i] === '--interactive' || (args[i] === '-i' && filteredArgs.length === 0)) {
      interactive = true;
    } else if (args[i] === '--log-level' && args[i + 1]) {
      logLevel = args[++i];
    } else if (args[i].startsWith('--log-level=')) {
      logLevel = args[i].split('=')[1];
    } else if (args[i] === '--force') {
      force = true;
    } else if (args[i].startsWith('--')) {
      console.error(`Unknown flag: ${args[i]}\n`);
      printHelp();
      process.exit(1);
    } else {
      filteredArgs.push(args[i]);
    }
  }

  // Default: auto-generate password if none specified
  if (!explicitPassword && !password) {
    password = crypto.randomBytes(16).toString('base64url');
  }

  // --no-tunnel disables the default tunnel
  if (noTunnel) useTunnel = false;

  // --public requires a tunnel
  if (publicTunnel && !useTunnel) {
    const rd = '\x1b[31m';
    const rs = '\x1b[0m';
    console.error(
      `${rd}Error: --public requires a tunnel. Remove --no-tunnel or remove --public.${rs}`,
    );
    process.exit(1);
  }

  // --public requires password authentication
  if (publicTunnel && !password) {
    const rd = '\x1b[31m';
    const rs = '\x1b[0m';
    console.error(
      `${rd}Error: Public tunnels require password authentication. Remove --no-password or remove --public.${rs}`,
    );
    process.exit(1);
  }

  const shell = filteredArgs[0] || defaultShell;
  const shellArgs = filteredArgs.slice(1);

  const { getVersion } = require('./version');
  const version = getVersion();

  return {
    port,
    host,
    password,
    useTunnel,
    persistedTunnel,
    publicTunnel,
    shell,
    shellArgs,
    cwd,
    defaultShell,
    version,
    logLevel,
    interactive,
    force,
  };
}

module.exports = { parseArgs, printHelp, isKnownShell, getWindowsAncestors };
