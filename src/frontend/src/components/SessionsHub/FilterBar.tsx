import { useEffect, useRef, useState } from 'react';
import type { SessionFilterState, FilterFacets } from '@/utils/sessionFilter';
import { isEmptyFilter } from '@/utils/sessionFilter';
import styles from './FilterBar.module.css';

interface Props {
  filter: SessionFilterState;
  facets: FilterFacets;
  onChange: (next: SessionFilterState) => void;
}

type Dimension = 'repo' | 'branch' | 'shell';

export default function FilterBar({ filter, facets, onChange }: Props) {
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
          {active ? '✓ ' : ''}
          {display}
          {active ? '' : ' ▾'}
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
                role="menuitem"
              >
                {opt}
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
        />
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
            {filter.hasAgent ? '✓ ' : ''}Has agent
          </button>
        )}
        {renderPickerChip('repo', 'Repo', facets.repos, filter.repo)}
        {renderPickerChip('branch', 'Branch', facets.branches, filter.branch)}
        {renderPickerChip('shell', 'Shell', facets.shells, filter.shell)}
      </div>
    </div>
  );
}
