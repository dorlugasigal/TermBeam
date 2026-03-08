import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ManagedSession } from '@/stores/sessionStore';
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

function formatTabActivity(lastActivity: string | number): string {
  const ts = typeof lastActivity === 'number' ? lastActivity : new Date(lastActivity).getTime();
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
      onClick={onActivate}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          if (confirm('Close this session?')) onClose();
        }
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...attributes}
      {...listeners}
    >
      <span className={styles.colorDot} style={{ backgroundColor: session.color }} />
      <span className={styles.tabName}>{session.name}</span>
      {activity && <span className={styles.tabActivity}>{activity}</span>}
      <button
        className={styles.closeBtn}
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
