import { useEffect, useRef, useState } from 'react';
import styles from './ReviewComposer.module.css';

interface ReviewComposerProps {
  file: string;
  startLine: number;
  endLine: number;
  selectedText: string;
  onSave: (comment: string) => void;
  onCancel: () => void;
}

export default function ReviewComposer({
  file,
  startLine,
  endLine,
  selectedText,
  onSave,
  onCancel,
}: ReviewComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const range = startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`;
  const trimmed = value.trim();

  function handleSubmit() {
    if (!trimmed) return;
    onSave(trimmed);
  }

  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Add review comment for ${file} line ${range}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.title}>
          Comment on {file}:{range}
        </div>
        <div className={styles.subtitle}>{selectedText}</div>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="What should the agent change?"
          maxLength={4096}
          enterKeyHint="send"
          autoCapitalize="sentences"
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={handleSubmit}
            disabled={!trimmed}
          >
            Add comment
          </button>
        </div>
      </div>
    </div>
  );
}
