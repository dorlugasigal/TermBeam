import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import styles from './Overlays.module.css';

interface PasteOverlayProps {
  open: boolean;
  onClose: () => void;
}

export default function PasteOverlay({ open, onClose }: PasteOverlayProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  const handleSend = useCallback(() => {
    if (!text) return;
    const { sessions, activeId } = useSessionStore.getState();
    if (!activeId) return;
    const ms = sessions.get(activeId);
    if (ms?.ws?.readyState === WebSocket.OPEN) {
      ms.ws.send(JSON.stringify({ type: 'input', data: text }));
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

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.heading}>Paste your text here</h3>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste content…"
        />
        <div className={styles.actions}>
          <button className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.btnPrimary} onClick={handleSend}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
