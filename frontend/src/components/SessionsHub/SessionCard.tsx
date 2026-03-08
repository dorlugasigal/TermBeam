import { useRef, useCallback, useEffect } from 'react';
import type { Session } from '@/types';
import styles from './SessionCard.module.css';

interface SessionCardProps {
  session: Session;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  revealedId: string | null;
  onRevealChange: (id: string | null) => void;
}

function formatActivity(lastActivity: string | number): string {
  const ts = typeof lastActivity === 'number' ? lastActivity : new Date(lastActivity).getTime();
  const diff = Date.now() - ts;
  if (diff < 10_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

const SWIPE_THRESHOLD = 50;
const REVEAL_WIDTH = 80;

const FolderIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

const ShellIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const UsersIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const GitBranchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const GitHubIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

const GitLabIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
  </svg>
);

function getProviderIcon(provider?: string) {
  if (!provider) return null;
  const lower = provider.toLowerCase();
  if (lower.includes('github')) return <GitHubIcon />;
  if (lower.includes('gitlab')) return <GitLabIcon />;
  return null;
}

export default function SessionCard({ session, onSelect, onDelete, revealedId, onRevealChange }: SessionCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const currentX = useRef(0);
  const isSwiping = useRef(false);
  const revealed = revealedId === session.id;

  const snapTo = useCallback((position: number) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transition = 'transform 0.25s ease';
    el.style.transform = `translateX(${position}px)`;
    currentX.current = position;
  }, []);

  // Snap back when another card is revealed
  useEffect(() => {
    if (!revealed) {
      snapTo(0);
    }
  }, [revealed, snapTo]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    isSwiping.current = false;

    const el = cardRef.current;
    if (el) {
      el.style.transition = 'none';
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX.current;
    const dy = touch.clientY - touchStartY.current;

    // Determine direction on first significant move
    if (!isSwiping.current && Math.abs(dx) > 5) {
      // If vertical scrolling dominates, bail out
      if (Math.abs(dy) > Math.abs(dx)) return;
      isSwiping.current = true;
    }

    if (!isSwiping.current) return;

    const el = cardRef.current;
    if (!el) return;

    // Calculate offset relative to current snap position
    const base = revealed ? -REVEAL_WIDTH : 0;
    let newX = base + dx;

    // Clamp: don't go past reveal width or past 0
    newX = Math.max(newX, -REVEAL_WIDTH);
    newX = Math.min(newX, 0);

    el.style.transform = `translateX(${newX}px)`;
  }, [revealed]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isSwiping.current) return;

    const touch = e.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartX.current;
    const base = revealed ? -REVEAL_WIDTH : 0;
    const finalX = base + dx;

    if (revealed) {
      // If swiped right enough, snap back closed
      if (dx > SWIPE_THRESHOLD) {
        onRevealChange(null);
        snapTo(0);
      } else {
        snapTo(-REVEAL_WIDTH);
      }
    } else {
      // If swiped left enough, reveal delete button
      if (finalX < -SWIPE_THRESHOLD) {
        onRevealChange(session.id);
        snapTo(-REVEAL_WIDTH);
      } else {
        snapTo(0);
      }
    }
  }, [revealed, session.id, onRevealChange, snapTo]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(session.id);
    onRevealChange(null);
  }, [session.id, onDelete, onRevealChange]);

  const shellName = session.shell.split('/').pop() ?? session.shell;
  const color = session.color ?? 'var(--success)';
  const git = session.git;
  const isClean = git?.status?.clean === true;

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.deleteBackground}
        onClick={handleDeleteClick}
        aria-label={`Delete session ${session.name}`}
        type="button"
      >
        <TrashIcon />
        Delete
      </button>
      <div
        ref={cardRef}
        className={styles.card}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Top row: dot + name + PID */}
        <div className={styles.topRow}>
          <div className={styles.nameGroup}>
            <span className={styles.colorDot} style={{ background: color }} />
            <span className={styles.name}>{session.name}</span>
          </div>
          <span className={styles.pidBadge}>PID {session.pid}</span>
        </div>

        {/* Details row */}
        <div className={styles.detailsRow}>
          <span className={styles.detailItem}>
            <FolderIcon /> {session.cwd}
          </span>
          <span className={styles.detailItem}>
            <ShellIcon /> {shellName}
          </span>
          <span className={styles.detailItem}>
            <UsersIcon /> {session.clients ?? 0} connected
          </span>
          <span className={styles.detailItem}>
            <ClockIcon /> {formatActivity(session.lastActivity)}
          </span>
        </div>

        {/* Git info */}
        {git && (
          <div className={styles.gitRow}>
            <span className={styles.gitBadge}>
              <GitBranchIcon /> {git.branch}
            </span>
            {git.provider && (
              <span className={styles.gitBadge}>
                {getProviderIcon(git.provider)} {git.provider}
              </span>
            )}
            {git.repoName && <span className={styles.gitBadge}>{git.repoName}</span>}
            {git.status != null && (
              <span className={`${styles.gitBadge} ${isClean ? styles.statusClean : styles.statusDirty}`}>
                {isClean ? '✓ clean' : git.status.summary}
              </span>
            )}
          </div>
        )}

        {/* Connect button */}
        <button
          className={styles.connectBtn}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(session.id);
          }}
        >
          Connect →
        </button>
      </div>
    </div>
  );
}
