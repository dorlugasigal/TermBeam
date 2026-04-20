import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useId, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useCodeViewerStore } from '@/stores/codeViewerStore';
import { useReviewCommentsStore } from '@/stores/reviewCommentsStore';
import { fetchGitDiff } from '@/services/api';
import type { GitDiff, DiffLine } from '@/services/api';
import type { ReviewComment, ReviewLineKind } from '@/utils/formatReviewComments';
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

function lineNumberForKind(line: DiffLine, kind: ReviewLineKind): number | null {
  // Strict per-kind coordinate: avoid falling back to the other system, which
  // would mix old/new line numbers (e.g. a removed line in an 'add'-kind
  // selection contributing its old-line number).
  if (kind === 'remove') return line.oldLine ?? null;
  if (kind === 'add') return line.newLine ?? null;
  // context lines have both set; prefer new, fall back to old defensively.
  return line.newLine ?? line.oldLine ?? null;
}

function prefixFor(line: DiffLine): string {
  if (line.type === 'add') return '+';
  if (line.type === 'remove') return '-';
  return ' ';
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
  const updateComment = useReviewCommentsStore((s) => s.updateComment);
  const removeComment = useReviewCommentsStore((s) => s.removeComment);
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
    // Key by `${lineKind}:${lineNum}` so a remove-comment on old-line N
    // doesn't collide with an add-comment on new-line N.
    const set = new Set<string>();
    for (const c of fileComments) {
      for (let n = c.startLine; n <= c.endLine; n++) set.add(`${c.lineKind}:${n}`);
    }
    return set;
  }, [fileComments]);

  // Render comments inline directly under the last line of their range.
  // Multiple rows may share a line number (e.g. add+remove pairs), so we
  // track which comments have already been rendered during the current pass.
  const commentsByEndLine = useMemo(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const c of fileComments) {
      const key = `${c.lineKind}:${c.endLine}`;
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return map;
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

  const handleStartReview = useCallback(() => {
    setReviewMode(sessionId, true);
  }, [sessionId, setReviewMode]);

  const handleExitReview = useCallback(() => {
    // Non-destructive: comments persist in localStorage. User can resume later
    // or clear them explicitly from the comments panel.
    setReviewMode(sessionId, false);
    setPending(null);
  }, [sessionId, setReviewMode]);

  const handleFinishReview = useCallback(() => {
    // Opening the panel is where Send/Copy live; we keep review mode on so
    // the user can go back and add more comments if the panel prompts them to.
    setPanelOpen(true);
  }, []);

  const handleRowClick = useCallback(
    (hunkIndex: number, lineIdx: number, extend: boolean) => {
      if (!reviewMode) return;
      if (extend && pending && pending.hunkIndex === hunkIndex) {
        const lo = Math.min(pending.startIdx, lineIdx);
        const hi = Math.max(pending.endIdx, lineIdx);
        setPending({ hunkIndex, startIdx: lo, endIdx: hi });
        return;
      }
      setPending({ hunkIndex, startIdx: lineIdx, endIdx: lineIdx });
    },
    [reviewMode, pending],
  );

  const adjustPendingRange = useCallback(
    (endpoint: 'start' | 'end', direction: 'up' | 'down') => {
      if (!pending) return;
      const hunk = diff.hunks[pending.hunkIndex];
      if (!hunk) return;
      const maxIdx = hunk.lines.length - 1;
      let { startIdx, endIdx } = pending;
      if (endpoint === 'start') {
        if (direction === 'up' && startIdx > 0) startIdx -= 1;
        else if (direction === 'down' && startIdx < endIdx) startIdx += 1;
        else return;
      } else {
        if (direction === 'up' && endIdx > startIdx) endIdx -= 1;
        else if (direction === 'down' && endIdx < maxIdx) endIdx += 1;
        else return;
      }
      setPending({ hunkIndex: pending.hunkIndex, startIdx, endIdx });
    },
    [pending, diff.hunks],
  );

  const rangeCaps = useMemo(() => {
    if (!pending) {
      return {
        canStartUp: false,
        canStartDown: false,
        canEndUp: false,
        canEndDown: false,
      };
    }
    const hunk = diff.hunks[pending.hunkIndex];
    const maxIdx = hunk ? hunk.lines.length - 1 : 0;
    return {
      canStartUp: pending.startIdx > 0,
      canStartDown: pending.startIdx < pending.endIdx,
      canEndUp: pending.endIdx > pending.startIdx,
      canEndDown: pending.endIdx < maxIdx,
    };
  }, [pending, diff.hunks]);

  const pendingInfo = useMemo(() => {
    if (!pending) return null;
    const hunk = diff.hunks[pending.hunkIndex];
    if (!hunk) return null;
    const lines = hunk.lines.slice(pending.startIdx, pending.endIdx + 1);
    if (lines.length === 0) return null;
    // Decide kind first; prefer 'add' (new state is what agents act on), then 'remove', else 'context'.
    const kinds = new Set(lines.map((l) => l.type));
    const kind: ReviewLineKind = kinds.has('add')
      ? 'add'
      : kinds.has('remove')
        ? 'remove'
        : 'context';
    // Derive line numbers using a consistent coordinate system for the decided kind.
    const nums = lines
      .map((l) => lineNumberForKind(l, kind))
      .filter((n): n is number => n !== null);
    if (nums.length === 0) return null;
    const startLine = Math.min(...nums);
    const endLine = Math.max(...nums);
    const selectedText = lines.map((l) => `${prefixFor(l)} ${l.content}`).join('\n');
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
          onStartReview={handleStartReview}
          onExitReview={handleExitReview}
          onFinishReview={handleFinishReview}
          reviewBadge={totalComments}
          onOpenPanel={() => setPanelOpen(true)}
        />
        <div className={styles.scrollArea}>
          <div className={styles.binary}>Binary file — cannot display diff</div>
        </div>
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
          onStartReview={handleStartReview}
          onExitReview={handleExitReview}
          onFinishReview={handleFinishReview}
          reviewBadge={totalComments}
          onOpenPanel={() => setPanelOpen(true)}
        />
        <div className={styles.scrollArea}>
          <div className={styles.empty}>No changes</div>
        </div>
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
        onStartReview={handleStartReview}
        onExitReview={handleExitReview}
        onFinishReview={handleFinishReview}
        reviewBadge={totalComments}
        onOpenPanel={() => setPanelOpen(true)}
      />
      <div className={styles.scrollArea}>
        <div className={styles.table}>
          {(() => {
            const rendered = new Set<string>();
            return diff.hunks.map((hunk, hi) => (
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
                  const commentKey = lineNum !== null ? `${line.type}:${lineNum}` : null;
                  const hasComment = commentKey !== null && commentedLines.has(commentKey);
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

                  const inlineComments: ReviewComment[] = [];
                  if (commentKey !== null) {
                    for (const c of commentsByEndLine.get(commentKey) ?? []) {
                      if (!rendered.has(c.id)) {
                        rendered.add(c.id);
                        inlineComments.push(c);
                      }
                    }
                  }

                  const isPendingLastLine =
                    pending !== null &&
                    pending.hunkIndex === hi &&
                    li === pending.endIdx &&
                    pendingInfo !== null;

                  return (
                    <Fragment key={`${hi}-${li}`}>
                      <div
                        className={classes.join(' ')}
                        onClick={
                          reviewable ? (e) => handleRowClick(hi, li, e.shiftKey) : undefined
                        }
                        role={reviewable ? 'button' : undefined}
                        tabIndex={reviewable ? 0 : undefined}
                        aria-pressed={reviewable ? isSelected : undefined}
                        onKeyDown={
                          reviewable
                            ? (e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleRowClick(hi, li, e.shiftKey);
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
                        </span>
                      </div>
                      {inlineComments.map((c) => (
                        <InlineCommentCard
                          key={c.id}
                          comment={c}
                          onSave={(body) => updateComment(sessionId, c.id, body)}
                          onDelete={() => removeComment(sessionId, c.id)}
                        />
                      ))}
                      {isPendingLastLine && pendingInfo && (
                        <InlineCommentEditor
                          key={`pending-${hi}-${li}`}
                          label={`L${
                            pendingInfo.startLine === pendingInfo.endLine
                              ? pendingInfo.startLine
                              : `${pendingInfo.startLine}–${pendingInfo.endLine}`
                          }`}
                          hint="Tap any line to reselect"
                          initialValue=""
                          submitLabel="Add comment"
                          onSubmit={handleComposerSave}
                          onCancel={handleComposerCancel}
                          rangeControls={{
                            startLine: pendingInfo.startLine,
                            endLine: pendingInfo.endLine,
                            canStartUp: rangeCaps.canStartUp,
                            canStartDown: rangeCaps.canStartDown,
                            canEndUp: rangeCaps.canEndUp,
                            canEndDown: rangeCaps.canEndDown,
                            onStartUp: () => adjustPendingRange('start', 'up'),
                            onStartDown: () => adjustPendingRange('start', 'down'),
                            onEndUp: () => adjustPendingRange('end', 'up'),
                            onEndDown: () => adjustPendingRange('end', 'down'),
                          }}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </div>
            ));
          })()}
        </div>
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
  onStartReview: () => void;
  onExitReview: () => void;
  onFinishReview: () => void;
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
  onStartReview,
  onExitReview,
  onFinishReview,
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
      {!reviewMode && reviewBadge === 0 && (
        <button
          type="button"
          className={`${styles.toggleBtn} ${styles.toggleBtnPrimary}`}
          onClick={onStartReview}
          title="Start review"
        >
          ✎ Start review
        </button>
      )}
      {!reviewMode && reviewBadge > 0 && (
        <>
          <button
            type="button"
            className={`${styles.toggleBtn} ${styles.toggleBtnPrimary}`}
            onClick={onStartReview}
            title="Resume review"
          >
            ▶ Resume ({reviewBadge})
          </button>
          <button
            type="button"
            className={`${styles.toggleBtn} ${styles.reviewBadgeBtn}`}
            onClick={onOpenPanel}
            title="View review comments"
            aria-label={`View ${reviewBadge} review comment${reviewBadge === 1 ? '' : 's'}`}
          >
            {reviewBadge}
          </button>
        </>
      )}
      {reviewMode && reviewBadge > 0 && (
        <>
          <button
            type="button"
            className={`${styles.toggleBtn} ${styles.toggleBtnPrimary}`}
            onClick={onFinishReview}
            title="Finish review and open comments panel"
          >
            ✓ Finish ({reviewBadge})
          </button>
          <button
            type="button"
            className={styles.toggleBtn}
            onClick={onExitReview}
            title="Exit review mode (comments are kept)"
          >
            Exit
          </button>
        </>
      )}
      {reviewMode && reviewBadge === 0 && (
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={onExitReview}
          title="Exit review mode"
        >
          ✕ Exit
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

interface RangeControls {
  startLine: number;
  endLine: number;
  canStartUp: boolean;
  canStartDown: boolean;
  canEndUp: boolean;
  canEndDown: boolean;
  onStartUp: () => void;
  onStartDown: () => void;
  onEndUp: () => void;
  onEndDown: () => void;
}

interface InlineCommentEditorProps {
  initialValue: string;
  submitLabel: string;
  label?: string;
  hint?: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  disableUnchanged?: boolean;
  rangeControls?: RangeControls;
}

function InlineCommentEditor({
  initialValue,
  submitLabel,
  label,
  hint,
  onSubmit,
  onCancel,
  disableUnchanged = false,
  rangeControls,
}: InlineCommentEditorProps) {
  const [value, setValue] = useState(initialValue);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    t.style.height = 'auto';
    const vvHeight = window.visualViewport?.height ?? window.innerHeight;
    // Cap to 30% of visible viewport so header + action row still fit.
    const max = Math.round(vvHeight * 0.3);
    t.style.height = `${Math.min(Math.max(t.scrollHeight, 60), max)}px`;
  }, [value]);

  // Track the keyboard inset so the fixed overlay sits directly above it.
  // visualViewport.height shrinks when the keyboard is shown; the bottom
  // inset is `innerHeight - (offsetTop + height)`. We debounce via rAF so
  // we don't write to state on every animation frame during the slide-in.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        setKeyboardOffset(inset);
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // iOS fires visualViewport.resize lazily (sometimes 100-300ms after focus)
  // which makes the editor visually "lag" behind the rising keyboard. On
  // textarea focus, poll visualViewport every animation frame for ~600ms so
  // --kb-offset tracks the keyboard slide-in smoothly from frame 1.
  const focusPollRafRef = useRef<number | null>(null);
  const handleFocusPoll = useCallback(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    if (focusPollRafRef.current !== null) {
      cancelAnimationFrame(focusPollRafRef.current);
    }
    const start = performance.now();
    const tick = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardOffset(inset);
      if (performance.now() - start < 600) {
        focusPollRafRef.current = requestAnimationFrame(tick);
      } else {
        focusPollRafRef.current = null;
      }
    };
    focusPollRafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    return () => {
      if (focusPollRafRef.current !== null) {
        cancelAnimationFrame(focusPollRafRef.current);
        focusPollRafRef.current = null;
      }
    };
  }, []);

  // Prevent buttons from stealing focus from the textarea. Focus loss
  // dismisses the iOS keyboard which causes layout thrash; preventDefault
  // on pointerdown keeps the textarea focused across taps.
  const keepFocus = useCallback((e: React.PointerEvent | React.MouseEvent) => {
    if (document.activeElement !== textareaRef.current) return;
    e.preventDefault();
  }, []);

  const trimmed = value.trim();
  const unchanged = trimmed === initialValue.trim();
  const disabled = !trimmed || (disableUnchanged && unchanged);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 640px)').matches : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // On iOS, when the keyboard opens for a focused input in a scrollable
  // document, Safari scrolls the page to bring the input "into view" —
  // even if the input is already visible (position: fixed above the
  // keyboard). That scroll is what makes the whole screen lurch. While
  // the mobile editor is mounted we lock body/html scrolling so iOS has
  // nothing to scroll. The diff content inside the code viewer overlay
  // has its own inner scroll container which is unaffected.
  useEffect(() => {
    if (!isMobile || typeof document === 'undefined') return;
    const body = document.body;
    const html = document.documentElement;
    const prevBody = body.style.overflow;
    const prevHtml = html.style.overflow;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => {
      body.style.overflow = prevBody;
      html.style.overflow = prevHtml;
    };
  }, [isMobile]);

  const editorNode = (
    <div
      ref={rootRef}
      className={styles.inlineCommentEdit}
      style={{ ['--kb-offset' as string]: `${keyboardOffset}px` }}
    >
      {(label || hint) && (
        <div className={styles.inlineCommentEditHeader}>
          {label && <span className={styles.inlineCommentEditLabel}>{label}</span>}
          {hint && <span className={styles.inlineCommentEditHint}>{hint}</span>}
        </div>
      )}
      {rangeControls && (
        <div
          className={styles.rangeAdjusters}
          role="group"
          aria-label="Adjust selected line range"
        >
          <button
            type="button"
            className={styles.rangeAdjusterBtn}
            onPointerDown={keepFocus}
            onClick={rangeControls.onStartUp}
            disabled={!rangeControls.canStartUp}
            title="Move start line up"
            aria-label="Move start line up"
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.rangeAdjusterBtn}
            onPointerDown={keepFocus}
            onClick={rangeControls.onStartDown}
            disabled={!rangeControls.canStartDown}
            title="Move start line down"
            aria-label="Move start line down"
          >
            ↓
          </button>
          <span className={styles.rangeAdjusterRange}>
            {rangeControls.startLine === rangeControls.endLine
              ? `L${rangeControls.startLine}`
              : `L${rangeControls.startLine}–${rangeControls.endLine}`}
          </span>
          <button
            type="button"
            className={styles.rangeAdjusterBtn}
            onPointerDown={keepFocus}
            onClick={rangeControls.onEndUp}
            disabled={!rangeControls.canEndUp}
            title="Move end line up"
            aria-label="Move end line up"
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.rangeAdjusterBtn}
            onPointerDown={keepFocus}
            onClick={rangeControls.onEndDown}
            disabled={!rangeControls.canEndDown}
            title="Move end line down"
            aria-label="Move end line down"
          >
            ↓
          </button>
        </div>
      )}
      <textarea
        ref={textareaRef}
        className={styles.inlineCommentTextarea}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={handleFocusPoll}
        autoFocus={!isMobile}
        maxLength={4096}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!disabled) onSubmit(trimmed);
          }
        }}
      />
      <div className={styles.inlineCommentActions}>
        <button
          type="button"
          className={styles.inlineCommentBtn}
          onPointerDown={keepFocus}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${styles.inlineCommentBtn} ${styles.inlineCommentBtnPrimary}`}
          disabled={disabled}
          onPointerDown={keepFocus}
          onClick={() => onSubmit(trimmed)}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );

  // On mobile we render into a portal at document.body so the
  // position: fixed styling is anchored to the visual viewport rather
  // than the diff scroll container. The scroll container uses
  // `container-type: inline-size`, which creates a containing block for
  // fixed descendants and would otherwise pin the editor inside the
  // overflowing scroll area (below the viewport, behind the keyboard).
  if (isMobile && typeof document !== 'undefined') {
    return createPortal(editorNode, document.body);
  }
  return editorNode;
}

interface InlineCommentCardProps {
  comment: ReviewComment;
  onSave: (body: string) => void;
  onDelete: () => void;
}

function InlineCommentCard({ comment, onSave, onDelete }: InlineCommentCardProps) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(true);

  if (editing) {
    return (
      <InlineCommentEditor
        initialValue={comment.comment}
        submitLabel="Save"
        disableUnchanged
        onSubmit={(body) => {
          onSave(body);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const preview = comment.comment.replace(/\s+/g, ' ').trim();

  return (
    <div className={styles.inlineComment}>
      <div
        className={`${styles.inlineCommentHeader} ${
          expanded ? '' : styles.inlineCommentHeaderCollapsed
        }`}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse comment' : 'Expand comment'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <span
          className={`${styles.inlineCommentCaret} ${
            expanded ? styles.inlineCommentCaretOpen : ''
          }`}
          aria-hidden
        >
          ▶
        </span>
        <span className={styles.inlineCommentPreview}>{preview}</span>
      </div>
      {expanded && (
        <div className={styles.inlineCommentContent}>
          <div className={styles.inlineCommentBody}>{comment.comment}</div>
          <div className={styles.inlineCommentActions}>
            <button
              type="button"
              className={styles.inlineCommentBtn}
              onClick={() => setEditing(true)}
              aria-label="Edit comment"
            >
              Edit
            </button>
            <button
              type="button"
              className={styles.inlineCommentBtn}
              onClick={onDelete}
              aria-label="Delete comment"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
