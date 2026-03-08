import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import styles from './Overlays.module.css';

export default function SelectOverlay() {
  const active = useUIStore((s) => s.selectModeActive);
  const setSelectMode = useUIStore((s) => s.setSelectMode);
  const activeId = useSessionStore((s) => s.activeId);
  const sessions = useSessionStore((s) => s.sessions);

  const text = useMemo(() => {
    if (!active || !activeId) return '';
    const ms = sessions.get(activeId);
    if (!ms?.term) return '';
    const buffer = ms.term.buffer.active;
    const lines: string[] = [];
    const start = Math.max(0, buffer.length - 200);
    for (let i = start; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString() ?? '');
    }
    return lines.join('\n');
  }, [active, activeId, sessions]);

  const handleCopy = useCallback(async () => {
    const selection = window.getSelection()?.toString() ?? '';
    const content = selection || text;
    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      toast.success('Copied to clipboard');
    } catch {
      // Fallback for non-secure contexts
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      toast.success('Copied to clipboard');
    }
  }, [text]);

  const handleClose = useCallback(() => {
    setSelectMode(false);
    if (activeId) {
      const ms = useSessionStore.getState().sessions.get(activeId);
      ms?.term?.focus();
    }
  }, [setSelectMode, activeId]);

  if (!active) return null;

  return (
    <div className={styles.selectOverlay}>
      <div className={styles.selectHeader}>
        <span style={{ color: 'var(--text, #ccc)', fontSize: 14, fontWeight: 600 }}>
          Select &amp; Copy
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={styles.btnPrimary} onClick={handleCopy}>
            Copy
          </button>
          <button className={styles.btnSecondary} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
      <div className={styles.selectContent}>
        <pre className={styles.selectPre}>{text}</pre>
      </div>
    </div>
  );
}
