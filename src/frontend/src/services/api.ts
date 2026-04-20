import type { Session, CreateSessionRequest } from '@/types';
import type { FileTreeNode } from '@/stores/codeViewerStore';

const BASE = '';
const DEFAULT_TIMEOUT = 10_000;

/** Fetch with an AbortController timeout to avoid hanging on stale tunnels. */
function fetchWithTimeout(
  url: string,
  options?: RequestInit & { timeout?: number },
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetchWithTimeout(`${BASE}/api/sessions`, { credentials: 'same-origin' });
  return handleResponse<Session[]>(res);
}

export async function createSession(
  req: CreateSessionRequest & { cols?: number; rows?: number },
): Promise<{ id: string; url: string; ptySessionId?: string | null }> {
  const res = await fetchWithTimeout(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    credentials: 'same-origin',
  });
  return handleResponse<{ id: string; url: string; ptySessionId?: string | null }>(res);
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}/api/sessions/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
}

export async function renameSession(id: string, name: string): Promise<void> {
  const res = await fetchWithTimeout(`${BASE}/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
}

export interface ShellInfo {
  name: string;
  path: string;
  cmd: string;
}

interface ShellsResponse {
  shells: ShellInfo[];
  default: string;
  cwd: string;
}

export async function fetchShells(): Promise<{
  shells: ShellInfo[];
  defaultShell: string;
  cwd: string;
}> {
  const res = await fetchWithTimeout(`${BASE}/api/shells`, { credentials: 'same-origin' });
  const data = await handleResponse<ShellsResponse>(res);
  return { shells: data.shells, defaultShell: data.default, cwd: data.cwd };
}

export interface AgentInfo {
  id: string;
  name: string;
  cmd: string;
  args?: string[];
  icon: string;
  version?: string;
}

export async function fetchAgents(): Promise<{ agents: AgentInfo[] }> {
  const res = await fetchWithTimeout(`${BASE}/api/agents`, { credentials: 'same-origin' });
  return handleResponse<{ agents: AgentInfo[] }>(res);
}

export interface AgentSession {
  id: string;
  agent: 'copilot' | 'claude' | 'opencode';
  agentName: string;
  agentIcon: string;
  summary: string | null;
  cwd: string | null;
  repo: string | null;
  branch: string | null;
  updatedAt: string;
  turnCount: number;
}

export async function fetchAgentSessions(
  limit = 100,
  search?: string,
  agent?: string,
): Promise<{ sessions: AgentSession[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search) params.set('search', search);
  if (agent) params.set('agent', agent);
  const res = await fetchWithTimeout(`${BASE}/api/agent-sessions?${params}`, {
    credentials: 'same-origin',
  });
  return handleResponse<{ sessions: AgentSession[] }>(res);
}

export async function getResumeCommand(agent: string, id: string): Promise<{ command: string }> {
  const res = await fetchWithTimeout(`${BASE}/api/agent-sessions/${agent}/${id}/resume-command`, {
    credentials: 'same-origin',
  });
  return handleResponse<{ command: string }>(res);
}

export async function resumeCopilotSdkSession(
  sdkSessionId: string,
  options?: { name?: string; model?: string; cwd?: string },
): Promise<{ id: string; type: string; ptySessionId?: string | null }> {
  const res = await fetchWithTimeout(`${BASE}/api/copilot/sdk/sessions/${sdkSessionId}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options || {}),
    credentials: 'same-origin',
  });
  return handleResponse<{ id: string; type: string; ptySessionId?: string | null }>(res);
}

export interface BrowseDirsResponse {
  base: string;
  dirs: string[];
  truncated?: boolean;
  exists?: boolean;
}

export async function browseDirectory(
  dir: string,
  options?: { prefixFilter?: boolean },
): Promise<BrowseDirsResponse> {
  // Default behavior: treat `dir` as a directory to list (trailing slash appended).
  // With prefixFilter=true, pass through as-is so the backend treats the last
  // path segment as a name prefix to filter by.
  const q = options?.prefixFilter
    ? dir
    : dir.endsWith('/') || dir.endsWith('\\')
      ? dir
      : dir + '/';
  const res = await fetchWithTimeout(`${BASE}/api/dirs?q=${encodeURIComponent(q)}`, {
    credentials: 'same-origin',
  });
  return handleResponse<BrowseDirsResponse>(res);
}

/** Upload with XHR for progress tracking */
function xhrUpload(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<{ path: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v);
    }
    xhr.withCredentials = true;
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid response'));
        }
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(body);
  });
}

export function uploadFile(
  sessionId: string,
  file: File,
  targetDir?: string,
  onProgress?: (pct: number) => void,
): Promise<{ path: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Filename': file.name,
  };
  if (targetDir) headers['X-Target-Dir'] = targetDir;
  return xhrUpload(`${BASE}/api/sessions/${sessionId}/upload`, file, headers, onProgress);
}

