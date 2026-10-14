import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchAuthStatus,
  probeServer,
  loginWithOneTimeToken,
  type AuthStatus,
} from '@/services/api';

/**
 * App-level auth gate. Only decides what to show on (re)load:
 *   checking → splash · login → LoginPage · app → the app
 *   tunnel-auth → Dev Tunnel sign-in expired · unreachable → can't reach host
 *
 * Losing auth *while the app is mounted* is NOT handled here — the
 * connection store opens the in-place unlock sheet so open terminals,
 * tabs and drafts survive.
 */
export type AuthPhase = 'checking' | 'login' | 'app' | 'tunnel-auth' | 'unreachable';

const TUNNEL_RELOAD_KEY = 'termbeam-tunnel-reload';
const TUNNEL_RELOAD_COOLDOWN_MS = 60_000;
const FRESH_SIGN_IN_MS = 2 * 60_000;
const UNREACHABLE_RETRY_MS = 5_000;

export interface UseAuthReturn {
  phase: AuthPhase;
  status: AuthStatus | null;
  /** Method of a sign-in that just happened (drives the passkey offer). */
  justSignedIn: string | null;
  clearJustSignedIn: () => void;
  onSignedIn: (method: string) => void;
  retry: () => void;
}

export function useAuth(): UseAuthReturn {
  const [phase, setPhase] = useState<AuthPhase>('checking');
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [justSignedIn, setJustSignedIn] = useState<string | null>(null);
  const checkingRef = useRef(false);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      // A one-time token normally gets consumed by the server on navigation;
      // this path only runs when the page shell came from somewhere else.
      const params = new URLSearchParams(window.location.search);
      const ott = params.get('ott');
      if (ott) {
        params.delete('ott');
        const search = params.toString();
        window.history.replaceState(
          null,
          '',
          window.location.pathname + (search ? `?${search}` : '') + window.location.hash,
        );
        try {
          await loginWithOneTimeToken(ott);
          setJustSignedIn('qr');
        } catch {
          // expired/used link — fall through to the normal check
        }
      }

      const st = await fetchAuthStatus();
      if (st) {
        setStatus(st);
        sessionStorage.removeItem(TUNNEL_RELOAD_KEY);
        if (st.authenticated) {
          const session = st.session;
          if (
            session &&
            session.method !== 'passkey' &&
            Date.now() - session.createdAt < FRESH_SIGN_IN_MS
          ) {
            setJustSignedIn((m) => m ?? session.method);
          }
          setPhase('app');
        } else {
          setPhase('login');
        }
        return;
      }

      const probe = await probeServer();
      if (probe === 'tunnel-auth') {
        // Only a top-level navigation lets Dev Tunnels run its sign-in flow.
        // Do it automatically once; after that, ask (avoids reload loops).
        const last = Number(sessionStorage.getItem(TUNNEL_RELOAD_KEY) || 0);
        if (Date.now() - last > TUNNEL_RELOAD_COOLDOWN_MS) {
          sessionStorage.setItem(TUNNEL_RELOAD_KEY, String(Date.now()));
          window.location.reload();
          return;
        }
        setPhase('tunnel-auth');
        return;
      }
      if (probe === 'auth-expired') setPhase('login');
      else if (probe === 'ok') setPhase('app');
      else setPhase('unreachable');
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // While the host is unreachable keep trying, and jump on network/foreground changes.
  useEffect(() => {
    if (phase !== 'unreachable') return;
    const id = setInterval(() => void check(), UNREACHABLE_RETRY_MS);
    const kick = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', kick);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', kick);
    };
  }, [phase, check]);

  const onSignedIn = useCallback((method: string) => {
    if (method !== 'passkey') setJustSignedIn(method);
    setPhase('app');
    void fetchAuthStatus().then((st) => st && setStatus(st));
  }, []);

  const clearJustSignedIn = useCallback(() => setJustSignedIn(null), []);
  const retry = useCallback(() => void check(), [check]);

  return { phase, status, justSignedIn, clearJustSignedIn, onSignedIn, retry };
}
