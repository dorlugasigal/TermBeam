const { execSync } = require('child_process');
const path = require('path');
const log = require('./logger');

function git(cmd, cwd) {
  return execSync(`git ${cmd}`, { cwd, stdio: 'pipe', timeout: 3000 }).toString().trim();
}

function getGitInfo(cwd) {
  try {
    git('rev-parse --is-inside-work-tree', cwd);
  } catch {
    log.debug(`Not a git repository: ${cwd}`);
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

  log.debug(`Git info resolved for ${cwd}`);
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

// --- Extended git utilities (async, using execFile for security) ---

const GIT_TIMEOUT = 5000;
const MAX_DIFF_BUFFER = 1024 * 1024; // 1 MB
const MAX_BLAME_BUFFER = 2 * 1024 * 1024; // 2 MB
const MAX_LOG_BUFFER = 1024 * 1024; // 1 MB

// git status --porcelain returns paths relative to the repo root, so
// commands that accept those paths (diff, blame, log --follow) must also
// run from the repo root.  Cache per-cwd to avoid repeated rev-parse calls.
const gitRootCache = new Map();

async function getGitRoot(cwd) {
  if (gitRootCache.has(cwd)) return gitRootCache.get(cwd);
  try {
    const root = await new Promise((resolve, reject) => {
      require('child_process').execFile(
        'git',
        ['rev-parse', '--show-toplevel'],
        { cwd, timeout: GIT_TIMEOUT },
        (err, stdout) => {
          if (err) return reject(err);
          resolve(stdout.trim());
        },
      );
    });
    gitRootCache.set(cwd, root);
    return root;
  } catch {
    return cwd; // fallback to session cwd
  }
}

async function gitAsync(args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    require('child_process').execFile(
      'git',
      args,
      {
        cwd,
        timeout: options.timeout || GIT_TIMEOUT,
        maxBuffer: options.maxBuffer || MAX_DIFF_BUFFER,
      },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      },
    );
  });
}

async function getDetailedStatus(cwd) {
  try {
    await gitAsync(['rev-parse', '--is-inside-work-tree'], cwd);
  } catch {
    return { isGitRepo: false };
  }

  const result = {
    branch: null,
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    isGitRepo: true,
  };

  try {
    const raw = await gitAsync(['status', '--porcelain=v1', '-b'], cwd);
    const lines = raw.split('\n').filter(Boolean);

    for (const line of lines) {
      // Branch header line
      if (line.startsWith('## ')) {
        const branchInfo = line.slice(3);
        const trackMatch = branchInfo.match(/^(.+?)(?:\.\.\.(.+?))?(?:\s+\[(.+)\])?$/);
        if (trackMatch) {
          result.branch = trackMatch[1];
          const tracking = trackMatch[3];
          if (tracking) {
            const aheadMatch = tracking.match(/ahead (\d+)/);
            const behindMatch = tracking.match(/behind (\d+)/);
            if (aheadMatch) result.ahead = parseInt(aheadMatch[1], 10);
            if (behindMatch) result.behind = parseInt(behindMatch[1], 10);
          }
        }
        continue;
      }

      const index = line[0];
      const working = line[1];
      const filePart = line.slice(3);

      // Untracked
      if (index === '?' && working === '?') {
        result.untracked.push(filePart);
        continue;
      }

      // Staged changes (index column)
      if (index !== ' ' && index !== '?') {
        const entry = { path: filePart, status: index, oldPath: null };
        if (index === 'R' || index === 'C') {
          const parts = filePart.split(' -> ');
          if (parts.length === 2) {
            entry.oldPath = parts[0];
            entry.path = parts[1];
          }
        }
        result.staged.push(entry);
      }

      // Working tree changes (working column)
      if (working !== ' ' && working !== '?') {
        result.modified.push({ path: filePart, status: working, oldPath: null });
      }
    }
  } catch (err) {
    log.warn(`getDetailedStatus failed: ${err.message}`);
  }

  return result;
}

