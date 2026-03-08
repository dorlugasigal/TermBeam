import { useEffect, useCallback, useRef, useState } from 'react';
import { fetchSessions } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { TerminalPane } from '@/components/TerminalPane/TerminalPane';
import type { Session } from '@/types';
import styles from './TerminalApp.module.css';

const POLL_INTERVAL = 3000;
const DEFAULT_FONT_SIZE = 14;

function getSessionIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('session');
}

export function TerminalApp() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const splitMode = useSessionStore((s) => s.splitMode);
  const addSession = useSessionStore((s) => s.addSession);
  const setActiveId = useSessionStore((s) => s.setActiveId);
  const toggleSplit = useSessionStore((s) => s.toggleSplit);

  const openSearchBar = useUIStore((s) => s.openSearchBar);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);

  const [fontSize] = useState(DEFAULT_FONT_SIZE);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useWakeLock();

  // Fetch sessions and auto-connect from URL
  const loadSessions = useCallback(async () => {
    try {
      const list: Session[] = await fetchSessions();

      // Auto-connect session from URL if not already tracked
      const urlSessionId = getSessionIdFromUrl();
      if (urlSessionId) {
        const serverSession = list.find((s) => s.id === urlSessionId);
        if (serverSession && !sessions.has(urlSessionId)) {
          addSession({
            id: serverSession.id,
            name: serverSession.name,
            shell: serverSession.shell,
            pid: serverSession.pid,
            cwd: serverSession.cwd,
            color: serverSession.color ?? '#6ec1e4',
            term: null,
            fitAddon: null,
            searchAddon: null,
            ws: null,
            connected: false,
            exited: false,
            scrollback: '',
          });
        }
      }
    } catch {
      // Network error — will retry on next poll
    }
  }, [sessions, addSession]);

  // Initial load + polling
  useEffect(() => {
    loadSessions();
    pollRef.current = setInterval(loadSessions, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadSessions]);

  const activeSession = activeId ? sessions.get(activeId) : null;

  // Determine which sessions to render in split mode
  const splitIds: string[] = [];
  if (splitMode && tabOrder.length >= 2 && activeId) {
    splitIds.push(activeId);
    const other = tabOrder.find((id) => id !== activeId);
    if (other) splitIds.push(other);
  }

  const visibleIds = splitMode && splitIds.length === 2 ? splitIds : activeId ? [activeId] : [];

  return (
    <div className={styles.layout}>
      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <a href="/" className={`${styles.backButton} ${styles.desktopOnly}`} aria-label="Back">
          ←
        </a>

        {/* Tab area placeholder — TabBar component will replace this */}
        <div className={styles.tabArea}>
          {activeSession && <span className={styles.activeTabName}>{activeSession.name}</span>}
        </div>

        <div className={styles.rightButtons}>
          <button className={styles.iconButton} onClick={openSearchBar} aria-label="Search">
            🔍
          </button>
          <button className={styles.iconButton} onClick={toggleSplit} aria-label="Split view">
            ⊞
          </button>
          <button
            className={styles.iconButton}
            onClick={toggleCommandPalette}
            aria-label="Command palette"
          >
            ☰
          </button>
        </div>
      </div>

      {/* ── Terminal area ── */}
      <div className={`${styles.terminalArea} ${splitMode ? styles.split : ''}`}>
        {tabOrder.map((id, index) => {
          const isVisible = visibleIds.includes(id);
          const isActive = id === activeId;

          return (
            <div
              key={id}
              className={`${styles.paneWrapper} ${isVisible ? styles.visible : ''}`}
              onClick={() => {
                if (!isActive) setActiveId(id);
              }}
            >
              <TerminalPane sessionId={id} active={isActive} fontSize={fontSize} />
              {splitMode && isVisible && index === 0 && visibleIds.length > 1 && (
                <div className={styles.splitDivider} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Key bar placeholder — TouchBar component will be added later ── */}
      <div className={styles.keyBar} />
    </div>
  );
}
