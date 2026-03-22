import { useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { ManagedSession } from '@/stores/sessionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { fetchVersion, deleteSession } from '@/services/api';
import { FileBrowser } from '@/components/FileBrowser/FileBrowser';
import styles from './SidePanel.module.css';

function getTerminalPreview(term: Terminal | null): string {
  if (!term) return '';
  const buf = term.buffer.active;
  const totalRows = buf.length;
  let lastNonEmpty = -1;
  for (let i = totalRows - 1; i >= 0; i--) {
    const line = buf.getLine(i);
    if (line && line.translateToString(true).trim() !== '') {
      lastNonEmpty = i;
      break;
    }
  }
  if (lastNonEmpty < 0) return '';
  const start = Math.max(0, lastNonEmpty - 5);
  const lines: string[] = [];
  for (let i = start; i <= lastNonEmpty; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines.join('\n');
}

function getActivityLabel(ts: string | number | undefined): string {
  if (!ts) return '';
  const num = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diff = (Date.now() - num) / 1000;
  if (diff < 5) return '';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function truncatePath(cwd: string): string {
  if (!cwd) return '';
  const home = cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~');
  if (home.length <= 40) return home;
  const parts = home.split('/');
  if (parts.length <= 3) return home;
  return parts[0] + '/…/' + parts.slice(-2).join('/');
}

function statusColor(session: ManagedSession): string {
  if (session.exited) return 'var(--danger)';
  if (session.connected) return 'var(--success)';
  return 'var(--text-muted)';
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
  const setActiveId = useSessionStore((s) => s.setActiveId);
  const removeSession = useSessionStore((s) => s.removeSession);

  const [closing, setClosing] = useState(false);
  const [version, setVersion] = useState('');
  const [showFiles, setShowFiles] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const animateClose = useCallback(() => {
    setClosing(true);
    setShowFiles(false);
    setTimeout(() => {
      setClosing(false);
      closeSidePanel();
    }, 200);
  }, [closeSidePanel]);

  useEffect(() => {
    if (!isOpen) return;
    fetchVersion().then((v) => {
      if (v) setVersion(v);
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') animateClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, animateClose]);

  if (!isOpen) return null;

  const orderedSessions = tabOrder
    .map((id) => sessions.get(id))
    .filter((s): s is NonNullable<typeof s> => s != null);

  const activeSession = activeId ? sessions.get(activeId) : undefined;

  const selectSession = (id: string) => {
    setActiveId(id);
    animateClose();
  };

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Close this session?')) {
      deleteSession(id).catch(() => {});
      removeSession(id);
    }
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
        data-testid="side-panel"
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
            <div className={styles.sectionTitle}>Sessions</div>

            {/* Session list */}
            <div className={styles.list} data-testid="side-panel-list">
              {orderedSessions.map((session) => {
                const preview = getTerminalPreview(session.term);
                const activity = getActivityLabel(session.lastActivity);
                const git = session.git;

                return (
                  <div
                    key={session.id}
                    className={`${styles.card} ${session.id === activeId ? styles.cardActive : ''}`}
                    data-testid="side-panel-card"
                    onClick={() => selectSession(session.id)}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        if (confirm('Close this session?')) {
                          deleteSession(session.id).catch(() => {});
                          removeSession(session.id);
                        }
                      }
                    }}
                  >
                    {/* Card header: color dot, name, status, close */}
                    <div className={styles.cardHeader}>
                      <span className={styles.cardDot} style={{ backgroundColor: session.color }} />
                      <span className={styles.cardName}>{session.name}</span>
                      {session.id !== activeId && session.hasUnread && (
                        <span className={styles.unreadDot} />
                      )}
                      <span
                        className={styles.cardStatus}
                        style={{ backgroundColor: statusColor(session) }}
                        title={
                          session.exited
                            ? 'Exited'
                            : session.connected
                              ? 'Connected'
                              : 'Disconnected'
                        }
                      />
                      <button
                        className={styles.cardClose}
                        onClick={(e) => handleClose(e, session.id)}
                        title="Close session"
                      >
                        ×
                      </button>
                    </div>

                    {/* Meta: shell + cwd + activity */}
                    <div className={styles.cardMeta}>
                      {session.shell}
                      {session.cwd ? ` · ${truncatePath(session.cwd)}` : ''}
                      {activity ? ` · ${activity}` : ''}
                    </div>

                    {/* Git info badges */}
                    {git && (
                      <div className={styles.cardGit}>
                        <span className={styles.gitBadge}>
                          <BranchIcon /> {git.branch || 'detached'}
                        </span>
                        {git.provider && <span className={styles.gitBadge}>{git.provider}</span>}
                        {git.repoName && <span className={styles.gitBadge}>{git.repoName}</span>}
                        {git.status && (
                          <span
                            className={`${styles.gitBadge} ${git.status.clean ? styles.gitClean : styles.gitDirty}`}
                          >
                            {git.status.clean ? '✓ clean' : git.status.summary}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Terminal preview */}
                    {preview ? (
                      <div className={styles.cardPreview}>{preview}</div>
                    ) : (
                      <div className={`${styles.cardPreview} ${styles.cardPreviewEmpty}`}>
                        No output yet
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
                  className={styles.footerBtn}
                  onClick={() => {
                    openNewSessionModal();
                    animateClose();
                  }}
                >
                  + New Session
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
