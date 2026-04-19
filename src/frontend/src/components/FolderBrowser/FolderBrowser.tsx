import { useState, useEffect, useCallback, useRef } from 'react';
import { browseDirectory } from '@/services/api';
import styles from './FolderBrowser.module.css';

interface FolderBrowserProps {
  currentDir?: string;
  onSelect: (dir: string) => void;
  onCancel?: () => void;
}

function endsWithSep(s: string): boolean {
  return s.endsWith('/') || s.endsWith('\\');
}

function stripTrailingSep(s: string): string {
  if (s.length <= 1) return s;
  return endsWithSep(s) ? s.slice(0, -1) : s;
}

export function FolderBrowser({ currentDir: initialDir = '/', onSelect, onCancel }: FolderBrowserProps) {
  // currentDir: the actual navigated directory (what Select returns).
  // Only updated when the user explicitly navigates (click / Enter on a valid path).
  const [currentDir, setCurrentDir] = useState(initialDir);
  // queryInput: raw text in the path/filter input (editable by user).
  const [queryInput, setQueryInput] = useState(initialDir);
  // listBase: directory the current list is based on (may be parent of queryInput
  // when in prefix-filter mode).
  const [listBase, setListBase] = useState(initialDir);
  const [dirs, setDirs] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  // Monotonic request id — only the latest response is applied, avoiding stale overwrites.
  const reqIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (
      path: string,
      opts?: { prefixFilter?: boolean },
    ): Promise<{ applied: boolean; exists: boolean; base: string }> => {
      const myId = ++reqIdRef.current;
      setLoading(true);
      setError('');
      try {
        const result = await browseDirectory(path || '/', opts);
        if (myId !== reqIdRef.current) return { applied: false, exists: false, base: '' };
        setListBase(result.base);
        setDirs([...result.dirs].sort((a, b) => a.localeCompare(b)));
        setTruncated(result.truncated === true);
        setNotFound(result.exists === false);
        return { applied: true, exists: result.exists !== false, base: result.base };
      } catch (err) {
        if (myId !== reqIdRef.current) return { applied: false, exists: false, base: '' };
        setError(err instanceof Error ? err.message : 'Failed to load directory');
        return { applied: true, exists: false, base: '' };
      } finally {
        if (myId === reqIdRef.current) setLoading(false);
      }
    },
    [],
  );

  // Initial load.
  useEffect(() => {
    setCurrentDir(initialDir);
    setQueryInput(initialDir);
    void load(initialDir);
  }, [initialDir, load]);

  // Navigate to a directory: updates currentDir, queryInput, and lists contents.
  const navigateTo = useCallback(
    async (path: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const target = path || '/';
      const res = await load(target);
      if (res.applied && res.exists) {
        // Use the server-normalized base (handles symlinks, '..', trailing slashes).
        const resolved = res.base || stripTrailingSep(target) || '/';
        setCurrentDir(resolved);
        setQueryInput(resolved);
      }
    },
    [load],
  );

  // Debounced filter as the user types.
  function handleInputChange(value: string) {
    setQueryInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!value) {
        void load('/');
        return;
      }
      const isListing = endsWithSep(value);
      void load(value, { prefixFilter: !isListing });
    }, 200);
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const v = queryInput.trim() || '/';
      void navigateTo(v);
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  }

  // Clean up any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const segments = currentDir.split(/[/\\]/).filter(Boolean);

  function navigateToSegment(index: number) {
    const path = '/' + segments.slice(0, index + 1).join('/');
    void navigateTo(path);
  }

  return (
    <div className={styles.container}>
      <input
        className={styles.pathInput}
        type="text"
        value={queryInput}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleInputKeyDown}
        placeholder="Type a path, or a prefix to filter. Press Enter to open."
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Directory path"
        data-testid="folder-path-input"
      />

      <div className={styles.breadcrumb} aria-label="Breadcrumb">
        <button
          className={styles.breadcrumbSegment}
          onClick={() => void navigateTo('/')}
          type="button"
        >
          /
        </button>
        {segments.map((seg, i) => (
          <span key={i}>
            <span className={styles.breadcrumbSep}>/</span>
            <button
              className={styles.breadcrumbSegment}
              onClick={() => navigateToSegment(i)}
              type="button"
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : notFound ? (
        <div className={styles.error}>Path not found: {queryInput}</div>
      ) : (
        <div className={styles.list}>
          {listBase && listBase !== '/' && (
            <button
              className={styles.entry}
              onClick={() => {
                const parent = listBase.split(/[/\\]/).slice(0, -1).join('/') || '/';
                void navigateTo(parent);
              }}
              type="button"
            >
              <span className={styles.entryIcon}>📁</span>
              <span className={styles.entryName}>..</span>
            </button>
          )}
          {dirs.map((fullPath) => {
            const name = fullPath.split(/[/\\]/).pop() || fullPath;
            return (
              <button
                key={fullPath}
                className={styles.entry}
                onClick={() => void navigateTo(fullPath)}
                type="button"
              >
                <span className={styles.entryIcon}>📁</span>
                <span className={styles.entryName}>{name}</span>
              </button>
            );
          })}
          {dirs.length === 0 && !notFound && (
            <div className={styles.loading}>No matching directories</div>
          )}
          {truncated && (
            <div className={styles.loading}>
              Showing first 500 results. Keep typing to narrow.
            </div>
          )}
        </div>
      )}

      <div className={styles.actions}>
        {onCancel && (
          <button className={styles.cancelBtn} onClick={onCancel} type="button">
            Cancel
          </button>
        )}
        <button
          className={styles.selectBtn}
          onClick={() => onSelect(currentDir)}
          disabled={loading}
          type="button"
        >
          Select
        </button>
      </div>
    </div>
  );
}
