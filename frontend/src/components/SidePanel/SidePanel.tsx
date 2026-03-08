import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import styles from './SidePanel.module.css';

function formatActivity(session: { connected: boolean; exited: boolean }): string {
  if (session.exited) return 'Exited';
  return session.connected ? 'Connected' : 'Disconnected';
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
  const panelRef = useRef<HTMLDivElement>(null);

  const animateClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      closeSidePanel();
    }, 200);
  }, [closeSidePanel]);

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

  const selectSession = (id: string) => {
    setActiveId(id);
    animateClose();
  };

  return (
    <>
      <div
        className={styles.backdrop}
        data-closing={closing}
        onClick={animateClose}
        aria-hidden="true"
      />
      <div className={styles.panel} data-closing={closing} ref={panelRef} role="dialog">
        <div className={styles.header}>
          <span className={styles.title}>Sessions</span>
          <button
            className={styles.closeBtn}
            onClick={animateClose}
            aria-label="Close side panel"
          >
            ✕
          </button>
        </div>

        <div className={styles.list}>
          {orderedSessions.map((session) => (
            <div
              key={session.id}
              className={`${styles.sessionCard} ${session.id === activeId ? styles.sessionCardActive : ''}`}
              onClick={() => selectSession(session.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  if (confirm('Close this session?')) removeSession(session.id);
                }
              }}
            >
              <span className={styles.sessionDot} style={{ backgroundColor: session.color }} />
              <div className={styles.sessionInfo}>
                <div className={styles.sessionName}>{session.name}</div>
                <div className={styles.sessionMeta}>
                  {session.shell} · {formatActivity(session)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <button
            className={styles.newBtn}
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
  );
}
