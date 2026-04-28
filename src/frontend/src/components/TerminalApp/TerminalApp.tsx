import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fetchSessions, checkAuth, clearServiceWorkerCaches } from '@/services/api';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useWakeLock } from '@/hooks/useWakeLock';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';
import { TerminalPane } from '@/components/TerminalPane/TerminalPane';
import { CopilotPane } from '@/components/CopilotPane/CopilotPane';
import { TabBar } from '@/components/TabBar/TabBar';
import TouchBar from '@/components/TouchBar/TouchBar';
import SearchBar from '@/components/SearchBar/SearchBar';
import ToolsPanel from '@/components/ToolsPanel/ToolsPanel';
import { SidePanel } from '@/components/SidePanel/SidePanel';
import { FileBrowser } from '@/components/FileBrowser/FileBrowser';
import { MarkdownBrowser } from '@/components/MarkdownBrowser/MarkdownBrowser';
import CodeViewer from '@/components/CodeViewer/CodeViewer';
import ResumeBrowser from '@/components/ResumeBrowser/ResumeBrowser';
import NewSessionModal from '@/components/SessionsHub/NewSessionModal';
import { UploadModal } from '@/components/Modals/UploadModal';
import { PreviewModal } from '@/components/Modals/PreviewModal';
import SettingsPanel from '@/components/SettingsPanel/SettingsPanel';
import ThemePicker from '@/components/common/ThemePicker';
import CustomKeysModal from '@/components/CustomKeysModal/CustomKeysModal';
import CopyOverlay from '@/components/Overlays/CopyOverlay';
import type { Session } from '@/types';
import styles from './TerminalApp.module.css';

