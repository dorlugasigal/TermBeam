const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('child_process');

// We mock execFile by replacing it on the child_process module.
// The git.js module uses promisify(execFile), so we need to mock before requiring.
let originalExecFile;
let mockExecFile;

function setupMock(handler) {
  mockExecFile = handler;
}

function installMock() {
  originalExecFile = childProcess.execFile;
  childProcess.execFile = function (cmd, args, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    if (mockExecFile) {
      try {
        const result = mockExecFile(cmd, args, opts);
        if (result instanceof Error) {
          process.nextTick(() => cb(result));
        } else {
          process.nextTick(() => cb(null, result, ''));
        }
      } catch (err) {
        process.nextTick(() => cb(err));
      }
    } else {
      process.nextTick(() => cb(new Error('No mock configured')));
    }
  };
}

function restoreMock() {
  childProcess.execFile = originalExecFile;
  mockExecFile = null;
}

// Clear require cache to get fresh module with our mock
function loadGit() {
  const modPath = require.resolve('../../src/utils/git');
  delete require.cache[modPath];
  return require('../../src/utils/git');
}

describe('getDetailedStatus', () => {
  beforeEach(() => installMock());
  afterEach(() => restoreMock());

  it('returns isGitRepo false for non-git directory', async () => {
    setupMock((_cmd, args) => {
      if (args.includes('--is-inside-work-tree')) {
        throw new Error('not a git repository');
      }
      return '';
    });
    const { getDetailedStatus } = loadGit();
    const result = await getDetailedStatus('/tmp');
    assert.equal(result.isGitRepo, false);
  });

  it('parses branch and status correctly', async () => {
    setupMock((_cmd, args) => {
      if (args.includes('--is-inside-work-tree')) return 'true';
      if (args.includes('--porcelain=v1')) {
        return [
          '## main...origin/main [ahead 2, behind 1]',
          'A  src/new.js',
          ' M src/routes.js',
          '?? TODO.md',
          'MM src/both.js',
        ].join('\n');
      }
      return '';
    });
    const { getDetailedStatus } = loadGit();
    const result = await getDetailedStatus('/project');

    assert.equal(result.isGitRepo, true);
    assert.equal(result.branch, 'main');
    assert.equal(result.ahead, 2);
    assert.equal(result.behind, 1);
    assert.equal(result.staged.length, 2);
    assert.equal(result.staged[0].path, 'src/new.js');
    assert.equal(result.staged[0].status, 'A');
    assert.equal(result.staged[1].path, 'src/both.js');
    assert.equal(result.staged[1].status, 'M');
    assert.equal(result.modified.length, 2);
    assert.equal(result.modified[0].path, 'src/routes.js');
    assert.equal(result.modified[0].status, 'M');
    assert.equal(result.modified[1].path, 'src/both.js');
    assert.equal(result.untracked.length, 1);
    assert.equal(result.untracked[0], 'TODO.md');
  });

  it('handles branch without tracking info', async () => {
    setupMock((_cmd, args) => {
      if (args.includes('--is-inside-work-tree')) return 'true';
      if (args.includes('--porcelain=v1')) return '## feature-branch\n';
      return '';
    });
    const { getDetailedStatus } = loadGit();
    const result = await getDetailedStatus('/project');

    assert.equal(result.branch, 'feature-branch');
    assert.equal(result.ahead, 0);
    assert.equal(result.behind, 0);
  });

  it('handles renames in staged files', async () => {
    setupMock((_cmd, args) => {
      if (args.includes('--is-inside-work-tree')) return 'true';
      if (args.includes('--porcelain=v1')) {
        return '## main\nR  old.js -> new.js\n';
      }
      return '';
    });
    const { getDetailedStatus } = loadGit();
    const result = await getDetailedStatus('/project');

    assert.equal(result.staged.length, 1);
    assert.equal(result.staged[0].status, 'R');
    assert.equal(result.staged[0].path, 'new.js');
    assert.equal(result.staged[0].oldPath, 'old.js');
  });

  it('returns empty arrays for clean repo', async () => {
    setupMock((_cmd, args) => {
      if (args.includes('--is-inside-work-tree')) return 'true';
      if (args.includes('--porcelain=v1')) return '## main\n';
      return '';
    });
    const { getDetailedStatus } = loadGit();
    const result = await getDetailedStatus('/project');

    assert.equal(result.staged.length, 0);
    assert.equal(result.modified.length, 0);
    assert.equal(result.untracked.length, 0);
  });
});

