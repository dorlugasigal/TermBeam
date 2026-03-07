const path = require('path');
const { execSync } = require('child_process');

function getVersion() {
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const base = pkg.version;

  // If installed via npm (global or npx), use the package version as-is
  if (process.env.npm_package_version || isInstalledGlobally()) {
    return base;
  }

  // Running from source — git tags are the version source of truth.
  // This avoids drift between package.json and tagged releases.
  try {
    const gitDesc = execSync('git describe --tags --always --dirty', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const tagMatch = gitDesc.match(/^v(\d+\.\d+\.\d+)/);
    if (tagMatch) {
      const gitVersion = tagMatch[1];
      // Exactly on a clean tag — return the tag version
      if (gitDesc === `v${gitVersion}`) return gitVersion;
      // Ahead of tag or dirty — show dev version derived from the tag
      return `${gitVersion}-dev (${gitDesc})`;
    }

    // No semver tag found (e.g. bare commit hash) — fall back to package.json
    return `${base}-dev (${gitDesc})`;
  } catch {
    return `${base}-dev`;
  }
}

function isInstalledGlobally() {
  // Check if we're running from a node_modules path (npm/npx install)
  return __dirname.includes('node_modules');
}

module.exports = { getVersion };
