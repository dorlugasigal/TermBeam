import { useState, useEffect, useCallback } from 'react';
import { checkAuth, login as apiLogin, logout as apiLogout } from '@/services/api';

interface UseAuthReturn {
  authenticated: boolean | null;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  loading: boolean;
}

export function useAuth(): UseAuthReturn {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Check for one-time-token in URL
      const params = new URLSearchParams(window.location.search);
      const ott = params.get('ott');

      if (ott) {
        // Remove ott from URL without reload
        params.delete('ott');
        const search = params.toString();
        const newUrl = window.location.pathname + (search ? `?${search}` : '') + window.location.hash;
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
        const { authenticated: isAuth } = await checkAuth();
        if (!cancelled) setAuthenticated(isAuth);
      } catch {
        if (!cancelled) setAuthenticated(false);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (password: string): Promise<boolean> => {
    setLoading(true);
    try {
      const { ok } = await apiLogin(password);
      setAuthenticated(ok);
      return ok;
    } catch (err) {
      // Re-throw so caller can distinguish 429 from other errors
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setAuthenticated(false);
  }, []);

  return { authenticated, login, logout, loading };
}
