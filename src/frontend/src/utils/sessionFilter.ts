import type { Session } from '@/types';

export interface SessionFilterState {
  text: string;
  repo: string | null;
  branch: string | null;
  shell: string | null;
  hasAgent: boolean;
}

export const EMPTY_FILTER: SessionFilterState = {
  text: '',
  repo: null,
  branch: null,
  shell: null,
  hasAgent: false,
};

export function shellLabel(s: Session): string {
  if (!s.shell) return '';
  const raw = s.shell.split(/[\\/]/).pop() ?? s.shell;
  return raw.replace(/\.exe$/i, '');
}

function isAgent(s: Session): boolean {
  return s.type === 'copilot' || s.type === 'agent';
}

/** Returns true if session matches all active filters. */
export function matchesFilter(session: Session, filter: SessionFilterState): boolean {
  if (filter.hasAgent && !isAgent(session)) return false;

  if (filter.repo && session.git?.repoName !== filter.repo) return false;
  if (filter.branch && session.git?.branch !== filter.branch) return false;
  if (filter.shell && shellLabel(session) !== filter.shell) return false;

  const text = filter.text.trim().toLowerCase();
  if (text) {
    const haystack = [
      session.name,
      session.cwd,
      shellLabel(session),
      session.git?.branch ?? '',
      session.git?.repoName ?? '',
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(text)) return false;
  }

  return true;
}

export function filterSessions(
  sessions: Session[],
  filter: SessionFilterState,
): Session[] {
  if (isEmptyFilter(filter)) return sessions;
  return sessions.filter((s) => matchesFilter(s, filter));
}

export function isEmptyFilter(filter: SessionFilterState): boolean {
  return (
    !filter.text.trim() &&
    !filter.repo &&
    !filter.branch &&
    !filter.shell &&
    !filter.hasAgent
  );
}

export interface FilterFacets {
  repos: string[];
  branches: string[];
  shells: string[];
  hasAnyAgent: boolean;
}

/** Derive available filter values from the current session list. */
export function deriveFacets(sessions: Session[]): FilterFacets {
  const repos = new Set<string>();
  const branches = new Set<string>();
  const shells = new Set<string>();
  let hasAnyAgent = false;
  for (const s of sessions) {
    if (s.git?.repoName) repos.add(s.git.repoName);
    if (s.git?.branch) branches.add(s.git.branch);
    const sh = shellLabel(s);
    if (sh) shells.add(sh);
    if (isAgent(s)) hasAnyAgent = true;
  }
  return {
    repos: [...repos].sort(),
    branches: [...branches].sort(),
    shells: [...shells].sort(),
    hasAnyAgent,
  };
}
