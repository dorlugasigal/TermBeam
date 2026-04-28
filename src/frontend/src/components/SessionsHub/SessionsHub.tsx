import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { fetchSessions, deleteSession, fetchVersion, getShareUrl } from '@/services/api';
import { useUIStore } from '@/stores/uiStore';
import ThemePicker from '@/components/common/ThemePicker';
import type { Session } from '@/types';
import UpdateBanner from '@/components/common/UpdateBanner';
import TunnelBanner from '@/components/common/TunnelBanner';
import SessionCard from './SessionCard';
import NewSessionModal from './NewSessionModal';
import ResumeBrowser from '@/components/ResumeBrowser/ResumeBrowser';
import WorkspaceLauncher from '@/components/WorkspaceLauncher/WorkspaceLauncher';
import FilterBar from './FilterBar';
import {
  EMPTY_FILTER,
  deriveFacets,
  filterSessions,
  isEmptyFilter,
  type SessionFilterState,
} from '@/utils/sessionFilter';
import styles from './SessionsHub.module.css';

const POLL_INTERVAL = 3000;
const FILTER_STORAGE_KEY = 'termbeam-hub-filter';

function loadFilterFromStorage(): SessionFilterState {
  try {
    const raw = sessionStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return EMPTY_FILTER;
    const parsed = JSON.parse(raw) as Partial<SessionFilterState>;
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      repo: typeof parsed.repo === 'string' ? parsed.repo : null,
      branch: typeof parsed.branch === 'string' ? parsed.branch : null,
      shell: typeof parsed.shell === 'string' ? parsed.shell : null,
      hasAgent: !!parsed.hasAgent,
    };
  } catch {
    return EMPTY_FILTER;
  }
}

/* clipboard fallback for non-secure (HTTP) contexts */
function fallbackCopyShare(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    toast.success('URL copied to clipboard');
  } catch {
    toast.error('Failed to copy URL');
  }
  document.body.removeChild(textarea);
}

const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export default function SessionsHub() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState('');
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SessionFilterState>(() => loadFilterFromStorage());
  const [workspaceLauncherOpen, setWorkspaceLauncherOpen] = useState(false);
  const { openNewSessionModal, openResumeBrowser, themePickerOpen, openThemePicker, closeThemePicker } = useUIStore();

  const loadSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list.filter((s) => !s.hidden));
    } catch {
      // Silently retry on next poll
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    const timer = setInterval(loadSessions, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [loadSessions]);

  useEffect(() => {
    fetchVersion().then((v) => {
      if (v) setVersion(v);
    });
  }, []);

  useEffect(() => {
    try {
      if (isEmptyFilter(filter)) sessionStorage.removeItem(FILTER_STORAGE_KEY);
      else sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filter));
    } catch {
      // ignore storage quota / private-mode errors
    }
  }, [filter]);

  const facets = useMemo(() => deriveFacets(sessions), [sessions]);
  const visibleSessions = useMemo(
    () => filterSessions(sessions, filter),
    [sessions, filter],
  );
  const filterActive = !isEmptyFilter(filter);

  function navigateToSession(id: string) {
    window.history.pushState(null, '', `/terminal?session=${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  async function handleDelete(id: string) {
    const session = sessions.find((s) => s.id === id);
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success(`Session "${session?.name ?? id}" deleted`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete session');
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      if ('caches' in window && typeof window.caches?.keys === 'function') {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      }
    } finally {
      location.reload();
    }
  }

  function handleShare() {
    getShareUrl().then((url) => {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(
          () => toast.success('URL copied to clipboard'),
          () => fallbackCopyShare(url),
        );
      } else {
        fallbackCopyShare(url);
      }
    });
  }

  return (
    <div className={styles.page}>
      <UpdateBanner />
      <TunnelBanner />

      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.title}>
            <span className={styles.brandIcon} aria-hidden="true">
              {'>_'}
            </span>
            <span className={styles.brandName}>
              Term<span className={styles.accent}>Beam</span>
            </span>
          </h1>
          {version ? (
            <span className={styles.version} data-testid="hub-version">
              v{version}
            </span>
          ) : null}
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.headerBtn}
            onClick={openThemePicker}
            aria-label="Choose theme"
            title="Theme"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="13.5" cy="6.5" r="1.5" fill="currentColor" />
              <circle cx="17.5" cy="10.5" r="1.5" fill="currentColor" />
              <circle cx="8.5" cy="7.5" r="1.5" fill="currentColor" />
              <circle cx="6.5" cy="12.5" r="1.5" fill="currentColor" />
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.52-4.48-10-10-10z" />
            </svg>
          </button>
          <button
            className={styles.headerBtn}
            onClick={handleShare}
            aria-label="Share URL"
            title="Share"
          >
            <ShareIcon />
          </button>
          <button
            className={styles.headerBtn}
            onClick={handleRefresh}
            aria-label="Refresh sessions"
            title="Refresh"
            data-testid="hub-refresh-btn"
          >
            <span className={refreshing ? styles.refreshSpin : ''} style={{ display: 'flex' }}>
              <RefreshIcon />
            </span>
          </button>
        </div>
      </header>

      <ThemePicker open={themePickerOpen} onClose={closeThemePicker} hideTrigger />

      <main className={styles.content}>
        {loading ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>⏳</span>
            <span className={styles.emptyText}>Loading sessions…</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className={styles.emptyState} data-testid="empty-state">
            <span className={styles.emptyIcon}>📡</span>
            <span className={styles.emptyText}>No active sessions</span>
            <span className={styles.emptyHint}>
              Tap &quot;+ New Session&quot; to create a new terminal session
            </span>
          </div>
        ) : (
          <>
            <FilterBar filter={filter} facets={facets} onChange={setFilter} />
            {visibleSessions.length === 0 ? (
              <div className={styles.emptyState} data-testid="empty-filtered">
                <span className={styles.emptyIcon}>🔍</span>
                <span className={styles.emptyText}>No sessions match your filters</span>
                <button
                  type="button"
                  className={`${styles.emptyHint} ${styles.emptyHintButton}`}
                  onClick={() => setFilter(EMPTY_FILTER)}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <div
                className={styles.sessionsList}
                data-testid="sessions-list"
                data-filter-active={filterActive || undefined}
              >
                {visibleSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onSelect={navigateToSession}
                    onDelete={handleDelete}
                    revealedId={revealedId}
                    onRevealChange={setRevealedId}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <div className={styles.hubFooter}>
        <button
          className={styles.newSessionBtn}
          onClick={() => openNewSessionModal()}
          aria-label="New session"
          data-testid="hub-new-session-btn"
        >
          + New Session
        </button>
        <button
          className={styles.resumeBtn}
          onClick={openResumeBrowser}
          aria-label="Resume agent"
        >
          ↺ Resume Agent
        </button>
        <button
          className={styles.workspaceBtn}
          onClick={() => setWorkspaceLauncherOpen(true)}
          aria-label="Open workspace"
          data-testid="hub-open-workspace-btn"
        >
          Open Workspace
        </button>
      </div>

      <NewSessionModal onCreated={navigateToSession} />
      <ResumeBrowser />
      <WorkspaceLauncher
        open={workspaceLauncherOpen}
        onClose={() => setWorkspaceLauncherOpen(false)}
        onLaunched={(id) => {
          if (id) navigateToSession(id);
        }}
      />
    </div>
  );
}