describe('getFileDiff', () => {
  beforeEach(() => installMock());
  afterEach(() => restoreMock());

  it('parses unified diff output into hunks', async () => {
    const diffOutput = [
      'diff --git a/src/routes.js b/src/routes.js',
      'index abc1234..def5678 100644',
      '--- a/src/routes.js',
      '+++ b/src/routes.js',
      '@@ -10,6 +10,8 @@ function setup() {',
      '   const a = 1;',
      '-  const b = 2;',
      '+  const b = 3;',
      '+  const c = 4;',
      '   const d = 5;',
    ].join('\n');

    setupMock((_cmd, args) => {
      if (args.includes('diff')) return diffOutput;
      return '';
    });
    const { getFileDiff } = loadGit();
    const result = await getFileDiff('/project', 'src/routes.js');

    assert.equal(result.file, 'src/routes.js');
    assert.equal(result.isBinary, false);
    assert.equal(result.hunks.length, 1);
    assert.equal(result.hunks[0].oldStart, 10);
    assert.equal(result.hunks[0].oldLines, 6);
    assert.equal(result.hunks[0].newStart, 10);
    assert.equal(result.hunks[0].newLines, 8);
    assert.equal(result.additions, 2);
    assert.equal(result.deletions, 1);

    const lines = result.hunks[0].lines;
    assert.equal(lines[0].type, 'context');
    assert.equal(lines[0].oldLine, 10);
    assert.equal(lines[0].newLine, 10);
    assert.equal(lines[1].type, 'remove');
    assert.equal(lines[1].oldLine, 11);
    assert.equal(lines[1].newLine, null);
    assert.equal(lines[2].type, 'add');
    assert.equal(lines[2].oldLine, null);
    assert.equal(lines[2].newLine, 11);
  });

  it('detects binary files', async () => {
    setupMock((_cmd, args) => {
      if (args.includes('diff')) {
        return 'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n';
      }
      return '';
    });
    const { getFileDiff } = loadGit();
    const result = await getFileDiff('/project', 'image.png');

    assert.equal(result.isBinary, true);
    assert.equal(result.hunks.length, 0);
  });

  it('returns empty hunks for no diff', async () => {
    setupMock((_cmd, args) => {
      if (args.includes('diff')) return '';
      return '';
    });
    const { getFileDiff } = loadGit();
    const result = await getFileDiff('/project', 'clean.js');

    assert.equal(result.hunks.length, 0);
    assert.equal(result.additions, 0);
    assert.equal(result.deletions, 0);
  });

  it('passes --cached for staged diffs', async () => {
    let capturedArgs;
    setupMock((_cmd, args) => {
      capturedArgs = args;
      return '';
    });
    const { getFileDiff } = loadGit();
    await getFileDiff('/project', 'file.js', { staged: true });

    assert.ok(capturedArgs.includes('--cached'));
  });

  it('uses custom context lines', async () => {
    let capturedArgs;
    setupMock((_cmd, args) => {
      capturedArgs = args;
      return '';
    });
    const { getFileDiff } = loadGit();
    await getFileDiff('/project', 'file.js', { context: 5 });

    assert.ok(capturedArgs.includes('--unified=5'));
  });

  it('parses multiple hunks', async () => {
    const diffOutput = [
      'diff --git a/file.js b/file.js',
      '--- a/file.js',
      '+++ b/file.js',
      '@@ -1,3 +1,4 @@',
      ' line1',
      '+added1',
      ' line2',
      ' line3',
      '@@ -20,3 +21,2 @@',
      ' line20',
      '-removed',
      ' line22',
    ].join('\n');

    setupMock((_cmd, args) => {
      if (args.includes('diff')) return diffOutput;
      return '';
    });
    const { getFileDiff } = loadGit();
    const result = await getFileDiff('/project', 'file.js');

    assert.equal(result.hunks.length, 2);
    assert.equal(result.hunks[0].oldStart, 1);
    assert.equal(result.hunks[1].oldStart, 20);
    assert.equal(result.additions, 1);
    assert.equal(result.deletions, 1);
  });
});

