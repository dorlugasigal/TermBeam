const { execSync } = require('child_process');
const path = require('path');

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, stdio: 'pipe', timeout: 3000 }).toString().trim();
}

function getGitInfo(cwd) {
  try {
    git('rev-parse --is-inside-work-tree', cwd);
  } catch {
    return null;
  }

  const result = { branch: null, repoName: null, provider: null, status: null };

  try {
    const branch = git('branch --show-current', cwd);
    if (branch) {
      result.branch = branch;
    } else {
      // Detached HEAD — use short SHA
      result.branch = `(${git('rev-parse --short HEAD', cwd)})`;
    }
  } catch {
    /* empty repo */
  }

  try {
    const remoteUrl = git('remote get-url origin', cwd);
    const parsed = parseRemoteUrl(remoteUrl);
    if (parsed) {
      result.repoName = parsed.repoName;
      result.provider = parsed.provider;
    }
  } catch {
    // No remote — use directory name
    try {
      const root = git('rev-parse --show-toplevel', cwd);
      result.repoName = path.basename(root);
    } catch {
      /* ignore */
    }
  }

  let ahead = 0,
    behind = 0;
  try {
    const counts = git('rev-list --left-right --count HEAD...@{upstream}', cwd);
    [ahead, behind] = counts.split(/\s+/).map(Number);
  } catch {
    /* no upstream configured */
  }

  try {
    const raw = git('status --porcelain', cwd);
    result.status = parseStatus(raw, ahead, behind);
  } catch {
    /* ignore */
  }

  return result;
}

function parseRemoteUrl(url) {
  // Azure DevOps: https://dev.azure.com/org/project/_git/repo
  const azureMatch = url.match(/dev\.azure\.com\/([^/]+\/[^/]+)\/_git\/([^/]+?)(?:\.git)?$/);
  if (azureMatch) {
    return { repoName: `${azureMatch[1]}/${azureMatch[2]}`, provider: 'Azure DevOps' };
  }

  // Azure DevOps (legacy): https://org.visualstudio.com/project/_git/repo
  const vsMatch = url.match(/([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/]+?)(?:\.git)?$/);
  if (vsMatch) {
    return { repoName: `${vsMatch[1]}/${vsMatch[2]}/${vsMatch[3]}`, provider: 'Azure DevOps' };
  }

  // SSH: git@github.com:owner/repo.git
  // HTTPS: https://github.com/owner/repo.git
  const match = url.match(/[@/]([^/:]+)[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!match) return null;

  const host = match[1];
  const fullName = match[2];

  let provider = host;
  if (host.includes('github')) provider = 'GitHub';
  else if (host.includes('gitlab')) provider = 'GitLab';
  else if (host.includes('bitbucket')) provider = 'Bitbucket';

  return { repoName: fullName, provider };
}

function parseStatus(output, ahead, behind) {
  let modified = 0,
    staged = 0,
    untracked = 0;

  if (output) {
    const lines = output.split('\n').filter(Boolean);
    for (const line of lines) {
      const index = line[0];
      const working = line[1];
      if (index === '?' && working === '?') {
        untracked++;
      } else {
        if (index !== ' ' && index !== '?') staged++;
        if (working !== ' ' && working !== '?') modified++;
      }
    }
  }

  const parts = [];
  if (staged) parts.push(`${staged} staged`);
  if (modified) parts.push(`${modified} modified`);
  if (untracked) parts.push(`${untracked} untracked`);
  if (ahead) parts.push(`${ahead}↑`);
  if (behind) parts.push(`${behind}↓`);
  const clean = !staged && !modified && !untracked && !ahead && !behind;
  const summary = parts.length ? parts.join(', ') : 'clean';

  return { clean, modified, staged, untracked, ahead: ahead || 0, behind: behind || 0, summary };
}

module.exports = { getGitInfo, parseRemoteUrl, parseStatus };
