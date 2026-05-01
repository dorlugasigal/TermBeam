const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync, execFileSync } = require('child_process');
const log = require('../utils/logger');

const INSTALL_DIR = path.join(os.homedir(), 'bin');

function getInstallDir() {
  return INSTALL_DIR;
}

/**
 * Resolve a binary name or path to an absolute path. Bare names (e.g. just
 * "devtunnel") are looked up on `$PATH`. Returns the realpath (symlinks
 * resolved) on success, or `null` if the binary couldn't be found.
 */
function resolveBinaryPath(binPathOrName) {
  if (!binPathOrName) return null;
  if (path.isAbsolute(binPathOrName)) {
    try {
      return fs.realpathSync(binPathOrName);
    } catch {
      return null;
    }
  }
  const PATH = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE').split(';').map((e) => e.toLowerCase())
      : [''];
  for (const dir of PATH.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binPathOrName + ext);
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          try {
            return fs.realpathSync(candidate);
          } catch {
            return candidate;
          }
        }
      } catch {
        // not in this dir
      }
    }
  }
  return null;
}

/**
 * Returns true when the file at `absPath` carries the macOS
 * `com.apple.quarantine` extended attribute. Always false on non-darwin.
 */
function hasQuarantine(absPath) {
  if (process.platform !== 'darwin' || !absPath) return false;
  try {
    execFileSync('xattr', ['-p', 'com.apple.quarantine', absPath], {
      stdio: 'pipe',
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Strip the macOS `com.apple.quarantine` extended attribute from a binary.
 * Brew casks tag downloaded binaries with this attribute, which causes
 * Gatekeeper to block execution and pop a system dialog ("are you sure you
 * want to open…") the first time the binary runs in a non-interactive
 * context (e.g. spawned from a service). On the next brew upgrade the new
 * binary is re-tagged, so this needs to run after every install and as a
 * best-effort self-heal step at runtime.
 *
 * Accepts an absolute path OR a bare command name (which is resolved via
 * `$PATH`). Returns one of:
 *   - 'noop'     — non-darwin, unresolvable, or no quarantine attribute
 *   - 'stripped' — quarantine was present and successfully removed
 *   - 'failed'   — quarantine was present and removal failed (e.g. EPERM)
 */
function stripQuarantine(binPathOrName) {
  if (process.platform !== 'darwin' || !binPathOrName) return 'noop';
  const resolved = resolveBinaryPath(binPathOrName);
  if (!resolved) return 'noop';
  if (!hasQuarantine(resolved)) return 'noop';
  try {
    execFileSync('xattr', ['-d', 'com.apple.quarantine', resolved], {
      stdio: 'pipe',
      timeout: 5000,
    });
  } catch {
    // Removal refused (e.g. EPERM). Verify outcome below.
  }
  return hasQuarantine(resolved) ? 'failed' : 'stripped';
}

function getBinaryName() {
  return process.platform === 'win32' ? 'devtunnel.exe' : 'devtunnel';
}

function promptUser(question) {
  if (!process.stdin.isTTY) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

async function promptInstall() {
  if (
    process.platform !== 'darwin' &&
    process.platform !== 'linux' &&
    process.platform !== 'win32'
  ) {
    log.error(`Unsupported platform: ${process.platform}/${process.arch}`);
    return null;
  }

  process.stderr.write('\n');
  process.stderr.write(`  ${yellow('⚠')}  ${bold('DevTunnel CLI is not installed.')}\n`);
  process.stderr.write(`  ${cyan('TermBeam uses tunnels by default for remote access.')}\n`);
  process.stderr.write('\n');
  const answer = await promptUser(`  Would you like me to install it for you? ${bold('(y/n)')} `);
  if (answer !== 'y') {
    log.info('Skipping DevTunnel install.');
    return null;
  }

  return installDevtunnel();
}

async function installDevtunnel() {
  try {
    const platform = process.platform;

    if (platform === 'darwin') {
      log.info('Installing devtunnel via brew...');
      execSync('brew install --cask devtunnel', { stdio: 'inherit', timeout: 120000 });
    } else if (platform === 'linux') {
      log.info('Installing devtunnel via official install script...');
      execSync('curl -sL https://aka.ms/DevTunnelCliInstall | bash', {
        stdio: 'inherit',
        timeout: 120000,
      });
    } else if (platform === 'win32') {
      log.info('Installing devtunnel via winget...');
      execSync(
        'winget install Microsoft.devtunnel --accept-source-agreements --accept-package-agreements',
        {
          stdio: 'inherit',
          timeout: 120000,
        },
      );
    }

    // Find the installed binary
    const found = findInstalledBinary();
    if (found) {
      // On macOS, brew --cask tags the binary with com.apple.quarantine which
      // causes Gatekeeper to block execution from non-interactive contexts.
      // Strip it now so the first spawn doesn't trigger a system dialog.
      stripQuarantine(found);
      log.info(`${green('✔')} DevTunnel CLI installed and verified successfully.`);
      return found;
    }

    log.error('DevTunnel was installed but could not be found on PATH.');
    return null;
  } catch (err) {
    log.error(`DevTunnel install failed: ${err.message}`);
    return null;
  }
}

function findInstalledBinary() {
  // Check PATH first
  try {
    execSync('devtunnel --version', { stdio: 'pipe', timeout: 10000, windowsHide: true });
    return 'devtunnel';
  } catch {}

  // On Windows, winget modifies PATH but the current process won't see it.
  // Use 'where' to find it via the system PATH registry.
  if (process.platform === 'win32') {
    try {
      const wherePath = execSync('where devtunnel.exe', {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 10000,
        windowsHide: true,
      })
        .trim()
        .split(/\r?\n/)[0];
      if (wherePath && fs.existsSync(wherePath)) return wherePath;
    } catch {}

    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'devtunnel.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'devtunnel.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'devtunnel', 'devtunnel.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  // Check ~/bin (where the Linux install script puts it)
  const homeBin = path.join(os.homedir(), 'bin', getBinaryName());
  if (fs.existsSync(homeBin)) {
    try {
      execFileSync(homeBin, ['--version'], { stdio: 'pipe', timeout: 10000, windowsHide: true });
      return homeBin;
    } catch {}
  }

  return null;
}

module.exports = {
  installDevtunnel,
  promptInstall,
  getInstallDir,
  stripQuarantine,
  resolveBinaryPath,
  hasQuarantine,
};
