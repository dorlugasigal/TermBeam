import { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import styles from './SearchBar.module.css';

export default function SearchBar() {
  const open = useUIStore((s) => s.searchBarOpen);
  const closeSearch = useUIStore((s) => s.closeSearchBar);
  const activeId = useSessionStore((s) => s.activeId);
  const [query, setQuery] = useState('');
  const [regex, setRegex] = useState(false);
  const [hasResults, setHasResults] = useState<boolean | null>(null);
  const [matchCount, setMatchCount] = useState<{ resultIndex: number; resultCount: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  const getAddon = useCallback(() => {
    if (!activeId) return null;
    const ms = useSessionStore.getState().sessions.get(activeId);
    return ms?.searchAddon ?? null;
  }, [activeId]);

  // Listen for search result count updates
  useEffect(() => {
    if (!open) return;
    const addon = getAddon();
    if (!addon) return;
    const disposable = addon.onDidChangeResults(
      (e: { resultIndex: number; resultCount: number }) => {
        setMatchCount(e);
      },
    );
    return () => disposable.dispose();
  }, [open, getAddon]);

  const doSearch = useCallback(
    (term: string, direction: 'next' | 'prev') => {
      const addon = getAddon();
      if (!addon || !term) {
        setHasResults(null);
        return;
      }
      const opts = { regex, caseSensitive: false, incremental: true };
      const found =
        direction === 'next' ? addon.findNext(term, opts) : addon.findPrevious(term, opts);
      setHasResults(found);
    },
    [getAddon, regex],
  );

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      doSearch(value, 'next');
    },
    [doSearch],
  );

  const handleClose = useCallback(() => {
    const addon = getAddon();
    addon?.clearDecorations();
    setQuery('');
    setHasResults(null);
    setMatchCount(null);
    closeSearch();
    // Re-focus the terminal
    if (activeId) {
      const ms = useSessionStore.getState().sessions.get(activeId);
      ms?.term?.focus();
    }
  }, [getAddon, closeSearch, activeId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch(query, e.shiftKey ? 'prev' : 'next');
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    },
    [query, doSearch, handleClose],
  );

  if (!open) return null;

  return (
    <div className={styles.searchBar} data-testid="search-bar" data-open="true">
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        placeholder="Search..."
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        data-testid="search-input"
      />
      <button
        className={styles.btn}
        onClick={() => doSearch(query, 'prev')}
        title="Previous (Shift+Enter)"
        data-testid="search-prev"
      >
        ▲
      </button>
      <button
        className={styles.btn}
        onClick={() => doSearch(query, 'next')}
        title="Next (Enter)"
        data-testid="search-next"
      >
        ▼
      </button>
      <button
        className={`${styles.btn} ${regex ? styles.btnActive : ''}`}
        onClick={() => setRegex((v) => !v)}
        title="Regex"
      >
        .*
      </button>
      {hasResults !== null && (
        <span className={styles.indicator}>
          {matchCount && matchCount.resultCount > 0
            ? `${matchCount.resultIndex + 1} of ${matchCount.resultCount}`
            : hasResults
              ? 'Found'
              : 'No results'}
        </span>
      )}
      <button
        className={styles.btn}
        onClick={handleClose}
        title="Close (Esc)"
        data-testid="search-close"
      >
        ✕
      </button>
    </div>
  );
}
