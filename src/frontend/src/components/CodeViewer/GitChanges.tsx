import { useCallback, useEffect, useState } from 'react';
import { useCodeViewerStore } from '@/stores/codeViewerStore';
import { fetchGitStatus, fetchGitDiff } from '@/services/api';
import styles from './GitChanges.module.css';

interface GitChangesProps {
  sessionId: string;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    M: 'M',
    A: 'A',
    D: 'D',
    R: 'R',
    C: 'C',
    U: 'U',
  };
  return map[status] || status.charAt(0).toUpperCase();
}

function statusClass(status: string): string {
  const first = status.charAt(0).toUpperCase();
  switch (first) {
    case 'M':
      return styles.statusM ?? '';
    case 'A':
      return styles.statusA ?? '';
    case 'D':
      return styles.statusD ?? '';
    case 'R':
      return styles.statusR ?? '';
    default:
      return styles.statusU ?? '';
  }
}

function fileName(path: string): string {
  return path.split('/').pop() || path;
}

export default function GitChanges({ sessionId }: GitChangesProps) {
  const { gitStatus, setGitStatus, setGitDiff, setDiffFile, diffFile } = useCodeViewerStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await fetchGitStatus(sessionId);
      setGitStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load git status');
    } finally {
      setLoading(false);
    }
  }, [sessionId, setGitStatus]);

  useEffect(() => {
    if (!gitStatus) {
      loadStatus();
    }
  }, [gitStatus, loadStatus]);

  const handleFileClick = useCallback(
    async (path: string, staged: boolean, untracked: boolean) => {
      setDiffFile(path);
      try {
        const diff = await fetchGitDiff(sessionId, path, staged, untracked);
        setGitDiff(diff);
      } catch {
        setGitDiff(null);
      }
    },
    [sessionId, setDiffFile, setGitDiff],
  );

  if (loading && !gitStatus) {
    return (
      <div className={styles.container}>
        <div className={styles.skeleton} role="status" aria-label="Loading git status">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className={styles.skeletonLine}
              style={{ width: `${60 + Math.random() * 30}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.notGit}>{error}</div>
      </div>
    );
  }

  if (gitStatus && !gitStatus.isGitRepo) {
    return (
      <div className={styles.container}>
        <div className={styles.notGit}>
          <div className={styles.emptyIcon}>⊘</div>
          Not a git repository
        </div>
      </div>
    );
  }

  if (!gitStatus) return null;

  const totalFiles =
    gitStatus.staged.length + gitStatus.modified.length + gitStatus.untracked.length;
  const noChanges = totalFiles === 0;

  return (
    <div className={styles.container}>
      {gitStatus.branch && (
        <div className={styles.branchInfo}>
          <span>⎇</span>
          <span className={styles.branchName}>{gitStatus.branch}</span>
          {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
            <span className={styles.syncInfo}>
              {gitStatus.ahead > 0 && `↑${gitStatus.ahead}`}
              {gitStatus.ahead > 0 && gitStatus.behind > 0 && ' '}
              {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
            </span>
          )}
        </div>
      )}

      {noChanges ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>✓</div>
          Working tree clean
        </div>
      ) : (
        <>
          {gitStatus.staged.length > 0 && (
            <FileSection
              title="Staged"
              files={gitStatus.staged.map((f) => ({ path: f.path, status: f.status }))}
              staged
              untracked={false}
              activeFile={diffFile}
              onFileClick={handleFileClick}
            />
          )}

          {gitStatus.modified.length > 0 && (
            <FileSection
              title="Modified"
              files={gitStatus.modified.map((f) => ({ path: f.path, status: f.status }))}
              staged={false}
              untracked={false}
              activeFile={diffFile}
              onFileClick={handleFileClick}
            />
          )}

          {gitStatus.untracked.length > 0 && (
            <FileSection
              title="Untracked"
              files={gitStatus.untracked.map((p) => ({ path: p, status: '?' }))}
              staged={false}
              untracked
              activeFile={diffFile}
              onFileClick={handleFileClick}
            />
          )}
        </>
      )}

      <div className={styles.footer}>
        <span>
          {totalFiles} file{totalFiles !== 1 ? 's' : ''}
        </span>
        <button
          className={styles.refreshBtn}
          onClick={loadStatus}
          disabled={loading}
          title="Refresh git status"
          aria-label="Refresh git status"
        >
          {loading ? '⟳' : '↻'}
        </button>
      </div>
    </div>
  );
}

interface FileSectionProps {
  title: string;
  files: Array<{ path: string; status: string }>;
  staged: boolean;
  untracked: boolean;
  activeFile: string | null;
  onFileClick: (path: string, staged: boolean, untracked: boolean) => void;
}

function FileSection({
  title,
  files,
  staged,
  untracked,
  activeFile,
  onFileClick,
}: FileSectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span>{title}</span>
        <span className={styles.badge}>{files.length}</span>
      </div>
      {files.map((file) => (
        <button
          key={file.path}
          className={`${styles.fileItem} ${activeFile === file.path ? styles.fileItemActive : ''}`}
          onClick={() => onFileClick(file.path, staged, untracked)}
          title={file.path}
          aria-label={`${file.path} (${file.status})`}
        >
          <span className={`${styles.statusBadge} ${statusClass(file.status)}`}>
            {statusLabel(file.status)}
          </span>
          <span className={styles.fileName}>{fileName(file.path)}</span>
        </button>
      ))}
    </div>
  );
}
