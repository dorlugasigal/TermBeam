import { useState, useEffect, useCallback } from 'react';
import { checkAuth, getConfig, login as apiLogin, logout as apiLogout } from '@/services/api';

interface UseAuthReturn {
  authenticated: boolean | null;
  passwordRequired: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  loading: boolean;
}

export function useAuth(): UseAuthReturn {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Check for one-time-token in URL first
      const params = new URLSearchParams(window.location.search);
      const ott = params.get('ott');

      if (ott) {
        params.delete('ott');
        const search = params.toString();
        const newUrl =
          window.location.pathname + (search ? `?${search}` : '') + window.location.hash;
        window.history.replaceState(null, '', newUrl);

        try {
          const res = await fetch('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: ott }),
          });
          if (!cancelled && res.ok) {
            const data = (await res.json()) as { ok: boolean };
            if (data.ok) {
              setAuthenticated(true);
              return;
            }
          }
        } catch {
          // Fall through to normal auth check
        }
      }

      // Primary check: can we reach the server and are we authenticated?
      const { authenticated: isAuth, serverReachable, tunnelAuthRequired } = await checkAuth();
      if (cancelled) return;

      if (isAuth) {
        sessionStorage.removeItem('termbeam-tunnel-reload');
        setAuthenticated(true);
        return;
      }

      // Not authenticated — but is a password even required?
      // If server is reachable and returned 401, password is required.
      // If server is unreachable (tunnel stale, network down), check /api/config.
      if (serverReachable) {
        // Server responded with 401 — password is required
        setPasswordRequired(true);
        setAuthenticated(false);
        return;
      }

      // A proxy/tunnel (e.g. DevTunnel) intercepted the request with an auth page.
      // Reload the page so the browser handles the auth redirect interactively
      // (fetch can't show interactive login pages — only navigation can).
      // Guard with sessionStorage to prevent infinite reload loops (30s cooldown).
      if (tunnelAuthRequired) {
        const RELOAD_KEY = 'termbeam-tunnel-reload';
        const lastReload = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10);
        if (Date.now() - lastReload > 30_000) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          window.location.reload();
          return;
        }
        // Already reloaded recently — fall through to show login as fallback
        sessionStorage.removeItem(RELOAD_KEY);
      }

      // Server unreachable — check if password is configured.
      // /api/config has no auth middleware, so it works even without a token.
      const config = await getConfig();
      if (cancelled) return;
      setPasswordRequired(config.passwordRequired);

      if (!config.passwordRequired) {
        // No password mode + server unreachable (tunnel flaky) — grant access.
        // The terminal/sessions hub will show its own connection banner.
        setAuthenticated(true);
      } else {
        setAuthenticated(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-check auth when returning from background (e.g. mobile tab switch after hours idle).
  useEffect(() => {
    function handleVisibility() {
      if (document.hidden) return;

      if (!passwordRequired) {
        // No-password mode: never flip to unauthenticated — the terminal handles
        // connection issues with its own reconnect banner.
        return;
      }

      // Password mode: if we were authenticated and now we're not, show login
      if (authenticated !== true) return;
      checkAuth()
        .then(({ authenticated: isAuth, serverReachable }) => {
          // Only treat as auth loss if the server explicitly returned 401.
          // Network timeouts (serverReachable=false) should not flip auth state.
          if (!isAuth && serverReachable) setAuthenticated(false);
        })
        .catch(() => {
          // Network error — don't change auth state
        });
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [authenticated, passwordRequired]);

  const login = useCallback(async (password: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { ok } = await apiLogin(password);
      setAuthenticated(ok);
      return ok;
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setAuthenticated(false);
  }, []);

  return { authenticated, passwordRequired, login, logout, loading };
}
