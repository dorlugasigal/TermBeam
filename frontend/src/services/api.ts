import type { Session, CreateSessionRequest } from '@/types';

const BASE = '';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchSessions(): Promise<Session[]> {
  const res = await fetch(`${BASE}/api/sessions`);
  return handleResponse<Session[]>(res);
}

export async function createSession(
  req: CreateSessionRequest & { cols?: number; rows?: number },
): Promise<Session> {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return handleResponse<Session>(res);
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/sessions/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
}

export async function renameSession(id: string, name: string): Promise<void> {
  const res = await fetch(`${BASE}/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
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

export async function fetchShells(): Promise<{ shells: ShellInfo[]; defaultShell: string; cwd: string }> {
  const res = await fetch(`${BASE}/api/shells`);
  const data = await handleResponse<ShellsResponse>(res);
  return { shells: data.shells, defaultShell: data.default, cwd: data.cwd };
}

export interface BrowseDirsResponse {
  base: string;
  dirs: string[];
}

export async function browseDirectory(dir: string): Promise<BrowseDirsResponse> {
  // Trailing slash tells backend to list contents (not prefix-filter)
  const q = dir.endsWith('/') || dir.endsWith('\\') ? dir : dir + '/';
  const res = await fetch(`${BASE}/api/dirs?q=${encodeURIComponent(q)}`);
  return handleResponse<BrowseDirsResponse>(res);
}

export async function uploadFile(
  sessionId: string,
  file: File,
  targetDir?: string,
): Promise<{ path: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'X-Filename': file.name,
  };
  if (targetDir) headers['X-Target-Dir'] = targetDir;

  const res = await fetch(`${BASE}/api/sessions/${sessionId}/upload`, {
    method: 'POST',
    headers,
    body: file,
  });
  return handleResponse<{ path: string }>(res);
}

export async function uploadImage(
  blob: Blob,
  contentType: string,
): Promise<{ path: string }> {
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: blob,
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json() as Promise<{ path: string }>;
}

export async function checkAuth(): Promise<{ authenticated: boolean }> {
  try {
    const res = await fetch(`${BASE}/api/sessions`);
    if (res.status === 401) return { authenticated: false };
    // 429 (rate limited) or 200 OK means the server is running and we're not blocked by auth
    return { authenticated: true };
  } catch {
    return { authenticated: false };
  }
}

export async function login(password: string): Promise<{ success: boolean }> {
  const res = await fetch(`${BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.status === 429) {
    throw new Error('Too many attempts. Try again later.');
  }
  return handleResponse<{ success: boolean }>(res);
}

export async function logout(): Promise<void> {
  // Clear auth cookie by navigating to login — server has no logout endpoint
  document.cookie = 'pty_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
}

export async function checkUpdate(force = false): Promise<{
  hasUpdate: boolean;
  current: string;
  latest: string;
} | null> {
  try {
    const res = await fetch(`${BASE}/api/update-check${force ? '?force=true' : ''}`);
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
  return fetch(`${BASE}/api/share-token`)
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
