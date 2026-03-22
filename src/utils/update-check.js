const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const log = require('./logger');

const PACKAGE_NAME = 'termbeam';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_SIZE = 100 * 1024; // 100 KB — real npm responses are ~3-4 KB

function getCacheFilePath() {
  const configDir = process.env.TERMBEAM_CONFIG_DIR || path.join(os.homedir(), '.termbeam');
  return path.join(configDir, 'update-check.json');
}

function readCache() {
  try {
    const data = JSON.parse(fs.readFileSync(getCacheFilePath(), 'utf8'));
    if (data && typeof data.latest === 'string' && typeof data.checkedAt === 'number') {
      return data;
    }
  } catch {
    // Cache missing or corrupt — will re-fetch
  }
  return null;
}

function writeCache(latest) {
  try {
    const cacheFile = getCacheFilePath();
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ latest, checkedAt: Date.now() }) + '\n', {
      mode: 0o600,
    });
  } catch {
    // Non-critical — next check will just re-fetch
  }
}

/**
 * Normalize a version string into a [major, minor, patch] numeric tuple.
 * Strips leading "v", drops prerelease/build metadata.
 * Returns null if the version cannot be safely parsed.
 */
function normalizeVersion(version) {
  if (typeof version !== 'string') return null;
  let v = version.trim();
  if (!v) return null;
  if (v[0] === 'v' || v[0] === 'V') v = v.slice(1);

  // Drop build metadata (+foo) and prerelease tags (-beta.1)
  const plusIdx = v.indexOf('+');
  if (plusIdx !== -1) v = v.slice(0, plusIdx);
  const dashIdx = v.indexOf('-');
  if (dashIdx !== -1) v = v.slice(0, dashIdx);
  if (!v) return null;

  const parts = v.split('.');
  if (parts.length === 0 || parts.length > 3) return null;

  const nums = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number(part));
  }
  while (nums.length < 3) nums.push(0);
  return nums;
}

/**
 * Compare two semver version strings (e.g. "1.10.2" vs "1.11.0").
 * Returns true if `latest` is newer than `current`.
 * Pre-release versions (e.g. "1.15.3-rc.1") are considered older than
 * the same stable version ("1.15.3"), so an update will be offered.
 * Returns false if either version cannot be parsed.
 */
function isNewerVersion(current, latest) {
  const cur = normalizeVersion(current);
  const lat = normalizeVersion(latest);
  if (!cur || !lat) return false;
  for (let i = 0; i < 3; i++) {
    if (lat[i] > cur[i]) return true;
    if (lat[i] < cur[i]) return false;
  }
  // Same base version — if current is a pre-release but latest is stable,
  // the stable release is newer (e.g. 1.15.3-rc.1 → 1.15.3)
  if (isPreRelease(current) && !isPreRelease(latest)) return true;
  return false;
}

/**
 * Check if a version string contains pre-release metadata (e.g. "-rc.1", "-dev.5").
 */
function isPreRelease(version) {
  if (typeof version !== 'string') return false;
  let v = version.trim();
  if (v[0] === 'v' || v[0] === 'V') v = v.slice(1);
  // Strip build metadata first (+foo)
  const plusIdx = v.indexOf('+');
  if (plusIdx !== -1) v = v.slice(0, plusIdx);
  return v.includes('-');
}

/**
 * Strip ANSI escape sequences and control characters from a string.
 * Prevents terminal injection if the registry returns malicious data.
 */
function sanitizeVersion(v) {
  if (typeof v !== 'string') return '';
  return (
    v
      // CSI sequences: ESC [ ... command
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
      // OSC sequences: ESC ] ... BEL or ESC ] ... ESC \
      .replace(/\x1b\][^\x1b\x07]*(?:\x07|\x1b\\)/g, '')
      // DCS, SOS, PM, APC: ESC P/X/^/_ ... ESC \
      .replace(/\x1b[PX^_][\s\S]*?\x1b\\/g, '')
      // Single-character ESC sequences
      .replace(/\x1b[@-Z\\-_]/g, '')
      // Remaining C0 and C1 control characters
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
  );
}

