import { useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ManagedSession } from '@/stores/sessionStore';
import { CopilotLogo } from '@/components/common/CopilotLogo';
import dissolveStyles from '@/components/common/Disintegrate.module.css';
import styles from './TabBar.module.css';

interface SortableTabProps {
  session: ManagedSession;
  isActive: boolean;
  tabIndex?: number;
  isSplit?: boolean;
  /** When true, this tab is currently playing the disintegrate animation. */
  dissolving?: boolean;
  onActivate: () => void;
  onClose: () => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
}

const TAP_THRESHOLD = 5;

export function SortableTab({
  session,
  isActive,
  tabIndex,
  isSplit = false,
  dissolving = false,
  onActivate,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
    transition: { duration: 160, easing: 'cubic-bezier(.16, 1, .3, 1)' },
  });
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ? 'transform var(--dur-2) var(--ease-out)' : undefined,
    opacity: isDragging ? 0.5 : 1,
    ['--session-color' as string]: session.color || 'var(--accent)',
    // Snappier host fade for tabs (280 ms) — matches the 'tab' variant
    // in useDissolveDelete. Cards (Hub) keep the default 600 ms.
    ...(dissolving ? { ['--termbeam-fragment-ms' as string]: '280ms' } : null),
  };

  const linkState = session.exited ? 'exited' : session.connected ? 'connected' : 'disconnected';
  const linkLabel = session.exited ? 'Exited' : session.connected ? 'Connected' : 'Disconnected';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.tab} ${isActive ? styles.tabActive : ''} ${isSplit ? styles.tabSplit : ''} ${dissolving ? dissolveStyles.dissolving : ''}`}
      data-testid="session-tab"
      {...(isActive ? { 'data-active': 'true' } : {})}
      aria-hidden={dissolving || undefined}
      {...attributes}
      {...listeners}
      role="tab"
      id={`tab-${session.id}`}
      aria-controls={`terminal-${session.id}`}
      aria-selected={isActive}
      tabIndex={dissolving ? -1 : (tabIndex ?? (isActive ? 0 : -1))}
      title={session.name}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate();
        }
      }}
      onClick={(e) => {
        if (e.detail === 0) onActivate();
      }}
      onPointerDown={(e) => {
        pointerStart.current = { x: e.clientX, y: e.clientY };
        // Chain with dnd-kit's handler
        (listeners as Record<string, Function>)?.onPointerDown?.(e);
      }}
      onPointerUp={(e) => {
        if (pointerStart.current && e.button === 0) {
          const dx = Math.abs(e.clientX - pointerStart.current.x);
          const dy = Math.abs(e.clientY - pointerStart.current.y);
          if (dx < TAP_THRESHOLD && dy < TAP_THRESHOLD) onActivate();
        }
        pointerStart.current = null;
      }}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          if (confirm('Close this session?')) onClose();
        }
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* One mark carries identity (color) and link state (filled / ring) */}
      {session.type === 'copilot' ? (
        <span
          className={styles.copilotIcon}
          data-testid="tab-status-dot"
          data-state={linkState}
          title={`Copilot session · ${linkLabel}`}
        >
          <CopilotLogo size={12} />
        </span>
      ) : (
        <span
          className={styles.dot}
          data-testid="tab-status-dot"
          data-state={linkState}
          title={linkLabel}
        />
      )}
      <span
        className={styles.tabName}
        data-testid="tab-name"
        style={isActive ? { viewTransitionName: 'tb-session-name' } : undefined}
      >
        {session.name}
      </span>
      {!isActive && session.hasUnread && (
        <span className={styles.unreadDot} data-testid="tab-unread" title="New output" />
      )}
      <button
        className={styles.closeBtn}
        data-testid="tab-close"
        tabIndex={isActive ? 0 : -1}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${session.name}`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </svg>
      </button>
    </div>
  );
}
