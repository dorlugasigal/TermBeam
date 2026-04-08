import { useRef } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ManagedSession } from '@/stores/sessionStore';
import { CopilotLogo } from '@/components/common/CopilotLogo';
import styles from './TabBar.module.css';

interface SortableTabProps {
  session: ManagedSession;
  isActive: boolean;
  isSplit?: boolean;
  onActivate: () => void;
  onClose: () => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
}

const TAP_THRESHOLD = 5;

function formatTabActivity(lastActivity: string | number): string {
  if (!lastActivity) return '';
  const ts = typeof lastActivity === 'number' ? lastActivity : new Date(lastActivity).getTime();
  if (isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function SortableTab({
  session,
  isActive,
  isSplit = false,
  onActivate,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const activity = formatTabActivity(session.lastActivity);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.tab} ${isActive ? styles.tabActive : ''} ${isSplit ? styles.tabSplit : ''}`}
      data-testid="session-tab"
      {...(isActive ? { 'data-active': 'true' } : {})}
      {...attributes}
      {...listeners}
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
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          if (confirm('Close this session?')) onClose();
        }
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {session.type === 'copilot' ? (
        <span className={styles.copilotIcon} aria-label="Copilot session">
          <CopilotLogo size={12} />
        </span>
      ) : (
        <span className={styles.colorDot} style={{ backgroundColor: session.color }} />
      )}
      <span className={styles.tabName} data-testid="tab-name">
        {session.name}
      </span>
      {!isActive && session.hasUnread && (
        <span className={styles.unreadDot} data-testid="tab-unread" />
      )}
      {activity && <span className={styles.tabActivity}>{activity}</span>}
      <span
        className={styles.statusDot}
        data-testid="tab-status-dot"
        style={{
          background: session.exited
            ? 'var(--danger)'
            : session.connected
              ? 'var(--success)'
              : 'var(--text-muted)',
        }}
      />
      <button
        className={styles.closeBtn}
        data-testid="tab-close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`Close ${session.name}`}
      >
        ×
      </button>
    </div>
  );
}
