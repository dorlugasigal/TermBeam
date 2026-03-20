import { useState, useEffect, useCallback } from 'react';
import { browseFiles, downloadFileWithProgress } from '@/services/api';
import type { FileEntry } from '@/services/api';
import styles from './FileBrowser.module.css';

interface FileBrowserProps {
  sessionId: string;
  rootDir: string;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[i]}`;
}

export function FileBrowser({ sessionId, rootDir, onClose }: FileBrowserProps) {
  const [dir, setDir] = useState(rootDir);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<FileEntry | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      setError('');
      try {
        const result = await browseFiles(sessionId, path);
        setDir(result.base);
        const sorted = [...result.entries].sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load directory');
      } finally {
        setLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    load(rootDir);
  }, [rootDir, load]);

  const normalizedDir = dir.replace(/\/+$/, '');
  const segments = normalizedDir.split('/').filter(Boolean);

  function navigateToBreadcrumb(index: number) {
    const path = '/' + segments.slice(0, index + 1).join('/');
    load(path);
  }

  function navigateUp() {
    const parent = normalizedDir.split('/').slice(0, -1).join('/') || '/';
    load(parent);
  }

  function handleEntryClick(entry: FileEntry) {
    if (entry.type === 'directory') {
      const target =
        (normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/') + entry.name;
      load(target);
    }
  }

  function handleDownloadClick(entry: FileEntry) {
    setConfirm(entry);
  }

  async function handleConfirmDownload() {
    if (!confirm) return;
    const filePath =
      (normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/') + confirm.name;
    setDownloading(true);
    setProgress(0);
    try {
      await downloadFileWithProgress(sessionId, filePath, (pct) => setProgress(pct));
    } catch {
      // Error is handled silently — the user sees it didn't complete
    } finally {
      setDownloading(false);
      setConfirm(null);
      setProgress(0);
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose} title="Close">
          ←
        </button>
        <span className={styles.headerTitle}>Download File</span>
      </div>

      <div className={styles.breadcrumb}>
        <button
          className={segments.length === 0 ? styles.breadcrumbCurrent : styles.breadcrumbSegment}
          onClick={() => load('/')}
        >
          /
        </button>
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          return (
            <span key={i}>
              <span className={styles.breadcrumbSep}>/</span>
              <button
                className={isLast ? styles.breadcrumbCurrent : styles.breadcrumbSegment}
                onClick={() => !isLast && navigateToBreadcrumb(i)}
              >
                {seg}
              </button>
            </span>
          );
        })}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : (
        <div className={styles.list}>
          {normalizedDir !== '/' && (
            <button className={styles.entry} onClick={navigateUp}>
              <span className={styles.entryIcon}>📁</span>
              <span className={styles.entryName}>..</span>
            </button>
          )}

          {entries.map((entry) => (
            <div key={entry.name} className={styles.entry}>
              <span className={styles.entryIcon}>{entry.type === 'directory' ? '📁' : '📄'}</span>
              <span
                className={styles.entryName}
                onClick={() => handleEntryClick(entry)}
                style={entry.type === 'directory' ? { cursor: 'pointer' } : undefined}
              >
                {entry.name}
              </span>
              {entry.type === 'file' && (
                <>
                  <span className={styles.entryMeta}>{formatSize(entry.size)}</span>
                  <button
                    className={styles.downloadBtn}
                    onClick={() => handleDownloadClick(entry)}
                    title={`Download ${entry.name}`}
                  >
                    ⬇️
                  </button>
                </>
              )}
            </div>
          ))}

          {entries.length === 0 && <div className={styles.empty}>Empty directory</div>}
        </div>
      )}

      {/* Download confirmation bar */}
      {confirm && (
        <div className={styles.confirmBar}>
          {downloading ? (
            <div className={styles.progressWrapper}>
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
              <span className={styles.progressLabel}>Downloading… {progress}%</span>
            </div>
          ) : (
            <>
              <span className={styles.confirmText}>
                Download <strong>{confirm.name}</strong> ({formatSize(confirm.size)})?
              </span>
              <div className={styles.confirmActions}>
                <button className={styles.confirmCancel} onClick={() => setConfirm(null)}>
                  Cancel
                </button>
                <button className={styles.confirmOk} onClick={handleConfirmDownload}>
                  Download
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
