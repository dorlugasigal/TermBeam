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
  const res = await fetch(`${BASE}/api/sessions`, { credentials: 'same-origin' });
  return handleResponse<Session[]>(res);
}

export async function createSession(
  req: CreateSessionRequest & { cols?: number; rows?: number },
): Promise<{ id: string; url: string }> {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    credentials: 'same-origin',
  });
  return handleResponse<{ id: string; url: string }>(res);
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/sessions/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
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
  const res = await fetch(`${BASE}/api/shells`, { credentials: 'same-origin' });
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
  const res = await fetch(`${BASE}/api/dirs?q=${encodeURIComponent(q)}`, {
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

export async function checkAuth(): Promise<{ authenticated: boolean }> {
  try {
    const res = await fetch(`${BASE}/api/sessions`, { credentials: 'same-origin' });
    if (res.status === 401) return { authenticated: false };
    if (res.status === 429) return { authenticated: false };
    return { authenticated: true };
  } catch {
    return { authenticated: false };
  }
}

export async function login(password: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/api/auth`, {
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
} | null> {
  try {
    const res = await fetch(`${BASE}/api/update-check${force ? '?force=true' : ''}`, {
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
  return fetch(`${BASE}/api/share-token`, { credentials: 'same-origin' })
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
