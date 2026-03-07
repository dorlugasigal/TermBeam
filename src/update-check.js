const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
  return v.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

/**
 * Fetch the latest version from the npm registry.
 * Returns the version string or null on failure.
 * @param {string} [registryUrl] - Override the registry URL (for testing).
 */
function fetchLatestVersion(registryUrl) {
  const url = registryUrl || REGISTRY_URL;
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve) => {
    const req = client.get(url, { timeout: REQUEST_TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
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
          if (!/^\d+\.\d+\.\d+/.test(version)) {
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
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
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
  // Skip check for dev versions
  if (!currentVersion || currentVersion.includes('-dev')) {
    return { current: currentVersion || 'unknown', latest: null, updateAvailable: false };
  }

  // Check cache first (unless forced)
  if (!force) {
    const cache = readCache();
    if (cache && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
      return {
        current: currentVersion,
        latest: cache.latest,
        updateAvailable: isNewerVersion(currentVersion, cache.latest),
      };
    }
  }

  // Fetch from registry
  const latest = await module.exports.fetchLatestVersion();
  if (!latest) {
    return { current: currentVersion, latest: null, updateAvailable: false };
  }

  // Cache the result
  writeCache(latest);

  return {
    current: currentVersion,
    latest,
    updateAvailable: isNewerVersion(currentVersion, latest),
  };
}

/**
 * Detect how TermBeam was installed and return the appropriate update command.
 * @returns {{ method: string, command: string }}
 */
function detectInstallMethod() {
  // npx / npm exec — npm sets npm_command=exec
  if (process.env.npm_command === 'exec') {
    return { method: 'npx', command: 'npx termbeam@latest' };
  }

  // Detect package manager from npm_execpath (set during npm/yarn/pnpm lifecycle)
  const execPath = process.env.npm_execpath || '';
  if (execPath.includes('yarn')) {
    return { method: 'yarn', command: 'yarn global add termbeam@latest' };
  }
  if (execPath.includes('pnpm')) {
    return { method: 'pnpm', command: 'pnpm add -g termbeam@latest' };
  }

  // Default: npm global install
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
