import { useCallback, useEffect, useMemo, useState, useId } from 'react';
import { useCodeViewerStore } from '@/stores/codeViewerStore';
import { useReviewCommentsStore } from '@/stores/reviewCommentsStore';
import { fetchGitDiff } from '@/services/api';
import type { GitDiff, DiffLine } from '@/services/api';
import type { ReviewLineKind } from '@/utils/formatReviewComments';
import ReviewComposer from './ReviewComposer';
import ReviewCommentsPanel from './ReviewCommentsPanel';
import styles from './DiffViewer.module.css';

interface DiffViewerProps {
  sessionId: string;
  diff: GitDiff;
}

interface PendingSelection {
  hunkIndex: number;
  startIdx: number;
  endIdx: number;
}

function lineNumberFor(line: DiffLine): number | null {
  return line.type === 'remove' ? line.oldLine : (line.newLine ?? line.oldLine);
}

export default function DiffViewer({ sessionId, diff }: DiffViewerProps) {
  const { setGitDiff } = useCodeViewerStore();
  const [staged, setStaged] = useState(false);
  const [fullFile, setFullFile] = useState(false);
  const [loading, setLoading] = useState(false);

  const reviewMode = useReviewCommentsStore(
    (s) => s.reviewModeEnabled.get(sessionId) ?? false,
  );
  const setReviewMode = useReviewCommentsStore((s) => s.setReviewMode);
  const load = useReviewCommentsStore((s) => s.load);
  const addComment = useReviewCommentsStore((s) => s.addComment);
  const allComments = useReviewCommentsStore((s) => s.bySession.get(sessionId));
  const fileComments = useMemo(
    () => (allComments ?? []).filter((c) => c.file === diff.file),
    [allComments, diff.file],
  );
  const totalComments = allComments?.length ?? 0;

  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    load(sessionId);
  }, [sessionId, load]);

  // Clear pending selection when review mode turns off or file changes.
  useEffect(() => {
    setPending(null);
  }, [reviewMode, diff.file]);

  const commentedLines = useMemo(() => {
    const set = new Set<number>();
    for (const c of fileComments) {
      for (let n = c.startLine; n <= c.endLine; n++) set.add(n);
    }
    return set;
  }, [fileComments]);

  const reloadDiff = useCallback(
    async (newStaged: boolean, showFullFile: boolean) => {
      setLoading(true);
      try {
        const context = showFullFile ? 99999 : undefined;
        const newDiff = await fetchGitDiff(sessionId, diff.file, newStaged, false, context);
        setGitDiff(newDiff);
      } catch {
        // keep current diff on error
      } finally {
        setLoading(false);
      }
    },
    [sessionId, diff.file, setGitDiff],
  );

  const handleStagedToggle = useCallback(async () => {
    const newStaged = !staged;
    setStaged(newStaged);
    await reloadDiff(newStaged, fullFile);
  }, [staged, fullFile, reloadDiff]);

  const handleFullFileToggle = useCallback(async () => {
    const newFullFile = !fullFile;
    setFullFile(newFullFile);
    await reloadDiff(staged, newFullFile);
  }, [staged, fullFile, reloadDiff]);

  const handleReviewToggle = useCallback(() => {
    setReviewMode(sessionId, !reviewMode);
  }, [sessionId, reviewMode, setReviewMode]);

  const handleRowClick = useCallback(
    (hunkIndex: number, lineIdx: number) => {
      if (!reviewMode) return;
      if (!pending || pending.hunkIndex !== hunkIndex) {
        setPending({ hunkIndex, startIdx: lineIdx, endIdx: lineIdx });
        return;
      }
      const lo = Math.min(pending.startIdx, lineIdx);
      const hi = Math.max(pending.startIdx, lineIdx);
      setPending({ hunkIndex, startIdx: lo, endIdx: hi });
    },
    [reviewMode, pending],
  );

  const pendingInfo = useMemo(() => {
    if (!pending) return null;
    const hunk = diff.hunks[pending.hunkIndex];
    if (!hunk) return null;
    const lines = hunk.lines.slice(pending.startIdx, pending.endIdx + 1);
    const nums = lines.map(lineNumberFor).filter((n): n is number => n !== null);
    if (nums.length === 0) return null;
    const startLine = Math.min(...nums);
    const endLine = Math.max(...nums);
    // If mix of add/remove, prefer 'add' (the new state is what the agent should act on).
    const kinds = new Set(lines.map((l) => l.type));
    const kind: ReviewLineKind = kinds.has('add')
      ? 'add'
      : kinds.has('remove')
        ? 'remove'
        : 'context';
    const selectedText = lines.map((l) => l.content).join('\n');
    return { startLine, endLine, kind, selectedText };
  }, [pending, diff.hunks]);

  const handleComposerSave = useCallback(
    (comment: string) => {
      if (!pendingInfo) return;
      addComment(sessionId, {
        file: diff.file,
        startLine: pendingInfo.startLine,
        endLine: pendingInfo.endLine,
        lineKind: pendingInfo.kind,
        selectedText: pendingInfo.selectedText,
        comment,
      });
      setPending(null);
    },
    [addComment, sessionId, diff.file, pendingInfo],
  );

  const handleComposerCancel = useCallback(() => {
    setPending(null);
  }, []);

  if (diff.isBinary) {
    return (
      <div className={styles.container}>
        <DiffHeader
          diff={diff}
          staged={staged}
          fullFile={fullFile}
          loading={loading}
          reviewMode={reviewMode}
          onToggleStaged={handleStagedToggle}
          onToggleFullFile={handleFullFileToggle}
          onToggleReview={handleReviewToggle}
          reviewBadge={totalComments}
          onOpenPanel={() => setPanelOpen(true)}
        />
        <div className={styles.binary}>Binary file — cannot display diff</div>
        <ReviewCommentsPanel
          sessionId={sessionId}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
        />
      </div>
    );
  }

  if (diff.hunks.length === 0) {
    return (
      <div className={styles.container}>
        <DiffHeader
          diff={diff}
          staged={staged}
          fullFile={fullFile}
          loading={loading}
          reviewMode={reviewMode}
          onToggleStaged={handleStagedToggle}
          onToggleFullFile={handleFullFileToggle}
          onToggleReview={handleReviewToggle}
          reviewBadge={totalComments}
          onOpenPanel={() => setPanelOpen(true)}
        />
        <div className={styles.empty}>No changes</div>
        <ReviewCommentsPanel
          sessionId={sessionId}
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <DiffHeader
        diff={diff}
        staged={staged}
        fullFile={fullFile}
        loading={loading}
        reviewMode={reviewMode}
        onToggleStaged={handleStagedToggle}
        onToggleFullFile={handleFullFileToggle}
        onToggleReview={handleReviewToggle}
        reviewBadge={totalComments}
        onOpenPanel={() => setPanelOpen(true)}
      />
      <div className={styles.table}>
        {diff.hunks.map((hunk, hi) => (
          <div key={hi}>
            <div className={styles.hunkHeader}>{hunk.header}</div>
            {hunk.lines.map((line, li) => {
              const rowClass =
                line.type === 'add'
                  ? styles.rowAdd
                  : line.type === 'remove'
                    ? styles.rowRemove
                    : styles.rowContext;
              const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
              const lineNum = lineNumberFor(line);
              const hasComment = lineNum !== null && commentedLines.has(lineNum);
              const isSelected =
                pending !== null &&
                pending.hunkIndex === hi &&
                li >= pending.startIdx &&
                li <= pending.endIdx;
              const reviewable = reviewMode && lineNum !== null;
              const classes = [rowClass];
              if (reviewable) classes.push(styles.rowReviewable);
              if (isSelected) classes.push(styles.rowSelected);
              if (hasComment) classes.push(styles.rowCommented);
              return (
                <div
                  key={`${hi}-${li}`}
                  className={classes.join(' ')}
                  onClick={reviewable ? () => handleRowClick(hi, li) : undefined}
                  role={reviewable ? 'button' : undefined}
                  tabIndex={reviewable ? 0 : undefined}
                  aria-pressed={reviewable ? isSelected : undefined}
                  onKeyDown={
                    reviewable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleRowClick(hi, li);
                          }
                        }
                      : undefined
                  }
                >
                  <span className={styles.lineNumOld}>{line.oldLine ?? ''}</span>
                  <span className={styles.lineNumNew}>{line.newLine ?? ''}</span>
                  <span className={styles.lineContent}>
                    <span className={styles.linePrefix}>{prefix} </span>
                    {line.content}
                    {hasComment && (
                      <span className={styles.commentMarker} aria-label="has review comment">
                        💬
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {pending !== null && pendingInfo !== null && pending.hunkIndex === hi && (
              <ReviewComposer
                file={diff.file}
                startLine={pendingInfo.startLine}
                endLine={pendingInfo.endLine}
                onSave={handleComposerSave}
                onCancel={handleComposerCancel}
              />
            )}
          </div>
        ))}
      </div>

      <ReviewCommentsPanel
        sessionId={sessionId}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}

interface DiffHeaderProps {
  diff: GitDiff;
  staged: boolean;
  fullFile: boolean;
  loading: boolean;
  reviewMode: boolean;
  onToggleStaged: () => void;
  onToggleFullFile: () => void;
  onToggleReview: () => void;
  reviewBadge: number;
  onOpenPanel: () => void;
}

function DiffHeader({
  diff,
  staged,
  fullFile,
  loading,
  reviewMode,
  onToggleStaged,
  onToggleFullFile,
  onToggleReview,
  reviewBadge,
  onOpenPanel,
}: DiffHeaderProps) {
  const toggleId = useId();
  const isNewFile =
    diff.deletions === 0 &&
    diff.additions > 0 &&
    diff.hunks.length > 0 &&
    diff.hunks.every((h) => h.lines.every((l) => l.type === 'add'));

  return (
    <div className={styles.header}>
      <span className={styles.fileName} title={diff.file}>
        {diff.file}
      </span>
      <div className={styles.stats}>
        {diff.additions > 0 && <span className={styles.additions}>+{diff.additions}</span>}
        {diff.deletions > 0 && <span className={styles.deletions}>-{diff.deletions}</span>}
        {isNewFile && <span className={styles.newFile}>new file</span>}
      </div>
      <button
        type="button"
        className={`${styles.toggleBtn} ${reviewMode ? styles.toggleBtnActive : ''}`}
        onClick={onToggleReview}
        title={reviewMode ? 'Exit review mode' : 'Enter review mode'}
        aria-pressed={reviewMode}
      >
        {reviewMode ? '✓ Review' : '✎ Review'}
      </button>
      {reviewBadge > 0 && (
        <button
          type="button"
          className={`${styles.toggleBtn} ${styles.reviewBadgeBtn}`}
          onClick={onOpenPanel}
          title="View review comments"
          aria-label={`View ${reviewBadge} review comment${reviewBadge === 1 ? '' : 's'}`}
        >
          {reviewBadge}
        </button>
      )}
      {!isNewFile && (
        <>
          <button
            className={`${styles.toggleBtn} ${fullFile ? styles.toggleBtnActive : ''}`}
            onClick={onToggleFullFile}
            disabled={loading}
            title={fullFile ? 'Show changes only' : 'Show full file'}
            aria-label={fullFile ? 'Show changes only' : 'Show full file'}
          >
            {fullFile ? '◫ Full' : '◨ Diff'}
          </button>
          <div className={styles.stagedToggle}>
            <input
              type="checkbox"
              id={toggleId}
              checked={staged}
              onChange={onToggleStaged}
              disabled={loading}
              aria-label="Show staged changes"
            />
            <label htmlFor={toggleId}>Staged</label>
          </div>
        </>
      )}
    </div>
  );
}
