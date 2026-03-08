import { useEffect, useRef, useState } from 'react';
import { fetchSessions, deleteSession } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useThemeStore } from '@/stores/themeStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { TerminalPane } from '@/components/TerminalPane/TerminalPane';
import { TabBar } from '@/components/TabBar/TabBar';
import TouchBar from '@/components/TouchBar/TouchBar';
import SearchBar from '@/components/SearchBar/SearchBar';
import CommandPalette from '@/components/CommandPalette/CommandPalette';
import { SidePanel } from '@/components/SidePanel/SidePanel';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';
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
  const setActiveId = useSessionStore((s) => s.setActiveId);

  const openSearchBar = useUIStore((s) => s.openSearchBar);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const openSidePanel = useUIStore((s) => s.openSidePanel);
  const openNewSessionModal = useUIStore((s) => s.openNewSessionModal);

  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);

  const [fontSize] = useState(DEFAULT_FONT_SIZE);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef(false);

  useWakeLock();

  // Initial load — connect session from URL param
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function init() {
      try {
        const list: Session[] = await fetchSessions();
        const urlSessionId = getSessionIdFromUrl();
        if (urlSessionId) {
          const serverSession = list.find((s) => s.id === urlSessionId);
          if (serverSession) {
            const store = useSessionStore.getState();
            if (!store.sessions.has(urlSessionId)) {
              store.addSession({
                id: serverSession.id,
                name: serverSession.name,
                shell: serverSession.shell,
                pid: serverSession.pid,
                cwd: serverSession.cwd,
                color: serverSession.color ?? '#6ec1e4',
                createdAt: serverSession.createdAt,
                lastActivity: serverSession.lastActivity,
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
        }
      } catch {
        // Will retry via polling
      }
    }

    init();
  }, []);

  // Polling — sync metadata only
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        await fetchSessions();
      } catch {
        // Network error
      }
    }, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearchBar();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleCommandPalette, openSearchBar]);

  const activeSession = activeId ? sessions.get(activeId) : null;

  // Deduplicated tab order
  const uniqueTabOrder = [...new Set(tabOrder)].filter((id) => sessions.has(id));

  // Determine which sessions to render in split mode
  const splitIds: string[] = [];
  if (splitMode && uniqueTabOrder.length >= 2 && activeId) {
    splitIds.push(activeId);
    const other = uniqueTabOrder.find((id) => id !== activeId);
    if (other) splitIds.push(other);
  }

  const visibleIds =
    splitMode && splitIds.length === 2 ? splitIds : activeId ? [activeId] : [];

  const statusText = activeSession
    ? activeSession.exited
      ? 'Exited'
      : activeSession.connected
        ? 'Connected'
        : 'Connecting…'
    : '';

  const cycleTheme = () => {
    const idx = THEMES.findIndex((t) => t.id === themeId);
    const next = THEMES[(idx + 1) % THEMES.length]!;
    setTheme(next.id as ThemeId);
  };

  const handleStop = async () => {
    if (!activeId) return;
    const ms = sessions.get(activeId);
    if (ms?.ws) ms.ws.close();
    try {
      await deleteSession(activeId);
    } catch {
      // ignore
    }
    useSessionStore.getState().removeSession(activeId);
  };

  return (
    <div className={styles.layout}>
      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.left}>
          <button
            className={styles.barBtn}
            onClick={openSidePanel}
            aria-label="Toggle panel"
            title="Sessions"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <a href="/" className={styles.barBtn} aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </a>
          {activeSession && (
            <>
              <span
                className={styles.statusDot}
                style={{ backgroundColor: activeSession.color }}
              />
              <span className={styles.sessionName}>{activeSession.name}</span>
              {statusText && <span className={styles.statusText}>{statusText}</span>}
            </>
          )}
        </div>

        <TabBar inline />

        <div className={styles.right}>
          <button
            className={`${styles.barBtn} ${styles.barBtnWithLabel}`}
            onClick={openNewSessionModal}
            aria-label="New tab"
            title="New tab"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span className={styles.btnLabel}>New</span>
          </button>
          <button
            className={`${styles.barBtn} ${styles.desktopOnly}`}
            onClick={cycleTheme}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
          </button>
          <button
            className={styles.barBtn}
            onClick={toggleCommandPalette}
            aria-label="Tools"
            title="Tools (Ctrl+K)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
          <button
            className={`${styles.barBtn} ${styles.stopBtn} ${styles.barBtnWithLabel}`}
            onClick={handleStop}
            aria-label="Stop"
            title="Stop session"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            <span className={styles.btnLabel}>Stop</span>
          </button>
        </div>
      </div>

      {/* ── Search bar ── */}
      <SearchBar />

      {/* ── Terminal area ── */}
      <div className={`${styles.terminalArea} ${splitMode ? styles.split : ''}`}>
        {uniqueTabOrder.map((id, index) => {
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

      {/* ── Touch bar (key bar) ── */}
      <TouchBar />

      {/* ── Overlays ── */}
      <CommandPalette />
      <SidePanel />
    </div>
  );
}
