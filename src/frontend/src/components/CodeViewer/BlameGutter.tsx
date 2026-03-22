import { useState, useMemo, useCallback } from 'react';
import type { GitBlame } from '@/services/api';
import styles from './BlameGutter.module.css';

interface BlameGutterProps {
  blame: GitBlame;
}

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 1) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

function shortAuthor(author: string): string {
  if (!author) return '';
  // If email-like, take part before @
  if (author.includes('@')) return author.split('@')[0] ?? author;
  // Abbreviate long names
  const parts = author.split(' ');
  if (parts.length > 1 && author.length > 12) {
    const last = parts[parts.length - 1];
    return `${parts[0]} ${last ? last.charAt(0) : ''}.`;
  }
  return author;
}

interface GroupedLine {
  isFirst: boolean;
  commit: string | null;
  author: string;
  date: string | null;
  summary: string;
  groupIndex: number;
}

export default function BlameGutter({ blame }: BlameGutterProps) {
  const [hoveredCommit, setHoveredCommit] = useState<string | null>(null);

  const grouped = useMemo((): GroupedLine[] => {
    let groupIdx = 0;
    return blame.lines.map((line, i) => {
      const prev = i > 0 ? blame.lines[i - 1] : null;
      const isFirst = !prev || prev.commit !== line.commit;
      if (isFirst && i > 0) groupIdx++;
      return {
        isFirst,
        commit: line.commit,
        author: line.author,
        date: line.date,
        summary: line.summary,
        groupIndex: groupIdx,
      };
    });
  }, [blame.lines]);

  const handleMouseEnter = useCallback((commit: string | null) => {
    setHoveredCommit(commit);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredCommit(null);
  }, []);

  return (
    <div className={styles.gutter} role="complementary" aria-label="Git blame annotations">
      {grouped.map((line, i) => {
        const lineClass = line.groupIndex % 2 === 0 ? styles.lineEven : styles.lineOdd;
        const isUncommitted = !line.commit || line.commit === '0000000';

        return (
          <div
            key={i}
            className={lineClass}
            onMouseEnter={() => handleMouseEnter(line.commit)}
            onMouseLeave={handleMouseLeave}
          >
            {line.isFirst ? (
              <div className={styles.annotation}>
                {isUncommitted ? (
                  <span className={styles.uncommitted}>Not Committed Yet</span>
                ) : (
                  <>
                    <span className={styles.hash} title={line.summary}>
                      {line.commit?.slice(0, 7)}
                    </span>
                    <span className={styles.author} title={line.author}>
                      {shortAuthor(line.author)}
                    </span>
                    <span className={styles.date}>{relativeDate(line.date)}</span>
                  </>
                )}
                {hoveredCommit === line.commit && line.commit && !isUncommitted && (
                  <div className={styles.tooltip}>
                    <div className={styles.tooltipHash}>{line.commit?.slice(0, 10)}</div>
                    <div className={styles.tooltipSubject}>{line.summary}</div>
                    <div className={styles.tooltipMeta}>
                      {line.author} · {relativeDate(line.date)}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.spacer} />
            )}
          </div>
        );
      })}
    </div>
  );
}
