export interface GitStatus {
  clean: boolean;
  modified: number;
  staged: number;
  untracked: number;
  ahead: number;
  behind: number;
  summary: string;
}

export interface Session {
  id: string;
  name: string;
  shell: string;
  pid: number;
  cwd: string;
  createdAt: string;
  lastActivity: string | number;
  color?: string;
  cols?: number;
  rows?: number;
  clients?: number;
  git?: {
    branch: string;
    provider?: string;
    repoName?: string;
    status?: GitStatus;
  };
}

export interface CreateSessionRequest {
  name?: string;
  shell?: string;
  cwd?: string;
  color?: string;
  initialCommand?: string;
  cols?: number;
  rows?: number;
}

export interface ManagedSession {
  id: string;
  name: string;
  shell: string;
  pid: number;
  cwd: string;
  color: string;
  createdAt: string;
  lastActivity: string;
}

export const SESSION_COLORS = [
  '#4a9eff',
  '#4ade80',
  '#fbbf24',
  '#c084fc',
  '#f87171',
  '#22d3ee',
  '#fb923c',
  '#f472b6',
] as const;

export type SessionColor = (typeof SESSION_COLORS)[number];
