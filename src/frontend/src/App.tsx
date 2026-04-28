import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import LoginPage from '@/components/LoginPage/LoginPage';
import SessionsHub from '@/components/SessionsHub/SessionsHub';
import { TerminalApp } from '@/components/TerminalApp/TerminalApp';
import CodeViewer from '@/components/CodeViewer/CodeViewer';
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

  // Hydrate user preferences from the server once we're authenticated. The
  // store seeds itself synchronously from localStorage on import so the first
  // paint already uses cached prefs; this fetch reconciles with the server.
  useEffect(() => {
    if (authenticated) {
      void usePreferencesStore.getState().hydrate();
    }
  }, [authenticated]);

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

  // Still checking auth
  if (authenticated === null) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg)',
          color: 'var(--text)',
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  if (!authenticated) {
    // No-password mode: server is unreachable — show reconnecting UI instead of login
    if (!passwordRequired) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: '16px',
            background: 'var(--bg)',
            color: 'var(--text)',
          }}
        >
          <div className="spinner" />
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            Reconnecting to server…
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '8px',
              padding: '8px 20px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Retry
          </button>
        </div>
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
