import { useState, useEffect, useCallback } from 'react';
import { browseFiles } from '@/services/api';
import type { FileEntry } from '@/services/api';
import { MarkdownViewer } from '@/components/MarkdownViewer/MarkdownViewer';
import styles from './MarkdownBrowser.module.css';

interface MarkdownBrowserProps {
  sessionId: string;
  rootDir: string;
  onClose: () => void;
}

function isMarkdownFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[i]}`;
}

export function MarkdownBrowser({ sessionId, rootDir, onClose }: MarkdownBrowserProps) {
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
        // Filter: only directories and markdown files
        const filtered = result.entries.filter(
          (e) => e.type === 'directory' || isMarkdownFile(e.name),
        );
        const sorted = [...filtered].sort((a, b) => {
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
    } else {
      const filePath =
        (normalizedDir.endsWith('/') ? normalizedDir : normalizedDir + '/') + entry.name;
      setViewingFile({ path: filePath, name: entry.name });
    }
  }

  if (viewingFile) {
    return (
      <MarkdownViewer
        sessionId={sessionId}
        filePath={viewingFile.path}
        fileName={viewingFile.name}
        onClose={() => setViewingFile(null)}
        onNavigate={(path, name) => setViewingFile({ path, name })}
      />
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onClose} title="Close">
          ←
        </button>
        <span className={styles.headerTitle}>View Markdown</span>
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
            <button
              key={entry.name}
              className={styles.entry}
              onClick={() => handleEntryClick(entry)}
            >
              <span className={styles.entryIcon}>
                {entry.type === 'directory' ? '📁' : '📝'}
              </span>
              <span className={styles.entryName}>{entry.name}</span>
              {entry.type === 'file' && (
                <span className={styles.entryMeta}>{formatSize(entry.size)}</span>
              )}
            </button>
          ))}

          {entries.length === 0 && (
            <div className={styles.empty}>No markdown files in this directory</div>
          )}
        </div>
      )}
    </div>
  );
}
