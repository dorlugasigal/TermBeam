import { useState, useEffect, useCallback } from 'react';
import { browseDirectory } from '@/services/api';
import styles from './FolderBrowser.module.css';

interface FolderBrowserProps {
  currentDir?: string;
  onSelect: (dir: string) => void;
  onCancel?: () => void;
}

export function FolderBrowser({ currentDir = '/', onSelect, onCancel }: FolderBrowserProps) {
  const [dir, setDir] = useState(currentDir);
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await browseDirectory(path);
      setDir(result.base);
      setDirs([...result.dirs].sort((a, b) => a.localeCompare(b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(currentDir);
  }, [currentDir, load]);

  const segments = dir.split('/').filter(Boolean);

  function navigateToSegment(index: number) {
    const path = '/' + segments.slice(0, index + 1).join('/');
    load(path);
  }

  return (
    <div className={styles.container}>
      <div className={styles.breadcrumb}>
        <button className={styles.breadcrumbSegment} onClick={() => load('/')}>
          /
        </button>
        {segments.map((seg, i) => (
          <span key={i}>
            <span className={styles.breadcrumbSep}>/</span>
            <button className={styles.breadcrumbSegment} onClick={() => navigateToSegment(i)}>
              {seg}
            </button>
          </span>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : (
        <div className={styles.list}>
          {segments.length > 0 && (
            <button
              className={styles.entry}
              onClick={() => load('/' + segments.slice(0, -1).join('/'))}
            >
              <span className={styles.entryIcon}>📁</span>
              <span className={styles.entryName}>..</span>
            </button>
          )}
          {dirs.map((fullPath) => {
            const name = fullPath.split(/[/\\]/).pop() || fullPath;
            return (
              <button key={fullPath} className={styles.entry} onClick={() => load(fullPath)}>
                <span className={styles.entryIcon}>📁</span>
                <span className={styles.entryName}>{name}</span>
              </button>
            );
          })}
          {dirs.length === 0 && <div className={styles.loading}>Empty directory</div>}
        </div>
      )}

      <div className={styles.actions}>
        {onCancel && (
          <button className={styles.cancelBtn} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className={styles.selectBtn} onClick={() => onSelect(dir)} disabled={loading}>
          Select
        </button>
      </div>
    </div>
  );
}
