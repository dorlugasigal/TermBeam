import type { GitStatus, Session } from '@/types';

/**
 * Presentation helpers for session metadata. Machine text (paths, branch
 * names, git state) is always shown in full — it wraps at separators instead
 * of being truncated, because users scan it to tell sessions apart.
 */

/**
 * `/Users/me/src/app` → `~/src/app`, but only for the server user's own home
 * (`home`, from the API). Other users' homes and look-alikes such as
 * `/Users/Shared` stay in full; without a known home nothing is shortened.
 */
export function tildePath(p: string | null | undefined, home?: string | null): string {
  if (!p) return '';
  const h = (home || '').replace(/[/\\]+$/, '');
  if (!h || !p.startsWith(h)) return p;
  if (p.length === h.length) return '~';
  const next = p.charAt(h.length);
  return next === '/' || next === '\\' ? `~${p.slice(h.length)}` : p;
}

/** Split after every `/` or `\` so callers can put a soft break (<wbr>) there. */
export function breakSegments(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of text) {
    current += ch;
    if (ch === '/' || ch === '\\') {
      parts.push(current);
      current = '';
    }
  }
  if (current) parts.push(current);
  return parts;
}

export interface Ago {
  /** Compact label for list rows: `now`, `42s`, `5m`, `3h`, `2d`, `Mar 4`. */
  short: string;
  /** Spoken / tooltip form. */
  long: string;
  /** Activity within the last 10 seconds. */
  recent: boolean;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

export function activityAgo(value: string | number | null | undefined, now = Date.now()): Ago {
  const ts = typeof value === 'number' ? value : value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(ts)) return { short: '', long: 'No recent activity', recent: false };
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 10) return { short: 'now', long: 'Active now', recent: true };
  if (s < 60) return { short: `${s}s`, long: `Active ${plural(s, 'second')} ago`, recent: false };
  const m = Math.floor(s / 60);
  if (m < 60) return { short: `${m}m`, long: `Active ${plural(m, 'minute')} ago`, recent: false };
  const h = Math.floor(m / 60);
  if (h < 24) return { short: `${h}h`, long: `Active ${plural(h, 'hour')} ago`, recent: false };
  const d = Math.floor(h / 24);
  if (d < 7) return { short: `${d}d`, long: `Active ${plural(d, 'day')} ago`, recent: false };
  const date = new Date(ts);
  const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { short: label, long: `Last active ${date.toLocaleString()}`, recent: false };
}

export type GitPartTone = 'staged' | 'modified' | 'untracked' | 'sync' | 'clean';

export interface GitPart {
  tone: GitPartTone;
  count: number | null;
  label: string;
}

/** Working-tree state as labelled parts, e.g. [3 staged] [12 modified] [↑2]. */
export function gitStatusParts(status: GitStatus | null | undefined): GitPart[] {
  if (!status) return [];
  const parts: GitPart[] = [];
  if (status.staged) parts.push({ tone: 'staged', count: status.staged, label: 'staged' });
  if (status.modified) parts.push({ tone: 'modified', count: status.modified, label: 'modified' });
  if (status.untracked) {
    parts.push({ tone: 'untracked', count: status.untracked, label: 'untracked' });
  }
  if (status.ahead) parts.push({ tone: 'sync', count: null, label: `↑${status.ahead}` });
  if (status.behind) parts.push({ tone: 'sync', count: null, label: `↓${status.behind}` });
  if (parts.length === 0) parts.push({ tone: 'clean', count: null, label: 'Clean' });
  return parts;
}

export interface SessionGroup {
  /** Stable key: repository root, else repo+branch, else `none`. */
  key: string;
  git: Session['git'] | null;
  sessions: Session[];
}

function groupKey(s: Session): string {
  const git = s.git;
  if (!git) return 'none';
  if (git.root) return `root:${git.root}`;
  return `repo:${git.repoName ?? ''}#${git.branch ?? ''}`;
}

/**
 * Sessions sharing a working tree share its branch and status, so they're
 * shown once per group instead of repeated on every row. Groups keep server
 * (creation) order so nothing reshuffles while polling; sessions outside any
 * repository come last.
 */
export function groupSessions(sessions: Session[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const s of sessions) {
    const key = groupKey(s);
    let group = groups.get(key);
    if (!group) {
      group = { key, git: s.git ?? null, sessions: [] };
      groups.set(key, group);
    }
    group.sessions.push(s);
  }
  const list = [...groups.values()];
  return [...list.filter((g) => g.key !== 'none'), ...list.filter((g) => g.key === 'none')];
}

/** `owner/repo` → `{ owner: 'owner/', name: 'repo' }` so the name can carry the weight. */
export function splitRepoName(repoName: string | null | undefined): {
  owner: string;
  name: string;
} {
  if (!repoName) return { owner: '', name: '' };
  const idx = repoName.lastIndexOf('/');
  if (idx === -1) return { owner: '', name: repoName };
  return { owner: repoName.slice(0, idx + 1), name: repoName.slice(idx + 1) };
}
