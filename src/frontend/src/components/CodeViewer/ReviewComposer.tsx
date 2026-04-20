import { useEffect, useRef, useState } from 'react';
import styles from './ReviewComposer.module.css';

interface ReviewComposerProps {
  file: string;
  startLine: number;
  endLine: number;
  onSave: (comment: string) => void;
  onCancel: () => void;
}

export default function ReviewComposer({
  file,
  startLine,
  endLine,
  onSave,
  onCancel,
}: ReviewComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    t.focus();
    try {
      t.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch {
      // ignore
    }
  }, []);

  const range = startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`;
  const trimmed = value.trim();

  function handleSubmit() {
    if (!trimmed) return;
    onSave(trimmed);
  }

  return (
    <div
      className={styles.composer}
      role="region"
      aria-label={`Add review comment for ${file} line ${range}`}
    >
      <div className={styles.header}>
        <span className={styles.headerLabel}>Comment on L{range}</span>
      </div>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What should the agent change?"
        maxLength={4096}
        enterKeyHint="send"
        autoCapitalize="sentences"
        autoCorrect="on"
        spellCheck
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
          }
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
  );
}
