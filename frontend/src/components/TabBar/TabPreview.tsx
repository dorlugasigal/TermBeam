import { useEffect, useRef, useState, useCallback } from 'react';
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
  const start = Math.max(0, buf.cursorY - count + 1);
  for (let i = start; i <= buf.cursorY; i++) {
    const line = buf.getLine(i);
    if (line) lines.push(line.translateToString(true));
  }
  return lines;
}

export function TabPreview({ session, anchorEl }: TabPreviewProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchRef = useRef(false);

  const show = useCallback(() => {
    if (isTouchRef.current) return;
    timerRef.current = setTimeout(() => setVisible(true), 300);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!anchorEl) return;

    const onTouch = () => {
      isTouchRef.current = true;
    };
    anchorEl.addEventListener('touchstart', onTouch, { passive: true });
    anchorEl.addEventListener('mouseenter', show);
    anchorEl.addEventListener('mouseleave', hide);

    return () => {
      anchorEl.removeEventListener('touchstart', onTouch);
      anchorEl.removeEventListener('mouseenter', show);
      anchorEl.removeEventListener('mouseleave', hide);
      hide();
    };
  }, [anchorEl, show, hide]);

  if (!visible) return null;

  const lines = getTerminalLines(session, 5);

  return (
    <div className={styles.preview}>
      {lines.length > 0 ? (
        <div className={styles.lines}>{lines.join('\n')}</div>
      ) : (
        <div className={styles.empty}>No output yet</div>
      )}
    </div>
  );
}
