import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import styles from './Overlays.module.css';

interface PasteOverlayProps {
  open: boolean;
  onClose: () => void;
}

export default function PasteOverlay({ open, onClose }: PasteOverlayProps) {
  const [text, setText] = useState('');
  const [showManual, setShowManual] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setShowManual(false);
      return;
    }

    if (!navigator.clipboard?.readText) {
      setShowManual(true);
      return;
    }
    let cancelled = false;
    navigator.clipboard
      .readText()
      .then((clipText) => {
        if (cancelled) return;
        if (clipText) {
          const { sessions, activeId } = useSessionStore.getState();
          if (activeId) {
            const ms = sessions.get(activeId);
            if (ms?.send) ms.send(clipText);
          }
          onClose();
        } else {
          // Empty clipboard — show manual fallback
          setShowManual(true);
        }
      })
      .catch(() => {
        // Clipboard access denied — show manual fallback
        if (!cancelled) setShowManual(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (showManual) {
      const frame = requestAnimationFrame(() => textareaRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [showManual]);

  const handleSend = useCallback(() => {
    if (!text) return;
    const { sessions, activeId } = useSessionStore.getState();
    if (!activeId) return;
    const ms = sessions.get(activeId);
    if (ms?.send) {
      ms.send(text);
    }
    onClose();
  }, [text, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  if (!open || !showManual) return null;

  return (
    <div className={styles.overlay} onClick={onClose} data-testid="paste-overlay">
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Paste your text here"
      >
        <h3 className={styles.heading}>Paste your text here</h3>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste content…"
          aria-label="Paste content"
          data-testid="paste-input"
        />
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={onClose} data-testid="paste-cancel">
            Cancel
          </button>
          <button className={styles.btnPrimary} onClick={handleSend} data-testid="paste-send">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
