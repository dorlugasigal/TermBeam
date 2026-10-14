import type { GitPart } from '@/utils/sessionDisplay';
import styles from './GitStatusLine.module.css';

/**
 * Working-tree state in words: "3 staged · 85 modified · ↑2". The count carries
 * the color, the label stays quiet — legible on every theme without chips.
 */
export function GitStatusLine({ parts, className }: { parts: GitPart[]; className?: string }) {
  if (parts.length === 0) return null;
  return (
    <span className={`${styles.line} ${className ?? ''}`}>
      {parts.map((part, i) => (
        <span key={`${part.tone}-${i}`} className={styles.part} data-tone={part.tone}>
          {part.tone === 'clean' && (
            <svg
              className={styles.check}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          )}
          {part.count !== null && <b className={styles.count}>{part.count}</b>}
          {part.label}
        </span>
      ))}
    </span>
  );
}

export default GitStatusLine;
