import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import { fetchSessions, deleteSession, fetchVersion, getShareUrl } from '@/services/api';
import { useUIStore } from '@/stores/uiStore';
import { useThemeStore } from '@/stores/themeStore';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';
import type { Session } from '@/types';
import UpdateBanner from '@/components/common/UpdateBanner';
import TunnelBanner from '@/components/common/TunnelBanner';
import SessionCard from './SessionCard';
import NewSessionModal from './NewSessionModal';
import ResumeBrowser from '@/components/ResumeBrowser/ResumeBrowser';
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

const ThemeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </svg>
);

export default function SessionsHub() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState('');
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SessionFilterState>(() => loadFilterFromStorage());
  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const themePanelRef = useRef<HTMLDivElement>(null);
  const { openNewSessionModal, openResumeBrowser } = useUIStore();
  const { themeId, setTheme } = useThemeStore();

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

  function handleToggleThemePicker() {
    setShowThemePicker((v) => !v);
  }

  useEffect(() => {
    if (!showThemePicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        themePanelRef.current &&
        !themePanelRef.current.contains(target) &&
        themeBtnRef.current &&
        !themeBtnRef.current.contains(target)
      ) {
        setShowThemePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showThemePicker]);

  return (
    <div className={styles.page}>
      <UpdateBanner />
      <TunnelBanner />

      <header className={styles.header}>
        <h1 className={styles.title}>
          📡 Term<span className={styles.accent}>Beam</span>
        </h1>
        <p className={styles.tagline}>
          Beam your terminal to any device
          {version ? <span data-testid="hub-version"> · v{version}</span> : ''}
        </p>

        <button
          className={`${styles.headerBtn} ${styles.shareBtn}`}
          onClick={handleShare}
          aria-label="Share URL"
          title="Share"
        >
          <ShareIcon />
        </button>
        <button
          className={`${styles.headerBtn} ${styles.refreshBtn}`}
          onClick={handleRefresh}
          aria-label="Refresh sessions"
          title="Refresh"
          data-testid="hub-refresh-btn"
        >
          <span className={refreshing ? styles.refreshSpin : ''} style={{ display: 'flex' }}>
            <RefreshIcon />
          </span>
        </button>
        <button
          className={`${styles.headerBtn} ${styles.themeBtn}`}
          onClick={handleToggleThemePicker}
          aria-label="Change theme"
          title="Change theme"
          ref={themeBtnRef}
        >
          <ThemeIcon />
        </button>
      </header>

      {showThemePicker && (
        <div className={styles.themePanel} ref={themePanelRef}>
          <div className={styles.themePanelHeader}>
            <span className={styles.themePanelTitle}>Theme</span>
            <button
              className={styles.themePanelClose}
              onClick={() => setShowThemePicker(false)}
              aria-label="Close theme picker"
            >
              ✕
            </button>
          </div>
          <div className={styles.themePanelList}>
            {THEMES.map((theme) => {
              const rc = parseInt(theme.bg.slice(1, 3), 16);
              const gc = parseInt(theme.bg.slice(3, 5), 16);
              const bc = parseInt(theme.bg.slice(5, 7), 16);
              const isLight = (rc + gc + bc) / 3 > 140;
              const isActive = theme.id === themeId;
              return (
                <button
                  key={theme.id}
                  className={`${styles.themeRow} ${isActive ? styles.themeRowActive : ''}`}
                  onClick={() => setTheme(theme.id as ThemeId)}
                >
                  <span className={styles.themeBar}>
                    <span style={{ flex: 40, background: theme.bg }} />
                    <span style={{ flex: 30, background: theme.surface }} />
                    <span style={{ flex: 20, background: theme.accent }} />
                    <span style={{ flex: 10, background: theme.text }} />
                  </span>
                  <span
                    className={styles.themeLabel}
                    style={isLight ? { color: '#1a1a1a', textShadow: 'none' } : undefined}
                  >
                    {theme.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

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
          aria-label="Resume session"
        >
          ↺ Resume
        </button>
      </div>

      <NewSessionModal onCreated={navigateToSession} />
      <ResumeBrowser />
    </div>
  );
}
