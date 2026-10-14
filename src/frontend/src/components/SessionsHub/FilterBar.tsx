import { useEffect, useRef, useState } from 'react';
import type { SessionFilterState, FilterFacets } from '@/utils/sessionFilter';
import { isEmptyFilter } from '@/utils/sessionFilter';
import styles from './FilterBar.module.css';

interface Props {
  filter: SessionFilterState;
  facets: FilterFacets;
  onChange: (next: SessionFilterState) => void;
  /** Focus the search field on mount (opened from the phone search button). */
  autoFocus?: boolean;
}

type Dimension = 'repo' | 'branch' | 'shell';

export default function FilterBar({ filter, facets, onChange, autoFocus = false }: Props) {
  const [openMenu, setOpenMenu] = useState<Dimension | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (!groupRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenu]);

  const set = (patch: Partial<SessionFilterState>) => onChange({ ...filter, ...patch });

  const renderPickerChip = (
    dim: Dimension,
    label: string,
    options: string[],
    current: string | null,
  ) => {
    if (options.length === 0 && !current) return null;
    const display = current ?? label;
    const active = !!current;
    const isOpen = openMenu === dim;
    return (
      <div className={styles.chipGroup} key={dim} ref={isOpen ? groupRef : undefined}>
        <button
          type="button"
          className={`${styles.chip} ${active ? styles.chipActive : ''}`}
          onClick={() => setOpenMenu((m) => (m === dim ? null : dim))}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <span>{display}</span>
          <svg
            className={styles.chev}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {isOpen && (
          <div className={styles.chipMenu} role="menu">
            {current && (
              <button
                type="button"
                className={styles.chipMenuItem}
                onClick={() => {
                  set({ [dim]: null } as Partial<SessionFilterState>);
                  setOpenMenu(null);
                }}
                role="menuitem"
              >
                Clear {label}
              </button>
            )}
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`${styles.chipMenuItem} ${current === opt ? styles.chipMenuItemActive : ''}`}
                onClick={() => {
                  set({ [dim]: opt } as Partial<SessionFilterState>);
                  setOpenMenu(null);
                }}
                role="menuitemradio"
                aria-checked={current === opt}
              >
                <span>{opt}</span>
                {current === opt && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.bar} data-testid="sessions-filter-bar">
      <div className={styles.searchRow}>
        <div className={styles.searchWrap}>
          <svg
            className={styles.searchIcon}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className={styles.searchInput}
            placeholder="Search name, path, branch…"
            value={filter.text}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Search sessions"
            type="search"
            autoComplete="off"
            spellCheck={false}
            data-testid="sessions-search"
            autoFocus={autoFocus}
          />
          {filter.text && (
            <button
              type="button"
              className={styles.searchClearBtn}
              onClick={() => set({ text: '' })}
              aria-label="Clear search"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M7 7l10 10M17 7 7 17" />
              </svg>
            </button>
          )}
        </div>
        {!isEmptyFilter(filter) && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() =>
              onChange({ text: '', repo: null, branch: null, shell: null, hasAgent: false })
            }
            aria-label="Clear all filters"
          >
            Clear
          </button>
        )}
      </div>
      <div className={styles.chips}>
        {facets.hasAnyAgent && (
          <button
            type="button"
            className={`${styles.chip} ${filter.hasAgent ? styles.chipActive : ''}`}
            onClick={() => set({ hasAgent: !filter.hasAgent })}
            aria-pressed={filter.hasAgent}
          >
            Has agent
          </button>
        )}
        {renderPickerChip('repo', 'Repo', facets.repos, filter.repo)}
        {renderPickerChip('branch', 'Branch', facets.branches, filter.branch)}
        {renderPickerChip('shell', 'Shell', facets.shells, filter.shell)}
      </div>
    </div>
  );
}