export function uploadImage(
  blob: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
): Promise<{ path: string }> {
  return xhrUpload(`${BASE}/api/upload`, blob, { 'Content-Type': contentType }, onProgress);
}

export async function checkAuth(): Promise<{
  authenticated: boolean;
  serverReachable: boolean;
  tunnelAuthRequired: boolean;
}> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/sessions`, { credentials: 'same-origin' });
    if (res.status === 401)
      return { authenticated: false, serverReachable: true, tunnelAuthRequired: false };
    if (res.status === 429)
      return { authenticated: false, serverReachable: true, tunnelAuthRequired: false };
    // Validate response is JSON — DevTunnel auth expiry can return 200 with HTML
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      // Got a response, but it's not JSON — a proxy/tunnel (e.g. DevTunnel) is
      // intercepting requests with its own auth page. A page reload (full browser
      // navigation) is needed so the browser can handle the auth redirect interactively.
      return { authenticated: false, serverReachable: false, tunnelAuthRequired: true };
    }
    return { authenticated: true, serverReachable: true, tunnelAuthRequired: false };
  } catch {
    // Network error — server truly unreachable (offline, DNS failure, etc.)
    return { authenticated: false, serverReachable: false, tunnelAuthRequired: false };
  }
}

export async function getConfig(): Promise<{ passwordRequired: boolean }> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/config`, { credentials: 'same-origin' });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      // Non-JSON response (DevTunnel auth page, etc.) — assume password required (safe default)
      return { passwordRequired: true };
    }
    return (await res.json()) as { passwordRequired: boolean };
  } catch {
    return { passwordRequired: true };
  }
}

export async function login(password: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'same-origin',
  });
  if (res.status === 429) {
    throw new Error('Too many attempts. Try again later.');
  }
  return handleResponse<{ ok: boolean }>(res);
}

export async function logout(): Promise<void> {
  // Auth cookie is httpOnly — we can't clear it client-side.
  // Redirect to login page; server will reject subsequent requests without a valid token.
}

export async function checkUpdate(force = false): Promise<{
  updateAvailable: boolean;
  current: string;
  latest: string;
  method?: string;
  command?: string;
  canAutoUpdate?: boolean;
  restartStrategy?: 'pm2' | 'exit' | 'none';
} | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/update-check${force ? '?force=true' : ''}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchChangelog(): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/changelog`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

export interface UpdateState {
  status:
    | 'idle'
    | 'checking-permissions'
    | 'installing'
    | 'verifying'
    | 'restarting'
    | 'complete'
    | 'failed';
  phase: string | null;
  progress: string | null;
  error: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  startedAt: number | null;
  restartStrategy: string | null;
}

export async function triggerUpdate(): Promise<{
  status?: string;
  method?: string;
  error?: string;
  command?: string;
  canAutoUpdate?: boolean;
}> {
  const res = await fetchWithTimeout(`${BASE}/api/update`, {
    method: 'POST',
    credentials: 'same-origin',
    timeout: 30_000,
  });
  const data = await res.json();
  if (!res.ok) {
    return { error: data.error || `HTTP ${res.status}`, ...data };
  }
  return data;
}

export async function getUpdateStatus(): Promise<UpdateState | null> {
  try {
    const res = await fetchWithTimeout(`${BASE}/api/update/status`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchVersion(): Promise<string> {
  try {
    const data = await checkUpdate();
    if (data?.current) return data.current;
  } catch {
    // ignore
  }
  return '';
}

export function getWebSocketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function getShareUrl(): Promise<string> {
  return fetchWithTimeout(`${BASE}/api/share-token`, { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data?.url) return window.location.href;
      // Replace the server-returned origin with the browser's origin so the
      // link works when accessed via a tunnel (server may return localhost).
      try {
        const parsed = new URL(data.url);
        return `${window.location.origin}${parsed.pathname}${parsed.search}`;
      } catch {
        return data.url;
      }
    })
    .catch(() => window.location.href);
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string | null;
}

export interface BrowseFilesResponse {
  base: string;
  rootDir: string;
  entries: FileEntry[];
}

export async function browseFiles(sessionId: string, dir?: string): Promise<BrowseFilesResponse> {
  const params = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  const res = await fetchWithTimeout(`${BASE}/api/sessions/${sessionId}/files${params}`, {
    credentials: 'same-origin',
  });
  return handleResponse<BrowseFilesResponse>(res);
}

export async function fetchFileContent(
  sessionId: string,
  filePath: string,
): Promise<{ content: string; name: string; size: number }> {
  const res = await fetchWithTimeout(
    `${BASE}/api/sessions/${sessionId}/file-content?file=${encodeURIComponent(filePath)}`,
    { credentials: 'same-origin' },
  );
  return handleResponse<{ content: string; name: string; size: number }>(res);
}

export async function fetchFileTree(
  sessionId: string,
  depth = 3,
  path?: string,
): Promise<{ root: string; tree: FileTreeNode[] }> {
  const params = new URLSearchParams({ depth: String(depth) });
  if (path) params.set('path', path);
  const res = await fetchWithTimeout(
    `${BASE}/api/sessions/${sessionId}/file-tree?${params.toString()}`,
    {
      credentials: 'same-origin',
    },
  );
  return handleResponse<{ root: string; tree: FileTreeNode[] }>(res);
}

export function downloadFile(sessionId: string, filePath: string): void {
  const url = `${BASE}/api/sessions/${sessionId}/download?file=${encodeURIComponent(filePath)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function downloadFileWithProgress(
  sessionId: string,
  filePath: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const url = `${BASE}/api/sessions/${sessionId}/download?file=${encodeURIComponent(filePath)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'blob';
    xhr.withCredentials = true;

    xhr.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = xhr.response as Blob;
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        const disposition = xhr.getResponseHeader('Content-Disposition');
        const match = disposition?.match(/filename="(.+?)"/);
        a.download = match?.[1] ?? filePath.split('/').pop() ?? 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        resolve();
      } else {
        reject(new Error(`Download failed: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send();
  });
}

