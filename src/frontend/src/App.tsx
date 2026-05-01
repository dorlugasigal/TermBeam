import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useMinDuration } from '@/hooks/useMinDuration';
import LoginPage from '@/components/LoginPage/LoginPage';
import SessionsHub from '@/components/SessionsHub/SessionsHub';
import { TerminalApp } from '@/components/TerminalApp/TerminalApp';
import CodeViewer from '@/components/CodeViewer/CodeViewer';
import { Splash } from '@/components/common/Splash';
import splashStyles from '@/components/common/Splash.module.css';
import { useThemeStore } from '@/stores/themeStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { THEMES } from '@/themes/terminalThemes';

function getPath() {
  return window.location.pathname;
}

function getCodeSessionId(): string | null {
  const match = window.location.pathname.match(/^\/code\/([^/]+)$/);
  return match?.[1] || null;
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
 *  - Sessions hub / Code viewer: bg (page background)
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

export default function App() {
  const { authenticated, passwordRequired, login, loading } = useAuth();
  const [path, setPath] = useState(getPath);

  /*
   * Hold the splash screen for at least 1500ms on cold load so the
   * per-letter Keynote-bloom animation (last letter starts at 0.55s,
   * 0.85s duration = 1.40s end) plays through with a 100ms beat to read
   * the settled wordmark. Without this gate, auth on localhost resolves
   * in ~50ms and the user never sees the animation.
   */
  const splashElapsed = useMinDuration(1500);

  // Hydrate user preferences from the server once we're authenticated. The
  // store seeds itself synchronously from localStorage on import so the first
  // paint already uses cached prefs; this fetch reconciles with the server.
  useEffect(() => {
    if (authenticated) {
      void usePreferencesStore.getState().hydrate();
    }
  }, [authenticated]);

  // Workspace auto-start moved to the server (src/server/index.js): the
  // server reads prefs and spawns workspace sessions ONCE on its own
  // startup. This means deleting sessions client-side is sticky — the
  // pages won't re-spawn them on refresh. The previous client-side
  // implementation here would re-fire whenever the page reloaded, which
  // was confusing UX (user deletes a session, refreshes, it returns).

  useEffect(() => {
    normalizeSessionParam();
  }, [path]);

  useEffect(() => {
    const onPopState = () => setPath(getPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const codeSessionId = getCodeSessionId();
  const isTerminalScreen = path === '/terminal' && !codeSessionId;
  useChromeColor(isTerminalScreen ? 'terminal' : 'main');

  // Still checking auth, OR auth done but we haven't yet hit the minimum
  // splash duration. The status text changes once auth resolves so the
  // splash feels like a real loading sequence instead of a fixed timer.
  if (authenticated === null || (authenticated && !splashElapsed)) {
    const status = authenticated ? 'Connected' : 'Establishing link';
    return <Splash status={status} />;
  }

  if (!authenticated) {
    // No-password mode: server is unreachable — show reconnecting UI instead of login
    if (!passwordRequired) {
      return (
        <Splash
          size="md"
          status="Reconnecting to server"
          action={
            <button onClick={() => window.location.reload()} className={splashStyles.action}>
              Retry
            </button>
          }
        />
      );
    }
    return <LoginPage onLogin={login} loading={loading} />;
  }

  // Authenticated — route by pathname
  if (codeSessionId) {
    return <CodeViewer sessionId={codeSessionId} />;
  }

  if (isTerminalScreen) {
    return <TerminalApp />;
  }

  return <SessionsHub />;
}
