import { useRef } from 'react';
import { useDrag } from '@use-gesture/react';
import type { Session } from '@/types';
import styles from './SessionCard.module.css';

interface SessionCardProps {
  session: Session;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function formatActivity(lastActivity: string): string {
  const diff = Date.now() - new Date(lastActivity).getTime();
  if (diff < 10_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(lastActivity).toLocaleDateString();
}

const SWIPE_THRESHOLD = 50;

export default function SessionCard({ session, onSelect, onDelete }: SessionCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const offsetX = useRef(0);

  const bind = useDrag(
    ({ movement: [mx], down, cancel }) => {
      if (mx > 0) {
        cancel();
        return;
      }

      const el = cardRef.current;
      if (!el) return;

      if (down) {
        offsetX.current = mx;
        el.style.transform = `translateX(${mx}px)`;
        el.style.transition = 'none';
      } else {
        el.style.transition = 'transform 0.25s ease';
        if (Math.abs(mx) > SWIPE_THRESHOLD) {
          el.style.transform = `translateX(-80px)`;
          setTimeout(() => onDelete(session.id), 200);
        } else {
          el.style.transform = 'translateX(0)';
        }
        offsetX.current = 0;
      }
    },
    { axis: 'x', filterTaps: true },
  );

  const shellName = session.shell.split('/').pop() ?? session.shell;
  const color = session.color ?? '#6ec1e4';

  return (
    <div className={styles.wrapper}>
      <div className={styles.deleteBackground}>Delete</div>
      <div
        ref={cardRef}
        className={styles.card}
        onClick={() => onSelect(session.id)}
        {...bind()}
      >
        <span className={styles.colorDot} style={{ background: color }} />
        <div className={styles.info}>
          <div className={styles.nameRow}>
            <span className={styles.name}>{session.name}</span>
          </div>
          <span className={styles.meta}>
            {shellName} · PID {session.pid} · {session.cwd}
          </span>
        </div>
        <span className={styles.activity}>{formatActivity(session.lastActivity)}</span>
        <button
          className={styles.deleteBtn}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(session.id);
          }}
          aria-label="Delete session"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
