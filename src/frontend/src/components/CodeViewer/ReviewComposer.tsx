import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    try {
      t.focus({ preventScroll: true });
    } catch {
      t.focus();
    }
  }, []);

  // On iOS Safari, position:fixed stays pinned to the layout viewport even
  // when the software keyboard opens, so the composer ends up hidden behind
  // the keyboard. Track the visual viewport and raise the composer by the
  // keyboard's height.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardOffset(offset);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  const range = startLine === endLine ? `${startLine}` : `${startLine}–${endLine}`;
  const trimmed = value.trim();

  function handleSubmit() {
    if (!trimmed) return;
    onSave(trimmed);
  }

  return createPortal(
    <div
      className={styles.composer}
      role="region"
      aria-label={`Add review comment for ${file} line ${range}`}
      style={{ transform: keyboardOffset ? `translateY(-${keyboardOffset}px)` : undefined }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        <span className={styles.headerLabel}>
          {file}:L{range}
        </span>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onCancel}
          aria-label="Close composer"
        >
          ✕
        </button>
      </div>
      <textarea
        ref={textareaRef}
        className={styles.textarea}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onTouchStart={(e) => {
          // iOS: focus inside the user gesture so the virtual keyboard opens.
          e.stopPropagation();
          textareaRef.current?.focus();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
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
    </div>,
    document.body,
  );
}