async function parseDiffOutput(raw, filePath) {
  const result = {
    file: filePath,
    hunks: [],
    additions: 0,
    deletions: 0,
    isBinary: false,
  };

  if (!raw.trim()) return result;

  // Binary file detection — only check the diff header (lines before the first hunk).
  // Content lines (prefixed with +/-/ ) may contain "Binary files ... differ" as text.
  const firstHunkIdx = raw.indexOf('\n@@');
  const header = firstHunkIdx >= 0 ? raw.slice(0, firstHunkIdx) : raw;
  if (header.includes('Binary files') && header.includes('differ')) {
    result.isBinary = true;
    return result;
  }

  // Parse unified diff into hunks
  const lines = raw.split('\n');
  let currentHunk = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    // Hunk header
    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      currentHunk = {
        header: line.match(/^@@.*@@/)[0],
        oldStart: parseInt(hunkMatch[1], 10),
        oldLines: parseInt(hunkMatch[2] ?? '1', 10),
        newStart: parseInt(hunkMatch[3], 10),
        newLines: parseInt(hunkMatch[4] ?? '1', 10),
        lines: [],
      };
      result.hunks.push(currentHunk);
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('+')) {
      currentHunk.lines.push({
        type: 'add',
        content: line.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
      result.additions++;
    } else if (line.startsWith('-')) {
      currentHunk.lines.push({
        type: 'remove',
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
      result.deletions++;
    } else if (line.startsWith(' ')) {
      currentHunk.lines.push({
        type: 'context',
        content: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
    // Skip diff header lines (diff --git, index, ---, +++)
  }

  return result;
}

async function getFileDiff(cwd, filePath, options = {}) {
  const { staged = false, untracked = false, context = 3 } = options;
  // git status returns paths relative to the repo root, so run diff from there
  const root = await getGitRoot(cwd);

  try {
    // Untracked files: use --no-index to diff against the null device
    const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    if (untracked) {
      const raw = await new Promise((resolve, reject) => {
        require('child_process').execFile(
          'git',
          ['diff', '--no-index', '--no-color', `--unified=${context}`, '--', nullDevice, filePath],
          {
            cwd: root,
            timeout: GIT_TIMEOUT,
            maxBuffer: MAX_DIFF_BUFFER,
          },
          (err, stdout) => {
            // git diff --no-index exits with 1 when files differ — that's expected
            if (err && err.code !== 1) return reject(err);
            resolve(stdout || '');
          },
        );
      });
      return parseDiffOutput(raw, filePath);
    }

    const args = ['diff', `--unified=${context}`, '--no-color'];
    if (staged) args.push('--cached');
    args.push('--', filePath);

    const raw = await gitAsync(args, root, { maxBuffer: MAX_DIFF_BUFFER });
    return parseDiffOutput(raw, filePath);
  } catch (err) {
    // Empty diff or git error
    if (err.code !== 1) {
      log.warn(`getFileDiff failed: ${err.message}`);
    }
  }

  return {
    file: filePath,
    hunks: [],
    additions: 0,
    deletions: 0,
    isBinary: false,
  };
}

async function getFileBlame(cwd, filePath) {
  const result = { file: filePath, lines: [] };
  // git status returns paths relative to the repo root, so run blame from there
  const root = await getGitRoot(cwd);

  try {
    const raw = await gitAsync(['blame', '--porcelain', '--', filePath], root, {
      maxBuffer: MAX_BLAME_BUFFER,
    });

    const rawLines = raw.split('\n');
    let currentCommit = null;
    let currentLine = null;
    const commitInfo = {}; // cache commit metadata

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];

      // Commit line: <40-char-hash> <orig-line> <final-line> [<num-lines>]
      const commitMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
      if (commitMatch) {
        currentCommit = commitMatch[1];
        currentLine = parseInt(commitMatch[3], 10);

        if (!commitInfo[currentCommit]) {
          commitInfo[currentCommit] = {
            author: null,
            date: null,
            summary: null,
          };
        }
        continue;
      }

      // Metadata lines
      if (currentCommit && line.startsWith('author ')) {
        commitInfo[currentCommit].author = line.slice(7);
      } else if (currentCommit && line.startsWith('author-time ')) {
        const timestamp = parseInt(line.slice(12), 10);
        commitInfo[currentCommit].date = new Date(timestamp * 1000).toISOString();
      } else if (currentCommit && line.startsWith('summary ')) {
        commitInfo[currentCommit].summary = line.slice(8);
      } else if (currentCommit && line.startsWith('\t')) {
        // Content line
        const info = commitInfo[currentCommit];
        const isUncommitted = currentCommit === '0000000000000000000000000000000000000000';
        result.lines.push({
          line: currentLine,
          content: line.slice(1),
          commit: isUncommitted ? null : currentCommit.slice(0, 7),
          author: isUncommitted ? 'Not Committed Yet' : info.author || 'Unknown',
          date: isUncommitted ? null : info.date || null,
          summary: isUncommitted ? 'Uncommitted changes' : info.summary || '',
        });
      }
    }
  } catch (err) {
    log.warn(`getFileBlame failed: ${err.message}`);
  }

  return result;
}

const LOG_SEPARATOR = '---GIT_LOG_SEP---';
const LOG_FIELD_SEP = '---GIT_FIELD_SEP---';
const LOG_FORMAT = [
  '%H', // hash
  '%h', // short hash
  '%an', // author name
  '%ae', // author email
  '%aI', // author date ISO
  '%s', // subject
  '%b', // body
].join(LOG_FIELD_SEP);

async function getGitLog(cwd, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 20, 1), 100);
  const result = { commits: [] };

  try {
    const args = ['log', `--format=${LOG_SEPARATOR}${LOG_FORMAT}`, `-n`, String(limit)];
    // When filtering by file, run from repo root since paths are repo-root-relative
    let runCwd = cwd;
    if (options.file) {
      args.push('--follow', '--', options.file);
      runCwd = await getGitRoot(cwd);
    }

    const raw = await gitAsync(args, runCwd, { maxBuffer: MAX_LOG_BUFFER });

    const entries = raw.split(LOG_SEPARATOR).filter((e) => e.trim());
    for (const entry of entries) {
      const fields = entry.trim().split(LOG_FIELD_SEP);
      if (fields.length < 6) continue;
      result.commits.push({
        hash: fields[0],
        shortHash: fields[1],
        author: fields[2],
        email: fields[3],
        date: fields[4],
        subject: fields[5],
        body: (fields[6] || '').trim(),
      });
    }
  } catch (err) {
    log.warn(`getGitLog failed: ${err.message}`);
  }

  return result;
}

module.exports = {
  getGitInfo,
  parseRemoteUrl,
  parseStatus,
  getDetailedStatus,
  getFileDiff,
  getFileBlame,
  getGitLog,
  getGitRoot,
};
