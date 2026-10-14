const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseRemoteUrl, parseStatus, getGitInfo, getGitInfoAsync } = require('../../src/utils/git');

describe('parseRemoteUrl', () => {
  it('parses GitHub HTTPS URL', () => {
    const result = parseRemoteUrl('https://github.com/owner/repo.git');
    assert.deepStrictEqual(result, { repoName: 'owner/repo', provider: 'GitHub' });
  });

  it('parses GitHub SSH URL', () => {
    const result = parseRemoteUrl('git@github.com:owner/repo.git');
    assert.deepStrictEqual(result, { repoName: 'owner/repo', provider: 'GitHub' });
  });

  it('parses GitLab HTTPS URL', () => {
    const result = parseRemoteUrl('https://gitlab.com/owner/repo.git');
    assert.deepStrictEqual(result, { repoName: 'owner/repo', provider: 'GitLab' });
  });

  it('parses Bitbucket SSH URL', () => {
    const result = parseRemoteUrl('git@bitbucket.org:team/project.git');
    assert.deepStrictEqual(result, { repoName: 'team/project', provider: 'Bitbucket' });
  });

  it('handles URL without .git suffix', () => {
    const result = parseRemoteUrl('https://github.com/owner/repo');
    assert.deepStrictEqual(result, { repoName: 'owner/repo', provider: 'GitHub' });
  });

  it('handles Azure DevOps URL', () => {
    const result = parseRemoteUrl('https://dev.azure.com/org/project/_git/repo');
    assert.equal(result.provider, 'Azure DevOps');
  });

  it('handles Azure DevOps legacy visualstudio.com URL', () => {
    const result = parseRemoteUrl(
      'https://cet-tech.visualstudio.com/CETtech/_git/cet-infrastructure',
    );
    assert.equal(result.provider, 'Azure DevOps');
    assert.equal(result.repoName, 'cet-tech/CETtech/cet-infrastructure');
  });

  it('handles unknown provider', () => {
    const result = parseRemoteUrl('git@selfhosted.example.com:team/repo.git');
    assert.equal(result.provider, 'selfhosted.example.com');
    assert.equal(result.repoName, 'team/repo');
  });

  it('returns null for invalid URL', () => {
    assert.equal(parseRemoteUrl('not-a-url'), null);
  });
});

describe('parseStatus', () => {
  it('returns clean for empty output', () => {
    const result = parseStatus('', 0, 0);
    assert.deepStrictEqual(result, {
      clean: true,
      modified: 0,
      staged: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      summary: 'clean',
    });
  });

  it('counts untracked files', () => {
    const result = parseStatus('?? file1.js\n?? file2.js', 0, 0);
    assert.equal(result.untracked, 2);
    assert.equal(result.clean, false);
    assert.equal(result.summary, '2 untracked');
  });

  it('counts modified files in working tree', () => {
    const result = parseStatus(' M src/server.js\n M src/cli.js', 0, 0);
    assert.equal(result.modified, 2);
    assert.equal(result.staged, 0);
    assert.equal(result.summary, '2 modified');
  });

  it('counts staged files', () => {
    const result = parseStatus('M  src/server.js\nA  src/new.js', 0, 0);
    assert.equal(result.staged, 2);
    assert.equal(result.modified, 0);
    assert.equal(result.summary, '2 staged');
  });

  it('counts mixed status', () => {
    const result = parseStatus('MM src/both.js\n?? untracked.js\nA  staged.js', 0, 0);
    assert.equal(result.staged, 2);
    assert.equal(result.modified, 1);
    assert.equal(result.untracked, 1);
    assert.ok(result.summary.includes('staged'));
    assert.ok(result.summary.includes('modified'));
    assert.ok(result.summary.includes('untracked'));
  });

  it('includes ahead/behind in summary', () => {
    const result = parseStatus('', 3, 1);
    assert.equal(result.ahead, 3);
    assert.equal(result.behind, 1);
    assert.equal(result.clean, false);
    assert.equal(result.summary, '3↑, 1↓');
  });

  it('combines working tree changes with ahead/behind', () => {
    const result = parseStatus(' M file.js', 2, 0);
    assert.equal(result.modified, 1);
    assert.equal(result.ahead, 2);
    assert.ok(result.summary.includes('1 modified'));
    assert.ok(result.summary.includes('2↑'));
  });
});

describe('getGitInfo', () => {
  it('returns info for the current repo', () => {
    const info = getGitInfo(process.cwd());
    assert.notEqual(info, null);
    assert.equal(typeof info.branch, 'string');
    assert.ok(info.branch.length > 0);
    assert.ok(info.status !== null);
    assert.equal(typeof info.status.clean, 'boolean');
  });

  it('returns null for non-git directory', () => {
    const os = require('os');
    // /tmp or os.tmpdir() is unlikely to be a git repo
    const info = getGitInfo(os.tmpdir());
    assert.equal(info, null);
  });

  it('returns null for non-existent directory', () => {
    const info = getGitInfo('/nonexistent/path/that/does/not/exist');
    assert.equal(info, null);
  });
});

describe('git info against a scratch repository', () => {
  let repo;
  const run = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });

  before(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tb-git-info-')));
    run('init', '-q', '-b', 'feature/very-long-branch-name');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'Test');
    run('config', 'commit.gpgsign', 'false');
    for (const f of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(repo, f), 'one\n');
    run('add', '.');
    run('commit', '-q', '-m', 'init');
    // Unstaged edit to the file porcelain lists first (" M a.txt"), plus an untracked file
    fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'x\n');
    fs.mkdirSync(path.join(repo, 'sub'));
  });

  after(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('counts an unstaged first-line change as modified, not staged', () => {
    const { status } = getGitInfo(repo);
    assert.equal(status.staged, 0);
    assert.equal(status.modified, 1);
    assert.equal(status.untracked, 1);
    assert.equal(status.summary, '1 modified, 1 untracked');
  });

  it('reports the repository root, full branch and folder name without a remote', () => {
    const info = getGitInfo(path.join(repo, 'sub'));
    assert.equal(path.resolve(info.root), path.resolve(repo));
    assert.equal(info.branch, 'feature/very-long-branch-name');
    assert.equal(info.repoName, path.basename(repo));
    assert.equal(info.provider, null);
  });

  it('getGitInfoAsync matches the synchronous result', async () => {
    assert.deepEqual(
      await getGitInfoAsync(path.join(repo, 'sub')),
      getGitInfo(path.join(repo, 'sub')),
    );
  });

  it('getGitInfoAsync returns null outside a work tree', async () => {
    assert.equal(await getGitInfoAsync(os.tmpdir()), null);
    assert.equal(await getGitInfoAsync(path.join(repo, '.git')), null);
    assert.equal(await getGitInfoAsync('/nonexistent/path/that/does/not/exist'), null);
  });

  it('labels a detached HEAD with its short SHA', async () => {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo })
      .toString()
      .trim();
    run('checkout', '-q', '--detach');
    try {
      assert.equal((await getGitInfoAsync(repo)).branch, `(${sha})`);
      assert.equal(getGitInfo(repo).branch, `(${sha})`);
    } finally {
      run('checkout', '-q', 'feature/very-long-branch-name');
    }
  });
});
