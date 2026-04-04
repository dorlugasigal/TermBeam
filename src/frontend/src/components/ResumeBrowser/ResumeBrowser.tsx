import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { fetchAgentSessions, getResumeCommand, createSession } from '@/services/api';
import type { AgentSession } from '@/services/api';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { AgentIcon } from '@/components/common/AgentIcon';
import styles from './ResumeBrowser.module.css';

function folderName(dir: string): string {
  const parts = dir.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || dir;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

type AgentFilter = 'all' | 'copilot' | 'claude';

export default function ResumeBrowser() {
  const { resumeBrowserOpen, closeResumeBrowser } = useUIStore();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [timeRange, setTimeRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [resuming, setResuming] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async (searchText?: string) => {
    setLoading(true);
    try {
      const { sessions } = await fetchAgentSessions(100, searchText || undefined);
      setSessions(sessions);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (resumeBrowserOpen) {
      loadSessions();
      // Focus search after animation
      setTimeout(() => inputRef.current?.focus(), 300);
    } else {
      setSearch('');
      setFilter('all');
      setTimeRange('all');
      setFolderFilter('all');
    }
  }, [resumeBrowserOpen, loadSessions]);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadSessions(value), 300);
  }

  const folders = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => {
      if (s.cwd) set.add(s.cwd);
    });
    return [...set].sort();
  }, [sessions]);

  const filtered = useMemo(() => {
    let result = filter === 'all' ? sessions : sessions.filter((s) => s.agent === filter);

    if (folderFilter !== 'all') {
      result = result.filter((s) => s.cwd === folderFilter);
    }

    if (timeRange !== 'all') {
      const now = Date.now();
      const cutoffs = {
        today: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
      };
      const cutoff = now - cutoffs[timeRange];
      result = result.filter((s) => new Date(s.updatedAt).getTime() > cutoff);
    }

    return result;
  }, [sessions, filter, folderFilter, timeRange]);

  async function handleResume(session: AgentSession) {
    setResuming(session.id);
    try {
      const { command } = await getResumeCommand(session.agent, session.id);
      const store = useSessionStore.getState();
      const activeMs = store.activeId ? store.sessions.get(store.activeId) : null;
      const cols = activeMs?.term?.cols;
      const rows = activeMs?.term?.rows;

      const existingNames = new Set([...store.sessions.values()].map((s) => s.name));
      let name = folderName(session.cwd || '/');
      if (existingNames.has(name)) {
        let i = 2;
        while (existingNames.has(`${name} (${i})`)) i++;
        name = `${name} (${i})`;
      }

      const created = await createSession({
        name,
        cwd: session.cwd || undefined,
        initialCommand: command,
        color: session.agent === 'copilot' ? '#4a9eff' : '#c084fc',
        ...(cols && rows ? { cols, rows } : {}),
      });
      closeResumeBrowser();
      // Navigate to the new session
      window.history.pushState(null, '', `/terminal?id=${created.id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume session');
    } finally {
      setResuming(null);
    }
  }

  // ESC to close
  useEffect(() => {
    if (!resumeBrowserOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeResumeBrowser();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [resumeBrowserOpen, closeResumeBrowser]);

  if (!resumeBrowserOpen) return null;

  const copilotCount = sessions.filter((s) => s.agent === 'copilot').length;
  const claudeCount = sessions.filter((s) => s.agent === 'claude').length;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={closeResumeBrowser}>
          ←
        </button>
        <h1 className={styles.title}>Resume Session</h1>
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        {search && (
          <button
            className={styles.clearBtn}
            onClick={() => {
              setSearch('');
              loadSessions();
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${filter === 'all' ? styles.tabActive : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({sessions.length})
        </button>
        {copilotCount > 0 && (
          <button
            className={`${styles.tab} ${filter === 'copilot' ? styles.tabActive : ''}`}
            onClick={() => setFilter('copilot')}
          >
            Copilot ({copilotCount})
          </button>
        )}
        {claudeCount > 0 && (
          <button
            className={`${styles.tab} ${filter === 'claude' ? styles.tabActive : ''}`}
            onClick={() => setFilter('claude')}
          >
            Claude ({claudeCount})
          </button>
        )}
      </div>

      {/* Time range filter */}
      <div className={styles.timeFilters}>
        {(['all', 'today', 'week', 'month'] as const).map((range) => (
          <button
            key={range}
            className={`${styles.timeChip} ${timeRange === range ? styles.timeChipActive : ''}`}
            onClick={() => setTimeRange(range)}
          >
            {range === 'all'
              ? 'All time'
              : range === 'today'
                ? 'Today'
                : range === 'week'
                  ? 'This week'
                  : 'This month'}
          </button>
        ))}
      </div>

      {/* Folder filter */}
      {folders.length > 1 && (
        <div className={styles.folderFilter}>
          <select
            className={styles.folderSelect}
            value={folderFilter}
            onChange={(e) => setFolderFilter(e.target.value)}
          >
            <option value="all">All projects</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {folderName(f)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Result count */}
      <div className={styles.resultCount}>
        {filtered.length} session{filtered.length !== 1 ? 's' : ''}
      </div>

      {/* Session list */}
      <div className={styles.list}>
        {loading ? (
          <div className={styles.emptyState}>Loading sessions…</div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            {search ? `No sessions matching "${search}"` : 'No past agent sessions found'}
          </div>
        ) : (
          filtered.map((session) => (
            <button
              key={`${session.agent}-${session.id}`}
              className={styles.card}
              disabled={resuming !== null}
              onClick={() => handleResume(session)}
            >
              <div className={styles.cardTop}>
                <span className={styles.cardIcon}><AgentIcon agent={session.agentIcon} /></span>
                <span className={styles.cardSummary}>
                  {session.summary || 'Untitled session'}
                </span>
                {resuming === session.id && <span className={styles.spinner}>⟳</span>}
              </div>
              <div className={styles.cardMeta}>
                {session.cwd && <span className={styles.metaItem}>{folderName(session.cwd)}</span>}
                {session.branch && <span className={styles.metaItem}>{session.branch}</span>}
                <span className={styles.metaItem}>{formatTimeAgo(session.updatedAt)}</span>
                {session.turnCount > 0 && <span className={styles.metaItem}>{session.turnCount} turns</span>}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
