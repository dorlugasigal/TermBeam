import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ManagedSession } from '@/stores/sessionStore';
import styles from './TabBar.module.css';

interface SortableTabProps {
  session: ManagedSession;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
}

export function SortableTab({
  session,
  isActive,
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
      onClick={onActivate}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...attributes}
      {...listeners}
    >
      <span className={styles.colorDot} style={{ backgroundColor: session.color }} />
      <span className={styles.tabName}>{session.name}</span>
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
