import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import styles from './Overlays.module.css';

const PAGE_SIZE = 200;

export default function SelectOverlay() {
  const active = useUIStore((s) => s.selectModeActive);
  const setSelectMode = useUIStore((s) => s.setSelectMode);
  const activeId = useSessionStore((s) => s.activeId);
  const sessions = useSessionStore((s) => s.sessions);
  const contentRef = useRef<HTMLDivElement>(null);

  const totalLines = useMemo(() => {
    if (!active || !activeId) return 0;
    const ms = sessions.get(activeId);
    if (!ms?.term) return 0;
    return ms.term.buffer.active.length;
  }, [active, activeId, sessions]);

  const [loadedFrom, setLoadedFrom] = useState(Math.max(0, totalLines - PAGE_SIZE));

  // Reset loadedFrom when overlay opens or session changes
  useEffect(() => {
    setLoadedFrom(Math.max(0, totalLines - PAGE_SIZE));
  }, [active, activeId, totalLines]);

  const text = useMemo(() => {
    if (!active || !activeId) return '';
    const ms = sessions.get(activeId);
    if (!ms?.term) return '';
    const buffer = ms.term.buffer.active;
    const lines: string[] = [];
    for (let i = loadedFrom; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
    return lines.join('\n');
  }, [active, activeId, sessions, loadedFrom]);

  const loadedLines = totalLines - loadedFrom;
  const linesAbove = loadedFrom;

  const handleLoadMore = useCallback(() => {
    const el = contentRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    setLoadedFrom((prev) => Math.max(0, prev - PAGE_SIZE));
    // Preserve scroll position after loading more
    requestAnimationFrame(() => {
      if (el) {
        const newScrollHeight = el.scrollHeight;
        el.scrollTop += newScrollHeight - prevScrollHeight;
      }
    });
  }, []);

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

  const title =
    loadedLines < totalLines
      ? `Copy Text (${loadedLines}/${totalLines} lines)`
      : `Copy Text (${totalLines} lines)`;

  return (
    <div className={styles.selectOverlay} data-testid="select-overlay">
      <div className={styles.selectHeader}>
        <span style={{ color: 'var(--text, #ccc)', fontSize: 14, fontWeight: 600 }}>
          {title}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={styles.btnPrimary} onClick={handleCopy}>
            Copy
          </button>
          <button className={styles.btnSecondary} onClick={handleClose} data-testid="select-close">
            Done
          </button>
        </div>
      </div>
      <div className={styles.selectContent} ref={contentRef} data-testid="select-content">
        {linesAbove > 0 && (
          <button className={styles.loadMoreBtn} onClick={handleLoadMore}>
            ▲ Load more ({linesAbove} lines above)
          </button>
        )}
        <pre className={styles.selectPre}>{text}</pre>
      </div>
    </div>
  );
}
