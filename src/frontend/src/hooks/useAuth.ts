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
      // Determine if password is required (uses localStorage cache when server unreachable)
      const config = await getConfig();
      if (cancelled) return;
      setPasswordRequired(config.passwordRequired);

      // No-password mode: skip auth checks entirely — always grant access
      if (!config.passwordRequired) {
        setAuthenticated(true);
        return;
      }

      // Check for one-time-token in URL
      const params = new URLSearchParams(window.location.search);
      const ott = params.get('ott');

      if (ott) {
        // Remove ott from URL without reload
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

      try {
        const { authenticated: isAuth, serverReachable } = await checkAuth();
        if (!cancelled) {
          if (!isAuth && !serverReachable) {
            setAuthenticated(false);
            return;
          }
          setAuthenticated(isAuth);
        }
      } catch {
        if (!cancelled) setAuthenticated(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-check auth when returning from background (e.g. mobile tab switch after hours idle).
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function handleVisibility() {
      if (document.hidden) return;

      if (!passwordRequired) {
        // No-password mode: server is always "authenticated", but verify reachability.
        // If unreachable, keep authenticated=true — the terminal/sessions hub will
        // show its own connection banner. Once reachable again, everything auto-recovers.
        checkAuth().then(({ serverReachable }) => {
          if (!serverReachable && retryTimer === null) {
            // Schedule a silent retry in case tunnel just needs a moment
            retryTimer = setTimeout(() => {
              retryTimer = null;
              checkAuth(); // fire-and-forget; UI stays on terminal
            }, 5000);
          }
        });
        return;
      }

      // Password mode: if we were authenticated and now we're not, show login
      if (authenticated !== true) return;
      checkAuth().then(({ authenticated: isAuth }) => {
        if (!isAuth) setAuthenticated(false);
      });
    }

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
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
