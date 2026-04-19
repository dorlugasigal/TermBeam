import { useCallback, useEffect, useRef, useState } from 'react';
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
  const inFlightRef = useRef(false);

  const loadStatus = useCallback(
    async (showSpinner = true) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (showSpinner) setLoading(true);
      try {
        const status = await fetchGitStatus(sessionId);
        setGitStatus(status);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load git status');
      } finally {
        if (showSpinner) setLoading(false);
        inFlightRef.current = false;
      }
    },
    [sessionId, setGitStatus],
  );

  useEffect(() => {
    if (!gitStatus) {
      loadStatus();
    }
  }, [gitStatus, loadStatus]);

  useEffect(() => {
    const POLL_MS = 3000;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          loadStatus(false);
        }
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        loadStatus(false);
        start();
      } else {
        stop();
      }
    };
    const onFocus = () => loadStatus(false);

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadStatus]);

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
          onClick={() => loadStatus(true)}
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
