import { useEffect, useRef, useState } from 'react';
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
  const [bottomOffset, setBottomOffset] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // iOS scroll-to-focused-input can briefly shift the LAYOUT viewport even
  // though html/body have `overflow: hidden`, producing a visible "whole
  // window slides up then snaps back" flash. Pin window scroll to 0 whenever
  // the visual viewport reports a non-zero offsetTop (iOS's transient scroll
  // state).
  const pinScroll = () => {
    if (window.scrollY !== 0 || window.scrollX !== 0) {
      window.scrollTo(0, 0);
    }
    if (document.scrollingElement && document.scrollingElement.scrollTop !== 0) {
      document.scrollingElement.scrollTop = 0;
    }
  };

  // On iOS Safari, position:fixed stays pinned to the layout viewport even
  // when the software keyboard opens, so the composer ends up hidden behind
  // the keyboard. Track the visual viewport and anchor the composer's bottom
  // to the visual-viewport bottom (not the layout-viewport bottom).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      setBottomOffset(0);
      return;
    }
    const update = () => {
      pinScroll();
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setBottomOffset(offset);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // iOS fires the visualViewport `resize` event only after the keyboard has
  // finished animating in (200-400 ms). Without proactive re-measurement the
  // composer stays hidden behind the keyboard for that window. Schedule a
  // few extra updates as soon as the textarea gains focus.
  const handleFocus = () => {
    const vv = window.visualViewport;
    if (!vv) return;
    const tick = () => {
      pinScroll();
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setBottomOffset(offset);
    };
    tick();
    [16, 50, 150, 300, 500, 800].forEach((ms) => window.setTimeout(tick, ms));
  };

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
      style={{ bottom: `calc(8px + env(safe-area-inset-bottom, 0px) + ${bottomOffset}px)` }}
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
        onFocus={handleFocus}
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
