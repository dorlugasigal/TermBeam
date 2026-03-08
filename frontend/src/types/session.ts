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
  '#6ec1e4',
  '#e4a06e',
  '#a0e46e',
  '#e46e9f',
  '#9f6ee4',
  '#e4d36e',
  '#6ee4b0',
  '#e46e6e',
] as const;

export type SessionColor = (typeof SESSION_COLORS)[number];
