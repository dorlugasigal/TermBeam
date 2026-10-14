import { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useAuth } from '@/hooks/useAuth';
import { useMinDuration } from '@/hooks/useMinDuration';
import LoginPage from '@/components/LoginPage/LoginPage';
import SessionsHub from '@/components/SessionsHub/SessionsHub';
import { TerminalApp } from '@/components/TerminalApp/TerminalApp';
import CodeViewer from '@/components/CodeViewer/CodeViewer';
import { Splash } from '@/components/common/Splash';
import splashStyles from '@/components/common/Splash.module.css';
import { ConnectionSheet } from '@/components/ConnectionStatus/ConnectionSheet';
import { UnlockSheet } from '@/components/ConnectionStatus/UnlockSheet';
import { PasskeyPrompt } from '@/components/ConnectionStatus/PasskeyPrompt';
import { installConnectionListeners } from '@/stores/connectionStore';
import { useThemeStore } from '@/stores/themeStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { THEMES } from '@/themes/terminalThemes';

const SPLASH_SEEN_KEY = 'termbeam-splash-seen';
const SPLASH_HOLD_MS = 950;

function getPath() {
  return window.location.pathname;
}

function getCodeSessionId(): string | null {
  const match = window.location.pathname.match(/^\/code\/([^/]+)$/);
  return match?.[1] || null;
}

/** Same-origin, path-absolute redirect targets only (mirrors the server's safeNextPath). */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next === '/login' || next.startsWith('/login?')) return '/';
  return next;
}

/** Normalize ?id= to ?session= so TerminalApp can read it */
function normalizeSessionParam() {
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');
  if (idParam && !params.get('session')) {
    params.set('session', idParam);
    params.delete('id');
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }
}

/**
 * Update the iOS browser-chrome color (status-bar + home-indicator zone) to
 * match the visible content of the current screen, so there's no visible
 * seam between our content and the OS chrome.
 *  - Terminal screen: surface (TouchBar bottom color)
 *  - Everything else: bg (page background)
 */
function useChromeColor(screen: 'terminal' | 'main') {
  const themeId = useThemeStore((s) => s.themeId);
  useEffect(() => {
    const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]!;
    const color = screen === 'terminal' ? theme.surface : theme.bg;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color);
    document.body.style.background = color;
  }, [screen, themeId]);
}

/**
 * The brand splash plays once per browser session (cold launch) when the
 * "Splash screen" preference is on — never on every reload, and readiness is
 * never delayed beyond the short hold.
 */
function useSplashHold(): boolean {
  const showSplash = usePreferencesStore((s) => s.prefs.showSplash);
  const [hold] = useState(() => {
    if (!showSplash) return false;
    try {
      return !sessionStorage.getItem(SPLASH_SEEN_KEY);
    } catch {
      return true;
    }
  });
  const elapsed = useMinDuration(hold ? SPLASH_HOLD_MS : 0);
  useEffect(() => {
    if (!elapsed || !hold) return;
    try {
      sessionStorage.setItem(SPLASH_SEEN_KEY, '1');
    } catch {
      // storage unavailable
    }
  }, [elapsed, hold]);
  return elapsed;
}

export default function App() {
  const { phase, status, justSignedIn, clearJustSignedIn, onSignedIn, retry } = useAuth();
  const [path, setPath] = useState(getPath);
  const splashElapsed = useSplashHold();

  useEffect(() => {
    installConnectionListeners();
  }, []);

  // Hydrate user preferences from the server once we're signed in. The store
  // seeds itself synchronously from localStorage on import so the first paint
  // already uses cached prefs; this fetch reconciles with the server.
  useEffect(() => {
    if (phase === 'app') void usePreferencesStore.getState().hydrate();
  }, [phase]);

  // Signed in on /login → continue to where the user was going (?next=).
  useEffect(() => {
    if (phase !== 'app' || window.location.pathname !== '/login') return;
    const next = safeNext(new URLSearchParams(window.location.search).get('next'));
    window.history.replaceState(null, '', next);
    setPath(getPath());
  }, [phase]);

  useEffect(() => {
    normalizeSessionParam();
  }, [path]);

  // Route changes morph between screens (View Transitions): the opened
  // session's name travels from its hub row into the terminal tab and back.
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    const onPopState = () => {
      const next = getPath();
      const update = () => setPath(next);
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => { finished: Promise<void> };
      };
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!doc.startViewTransition || reduced || next === pathRef.current) {
        update();
        return;
      }
      const root = document.documentElement;
      root.dataset.vt = next === '/terminal' ? 'forward' : 'back';
      const transition = doc.startViewTransition(() => flushSync(update));
      void transition.finished.finally(() => delete root.dataset.vt);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const codeSessionId = getCodeSessionId();
  const isTerminalScreen = phase === 'app' && path === '/terminal' && !codeSessionId;
  useChromeColor(isTerminalScreen ? 'terminal' : 'main');

  if (phase === 'checking' || (phase === 'app' && !splashElapsed)) {
    return <Splash status={phase === 'app' ? 'Link established' : 'Establishing link'} />;
  }

  if (phase === 'tunnel-auth') {
    return (
      <Splash
        size="md"
        status="Tunnel sign-in expired"
        detail="Dev Tunnels needs you to sign in again with the account that owns this tunnel."
        action={
          <button onClick={() => window.location.reload()} className={splashStyles.action}>
            Sign in again
          </button>
        }
      />
    );
  }

  if (phase === 'unreachable') {
    return (
      <Splash
        size="md"
        status="Can't reach your computer"
        detail="It may be asleep, offline, or its tunnel is restarting. Retrying automatically."
        action={
          <button onClick={retry} className={splashStyles.action}>
            Retry now
          </button>
        }
      />
    );
  }

  if (phase === 'login') {
    return <LoginPage status={status} onSignedIn={onSignedIn} />;
  }

  let screen;
  if (codeSessionId) screen = <CodeViewer sessionId={codeSessionId} />;
  else if (isTerminalScreen) screen = <TerminalApp />;
  else screen = <SessionsHub />;

  return (
    <>
      {screen}
      <ConnectionSheet />
      <UnlockSheet />
      <PasskeyPrompt method={justSignedIn} status={status} onDone={clearJustSignedIn} />
    </>
  );
}
