import { useState, useEffect, useCallback } from 'react';
import { browseFiles, downloadFile } from '@/services/api';
import type { FileEntry } from '@/services/api';
import { MarkdownViewer } from '@/components/MarkdownViewer/MarkdownViewer';
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
  const [viewingFile, setViewingFile] = useState<{ path: string; name: string } | null>(null);

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

  // Build relative path segments for breadcrumb
  const normalizedRoot = rootDir.replace(/\/+$/, '');
  const normalizedDir = dir.replace(/\/+$/, '');
  const relativePath = normalizedDir.startsWith(normalizedRoot)
    ? normalizedDir.slice(normalizedRoot.length)
    : '';
  const relSegments = relativePath.split('/').filter(Boolean);
  const isAtRoot = relSegments.length === 0;

  // Root display name (last segment of rootDir, or rootDir itself)
  const rootName = normalizedRoot.split('/').pop() || normalizedRoot;

  function navigateToBreadcrumb(index: number) {
    if (index < 0) {
      load(rootDir);
    } else {
      const path = normalizedRoot + '/' + relSegments.slice(0, index + 1).join('/');
      load(path);
    }
  }

  function navigateUp() {
    if (isAtRoot) return;
    const parent = normalizedRoot + '/' + relSegments.slice(0, -1).join('/');
    load(parent || rootDir);
  }

  function isMarkdownFile(name: string): boolean {
    return /\.(md|markdown)$/i.test(name);
  }

  function handleEntryClick(entry: FileEntry) {
    if (entry.type === 'directory') {
      const target =
        (normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/') + entry.name;
      load(target);
    } else if (isMarkdownFile(entry.name)) {
      const filePath =
        (normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/') + entry.name;
      setViewingFile({ path: filePath, name: entry.name });
    }
  }

  function handleDownload(entry: FileEntry) {
    const filePath =
      (normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/') + entry.name;
    downloadFile(sessionId, filePath);
  }

  if (viewingFile) {
    return (
      <MarkdownViewer
        sessionId={sessionId}
        filePath={viewingFile.path}
        fileName={viewingFile.name}
        onClose={() => setViewingFile(null)}
      />
    );
  }

  return (
    <div className={styles.container}>
      {/* Header with back button */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose} title="Back to sessions">
          ←
        </button>
        <span className={styles.headerTitle}>Download File</span>
      </div>

      {/* Breadcrumb */}
      <div className={styles.breadcrumb}>
        <button
          className={isAtRoot ? styles.breadcrumbCurrent : styles.breadcrumbSegment}
          onClick={() => navigateToBreadcrumb(-1)}
        >
          📁 {rootName}
        </button>
        {relSegments.map((seg, i) => {
          const isLast = i === relSegments.length - 1;
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

      {/* File list */}
      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : (
        <div className={styles.list}>
          {/* ".." entry only when inside a subdirectory */}
          {!isAtRoot && (
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
                style={
                  entry.type === 'directory' || isMarkdownFile(entry.name)
                    ? { cursor: 'pointer' }
                    : undefined
                }
              >
                {entry.name}
              </span>
              {entry.type === 'file' && (
                <>
                  {isMarkdownFile(entry.name) && (
                    <span className={styles.previewHint} title="Click to preview">
                      👁️
                    </span>
                  )}
                  <span className={styles.entryMeta}>{formatSize(entry.size)}</span>
                  <button
                    className={styles.downloadBtn}
                    onClick={() => handleDownload(entry)}
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
    </div>
  );
}
