import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ManagedSession } from '@/stores/sessionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useDissolveDelete } from '@/hooks/useDissolveDelete';
import { fetchVersion, deleteSession } from '@/services/api';
import { FileBrowser } from '@/components/FileBrowser/FileBrowser';
import { Breakable } from '@/components/common/Breakable';
import dissolveStyles from '@/components/common/Disintegrate.module.css';
import styles from './SidePanel.module.css';

function getActivityLabel(ts: string | number | undefined): string {
  if (!ts) return '';
  const num = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diff = (Date.now() - num) / 1000;
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function BreakableText({ text }: { text: string }) {
  return (
    <span className={styles.breakable}>
      <Breakable text={text} />
    </span>
  );
}

function statusColor(session: ManagedSession): string {
  if (session.exited) return 'var(--err)';
  if (session.connected) return 'var(--ok)';
  return 'var(--ink-3)';
}

function BranchIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

export function SidePanel() {
  const isOpen = useUIStore((s) => s.sidePanelOpen);
  const closeSidePanel = useUIStore((s) => s.closeSidePanel);
  const openNewSessionModal = useUIStore((s) => s.openNewSessionModal);

  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const dissolvingIds = useSessionStore((s) => s.dissolvingIds);
  const setActiveId = useSessionStore((s) => s.setActiveId);
  const removeSession = useSessionStore((s) => s.removeSession);
  const dissolveDelete = useDissolveDelete();

  const [closing, setClosing] = useState(false);
  const [version, setVersion] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setClosing(false);
    closeSidePanel();
  }, [closeSidePanel]);

  const animateClose = useCallback(() => {
    if (closeTimer.current) return;
    setClosing(true);
    setShowFiles(false);
    setConfirmId(null);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--dur-2'),
    );
    if (reducedMotion) {
      finishClose();
      return;
    }
    closeTimer.current = setTimeout(finishClose, (duration || 160) + 80);
  }, [finishClose]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!confirmId) return;
    const timer = setTimeout(() => setConfirmId(null), 2500);
    return () => clearTimeout(timer);
  }, [confirmId]);

  useEffect(() => {
    if (!isOpen) return;
    fetchVersion()
      .then((v) => {
        if (v) setVersion(v);
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('[aria-label="Close side panel"]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        animateClose();
      }
      if (e.key === 'Tab') {
        const controls = panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex="0"]',
        );
        if (!controls?.length) return;
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    panel?.addEventListener('keydown', onKey);
    return () => {
      panel?.removeEventListener('keydown', onKey);
      if (
        previous instanceof HTMLElement &&
        (document.activeElement === document.body || panel?.contains(document.activeElement))
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [isOpen, animateClose]);

  if (!isOpen) return null;

  const orderedSessions = tabOrder
    .map((id) => sessions.get(id))
    .filter((s): s is NonNullable<typeof s> => s != null && !s.hidden);

  const activeSession = activeId ? sessions.get(activeId) : undefined;

  const selectSession = (id: string) => {
    setActiveId(id);
    animateClose();
  };

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (dissolvingIds.has(id)) return;
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    if (id === activeId) {
      const nextActive = orderedSessions.find((session) => session.id !== id)?.id;
      if (nextActive) setActiveId(nextActive);
    }
    const session = sessions.get(id);
    const rowEl = listRef.current?.querySelector<HTMLElement>(`[data-session-id="${id}"]`);
    void dissolveDelete(id, {
      element: rowEl ?? null,
      color:
        session?.color || getComputedStyle(document.documentElement).getPropertyValue('--accent'),
      variant: 'tab',
      apiDelete: () => deleteSession(id),
      finalize: () => removeSession(id),
    }).catch(() => toast.error('Failed to close session'));
  };

  return (
    <>
      <div
        className={styles.backdrop}
        data-closing={closing}
        onClick={animateClose}
        aria-hidden="true"
      />
      <div
        className={styles.panel}
        data-closing={closing}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sessions"
        data-testid="side-panel"
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) finishClose();
        }}
      >
        {/* Brand header */}
        <div className={styles.header}>
          <div className={styles.brand}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
            TermBeam
          </div>
          {version && <div className={styles.version}>v{version}</div>}
          <button className={styles.closeBtn} onClick={animateClose} aria-label="Close side panel">
            ×
          </button>
        </div>

        {showFiles && activeId && activeSession?.cwd ? (
          <FileBrowser
            sessionId={activeId}
            rootDir={activeSession.cwd}
            onClose={() => setShowFiles(false)}
          />
        ) : (
          <>
            {/* Section title */}
            <div className={styles.sectionTitle}>
              Sessions <span>{orderedSessions.length}</span>
            </div>

            {/* Session list */}
            <div ref={listRef} className={styles.list} data-testid="side-panel-list">
              {orderedSessions.map((session) => {
                const activity = getActivityLabel(session.lastActivity);
                const git = session.git;
                const isDissolvingRow = dissolvingIds.has(session.id);

                return (
                  <div
                    key={session.id}
                    className={`${styles.card} ${session.id === activeId ? styles.cardActive : ''} ${isDissolvingRow ? dissolveStyles.dissolving : ''}`}
                    data-testid="side-panel-card"
                    data-session-id={session.id}
                    aria-hidden={isDissolvingRow || undefined}
                    style={
                      {
                        '--session-color': session.color || 'var(--accent)',
                        ...(isDissolvingRow ? { '--termbeam-fragment-ms': '280ms' } : {}),
                      } as React.CSSProperties
                    }
                    onClick={() => {
                      if (isDissolvingRow) return;
                      selectSession(session.id);
                    }}
                    onAuxClick={(e) => {
                      if (isDissolvingRow) return;
                      if (e.button === 1) {
                        e.preventDefault();
                        handleClose(e, session.id);
                      }
                    }}
                  >
                    <button
                      className={styles.cardActivate}
                      aria-label={`Open ${session.name}`}
                      aria-current={session.id === activeId ? 'true' : undefined}
                      tabIndex={isDissolvingRow ? -1 : 0}
                    />
                    <div className={styles.cardHeader}>
                      <span
                        className={styles.cardDot}
                        style={{
                          backgroundColor: statusColor(session),
                        }}
                        title={
                          session.exited
                            ? 'Exited'
                            : session.connected
                              ? 'Connected'
                              : 'Disconnected'
                        }
                      />
                      <span className={styles.cardName}>
                        <BreakableText text={session.name} />
                      </span>
                      {session.id !== activeId && session.hasUnread && (
                        <span className={styles.unreadDot} />
                      )}
                      <button
                        className={`${styles.cardClose} ${confirmId === session.id ? styles.cardCloseConfirm : ''}`}
                        onClick={(e) => handleClose(e, session.id)}
                        title="Close session"
                        aria-label={
                          confirmId === session.id
                            ? `Confirm close ${session.name}`
                            : `Close ${session.name}`
                        }
                      >
                        {confirmId === session.id ? 'Close?' : '×'}
                      </button>
                    </div>

                    {/* Meta: shell + cwd + activity */}
                    <div className={styles.cardMeta}>
                      <span className={styles.metaDetails}>
                        <BreakableText text={session.shell} />
                        {activity && <span>· {activity}</span>}
                      </span>
                      {session.cwd && <BreakableText text={session.cwd} />}
                    </div>

                    {/* Git info badges */}
                    {git && (
                      <div className={styles.cardGit}>
                        <span className={styles.gitBadge}>
                          <BranchIcon /> <BreakableText text={git.branch || 'detached'} />
                        </span>
                        {git.provider && (
                          <span className={styles.gitBadge}>
                            <BreakableText text={git.provider} />
                          </span>
                        )}
                        {git.repoName && (
                          <span className={styles.gitBadge}>
                            <BreakableText text={git.repoName} />
                          </span>
                        )}
                        {git.status && (
                          <span
                            className={`${styles.gitBadge} ${git.status.clean ? styles.gitClean : styles.gitDirty}`}
                          >
                            <BreakableText
                              text={git.status.clean ? '✓ clean' : git.status.summary}
                            />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className={styles.footer}>
              <div className={styles.footerRow}>
                <button
                  className={styles.footerBtnPrimary}
                  onClick={() => {
                    openNewSessionModal();
                    animateClose();
                  }}
                >
                  <span>+ New Session</span>
                </button>
                <button
                  className={styles.footerBtnSecondary}
                  onClick={() => {
                    useUIStore.getState().openResumeBrowser();
                    animateClose();
                  }}
                >
                  ↺ Resume
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
