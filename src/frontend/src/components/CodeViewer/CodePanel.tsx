import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { usePinch } from '@use-gesture/react';
import type { GitBlame } from '@/services/api';
import BlameGutter from './BlameGutter';
import { detectLanguage, highlightToLines } from './highlight';
import styles from './CodePanel.module.css';

interface CodePanelProps {
  content: string;
  language: string;
  fileName: string;
  scrollTop?: number;
  onScroll?: (scrollTop: number) => void;
  blame?: GitBlame | null;
  blameEnabled?: boolean;
  blameLoading?: boolean;
}

function isBinary(content: string): boolean {
  return content.includes('\0');
}

export default function CodePanel({
  content,
  language,
  fileName,
  scrollTop,
  onScroll,
  blame,
  blameEnabled,
  blameLoading,
}: CodePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isRestoringScroll = useRef(false);

  const BASE_FONT_SIZE = 13;
  const MIN_FONT_SIZE = 9;
  const MAX_FONT_SIZE = 24;

  const [fontSize, setFontSize] = useState(BASE_FONT_SIZE);

  const clampFontSize = useCallback(
    (scale: number) =>
      Math.min(
        MAX_FONT_SIZE,
        Math.max(MIN_FONT_SIZE, Math.round(BASE_FONT_SIZE * scale * 10) / 10),
      ),
    [],
  );

  usePinch(
    ({ offset: [scale] }) => {
      setFontSize(clampFontSize(scale));
    },
    {
      target: containerRef,
      scaleBounds: { min: MIN_FONT_SIZE / BASE_FONT_SIZE, max: MAX_FONT_SIZE / BASE_FONT_SIZE },
      from: () => [fontSize / BASE_FONT_SIZE, 0],
      eventOptions: { passive: false },
    },
  );

  const resolvedLang = language || detectLanguage(fileName);

  // Highlight the whole file at once so multi-line tokens keep their context.
  const highlightedLines = useMemo(
    () => (!content || isBinary(content) ? [] : highlightToLines(content, resolvedLang)),
    [content, resolvedLang],
  );

  // Restore scroll position
  useEffect(() => {
    if (containerRef.current && scrollTop != null && scrollTop > 0) {
      isRestoringScroll.current = true;
      containerRef.current.scrollTop = scrollTop;
      requestAnimationFrame(() => {
        isRestoringScroll.current = false;
      });
    }
  }, [scrollTop, fileName]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onScroll) return;

    const handleScroll = () => {
      if (!isRestoringScroll.current) {
        onScroll(el.scrollTop);
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onScroll]);

  if (isBinary(content)) {
    return <div className={styles.empty}>Binary file — cannot display</div>;
  }

  if (!content) {
    return <div className={styles.empty}>Empty file</div>;
  }

  return (
    <div className={styles.wrapper}>
      {blameEnabled && blame && <BlameGutter blame={blame} />}
      {blameEnabled && blameLoading && !blame && (
        <div className={styles.blameLoading}>Loading blame…</div>
      )}
      <div
        className={styles.container}
        ref={containerRef}
        style={fontSize !== BASE_FONT_SIZE ? { fontSize: `${fontSize}px` } : undefined}
      >
        <div className={`${styles.table} tb-syntax`}>
          {highlightedLines.map((lineHtml, i) => (
            <div key={i} className={styles.row}>
              <span className={styles.lineNumber}>{i + 1}</span>
              <span
                className={styles.lineContent}
                dangerouslySetInnerHTML={{ __html: lineHtml || ' ' }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