const POLL_INTERVAL = 3000;
const MAX_CONSECUTIVE_FAILURES = 5;

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
  const toggleToolsPanel = useUIStore((s) => s.toggleToolsPanel);
  const toggleSettingsPanel = useUIStore((s) => s.toggleSettingsPanel);
  const closeToolsPanel = useUIStore((s) => s.closeToolsPanel);
  const closeSearchBar = useUIStore((s) => s.closeSearchBar);
  const openSidePanel = useUIStore((s) => s.openSidePanel);
  const openNewSessionModal = useUIStore((s) => s.openNewSessionModal);
  const fontSize = useUIStore((s) => s.fontSize);
  const showDownload = useUIStore((s) => s.downloadModalOpen);
  const closeDownloadModal = useUIStore((s) => s.closeDownloadModal);
  const showMarkdown = useUIStore((s) => s.markdownModalOpen);
  const closeMarkdownModal = useUIStore((s) => s.closeMarkdownModal);
  const codeViewerOpen = useUIStore((s) => s.codeViewerOpen);
  const codeViewerSessionId = useUIStore((s) => s.codeViewerSessionId);
  const codeViewerInitialView = useUIStore((s) => s.codeViewerInitialView);
  const closeCodeViewer = useUIStore((s) => s.closeCodeViewer);
  // FIX #2: ThemePicker controlled mode
  const themePickerOpen = useUIStore((s) => s.themePickerOpen);
  const closeThemePicker = useUIStore((s) => s.closeThemePicker);
  const customKeysModalOpen = useUIStore((s) => s.customKeysModalOpen);
  const closeCustomKeysModal = useUIStore((s) => s.closeCustomKeysModal);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initializedRef = useRef(false);
  const pollFailuresRef = useRef(0);
  const [connectionLost, setConnectionLost] = useState(false);

  useWakeLock();

  // Navigate back to sessions hub when all sessions are removed
  useEffect(() => {
    if (initializedRef.current && sessions.size === 0) {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [sessions.size]);

  const { keyboardOpen, keyboardHeight } = useMobileKeyboard();

  async function handleNewSessionCreated(id: string, type?: 'terminal' | 'copilot', ptySessionId?: string | null, model?: string) {
    // Add a placeholder immediately so the pane mounts right away
    const store = useSessionStore.getState();
    const isCopilot = type === 'copilot';

    // For copilot sessions, also register the companion PTY (hidden)
    if (isCopilot && ptySessionId && !store.sessions.has(ptySessionId)) {
      store.addSession({
        id: ptySessionId,
        name: 'Agent Terminal',
        type: 'terminal',
        hidden: true,
        shell: '',
        pid: 0,
        cwd: '',
        color: '#6ec1e4',
        createdAt: new Date().toISOString(),
        lastActivity: Date.now(),
        term: null,
        fitAddon: null,
        searchAddon: null,
        ws: null,
        send: null,
        connected: false,
        exited: false,
        scrollback: '',
        hasUnread: false,
      });
    }

    if (!store.sessions.has(id)) {
      store.addSession({
        id,
        name: id.slice(0, 8),
        type,
        shell: '',
        pid: 0,
        cwd: '',
        color: isCopilot ? '#a855f6' : '#6ec1e4',
        createdAt: new Date().toISOString(),
        lastActivity: Date.now(),
        companionTermId: isCopilot && ptySessionId ? ptySessionId : undefined,
        model: isCopilot ? model : undefined,
        term: null,
        fitAddon: null,
        searchAddon: null,
        ws: null,
        send: null,
        connected: isCopilot, // CopilotPane manages its own SDK connection
        exited: false,
        scrollback: '',
        hasUnread: false,
      });
    }
    store.setActiveId(id);

    // Fetch real metadata in the background
    try {
      const list: Session[] = await fetchSessions();
      const newSession = list.find((s) => s.id === id);
      if (newSession) {
        useSessionStore.getState().updateSession(id, {
          name: newSession.name,
          shell: newSession.shell,
          pid: newSession.pid,
          cwd: newSession.cwd,
          color: newSession.color ?? '#6ec1e4',
          createdAt: newSession.createdAt,
          lastActivity: newSession.lastActivity,
          type: newSession.type,
          model: (newSession as any).model,
        });
        toast.success(`Session "${newSession.name}" created`);
      }
    } catch {
      // Polling will pick up metadata
    }
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
          if (s.hidden) continue; // Skip hidden companion sessions
          if (!store.sessions.has(s.id)) {
            const isCopilot = s.type === 'copilot';
            const ptySessionId = isCopilot ? (s as any).ptySessionId ?? undefined : undefined;

            // Register the companion PTY as a hidden session so that
            // CopilotPane's embedded TerminalPane can updateSession() on it
            // and TouchBar.sendInput() can route key presses to it.
            if (ptySessionId && !store.sessions.has(ptySessionId)) {
              store.addSession({
                id: ptySessionId,
                name: 'Agent Terminal',
                type: 'terminal',
                hidden: true,
                shell: '',
                pid: 0,
                cwd: s.cwd ?? '',
                color: '#6ec1e4',
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
                hasUnread: false,
              });
            }

            store.addSession({
              id: s.id,
              name: s.name,
              shell: s.shell,
              pid: s.pid,
              cwd: s.cwd,
              color: s.color ?? '#6ec1e4',
              createdAt: s.createdAt,
              lastActivity: s.lastActivity,
              type: s.type,
              companionTermId: ptySessionId,
              term: null,
              fitAddon: null,
              searchAddon: null,
              ws: null,
              send: null,
              connected: isCopilot, // CopilotPane manages its own SDK connection
              exited: false,
              scrollback: '',
              hasUnread: false,
            });
          }
        }

        // Activate the URL session, or first session if URL not specified
        const startId =
          urlSessionId && useSessionStore.getState().sessions.has(urlSessionId)
            ? urlSessionId
            : (list[0]?.id ?? null);

        if (startId) {
          useSessionStore.getState().setActiveId(startId);
        } else {
          window.location.replace('/');
        }
      } catch {
        checkAuth()
          .then(({ authenticated, serverReachable }) => {
            if (!authenticated && serverReachable) window.location.replace('/login');
          })
          .catch(() => {
            // Network error — don't redirect, polling will retry
          });
      }
    }

    init();
  }, []);

  // Polling — sync sessions (add new, update metadata, remove deleted)
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        const list: Session[] = await fetchSessions();
        if (pollFailuresRef.current > 0) clearServiceWorkerCaches();
        pollFailuresRef.current = 0;
        setConnectionLost(false);
        const store = useSessionStore.getState();
        const serverIds = new Set(list.map((s) => s.id));

        // Add new sessions that appeared on server
        for (const s of list) {
          if (s.hidden) continue; // Skip hidden companion sessions
          const existing = store.sessions.get(s.id);
          if (!existing) {
            const isCopilot = s.type === 'copilot';
            const ptySessionId = isCopilot ? (s as any).ptySessionId ?? undefined : undefined;

            // Register the companion PTY as a hidden session so that
            // CopilotPane's embedded TerminalPane can updateSession() on it
            // and TouchBar.sendInput() can route key presses to it.
            if (ptySessionId && !store.sessions.has(ptySessionId)) {
              store.addSession({
                id: ptySessionId,
                name: 'Agent Terminal',
                type: 'terminal',
                hidden: true,
                shell: '',
                pid: 0,
                cwd: s.cwd ?? '',
                color: '#6ec1e4',
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
                hasUnread: false,
              });
            }

            store.addSession({
              id: s.id,
              name: s.name,
              shell: s.shell,
              pid: s.pid,
              cwd: s.cwd,
              color: s.color ?? '#6ec1e4',
              createdAt: s.createdAt,
              lastActivity: s.lastActivity,
              type: s.type,
              companionTermId: ptySessionId,
              term: null,
              fitAddon: null,
              searchAddon: null,
              ws: null,
              send: null,
              connected: isCopilot, // CopilotPane manages its own SDK connection
              exited: false,
              scrollback: '',
              hasUnread: false,
            });
          } else if (!existing.hidden) {
            // Update metadata for existing sessions, but skip hidden companion
            // sessions so polling doesn't overwrite their name or re-surface them.
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
            // If it's a copilot session, also remove its companion PTY
            if (ms.companionTermId) {
              store.removeSession(ms.companionTermId);
            }
            store.removeSession(id);
          }
        }
      } catch {
        pollFailuresRef.current++;
        if (pollFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
          setConnectionLost(true);
          checkAuth()
            .then(({ authenticated, serverReachable }) => {
              if (!authenticated && serverReachable) window.location.replace('/login');
            })
            .catch(() => {
              // Network error — keep showing connection lost banner
            });
        }
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
        toggleToolsPanel();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearchBar();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        toggleSettingsPanel();
      }
      if (e.key === 'Escape') {
        if (codeViewerOpen) {
          e.preventDefault();
          closeCodeViewer();
          return;
        }
        if (showDownload) {
          e.preventDefault();
          closeDownloadModal();
          return;
        }
        if (showMarkdown) {
          e.preventDefault();
          closeMarkdownModal();
          return;
        }
        const state = useUIStore.getState();
        if (state.toolsPanelOpen) {
          e.preventDefault();
          closeToolsPanel();
        } else if (state.searchBarOpen) {
          e.preventDefault();
          closeSearchBar();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [
    toggleToolsPanel,
    openSearchBar,
    toggleSettingsPanel,
    closeToolsPanel,
    closeSearchBar,
    showDownload,
    showMarkdown,
    closeDownloadModal,
    closeMarkdownModal,
    codeViewerOpen,
    closeCodeViewer,
  ]);

  const activeSession = activeId ? sessions.get(activeId) : null;
  const isCopilotChat = activeSession?.type === 'copilot';
  const showingAgentTerminal = useUIStore((s) => s.showingAgentTerminal);
  const hideTouchBar = isCopilotChat && !showingAgentTerminal;
  // For copilot sessions, file/git APIs need the companion PTY session ID
  const activePtyId = isCopilotChat ? (activeSession?.companionTermId ?? activeId) : activeId;

  // Deduplicated tab order — exclude hidden companion sessions
  const uniqueTabOrder = [...new Set(tabOrder)].filter((id) => {
    const s = sessions.get(id);
    return s && !s.hidden;
  });

  // Determine which sessions to render in split mode
  const isSplit = splitMode !== 'off';
  const splitIds: string[] = [];
  if (isSplit && uniqueTabOrder.length >= 2 && activeId) {
    splitIds.push(activeId);
    const other = uniqueTabOrder.find((id) => id !== activeId);
    if (other) splitIds.push(other);
  }

  const visibleIds = isSplit && splitIds.length === 2 ? splitIds : activeId ? [activeId] : [];

  // Status text: empty when connected (matches old UI), only show on disconnect/exit
  const statusText = activeSession
    ? activeSession.exited
      ? 'Exited'
      : activeSession.connected
        ? ''
        : 'Connecting…'
    : '';

  return (
    <div
      className={styles.layout}
      data-testid="terminal-app"
      data-keyboard-open={keyboardOpen || undefined}
      data-hide-touchbar={hideTouchBar || undefined}
      style={{ '--keyboard-height': `${keyboardHeight}px` } as React.CSSProperties}
    >
      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.left}>
          <button
            className={`${styles.barBtn} ${styles.mobileOnly}`}
            onClick={openSidePanel}
            onTouchStart={(e) => e.stopPropagation()}
            aria-label="Toggle panel"
            title="Sessions"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <a
            href="/"
            className={`${styles.barBtn} ${styles.desktopOnly}`}
            aria-label="Back"
            title="Back to sessions"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </a>
          {activeSession && (
            <>
              <span
                className={`${styles.statusDot} ${activeSession.connected ? styles.statusConnected : ''} ${activeSession.connected ? 'connected' : 'disconnected'}`}
                data-testid="status-dot"
              />
              <span className={styles.sessionName} data-testid="session-name-display">
                {activeSession.name}
              </span>
              {statusText && <span className={styles.statusText}>{statusText}</span>}
            </>
          )}
        </div>

        <TabBar inline />

        <div className={styles.right}>
          <button
            className={`${styles.barBtn} ${styles.barBtnWithLabel} ${styles.desktopOnly}`}
            data-testid="tab-new-btn"
            onClick={() => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              openNewSessionModal();
            }}
            onTouchStart={(e) => e.stopPropagation()}
            aria-label="New tab"
            title="New tab"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className={styles.btnLabel}>New</span>
          </button>
          <button
            className={styles.barBtn}
            onClick={toggleToolsPanel}
            onTouchStart={(e) => e.stopPropagation()}
            aria-label="Tools"
            title="Tools (Ctrl+K)"
            data-testid="palette-trigger"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Connection lost banner ── */}
      {connectionLost && (
        <div className={styles.connectionBanner} data-testid="connection-banner">
          <span>Connection lost — reconnecting…</span>
          <button onClick={() => window.location.reload()} className={styles.connectionBannerBtn}>
            Reload
          </button>
        </div>
      )}

      {/* ── Search bar ── */}
      <SearchBar />

      {/* ── Terminal area ── */}
      <div
        className={`${styles.terminalArea} ${isSplit ? styles.split : ''} ${splitMode === 'horizontal' ? styles.splitHorizontal : ''}`}
      >
        {uniqueTabOrder.map((id) => {
          const isVisible = visibleIds.includes(id);
          const isActive = id === activeId;
          const sessionType = sessions.get(id)?.type;

          return (
            <div
              key={id}
              className={`${styles.paneWrapper} ${isVisible ? styles.visible : ''} ${isSplit && isVisible && isActive ? styles.paneFocused : ''} ${isSplit && isVisible && !isActive ? styles.paneUnfocused : ''}`}
              onClick={() => {
                if (!isActive) setActiveId(id);
              }}
            >
              {sessionType === 'copilot' ? (
                <CopilotPane sessionId={id} active={isActive} />
              ) : (
                <TerminalPane
                  sessionId={id}
                  active={isActive}
                  visible={isVisible}
                  fontSize={fontSize}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Touch bar (key bar) — only for terminal sessions ── */}
      <TouchBar />

      {/* ── Overlays ── */}
      <ToolsPanel />
      <SidePanel />
      <NewSessionModal onCreated={handleNewSessionCreated} />
      <UploadModal />
      <PreviewModal />
      <SettingsPanel />
      {/* FIX #2: Standalone ThemePicker with controlled mode */}
      <ThemePicker open={themePickerOpen} onClose={closeThemePicker} hideTrigger />
      <CustomKeysModal open={customKeysModalOpen} onClose={closeCustomKeysModal} />
      <CopyOverlay />
      <ResumeBrowser />

      {/* ── Download file browser overlay ── */}
      {showDownload && activePtyId && activeSession?.cwd && (
        <div className={styles.downloadOverlay} onClick={closeDownloadModal}>
          <div className={styles.downloadPanel} onClick={(e) => e.stopPropagation()}>
            <FileBrowser
              sessionId={activePtyId}
              rootDir={activeSession.cwd}
              onClose={closeDownloadModal}
            />
          </div>
        </div>
      )}

      {/* ── Markdown browser overlay ── */}
      {showMarkdown && activePtyId && activeSession?.cwd && (
        <div className={styles.downloadOverlay} onClick={closeMarkdownModal}>
          <div className={styles.downloadPanel} onClick={(e) => e.stopPropagation()}>
            <MarkdownBrowser
              sessionId={activePtyId}
              rootDir={activeSession.cwd}
              onClose={closeMarkdownModal}
            />
          </div>
        </div>
      )}

      {/* ── Code viewer overlay (fullscreen, terminal stays alive underneath) ── */}
      {codeViewerOpen && codeViewerSessionId && (
        <div className={styles.codeViewerOverlay}>
          <CodeViewer
            sessionId={codeViewerSessionId}
            onClose={closeCodeViewer}
            initialView={codeViewerInitialView}
          />
        </div>
      )}
    </div>
  );
}
