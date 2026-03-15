const path = require('path');
const { execSync } = require('child_process');
const log = require('./logger');

function getVersion() {
  const pkg = require(path.join(__dirname, '..', '..', 'package.json'));
  const base = pkg.version;

  // If installed via npm (global or npx), use the package version as-is
  if (process.env.npm_package_version || isInstalledGlobally()) {
    log.debug('Version source: npm_package_version');
    const version = base;
    log.debug(`Resolved version: ${version}`);
    return version;
  }

  // Running from source — git tags are the version source of truth.
  // This avoids drift between package.json and tagged releases.
  try {
    const gitDesc = execSync('git describe --tags --always --dirty', {
      cwd: path.join(__dirname, '..', '..'),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const tagMatch = gitDesc.match(/^v(\d+\.\d+\.\d+)(?:-(\d+)-g([0-9a-f]+))?(-dirty)?$/);
    if (tagMatch) {
      const gitVersion = tagMatch[1];
      const commits = tagMatch[2];
      const hash = tagMatch[3];
      const dirty = tagMatch[4];

      // Exactly on a clean tag — return the tag version
      if (!commits && !dirty) {
        log.debug('Version source: git describe');
        const version = gitVersion;
        log.debug(`Resolved version: ${version}`);
        return version;
      }

      // Build a combined semver-style dev string
      let ver = `${gitVersion}-dev`;
      if (commits) ver += `.${commits}`;
      const meta = [hash ? `g${hash}` : null, dirty ? 'dirty' : null].filter(Boolean).join('.');
      if (meta) ver += `+${meta}`;
      log.debug('Version source: git describe');
      log.debug(`Resolved version: ${ver}`);
      return ver;
    }

    // No semver tag found (e.g. bare commit hash) — fall back to package.json
    log.debug('Version source: package.json fallback');
    const version = `${base}-dev+${gitDesc}`;
    log.debug(`Resolved version: ${version}`);
    return version;
  } catch {
    log.debug('Version source: package.json fallback');
    const version = `${base}-dev`;
    log.debug(`Resolved version: ${version}`);
    return version;
  }
}

function isInstalledGlobally() {
  // Check if we're running from a node_modules path (npm/npx install)
  return __dirname.includes('node_modules');
}

module.exports = { getVersion };
