import { describe, it, expect } from 'vitest';
import type { Session } from '@/types';
import {
  activityAgo,
  breakSegments,
  gitStatusParts,
  groupSessions,
  splitRepoName,
  tildePath,
} from '../sessionDisplay';

function session(id: string, git?: Session['git']): Session {
  return {
    id,
    name: id,
    shell: '/bin/zsh',
    pid: 1,
    cwd: '/tmp',
    createdAt: '',
    lastActivity: 0,
    git,
  };
}

const status = {
  clean: false,
  modified: 0,
  staged: 0,
  untracked: 0,
  ahead: 0,
  behind: 0,
  summary: '',
};

describe('tildePath', () => {
  it("abbreviates the server user's home on macOS, Linux, root and Windows", () => {
    expect(tildePath('/Users/dor/Projects/termbeam', '/Users/dor')).toBe('~/Projects/termbeam');
    expect(tildePath('/home/dor', '/home/dor')).toBe('~');
    expect(tildePath('/root/app', '/root/')).toBe('~/app');
    expect(tildePath('C:\\Users\\dor\\src', 'C:\\Users\\dor')).toBe('~\\src');
  });

  it("keeps other users' homes, shared folders and look-alike prefixes in full", () => {
    expect(tildePath('/Users/Shared/project', '/Users/dor')).toBe('/Users/Shared/project');
    expect(tildePath('/home/alice/app', '/home/bob')).toBe('/home/alice/app');
    expect(tildePath('/Users/dorx/app', '/Users/dor')).toBe('/Users/dorx/app');
    expect(tildePath('/opt/app', '/Users/dor')).toBe('/opt/app');
  });

  it('shortens nothing when the home is unknown', () => {
    expect(tildePath('/Users/dor/Projects', undefined)).toBe('/Users/dor/Projects');
    expect(tildePath('/home/dor', '')).toBe('/home/dor');
    expect(tildePath('/x', '/')).toBe('/x');
    expect(tildePath('', '/Users/dor')).toBe('');
    expect(tildePath(null, '/Users/dor')).toBe('');
  });
});

describe('breakSegments', () => {
  it('splits after each separator without losing characters', () => {
    expect(breakSegments('user/feature/carrier-redesign')).toEqual([
      'user/',
      'feature/',
      'carrier-redesign',
    ]);
    expect(breakSegments('C:\\a\\b')).toEqual(['C:\\', 'a\\', 'b']);
    expect(breakSegments('main')).toEqual(['main']);
    expect(breakSegments('/')).toEqual(['/']);
  });
});

describe('activityAgo', () => {
  const now = 1_700_000_000_000;
  it('uses compact labels with spoken equivalents', () => {
    expect(activityAgo(now - 3_000, now)).toEqual({
      short: 'now',
      long: 'Active now',
      recent: true,
    });
    expect(activityAgo(now - 42_000, now).short).toBe('42s');
    expect(activityAgo(now - 60_000, now).long).toBe('Active 1 minute ago');
    expect(activityAgo(now - 5 * 3_600_000, now).short).toBe('5h');
    expect(activityAgo(now - 2 * 86_400_000, now).long).toBe('Active 2 days ago');
  });

  it('accepts ISO strings and tolerates bad input', () => {
    expect(activityAgo(new Date(now - 120_000).toISOString(), now).short).toBe('2m');
    expect(activityAgo('not a date', now)).toEqual({
      short: '',
      long: 'No recent activity',
      recent: false,
    });
    expect(activityAgo(now + 5_000, now).recent).toBe(true);
  });
});

describe('gitStatusParts', () => {
  it('lists every non-zero bucket and sync arrows', () => {
    expect(
      gitStatusParts({ ...status, staged: 2, modified: 85, untracked: 3, ahead: 1, behind: 4 }),
    ).toEqual([
      { tone: 'staged', count: 2, label: 'staged' },
      { tone: 'modified', count: 85, label: 'modified' },
      { tone: 'untracked', count: 3, label: 'untracked' },
      { tone: 'sync', count: null, label: '↑1' },
      { tone: 'sync', count: null, label: '↓4' },
    ]);
  });

  it('reports a clean tree, and nothing when status is unknown', () => {
    expect(gitStatusParts({ ...status, clean: true })).toEqual([
      { tone: 'clean', count: null, label: 'Clean' },
    ]);
    expect(gitStatusParts(undefined)).toEqual([]);
  });
});

describe('groupSessions', () => {
  it('groups by working tree in first-seen order with non-repo sessions last', () => {
    const tb = { branch: 'main', repoName: 'me/tb', root: '/w/tb' };
    const other = { branch: 'dev', repoName: 'me/x', root: '/w/x' };
    const groups = groupSessions([
      session('loose'),
      session('a', tb),
      session('b', other),
      session('c', { ...tb, status: { ...status, modified: 1 } }),
    ]);
    expect(groups.map((g) => [g.key, g.sessions.map((s) => s.id)])).toEqual([
      ['root:/w/tb', ['a', 'c']],
      ['root:/w/x', ['b']],
      ['none', ['loose']],
    ]);
  });

  it('falls back to repo + branch when the server did not report a root', () => {
    const groups = groupSessions([
      session('a', { branch: 'main', repoName: 'me/tb' }),
      session('b', { branch: 'main', repoName: 'me/tb' }),
      session('c', { branch: 'dev', repoName: 'me/tb' }),
    ]);
    expect(groups.map((g) => g.sessions.length)).toEqual([2, 1]);
  });
});

describe('splitRepoName', () => {
  it('separates the owner path from the repository name', () => {
    expect(splitRepoName('dorlugasigal/TermBeam')).toEqual({
      owner: 'dorlugasigal/',
      name: 'TermBeam',
    });
    expect(splitRepoName('org/project/repo')).toEqual({ owner: 'org/project/', name: 'repo' });
    expect(splitRepoName('local')).toEqual({ owner: '', name: 'local' });
    expect(splitRepoName(undefined)).toEqual({ owner: '', name: '' });
  });
});
