import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ManagedSession } from '@/stores/sessionStore';
import styles from './TabPreview.module.css';

interface TabPreviewProps {
  session: ManagedSession;
  anchorEl: HTMLElement | null;
}

function getTerminalLines(session: ManagedSession, count: number): string[] {
  const term = session.term;
  if (!term) return [];
  const buf = term.buffer.active;
  const lines: string[] = [];
  const cursor = buf.baseY + buf.cursorY;
  const start = Math.max(0, cursor - count + 1);
  for (let i = start; i <= cursor; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines;
}

export function TabPreview({ session, anchorEl }: TabPreviewProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!anchorEl || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const timer = setTimeout(() => setVisible(true), 300);
    const hide = () => {
      clearTimeout(timer);
      setVisible(false);
    };
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchorEl]);

  if (!visible || !anchorEl) return null;

  const lines = getTerminalLines(session, 12);
  const rect = anchorEl.getBoundingClientRect();
  const width = Math.min(340, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));

  return createPortal(
    <div
      className={styles.preview}
      style={{ top: rect.bottom + 8, left, width }}
      aria-hidden="true"
    >
      <div className={styles.name}>{session.name}</div>
      {lines.length > 0 ? (
        <div className={styles.lines}>{lines.join('\n')}</div>
      ) : (
        <div className={styles.empty}>No output yet</div>
      )}
    </div>,
    document.body,
  );
}
