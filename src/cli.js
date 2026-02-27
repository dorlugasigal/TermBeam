const os = require('os');
const path = require('path');
const crypto = require('crypto');

function printHelp() {
  console.log(`
termbeam — Beam your terminal to any device

Usage:
  termbeam [options] [shell] [args...]

Options:
  --password <pw>       Set access password (or TERMBEAM_PASSWORD env var)
  --generate-password   Auto-generate a secure password
  --tunnel              Create a public devtunnel URL
  --new-tunnel          Force a fresh tunnel (ignore persisted)
  --port <port>         Set port (default: 3456, or PORT env var)
  --host <addr>         Bind address (default: 0.0.0.0)
  -h, --help            Show this help
  -v, --version         Show version

Examples:
  termbeam                          Start with default shell
  termbeam --password secret        Start with password auth
  termbeam --generate-password      Start with auto-generated password
  termbeam --tunnel --password pw   Start with public tunnel
  termbeam /bin/bash                Use bash instead of default shell

Environment:
  PORT                  Server port (default: 3456)
  TERMBEAM_PASSWORD     Access password
  TERMBEAM_CWD          Working directory
`);
}

function getDefaultShell() {
  const { execFileSync } = require('child_process');
  const ppid = process.ppid;
  console.log(`[termbeam] Detecting shell (parent PID: ${ppid}, platform: ${os.platform()})`);

  if (os.platform() === 'win32') {
    // Detect parent process on Windows via WMIC
    try {
      const result = execFileSync(
        'wmic',
        ['process', 'where', `ProcessId=${ppid}`, 'get', 'Name', '/value'],
        { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8', timeout: 3000 },
      );
      const match = result.match(/Name=(.+)/);
      if (match) {
        const name = match[1].trim().toLowerCase();
        console.log(`[termbeam] Detected parent process: ${name}`);
        if (name === 'pwsh.exe') return 'pwsh.exe';
        if (name === 'powershell.exe') return 'powershell.exe';
      }
    } catch (err) {
      console.log(`[termbeam] Could not detect parent process: ${err.message}`);
    }
    const fallback = process.env.COMSPEC || 'cmd.exe';
    console.log(`[termbeam] Falling back to: ${fallback}`);
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
      console.log(`[termbeam] Detected parent shell: ${shell}`);
      return shell;
    }
  } catch (err) {
    console.log(`[termbeam] Could not detect parent shell: ${err.message}`);
  }

  // Fallback to SHELL env or /bin/sh
  const fallback = process.env.SHELL || '/bin/sh';
  console.log(`[termbeam] Falling back to: ${fallback}`);
  return fallback;
}

function parseArgs() {
  let port = parseInt(process.env.PORT || '3456', 10);
  let host = '0.0.0.0';
  const defaultShell = getDefaultShell();
  const cwd = process.env.TERMBEAM_CWD || process.env.PTY_CWD || process.cwd();
  let password = process.env.TERMBEAM_PASSWORD || process.env.PTY_PASSWORD || null;
  let useTunnel = false;
  let newTunnel = false;

  const args = process.argv.slice(2);
  const filteredArgs = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--password' && args[i + 1]) {
      password = args[++i];
    } else if (args[i] === '--tunnel') {
      useTunnel = true;
    } else if (args[i] === '--new-tunnel') {
      newTunnel = true;
    } else if (args[i].startsWith('--password=')) {
      password = args[i].split('=')[1];
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    } else if (args[i] === '--version' || args[i] === '-v') {
      const { getVersion } = require('./version');
      console.log(`termbeam v${getVersion()}`);
      process.exit(0);
    } else if (args[i] === '--generate-password') {
      password = crypto.randomBytes(16).toString('base64url');
      console.log(`Generated password: ${password}`);
    } else if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (args[i] === '--host' && args[i + 1]) {
      host = args[++i];
    } else {
      filteredArgs.push(args[i]);
    }
  }

  const shell = filteredArgs[0] || defaultShell;
  const shellArgs = filteredArgs.slice(1);

  const { getVersion } = require('./version');
  const version = getVersion();

  return { port, host, password, useTunnel, newTunnel, shell, shellArgs, cwd, defaultShell, version };
}

module.exports = { parseArgs, printHelp };
