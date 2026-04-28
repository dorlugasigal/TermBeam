import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import LoginPage from '@/components/LoginPage/LoginPage';
import SessionsHub from '@/components/SessionsHub/SessionsHub';
import { TerminalApp } from '@/components/TerminalApp/TerminalApp';
import CodeViewer from '@/components/CodeViewer/CodeViewer';
import { useThemeStore } from '@/stores/themeStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useSessionStore } from '@/stores/sessionStore';
import { THEMES } from '@/themes/terminalThemes';
import { createSession, fetchSessions } from '@/services/api';

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
  const startupBootedRef = useRef(false);

  // Hydrate user preferences from the server once we're authenticated. The
  // store seeds itself synchronously from localStorage on import so the first
  // paint already uses cached prefs; this fetch reconciles with the server.
  useEffect(() => {
    if (authenticated) {
      void usePreferencesStore.getState().hydrate();
    }
  }, [authenticated]);

  // Startup workspace: when the user has saved a list of "open these sessions
  // on launch" entries, create them once after auth + hydrate. Guarded by a
  // ref so HMR / re-renders don't re-spawn duplicates. We subscribe to the
  // prefs store so we can run the boot exactly once, when hydrate() resolves
  // and brings down the authoritative server-side preferences (otherwise we'd
  // potentially boot from stale localStorage cache).
  useEffect(() => {
    if (!authenticated) return;
    const tryBoot = (state: ReturnType<typeof usePreferencesStore.getState>) => {
      if (startupBootedRef.current) return;
      if (!state.hydrated) return;
      startupBootedRef.current = true;

      // Pick which session list to boot from. Preference order:
      //   1. A named workspace flagged `default: true`
      //   2. If there's exactly ONE named workspace, treat it as default
      //      (matches the user's intent — they only have one to choose)
      //   3. Legacy single startupWorkspace (when enabled)
      const namedWorkspaces = state.prefs.workspaces ?? [];
      const explicitDefault = namedWorkspaces.find((w) => w.default);
      const onlyWorkspace = namedWorkspaces.length === 1 ? namedWorkspaces[0] : null;
      const legacy = state.prefs.startupWorkspace;
      const sessionsToBoot = explicitDefault
        ? explicitDefault.sessions
        : onlyWorkspace
          ? onlyWorkspace.sessions
          : legacy && legacy.enabled && legacy.sessions
            ? legacy.sessions
            : [];

      if (sessionsToBoot.length === 0) return;

      (async () => {
        // Idempotent boot: only spawn startup sessions when the server has
        // none. Otherwise refreshing the page (or any client reconnecting
        // to an already-running TermBeam) would keep stacking duplicates.
        try {
          const existing = await fetchSessions();
          if (existing.length > 0) return;
        } catch {
          // If we can't read the session list, bail out — we'd rather skip
          // the boot than risk creating duplicates.
          return;
        }
        for (const s of sessionsToBoot) {
          const cmd = (s.initialCommand ?? '').trim();
          const baseReq = {
            name: s.name,
            cwd: s.cwd || undefined,
            color: s.color || undefined,
            initialCommand: cmd || undefined,
            type: (s.kind === 'agent' ? 'agent' : 'terminal') as 'agent' | 'terminal',
          };
          let created;
          try {
            // First attempt: include the saved shell if any.
            created = await createSession({
              ...baseReq,
              shell: s.shell || undefined,
            });
          } catch (err) {
            // If the saved shell isn't a recognized path on this host
            // (common when prefs were saved with just the basename, or
            // when moving between machines), retry without a shell so
            // the server uses its default.
            const msg = err instanceof Error ? err.message : '';
            if (msg.toLowerCase().includes('shell')) {
              try {
                created = await createSession(baseReq);
              } catch {
                continue;
              }
            } else {
              continue;
            }
          }
          if (cmd && created) {
            useSessionStore.getState().setPendingInitialCommand(created.id, cmd);
          }
        }
      })();
    };
    tryBoot(usePreferencesStore.getState());
    const unsub = usePreferencesStore.subscribe(tryBoot);
    return unsub;
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