/* ---------- push notification API ---------- */

export async function fetchVapidKey(): Promise<{ publicKey: string }> {
  const res = await fetchWithTimeout(`${BASE}/api/push/vapid-key`, {
    credentials: 'same-origin',
  });
  return handleResponse<{ publicKey: string }>(res);
}

export async function subscribePush(subscription: PushSubscriptionJSON): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription }),
    credentials: 'same-origin',
  });
  return handleResponse<{ ok: boolean }>(res);
}

export async function unsubscribePush(endpoint: string): Promise<{ ok: boolean }> {
  const res = await fetchWithTimeout(`${BASE}/api/push/unsubscribe`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
    credentials: 'same-origin',
  });
  return handleResponse<{ ok: boolean }>(res);
}

/** Ask the service worker to purge non-precache caches (e.g. stale navigation HTML). */
export function clearServiceWorkerCaches(): void {
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' });
  }
}

// ── Git API types ──

export interface GitFileChange {
  path: string;
  status: string;
  oldPath: string | null;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  modified: GitFileChange[];
  untracked: string[];
  isGitRepo: boolean;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface GitDiff {
  file: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
}

export interface BlameLine {
  line: number;
  content: string;
  commit: string | null;
  author: string;
  date: string | null;
  summary: string;
}

export interface GitBlame {
  file: string;
  lines: BlameLine[];
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  subject: string;
  body: string;
}

export interface GitLog {
  commits: GitCommit[];
}

// ── Git API functions ──

export async function fetchGitStatus(sessionId: string): Promise<GitStatus> {
  const res = await fetchWithTimeout(`${BASE}/api/sessions/${sessionId}/git/status`, {
    credentials: 'same-origin',
  });
  return handleResponse<GitStatus>(res);
}

export async function fetchGitDiff(
  sessionId: string,
  file: string,
  staged = false,
  untracked = false,
  context?: number,
): Promise<GitDiff> {
  const params = new URLSearchParams({ file });
  if (staged) params.set('staged', 'true');
  if (untracked) params.set('untracked', 'true');
  if (context !== undefined) params.set('context', String(context));
  const res = await fetchWithTimeout(`${BASE}/api/sessions/${sessionId}/git/diff?${params}`, {
    credentials: 'same-origin',
  });
  return handleResponse<GitDiff>(res);
}

export async function fetchGitBlame(sessionId: string, file: string): Promise<GitBlame> {
  const res = await fetchWithTimeout(
    `${BASE}/api/sessions/${sessionId}/git/blame?file=${encodeURIComponent(file)}`,
    { credentials: 'same-origin' },
  );
  return handleResponse<GitBlame>(res);
}

export async function fetchGitLog(sessionId: string, limit = 20, file?: string): Promise<GitLog> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (file) params.set('file', file);
  const res = await fetchWithTimeout(`${BASE}/api/sessions/${sessionId}/git/log?${params}`, {
    credentials: 'same-origin',
  });
  return handleResponse<GitLog>(res);
}

// ── Tunnel API ──

export interface TunnelStatus {
  state: string;
  provider?: string | null;
  tokenLifetimeSeconds?: number | null;
  expiresIn?: number;
}

export async function fetchTunnelStatus(): Promise<TunnelStatus> {
  const res = await fetchWithTimeout(`${BASE}/api/tunnel/status`, {
    credentials: 'same-origin',
  });
  return handleResponse<TunnelStatus>(res);
}

// Tunnel renew endpoint removed — DevTunnel handles its own OAuth lifecycle.
