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
  return false;
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
 * Detect how TermBeam was installed and return the appropriate update command.
 * @returns {{ method: string, command: string }}
 */
function detectInstallMethod() {
  // npx / npm exec — npm sets npm_command=exec
  if (process.env.npm_command === 'exec') {
    log.debug('Install method: npx');
    return { method: 'npx', command: 'npx termbeam@latest' };
  }

  // Detect package manager from npm_execpath (set during npm/yarn/pnpm lifecycle)
  const execPath = process.env.npm_execpath || '';
  if (execPath.includes('yarn')) {
    log.debug('Install method: yarn');
    return { method: 'yarn', command: 'yarn global add termbeam@latest' };
  }
  if (execPath.includes('pnpm')) {
    log.debug('Install method: pnpm');
    return { method: 'pnpm', command: 'pnpm add -g termbeam@latest' };
  }

  // Default: npm global install
  log.debug('Install method: npm');
  return { method: 'npm', command: 'npm install -g termbeam@latest' };
}

module.exports = {
  checkForUpdate,
  isNewerVersion,
  normalizeVersion,
  fetchLatestVersion,
  readCache,
  writeCache,
  sanitizeVersion,
  detectInstallMethod,
};
