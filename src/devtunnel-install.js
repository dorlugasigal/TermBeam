const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync, execFileSync } = require('child_process');
const log = require('./logger');

const INSTALL_DIR = path.join(os.homedir(), 'bin');

function getInstallDir() {
  return INSTALL_DIR;
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
    execSync('devtunnel --version', { stdio: 'pipe', timeout: 10000 });
    return 'devtunnel';
  } catch {}

  // Check ~/bin (where the Linux install script puts it)
  const homeBin = path.join(os.homedir(), 'bin', getBinaryName());
  if (fs.existsSync(homeBin)) {
    try {
      execFileSync(homeBin, ['--version'], { stdio: 'pipe', timeout: 10000 });
      return homeBin;
    } catch {}
  }

  // Windows-specific locations
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'devtunnel.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'devtunnel', 'devtunnel.exe'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

module.exports = { installDevtunnel, promptInstall, getInstallDir };
