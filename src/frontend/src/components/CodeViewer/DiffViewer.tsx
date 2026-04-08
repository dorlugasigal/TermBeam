import { useCallback, useState, useId } from 'react';
import { useCodeViewerStore } from '@/stores/codeViewerStore';
import { fetchGitDiff } from '@/services/api';
import type { GitDiff } from '@/services/api';
import styles from './DiffViewer.module.css';

interface DiffViewerProps {
  sessionId: string;
  diff: GitDiff;
}

export default function DiffViewer({ sessionId, diff }: DiffViewerProps) {
  const { setGitDiff } = useCodeViewerStore();
  const [staged, setStaged] = useState(false);
  const [fullFile, setFullFile] = useState(false);
  const [loading, setLoading] = useState(false);

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

  if (diff.isBinary) {
    return (
      <div className={styles.container}>
        <DiffHeader
          diff={diff}
          staged={staged}
          fullFile={fullFile}
          loading={loading}
          onToggleStaged={handleStagedToggle}
          onToggleFullFile={handleFullFileToggle}
        />
        <div className={styles.binary}>Binary file — cannot display diff</div>
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
          onToggleStaged={handleStagedToggle}
          onToggleFullFile={handleFullFileToggle}
        />
        <div className={styles.empty}>No changes</div>
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
        onToggleStaged={handleStagedToggle}
        onToggleFullFile={handleFullFileToggle}
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
              return (
                <div key={`${hi}-${li}`} className={rowClass}>
                  <span className={styles.lineNumOld}>{line.oldLine ?? ''}</span>
                  <span className={styles.lineNumNew}>{line.newLine ?? ''}</span>
                  <span className={styles.lineContent}>
                    <span className={styles.linePrefix}>{prefix} </span>
                    {line.content}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

interface DiffHeaderProps {
  diff: GitDiff;
  staged: boolean;
  fullFile: boolean;
  loading: boolean;
  onToggleStaged: () => void;
  onToggleFullFile: () => void;
}

function DiffHeader({
  diff,
  staged,
  fullFile,
  loading,
  onToggleStaged,
  onToggleFullFile,
}: DiffHeaderProps) {
  const toggleId = useId();
  // Untracked/new files are entirely additions — no meaningful diff/full or staged toggle
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
