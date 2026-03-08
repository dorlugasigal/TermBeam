import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import styles from './CopyOverlay.module.css';

const PAGE_SIZE = 200;

export default function CopyOverlay() {
  const open = useUIStore((s) => s.copyOverlayOpen);
  const closeCopyOverlay = useUIStore((s) => s.closeCopyOverlay);
  const activeId = useSessionStore((s) => s.activeId);
  const sessions = useSessionStore((s) => s.sessions);
  const contentRef = useRef<HTMLDivElement>(null);

  const totalLines = useMemo(() => {
    if (!open || !activeId) return 0;
    const ms = sessions.get(activeId);
    if (!ms?.term) return 0;
    return ms.term.buffer.active.length;
  }, [open, activeId, sessions]);

  const [loadedFrom, setLoadedFrom] = useState(Math.max(0, totalLines - PAGE_SIZE));

  // Reset loadedFrom when overlay opens or session changes
  useMemo(() => {
    setLoadedFrom(Math.max(0, totalLines - PAGE_SIZE));
  }, [open, activeId, totalLines]);

  // Auto-scroll to bottom on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        const el = contentRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [open]);

  const text = useMemo(() => {
    if (!open || !activeId) return '';
    const ms = sessions.get(activeId);
    if (!ms?.term) return '';
    const buffer = ms.term.buffer.active;
    const lines: string[] = [];
    for (let i = loadedFrom; i < buffer.length; i++) {
      lines.push(buffer.getLine(i)?.translateToString() ?? '');
    }
    return lines.join('\n');
  }, [open, activeId, sessions, loadedFrom]);

  const loadedLines = totalLines - loadedFrom;
  const linesAbove = loadedFrom;

  const handleLoadMore = useCallback(() => {
    const el = contentRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    setLoadedFrom((prev) => Math.max(0, prev - PAGE_SIZE));
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
    closeCopyOverlay();
    if (activeId) {
      const ms = useSessionStore.getState().sessions.get(activeId);
      ms?.term?.focus();
    }
  }, [closeCopyOverlay, activeId]);

  if (!open) return null;

  const title =
    loadedLines < totalLines
      ? `Copy Text (${loadedLines}/${totalLines} lines)`
      : `Copy Text (${totalLines} lines)`;

  return (
    <div className={styles.overlay}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={handleCopy}>
            Copy
          </button>
          <button className={styles.btnSecondary} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
      <div className={styles.content} ref={contentRef}>
        {linesAbove > 0 && (
          <button className={styles.loadMoreBtn} onClick={handleLoadMore}>
            ▲ Load more ({linesAbove} lines above)
          </button>
        )}
        <pre className={styles.pre}>{text}</pre>
      </div>
    </div>
  );
}
