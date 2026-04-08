import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { fetchAgentSessions, getResumeCommand, createSession, resumeCopilotSdkSession } from '@/services/api';
import type { AgentSession } from '@/services/api';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { AgentIcon } from '@/components/common/AgentIcon';
import { CopilotLogo } from '@/components/common/CopilotLogo';
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

type AgentFilter = 'all' | 'copilot' | 'claude' | 'opencode';

export default function ResumeBrowser() {
  const { resumeBrowserOpen, closeResumeBrowser } = useUIStore();
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<AgentFilter>('all');
  const [timeRange, setTimeRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [folderFilter, setFolderFilter] = useState<string>('all');
  const [resuming, setResuming] = useState<string | null>(null);
  const [resumeChoice, setResumeChoice] = useState<{ session: AgentSession; name: string } | null>(
    null,
  );
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const loadSessions = useCallback(async (searchText?: string) => {
    const thisRequest = ++requestId.current;
    setLoading(true);
    try {
      const { sessions } = await fetchAgentSessions(100, searchText || undefined);
      if (thisRequest === requestId.current) {
        setSessions(sessions);
      }
    } catch {
      if (thisRequest === requestId.current) {
        setSessions([]);
      }
    } finally {
      if (thisRequest === requestId.current) {
        setLoading(false);
      }
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
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
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

  function getUniqueName(session: AgentSession): string {
    const store = useSessionStore.getState();
    const existingNames = new Set([...store.sessions.values()].map((s) => s.name));
    let name = folderName(session.cwd || '/');
    if (existingNames.has(name)) {
      let i = 2;
      while (existingNames.has(`${name} (${i})`)) i++;
      name = `${name} (${i})`;
    }
    return name;
  }

  function handleResume(session: AgentSession) {
    if (session.agent === 'copilot') {
      // Show choice dialog for Copilot sessions
      setResumeChoice({ session, name: getUniqueName(session) });
    } else {
      executeTerminalResume(session, getUniqueName(session));
    }
  }

  async function executeTerminalResume(session: AgentSession, name: string) {
    setResuming(`${session.agent}-${session.id}`);
    setResumeChoice(null);
    try {
      const store = useSessionStore.getState();
      const activeMs = store.activeId ? store.sessions.get(store.activeId) : null;
      const cols = activeMs?.term?.cols;
      const rows = activeMs?.term?.rows;

      const { command } = await getResumeCommand(session.agent, session.id);
      const created = await createSession({
        name,
        cwd: session.cwd || undefined,
        initialCommand: command,
        color: '#c084fc',
        ...(cols && rows ? { cols, rows } : {}),
      });
      closeResumeBrowser();
      window.history.pushState(null, '', `/terminal?id=${created.id}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resume session');
    } finally {
      setResuming(null);
    }
  }

  async function executeAgentUiResume(session: AgentSession, name: string) {
    setResuming(`${session.agent}-${session.id}`);
    setResumeChoice(null);
    try {
      const created = await resumeCopilotSdkSession(session.id, { name, cwd: session.cwd || undefined });
      const store = useSessionStore.getState();

      // Register companion PTY (hidden)
      if (created.ptySessionId && !store.sessions.has(created.ptySessionId)) {
        store.addSession({
          id: created.ptySessionId,
          name: `${name} Terminal`,
          type: 'terminal',
          hidden: true,
          shell: '',
          pid: 0,
          cwd: session.cwd || '',
          color: '#6ec1e4',
          createdAt: new Date().toISOString(),
          lastActivity: Date.now(),
          term: null,
          fitAddon: null,
          searchAddon: null,
          ws: null,
          send: null,
          connected: false,
          exited: false,
          scrollback: '',
          hasUnread: false,
        });
      }

      // Register the copilot session
      if (!store.sessions.has(created.id)) {
        store.addSession({
          id: created.id,
          name,
          type: 'copilot',
          shell: '',
          pid: 0,
          cwd: session.cwd || '',
          color: '#a855f6',
          createdAt: new Date().toISOString(),
          lastActivity: Date.now(),
          companionTermId: created.ptySessionId ?? undefined,
          term: null,
          fitAddon: null,
          searchAddon: null,
          ws: null,
          send: null,
          connected: true,
          exited: false,
          scrollback: '',
          hasUnread: false,
        });
      }
      store.setActiveId(created.id);

      closeResumeBrowser();
      window.history.pushState(null, '', `/terminal?session=${created.id}`);
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
      if (e.key === 'Escape') {
        if (resumeChoice) {
          setResumeChoice(null);
        } else {
          closeResumeBrowser();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [resumeBrowserOpen, closeResumeBrowser, resumeChoice]);

  if (!resumeBrowserOpen) return null;

  const copilotCount = sessions.filter((s) => s.agent === 'copilot').length;
  const claudeCount = sessions.filter((s) => s.agent === 'claude').length;
  const opencodeCount = sessions.filter((s) => s.agent === 'opencode').length;

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button
          className={styles.backBtn}
          onClick={closeResumeBrowser}
          aria-label="Go back"
          type="button"
        >
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
            aria-label="Clear search"
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
        {opencodeCount > 0 && (
          <button
            className={`${styles.tab} ${filter === 'opencode' ? styles.tabActive : ''}`}
            onClick={() => setFilter('opencode')}
          >
            OpenCode ({opencodeCount})
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
                <span className={styles.cardIcon}>
                  <AgentIcon agent={session.agentIcon} />
                </span>
                <span className={styles.cardSummary}>{session.summary || 'Untitled session'}</span>
                {resuming === `${session.agent}-${session.id}` && (
                  <span className={styles.spinner}>⟳</span>
                )}
              </div>
              <div className={styles.cardMeta}>
                {session.cwd && <span className={styles.metaItem}>{folderName(session.cwd)}</span>}
                {session.branch && <span className={styles.metaItem}>{session.branch}</span>}
                <span className={styles.metaItem}>{formatTimeAgo(session.updatedAt)}</span>
                {session.turnCount > 0 && (
                  <span className={styles.metaItem}>{session.turnCount} turns</span>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* Resume method choice for Copilot sessions */}
      {resumeChoice && (
        <div className={styles.choiceOverlay} onClick={() => setResumeChoice(null)}>
          <div className={styles.choiceDialog} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.choiceTitle}>Resume Copilot Session</h2>
            <p className={styles.choiceDesc}>
              {resumeChoice.session.summary || 'Untitled session'}
            </p>
            <div className={styles.choiceOptions}>
              <button
                className={styles.choiceBtn}
                disabled={resuming !== null}
                onClick={() =>
                  executeTerminalResume(resumeChoice.session, resumeChoice.name)
                }
              >
                <span className={styles.choiceBtnIcon}>
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM7.25 8a.749.749 0 0 1-.22.53l-2.25 2.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L5.44 8 3.72 6.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.25 2.25c.141.14.22.331.22.53Zm1.5 1.5h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Z" />
                  </svg>
                </span>
                <span className={styles.choiceBtnLabel}>Terminal</span>
                <span className={styles.choiceBtnHint}>Pure CLI experience</span>
              </button>
              <button
                className={styles.choiceBtn}
                disabled={resuming !== null}
                onClick={() =>
                  executeAgentUiResume(resumeChoice.session, resumeChoice.name)
                }
              >
                <span className={styles.choiceBtnIcon}><CopilotLogo size={18} /></span>
                <span className={styles.choiceBtnLabel}>Agent UI</span>
                <span className={styles.choiceBtnHint}>Copilot SDK interface</span>
              </button>
            </div>
            {resuming && <div className={styles.choiceSpinner}>⟳ Resuming…</div>}
          </div>
        </div>
      )}
    </div>
  );
}