/**
 * Fetch the latest version from the npm registry.
 * Returns the version string or null on failure.
 * @param {string} [registryUrl] - Override the registry URL (for testing).
 */
function fetchLatestVersion(registryUrl) {
  const url = registryUrl || REGISTRY_URL;
  const client = url.startsWith('https') ? https : http;
  log.debug('Fetching latest version from npm registry');
  return new Promise((resolve) => {
    const req = client.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        log.warn(`Registry returned HTTP ${res.statusCode}`);
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      let aborted = false;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        if (aborted) return;
        body += chunk;
        if (body.length > MAX_RESPONSE_SIZE) {
          aborted = true;
          req.destroy();
          resolve(null);
        }
      });
      res.on('end', () => {
        if (aborted) return;
        try {
          const data = JSON.parse(body);
          const version = data.version;
          if (!version || typeof version !== 'string') {
            resolve(null);
            return;
          }
          if (!/^\d+\.\d+\.\d+$/.test(version)) {
            resolve(null);
            return;
          }
          resolve(sanitizeVersion(version));
        } catch {
          resolve(null);
        }
      });
    });
    // Unref so a pending update check can't delay process exit
    req.on('socket', (socket) => socket.unref());
    req.on('error', (err) => {
      log.debug(`Network error checking updates: ${err.message}`);
      resolve(null);
    });
    req.on('timeout', () => {
      log.warn('Update check timed out');
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Check for available updates.
 * @param {object} options
 * @param {string} options.currentVersion - The current version (e.g. "1.10.2")
 * @param {boolean} [options.force=false] - Bypass cache and fetch fresh data
 * @returns {Promise<{current: string, latest: string|null, updateAvailable: boolean}>}
 */
async function checkForUpdate({ currentVersion, force = false } = {}) {
  log.debug(`Update check: current=${currentVersion}`);
  if (!currentVersion) {
    return { current: 'unknown', latest: null, updateAvailable: false };
  }

  // Check cache first (unless forced)
  if (!force) {
    const cache = readCache();
    if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
      const cachedLatest = typeof cache.latest === 'string' ? sanitizeVersion(cache.latest) : null;
      if (cachedLatest && /^\d+\.\d+\.\d+$/.test(cachedLatest)) {
        log.debug('Using cached update check result');
        return {
          current: currentVersion,
          latest: cachedLatest,
          updateAvailable: isNewerVersion(currentVersion, cachedLatest),
        };
      }
    }
  }

  // Fetch from registry
  const latest = await module.exports.fetchLatestVersion();
  if (!latest) {
    return { current: currentVersion, latest: null, updateAvailable: false };
  }

  // Cache the result
  writeCache(latest);

  const updateAvailable = isNewerVersion(currentVersion, latest);
  log.debug(
    updateAvailable
      ? `Update available: ${currentVersion} → ${latest}`
      : `Already on latest version: ${currentVersion}`,
  );

  return {
    current: currentVersion,
    latest,
    updateAvailable,
  };
}

/**
 * Detect how TermBeam was installed and return the appropriate update command,
 * whether it can auto-update, and the restart strategy.
 * @returns {{ method: string, command: string, canAutoUpdate: boolean, restartStrategy: 'pm2'|'exit'|'none', installCmd: string|null, installArgs: string[]|null }}
 * Note: installCmd/installArgs are internal — stripped before sending to API clients.
 */
function detectInstallMethod() {
  // npx / npm exec — npm sets npm_command=exec
  if (process.env.npm_command === 'exec') {
    log.debug('Install method: npx');
    return {
      method: 'npx',
      command: 'npx termbeam@latest',
      installCmd: 'npx',
      installArgs: ['termbeam@latest'],
      canAutoUpdate: false,
      restartStrategy: 'none',
    };
  }

  // PM2 managed — detect via PM2 environment variables
  const isPm2 = isRunningUnderPm2();

  // Detect package manager from npm_execpath (set during npm/yarn/pnpm lifecycle)
  // Check this before file-system checks since env vars are more reliable
  const execPath = process.env.npm_execpath || '';
  if (execPath.includes('yarn')) {
    log.debug(`Install method: yarn${isPm2 ? ' (PM2)' : ''}`);
    return {
      method: 'yarn',
      command: 'yarn global add termbeam@latest',
      installCmd: 'yarn',
      installArgs: ['global', 'add', 'termbeam@latest'],
      canAutoUpdate: true,
      restartStrategy: isPm2 ? 'pm2' : 'exit',
    };
  }
  if (execPath.includes('pnpm')) {
    log.debug(`Install method: pnpm${isPm2 ? ' (PM2)' : ''}`);
    return {
      method: 'pnpm',
      command: 'pnpm add -g termbeam@latest',
      installCmd: 'pnpm',
      installArgs: ['add', '-g', 'termbeam@latest'],
      canAutoUpdate: true,
      restartStrategy: isPm2 ? 'pm2' : 'exit',
    };
  }

  // Development / git clone — not in node_modules and .git exists
  // Check before Docker: a git checkout running inside a container (CI/devcontainers)
  // should be treated as source, not Docker
  if (isRunningFromSource()) {
    log.debug('Install method: source');
    return {
      method: 'source',
      command: 'git pull && npm install && npm run build:frontend',
      installCmd: null,
      installArgs: null,
      canAutoUpdate: false,
      restartStrategy: 'none',
    };
  }

  // Docker — check for /.dockerenv or /proc/1/cgroup containing docker
  if (isRunningInDocker()) {
    log.debug('Install method: docker');
    return {
      method: 'docker',
      command: 'docker pull termbeam:latest && docker-compose up -d',
      installCmd: null,
      installArgs: null,
      canAutoUpdate: false,
      restartStrategy: 'none',
    };
  }

  // Default: npm global install
  log.debug(`Install method: npm${isPm2 ? ' (PM2)' : ''}`);
  return {
    method: 'npm',
    command: 'npm install -g termbeam@latest',
    installCmd: 'npm',
    installArgs: ['install', '-g', 'termbeam@latest'],
    canAutoUpdate: true,
    restartStrategy: isPm2 ? 'pm2' : 'exit',
  };
}

/**
 * Detect if running inside a Docker container.
 */
function isRunningInDocker() {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
  } catch {
    // ignore
  }
  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    if (cgroup.includes('docker') || cgroup.includes('containerd')) return true;
  } catch {
    // Not Linux or no access — not Docker
  }
  return false;
}

/**
 * Detect if running from a git source checkout (not installed as a package).
 * Walks upward from __dirname looking for .git to avoid fragile fixed-depth assumptions.
 */
function isRunningFromSource() {
  // If __dirname is inside node_modules, it's a package install
  if (__dirname.includes('node_modules')) return false;
  try {
    let currentDir = __dirname;
    for (let i = 0; i < 10; i++) {
      if (fs.existsSync(path.join(currentDir, '.git'))) return true;
      const parentDir = path.dirname(currentDir);
      if (!parentDir || parentDir === currentDir) break;
      currentDir = parentDir;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Detect if running under PM2 process manager.
 */
function isRunningUnderPm2() {
  return !!(process.env.PM2_HOME || process.env.pm_id || process.env.PM2_USAGE);
}

module.exports = {
  checkForUpdate,
  isNewerVersion,
  isPreRelease,
  normalizeVersion,
  fetchLatestVersion,
  readCache,
  writeCache,
  sanitizeVersion,
  detectInstallMethod,
  isRunningInDocker,
  isRunningFromSource,
  isRunningUnderPm2,
};