describe('getFileBlame', () => {
  beforeEach(() => installMock());
  afterEach(() => restoreMock());

  it('parses porcelain blame output', async () => {
    const blameOutput = [
      'abcdef1234567890abcdef1234567890abcdef12 1 1 2',
      'author John Doe',
      'author-mail <john@example.com>',
      'author-time 1705312200',
      'author-tz +0000',
      'committer John Doe',
      'committer-mail <john@example.com>',
      'committer-time 1705312200',
      'committer-tz +0000',
      'summary Initial commit',
      'filename src/routes.js',
      '\tconst express = require("express");',
      'abcdef1234567890abcdef1234567890abcdef12 2 2',
      '\tconst path = require("path");',
    ].join('\n');

    setupMock((_cmd, args) => {
      if (args.includes('blame')) return blameOutput;
      return '';
    });
    const { getFileBlame } = loadGit();
    const result = await getFileBlame('/project', 'src/routes.js');

    assert.equal(result.file, 'src/routes.js');
    assert.equal(result.lines.length, 2);
    assert.equal(result.lines[0].line, 1);
    assert.equal(result.lines[0].content, 'const express = require("express");');
    assert.equal(result.lines[0].commit, 'abcdef1');
    assert.equal(result.lines[0].author, 'John Doe');
    assert.equal(result.lines[0].summary, 'Initial commit');
    assert.ok(result.lines[0].date);
    assert.equal(result.lines[1].line, 2);
    assert.equal(result.lines[1].content, 'const path = require("path");');
  });

  it('handles uncommitted lines', async () => {
    const blameOutput = [
      '0000000000000000000000000000000000000000 1 1 1',
      'author Not Committed Yet',
      'author-mail <not.committed.yet>',
      'author-time 0',
      'author-tz +0000',
      'committer Not Committed Yet',
      'committer-mail <not.committed.yet>',
      'committer-time 0',
      'committer-tz +0000',
      'summary Not Yet Committed',
      'filename new.js',
      '\tconsole.log("new");',
    ].join('\n');

    setupMock((_cmd, args) => {
      if (args.includes('blame')) return blameOutput;
      return '';
    });
    const { getFileBlame } = loadGit();
    const result = await getFileBlame('/project', 'new.js');

    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].commit, null);
    assert.equal(result.lines[0].author, 'Not Committed Yet');
    assert.equal(result.lines[0].date, null);
    assert.equal(result.lines[0].summary, 'Uncommitted changes');
  });

  it('returns empty lines on error', async () => {
    setupMock(() => {
      throw new Error('fatal: no such path');
    });
    const { getFileBlame } = loadGit();
    const result = await getFileBlame('/project', 'nonexistent.js');

    assert.equal(result.lines.length, 0);
    assert.equal(result.file, 'nonexistent.js');
  });
});

describe('getGitLog', () => {
  beforeEach(() => installMock());
  afterEach(() => restoreMock());

  it('parses log output into commits', async () => {
    const sep = '---GIT_LOG_SEP---';
    const fieldSep = '---GIT_FIELD_SEP---';
    const logOutput = [
      `${sep}abc1234def5678${fieldSep}abc1234${fieldSep}John Doe${fieldSep}john@example.com${fieldSep}2024-01-15T10:30:00+00:00${fieldSep}feat: add feature${fieldSep}Detailed body`,
      `${sep}def5678abc1234${fieldSep}def5678${fieldSep}Jane Doe${fieldSep}jane@example.com${fieldSep}2024-01-14T09:00:00+00:00${fieldSep}fix: bug fix${fieldSep}`,
    ].join('\n');

    setupMock((_cmd, args) => {
      if (args.includes('log')) return logOutput;
      return '';
    });
    const { getGitLog } = loadGit();
    const result = await getGitLog('/project');

    assert.equal(result.commits.length, 2);
    assert.equal(result.commits[0].hash, 'abc1234def5678');
    assert.equal(result.commits[0].shortHash, 'abc1234');
    assert.equal(result.commits[0].author, 'John Doe');
    assert.equal(result.commits[0].email, 'john@example.com');
    assert.equal(result.commits[0].subject, 'feat: add feature');
    assert.equal(result.commits[0].body, 'Detailed body');
    assert.equal(result.commits[1].body, '');
  });

  it('respects limit option', async () => {
    let capturedArgs;
    setupMock((_cmd, args) => {
      capturedArgs = args;
      return '';
    });
    const { getGitLog } = loadGit();
    await getGitLog('/project', { limit: 5 });

    assert.ok(capturedArgs.includes('-n'));
    assert.ok(capturedArgs.includes('5'));
  });

  it('caps limit at 100', async () => {
    let capturedArgs;
    setupMock((_cmd, args) => {
      capturedArgs = args;
      return '';
    });
    const { getGitLog } = loadGit();
    await getGitLog('/project', { limit: 999 });

    assert.ok(capturedArgs.includes('100'));
  });

  it('passes --follow for file history', async () => {
    let capturedArgs;
    setupMock((_cmd, args) => {
      capturedArgs = args;
      return '';
    });
    const { getGitLog } = loadGit();
    await getGitLog('/project', { file: 'src/index.js' });

    assert.ok(capturedArgs.includes('--follow'));
    assert.ok(capturedArgs.includes('--'));
    assert.ok(capturedArgs.includes('src/index.js'));
  });

  it('returns empty commits on error', async () => {
    setupMock(() => {
      throw new Error('fatal: bad default revision');
    });
    const { getGitLog } = loadGit();
    const result = await getGitLog('/project');

    assert.deepStrictEqual(result.commits, []);
  });

  it('defaults limit to 20', async () => {
    let capturedArgs;
    setupMock((_cmd, args) => {
      capturedArgs = args;
      return '';
    });
    const { getGitLog } = loadGit();
    await getGitLog('/project');

    assert.ok(capturedArgs.includes('20'));
  });
});
