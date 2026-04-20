// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER,
  deriveFacets,
  filterSessions,
  isEmptyFilter,
  matchesFilter,
  shellLabel,
} from '../sessionFilter';
import type { Session } from '@/types';

function mk(partial: Partial<Session>): Session {
  return {
    id: 'x',
    name: 'n',
    shell: '/bin/zsh',
    pid: 0,
    cwd: '/tmp',
    createdAt: new Date().toISOString(),
    lastActivity: Date.now(),
    ...partial,
  };
}

describe('sessionFilter', () => {
  it('isEmptyFilter returns true for EMPTY_FILTER', () => {
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
  });

  it('shellLabel extracts basename and strips .exe', () => {
    expect(shellLabel(mk({ shell: '/bin/bash' }))).toBe('bash');
    expect(shellLabel(mk({ shell: 'C:\\Windows\\system32\\powershell.exe' }))).toBe(
      'powershell',
    );
    expect(shellLabel(mk({ shell: '' }))).toBe('');
  });

  it('text search matches name, cwd, shell, branch, repo', () => {
    const s = mk({
      name: 'work',
      cwd: '/home/user/proj',
      shell: '/bin/zsh',
      git: { branch: 'feat/x', repoName: 'acme' },
    });
    expect(matchesFilter(s, { ...EMPTY_FILTER, text: 'work' })).toBe(true);
    expect(matchesFilter(s, { ...EMPTY_FILTER, text: 'PROJ' })).toBe(true); // case-insensitive
    expect(matchesFilter(s, { ...EMPTY_FILTER, text: 'zsh' })).toBe(true);
    expect(matchesFilter(s, { ...EMPTY_FILTER, text: 'feat' })).toBe(true);
    expect(matchesFilter(s, { ...EMPTY_FILTER, text: 'acme' })).toBe(true);
    expect(matchesFilter(s, { ...EMPTY_FILTER, text: 'nope' })).toBe(false);
  });

  it('repo chip filters by repoName', () => {
    const a = mk({ id: 'a', git: { branch: 'main', repoName: 'r1' } });
    const b = mk({ id: 'b', git: { branch: 'main', repoName: 'r2' } });
    const out = filterSessions([a, b], { ...EMPTY_FILTER, repo: 'r1' });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('branch chip filters by branch', () => {
    const a = mk({ id: 'a', git: { branch: 'main' } });
    const b = mk({ id: 'b', git: { branch: 'dev' } });
    expect(
      filterSessions([a, b], { ...EMPTY_FILTER, branch: 'dev' }).map((s) => s.id),
    ).toEqual(['b']);
  });

  it('shell chip filters by shell basename', () => {
    const a = mk({ id: 'a', shell: '/bin/zsh' });
    const b = mk({ id: 'b', shell: '/bin/bash' });
    expect(
      filterSessions([a, b], { ...EMPTY_FILTER, shell: 'bash' }).map((s) => s.id),
    ).toEqual(['b']);
  });

  it('hasAgent chip filters to copilot + agent sessions', () => {
    const a = mk({ id: 'a', type: 'terminal' });
    const b = mk({ id: 'b', type: 'copilot' });
    const c = mk({ id: 'c', type: 'agent' });
    expect(
      filterSessions([a, b, c], { ...EMPTY_FILTER, hasAgent: true })
        .map((s) => s.id)
        .sort(),
    ).toEqual(['b', 'c']);
  });

  it('combines multiple filters (AND)', () => {
    const a = mk({ id: 'a', shell: '/bin/zsh', git: { branch: 'main' } });
    const b = mk({ id: 'b', shell: '/bin/bash', git: { branch: 'main' } });
    const c = mk({ id: 'c', shell: '/bin/zsh', git: { branch: 'dev' } });
    const out = filterSessions([a, b, c], {
      ...EMPTY_FILTER,
      shell: 'zsh',
      branch: 'main',
    });
    expect(out.map((s) => s.id)).toEqual(['a']);
  });

  it('passes through when all filters empty', () => {
    const s = mk({});
    expect(filterSessions([s], EMPTY_FILTER)).toHaveLength(1);
  });

  it('deriveFacets collects unique, sorted facets', () => {
    const sessions = [
      mk({ shell: '/bin/zsh', git: { branch: 'main', repoName: 'acme' }, type: 'copilot' }),
      mk({ shell: '/bin/bash', git: { branch: 'main', repoName: 'beta' } }),
      mk({ shell: '/bin/zsh', git: { branch: 'dev', repoName: 'acme' } }),
    ];
    const f = deriveFacets(sessions);
    expect(f.repos).toEqual(['acme', 'beta']);
    expect(f.branches).toEqual(['dev', 'main']);
    expect(f.shells).toEqual(['bash', 'zsh']);
    expect(f.hasAnyAgent).toBe(true);
  });

  it('deriveFacets hasAnyAgent false when none', () => {
    expect(deriveFacets([mk({ type: 'terminal' })]).hasAnyAgent).toBe(false);
  });
});
