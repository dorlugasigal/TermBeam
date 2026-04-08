import { useMemo, useState } from 'react';
import styles from './DiffViewer.module.css';

// ── Types ──

interface DiffViewerProps {
  diff: string;
  filePath?: string;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

const MAX_VISIBLE_LINES = 20;

// ── Parser ──

function parseDiff(diffText: string): DiffHunk[] {
  const lines = diffText.split('\n');
  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue;
    }

    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(.*)/);
    if (hunkMatch) {
      currentHunk = { header: line, lines: [] };
      hunks.push(currentHunk);
      oldLine = parseInt(hunkMatch[1]!, 10);
      newLine = parseInt(hunkMatch[2]!, 10);
      continue;
    }

    if (!currentHunk) continue;

    if (line.startsWith('-')) {
      currentHunk.lines.push({ type: 'remove', content: line.slice(1), oldLineNum: oldLine });
      oldLine++;
    } else if (line.startsWith('+')) {
      currentHunk.lines.push({ type: 'add', content: line.slice(1), newLineNum: newLine });
      newLine++;
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      currentHunk.lines.push({
        type: 'context',
        content,
        oldLineNum: oldLine,
        newLineNum: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return hunks;
}

// ── Component ──

export function DiffViewer({ diff }: DiffViewerProps) {
  const hunks = useMemo(() => parseDiff(diff), [diff]);
  const totalLines = useMemo(() => hunks.reduce((s, h) => s + h.lines.length, 0), [hunks]);
  const [showAll, setShowAll] = useState(false);

  if (hunks.length === 0) {
    return (
      <pre className={styles.rawDiff}>
        <code>{diff}</code>
      </pre>
    );
  }

  const needsTruncation = totalLines > MAX_VISIBLE_LINES && !showAll;
  let linesRendered = 0;

  return (
    <div className={styles.diffContainer}>
      {hunks.map((hunk, i) => {
        if (needsTruncation && linesRendered >= MAX_VISIBLE_LINES) return null;

        const remaining = MAX_VISIBLE_LINES - linesRendered;
        const linesToShow = needsTruncation ? hunk.lines.slice(0, remaining) : hunk.lines;
        linesRendered += linesToShow.length;

        return (
          <div key={i}>
            <div className={styles.hunkHeader}>{hunk.header}</div>
            <table className={styles.diffTable}>
              <colgroup>
                <col className={styles.colNum} />
                <col className={styles.colNum} />
                <col className={styles.colContent} />
              </colgroup>
              <tbody>
                {linesToShow.map((line, j) => {
                  const isAdd = line.type === 'add';
                  const isDel = line.type === 'remove';
                  const numClass = isAdd
                    ? `${styles.lineNum} ${styles.lineNumAdd}`
                    : isDel
                      ? `${styles.lineNum} ${styles.lineNumDel}`
                      : styles.lineNum;
                  const contentClass = isAdd
                    ? `${styles.lineContent} ${styles.lineContentAdd}`
                    : isDel
                      ? `${styles.lineContent} ${styles.lineContentDel}`
                      : styles.lineContent;

                  return (
                    <tr key={j}>
                      <td className={numClass}>{!isAdd ? line.oldLineNum : ''}</td>
                      <td className={numClass}>{!isDel ? line.newLineNum : ''}</td>
                      <td className={contentClass}>
                        <div className={styles.lineContentInner}>
                          <span className={styles.lineMarker}>
                            {isAdd ? '+' : isDel ? '-' : ''}
                          </span>
                          <span className={styles.lineText}>{line.content}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      {needsTruncation && (
        <button className={styles.showAllBtn} onClick={() => setShowAll(true)}>
          <span>Show all {totalLines} lines</span>
          <span className={styles.showAllArrow}>↓</span>
        </button>
      )}
    </div>
  );
}
