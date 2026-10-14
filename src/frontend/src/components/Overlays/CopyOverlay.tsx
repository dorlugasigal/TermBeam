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
  const overlayRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const totalLines = useMemo(() => {
    if (!open || !activeId) return 0;
    const ms = sessions.get(activeId);
    if (!ms?.term) return 0;
    return ms.term.buffer.active.length;
  }, [open, activeId, sessions]);

  const [loadedFrom, setLoadedFrom] = useState(Math.max(0, totalLines - PAGE_SIZE));

  // Reset loadedFrom when overlay opens or session changes
  useEffect(() => {
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
      lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
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

  const [hasSelection, setHasSelection] = useState(false);
  const savedSelectionRef = useRef('');

  // Track whether the user has selected text within the overlay
  useEffect(() => {
    if (!open) {
      savedSelectionRef.current = '';
      setHasSelection(false);
      return;
    }
    const onSelectionChange = () => {
      const sel = window.getSelection()?.toString() ?? '';
      if (sel.length > 0) savedSelectionRef.current = sel;
      setHasSelection(sel.length > 0);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [open]);

  const handleCopy = useCallback(async () => {
    const content = savedSelectionRef.current || text;
    if (!content) return;

    const isSelection = !!savedSelectionRef.current;
    try {
      await navigator.clipboard.writeText(content);
      toast.success(isSelection ? 'Selection copied' : 'All text copied');
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
      toast.success(isSelection ? 'Selection copied' : 'All text copied');
    }
  }, [text]);

  const handleClose = useCallback(() => {
    closeCopyOverlay();
  }, [closeCopyOverlay]);

  // Modal behaviour: the rest of the terminal UI is inert while this is open,
  // focus starts on the primary action and stays inside, and it returns to
  // the terminal only after the background is interactive again (focusing an
  // inert element silently fails).
  useEffect(() => {
    if (!open) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const background = Array.from(overlay.parentElement?.children ?? []).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== overlay && !el.inert,
    );
    for (const el of background) el.inert = true;
    primaryRef.current?.focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Another dialog stacked on top (e.g. the Unlock sheet after a session
      // expires) owns the keyboard: leave its focus trap and Escape alone.
      const active = document.activeElement;
      const dialog = active?.closest('[role="dialog"], [role="alertdialog"]');
      if (dialog && dialog !== overlay) return;
      if (e.key === 'Escape') {
        closeCopyOverlay();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = overlay.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [tabindex="0"]',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!overlay.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey ? active === first : active === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      for (const el of background) el.inert = false;
      const { activeId: id, sessions: all } = useSessionStore.getState();
      if (id) all.get(id)?.term?.focus();
    };
  }, [open, closeCopyOverlay]);

  if (!open) return null;

  const title =
    loadedLines < totalLines
      ? `Copy Text (${loadedLines}/${totalLines} lines)`
      : `Copy Text (${totalLines} lines)`;

  return (
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-testid="select-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Copy Text"
    >
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <div className={styles.actions}>
          <button ref={primaryRef} className={styles.btnPrimary} onClick={handleCopy}>
            {hasSelection ? 'Copy Selection' : 'Copy All'}
          </button>
          <button className={styles.btnSecondary} onClick={handleClose} data-testid="select-close">
            Done
          </button>
        </div>
      </div>
      <div
        className={styles.content}
        ref={contentRef}
        data-testid="select-content"
        tabIndex={0}
        aria-label="Terminal text"
      >
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
