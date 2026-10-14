import { useRef, useCallback, useEffect } from 'react';
import type { Session } from '@/types';
import { Breakable } from '@/components/common/Breakable';
import { CopilotLogo } from '@/components/common/CopilotLogo';
import { shellLabel } from '@/utils/sessionFilter';
import { activityAgo, tildePath } from '@/utils/sessionDisplay';
import styles from './SessionCard.module.css';
import dissolveStyles from '@/components/common/Disintegrate.module.css';

interface SessionCardProps {
  session: Session;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  revealedId: string | null;
  onRevealChange: (id: string | null) => void;
  /** Position in the list — drives the first-load stagger. */
  index?: number;
  /** Playing the delete animation; interaction is disabled. */
  dissolving?: boolean;
  /** This row's name morphs into the terminal tab on navigation. */
  morph?: boolean;
}

const SWIPE_THRESHOLD = 50;
const REVEAL_WIDTH = 84;

const TrashIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

export default function SessionCard({
  session,
  onSelect,
  onDelete,
  revealedId,
  onRevealChange,
  index = 0,
  dissolving = false,
  morph = false,
}: SessionCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);
  const revealed = revealedId === session.id;

  const snapTo = useCallback((position: number) => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transition = 'transform 280ms var(--ease-out)';
    el.style.transform = position ? `translateX(${position}px)` : '';
  }, []);

  useEffect(() => {
    if (!revealed) snapTo(0);
  }, [revealed, snapTo]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
    isSwiping.current = false;
    if (cardRef.current) cardRef.current.style.transition = 'none';
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - touchStartX.current;
      const dy = touch.clientY - touchStartY.current;
      if (!isSwiping.current && Math.abs(dx) > 5) {
        if (Math.abs(dy) > Math.abs(dx)) return;
        isSwiping.current = true;
      }
      if (!isSwiping.current || !cardRef.current) return;
      const base = revealed ? -REVEAL_WIDTH : 0;
      // Rubber-band past the action width instead of a hard stop
      let x = base + dx;
      if (x < -REVEAL_WIDTH) x = -REVEAL_WIDTH + (x + REVEAL_WIDTH) * 0.25;
      x = Math.min(x, 0);
      cardRef.current.style.transform = `translateX(${x}px)`;
    },
    [revealed],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!isSwiping.current) return;
      e.preventDefault(); // no click after a swipe
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - touchStartX.current;
      if (revealed) {
        if (dx > SWIPE_THRESHOLD) {
          onRevealChange(null);
          snapTo(0);
        } else {
          snapTo(-REVEAL_WIDTH);
        }
      } else if (dx < -SWIPE_THRESHOLD) {
        onRevealChange(session.id);
        snapTo(-REVEAL_WIDTH);
      } else {
        snapTo(0);
      }
    },
    [revealed, session.id, onRevealChange, snapTo],
  );

  const handleDeleteClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(session.id);
      onRevealChange(null);
    },
    [session.id, onDelete, onRevealChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (dissolving || e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(session.id);
      }
    },
    [dissolving, onSelect, session.id],
  );

  const isCopilot = session.type === 'copilot';
  const color = session.color ?? (isCopilot ? 'var(--accent)' : 'var(--ok)');
  const ago = activityAgo(session.lastActivity);
  const activityTs =
    typeof session.lastActivity === 'number'
      ? session.lastActivity
      : Date.parse(session.lastActivity ?? '');
  const viewers = session.clients ?? 0;

  return (
    <div
      className={styles.slot}
      data-session-id={session.id}
      data-dissolving={dissolving || undefined}
      style={{ ['--stagger-i' as string]: Math.min(index, 8) }}
      role="listitem"
    >
      <div
        className={`${styles.wrapper} ${dissolving ? dissolveStyles.dissolving : ''}`}
        aria-hidden={dissolving || undefined}
      >
        <button
          className={styles.swipeAction}
          onClick={handleDeleteClick}
          aria-label={`Delete session ${session.name}`}
          type="button"
          tabIndex={revealed ? 0 : -1}
          disabled={dissolving}
        >
          <TrashIcon />
          <span>Delete</span>
        </button>
        <div
          ref={cardRef}
          className={styles.row}
          style={{ ['--session-color' as string]: color }}
          data-testid="session-card"
          data-revealed={revealed || undefined}
          role="button"
          tabIndex={dissolving ? -1 : 0}
          aria-label={`${session.name}, ${tildePath(session.cwd)}. ${ago.long}`}
          onClick={() => {
            if (dissolving) return;
            if (revealed) {
              onRevealChange(null);
              return;
            }
            onSelect(session.id);
          }}
          onKeyDown={handleKeyDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <span className={styles.marker} data-recent={ago.recent || undefined} aria-hidden="true">
            {isCopilot ? <CopilotLogo size={13} /> : <i className={styles.dot} />}
          </span>

          <div className={styles.head}>
            <span
              className={styles.name}
              data-testid="session-name"
              style={morph ? { viewTransitionName: 'tb-session-name' } : undefined}
            >
              {session.name}
            </span>
            <time
              className={styles.time}
              data-recent={ago.recent || undefined}
              dateTime={
                Number.isFinite(activityTs) ? new Date(activityTs).toISOString() : undefined
              }
              title={ago.long}
            >
              {ago.short}
            </time>
            <button
              type="button"
              className={styles.hoverDelete}
              onClick={handleDeleteClick}
              aria-label={`Delete session ${session.name}`}
              title="Delete session"
              disabled={dissolving}
            >
              <TrashIcon />
            </button>
          </div>

          <div className={styles.details}>
            {session.cwd && (
              <div className={styles.path} title={session.cwd}>
                <Breakable text={tildePath(session.cwd)} />
              </div>
            )}

            <div className={styles.meta}>
              {isCopilot ? (
                <>
                  <span data-testid="session-shell">Copilot</span>
                  {session.model && <span data-testid="session-type-badge">{session.model}</span>}
                </>
              ) : (
                <>
                  <span data-testid="session-shell">{shellLabel(session) || session.shell}</span>
                  <span data-testid="session-pid">pid {session.pid}</span>
                </>
              )}
              {viewers > 0 && (
                <span className={styles.viewers}>
                  {viewers} {viewers === 1 ? 'viewer' : 'viewers'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
