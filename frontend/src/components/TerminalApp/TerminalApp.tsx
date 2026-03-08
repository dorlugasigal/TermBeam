import { useEffect, useRef } from 'react';
import { fetchSessions } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { TerminalPane } from '@/components/TerminalPane/TerminalPane';
import { TabBar } from '@/components/TabBar/TabBar';
import TouchBar from '@/components/TouchBar/TouchBar';
import SearchBar from '@/components/SearchBar/SearchBar';
import CommandPalette from '@/components/CommandPalette/CommandPalette';
import { SidePanel } from '@/components/SidePanel/SidePanel';
import NewSessionModal from '@/components/SessionsHub/NewSessionModal';
import { UploadModal } from '@/components/common/UploadModal';
import { PreviewModal } from '@/components/common/PreviewModal';
import type { Session } from '@/types';
import styles from './TerminalApp.module.css';

const POLL_INTERVAL = 3000;
function getSessionIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('session') || params.get('id');
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
  const fontSize = useUIStore((s) => s.fontSize);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef(false);

  useWakeLock();

  async function handleNewSessionCreated(id: string) {
    const list: Session[] = await fetchSessions();
    const store = useSessionStore.getState();
    const newSession = list.find((s) => s.id === id);
    if (newSession) {
      store.addSession({
        id: newSession.id,
        name: newSession.name,
        shell: newSession.shell,
        pid: newSession.pid,
        cwd: newSession.cwd,
        color: newSession.color ?? '#6ec1e4',
        createdAt: newSession.createdAt,
        lastActivity: newSession.lastActivity,
        term: null,
        fitAddon: null,
        searchAddon: null,
        ws: null,
        send: null,
        connected: false,
        exited: false,
        scrollback: '',
      });
    }
    store.setActiveId(id);
  }

  // Initial load — add ALL server sessions as tabs, activate URL session
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    async function init() {
      try {
        const list: Session[] = await fetchSessions();
        const store = useSessionStore.getState();
        const urlSessionId = getSessionIdFromUrl();

        // Add ALL sessions from server (matching old UI behavior)
        for (const s of list) {
          if (!store.sessions.has(s.id)) {
            store.addSession({
              id: s.id,
              name: s.name,
              shell: s.shell,
              pid: s.pid,
              cwd: s.cwd,
              color: s.color ?? '#6ec1e4',
              createdAt: s.createdAt,
              lastActivity: s.lastActivity,
              term: null,
              fitAddon: null,
              searchAddon: null,
              ws: null,
              send: null,
              connected: false,
              exited: false,
              scrollback: '',
            });
          }
        }

        // Activate the URL session, or first session if URL not specified
        const startId =
          urlSessionId && useSessionStore.getState().sessions.has(urlSessionId)
            ? urlSessionId
            : list[0]?.id ?? null;

        if (startId) {
          useSessionStore.getState().setActiveId(startId);
        } else {
          window.location.replace('/');
        }
      } catch {
        // Will retry via polling
      }
    }

    init();
  }, []);

  // Polling — sync sessions (add new, update metadata, remove deleted)
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const list: Session[] = await fetchSessions();
        const store = useSessionStore.getState();
        const serverIds = new Set(list.map((s) => s.id));

        // Add new sessions that appeared on server
        for (const s of list) {
          if (!store.sessions.has(s.id)) {
            store.addSession({
              id: s.id,
              name: s.name,
              shell: s.shell,
              pid: s.pid,
              cwd: s.cwd,
              color: s.color ?? '#6ec1e4',
              createdAt: s.createdAt,
              lastActivity: s.lastActivity,
              term: null,
              fitAddon: null,
              searchAddon: null,
              ws: null,
              send: null,
              connected: false,
              exited: false,
              scrollback: '',
            });
          } else {
            // Update metadata for existing sessions
            store.updateSession(s.id, {
              name: s.name,
              lastActivity: s.lastActivity,
              cwd: s.cwd,
              git: s.git,
            });
          }
        }

        // Remove sessions that no longer exist on server
        for (const [id, ms] of store.sessions) {
          if (!serverIds.has(id) && !ms.exited) {
            store.removeSession(id);
          }
        }
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

  // Status text: empty when connected (matches old UI), only show on disconnect/exit
  const statusText = activeSession
    ? activeSession.exited
      ? 'Exited'
      : activeSession.connected
        ? ''
        : 'Connecting…'
    : '';

  return (
    <div className={styles.layout}>
      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.left}>
          <button
            className={`${styles.barBtn} ${styles.mobileOnly}`}
            onClick={openSidePanel}
            aria-label="Toggle panel"
            title="Sessions"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <a href="/" className={`${styles.barBtn} ${styles.desktopOnly}`} aria-label="Back" title="Back to sessions">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </a>
          {activeSession && (
            <>
              <span
                className={`${styles.statusDot} ${activeSession.connected ? styles.statusConnected : ''}`}
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
            className={styles.barBtn}
            onClick={toggleCommandPalette}
            aria-label="Tools"
            title="Tools (Ctrl+K)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
        </div>
      </div>

      {/* ── Search bar ── */}
      <SearchBar />

      {/* ── Terminal area ── */}
      <div className={`${styles.terminalArea} ${splitMode ? styles.split : ''}`}>
        {uniqueTabOrder.map((id) => {
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
            </div>
          );
        })}
      </div>

      {/* ── Touch bar (key bar) ── */}
      <TouchBar />

      {/* ── Overlays ── */}
      <CommandPalette />
      <SidePanel />
      <NewSessionModal onCreated={handleNewSessionCreated} />
      <UploadModal />
      <PreviewModal />
    </div>
  );
}
