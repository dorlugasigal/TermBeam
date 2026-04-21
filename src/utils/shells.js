const os = require('os');
const fs = require('fs');
const child_process = require('child_process');

const KNOWN_WINDOWS_SHELLS = [
  { name: 'PowerShell (Core)', cmd: 'pwsh.exe' },
  { name: 'Windows PowerShell', cmd: 'powershell.exe' },
  { name: 'Command Prompt', cmd: 'cmd.exe' },
  { name: 'Git Bash', cmd: 'bash.exe' },
  { name: 'WSL', cmd: 'wsl.exe' },
];

function detectShells() {
  if (os.platform() === 'win32') {
    return detectWindowsShells();
  }
  return detectUnixShells();
}

function detectWindowsShells() {
  const shells = [];
  for (const { name, cmd } of KNOWN_WINDOWS_SHELLS) {
    try {
      const result = child_process.execFileSync('where', [cmd], {
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: 3000,
        windowsHide: true,
      });
      const fullPath = result.trim().split('\n')[0].trim();
      if (fullPath) {
        shells.push({ name, path: fullPath, cmd });
      }
    } catch {
      // not installed
    }
  }
  return shells;
}

function detectUnixShells() {
  const shells = [];
  const seen = new Set();

  // Read /etc/shells
  try {
    const content = fs.readFileSync('/etc/shells', 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const name = trimmed.split('/').pop();
        if (!seen.has(name)) {
          seen.add(name);
          shells.push({ name, path: trimmed, cmd: trimmed });
        }
      }
    }
  } catch {
    // /etc/shells not available, try common paths
    const common = ['/bin/bash', '/bin/zsh', '/bin/sh', '/usr/bin/fish', '/bin/fish'];
    for (const p of common) {
      try {
        fs.accessSync(p, fs.constants.X_OK);
        const name = p.split('/').pop();
        if (!seen.has(name)) {
          seen.add(name);
          shells.push({ name, path: p, cmd: p });
        }
      } catch {
        // not installed
      }
    }
  }

  return shells;
}

module.exports = { detectShells, detectWindowsShells, detectUnixShells };
