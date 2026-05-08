import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { fetchSessions, deleteSession, fetchVersion, getShareUrl } from '@/services/api';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useDissolveDelete } from '@/hooks/useDissolveDelete';
import ThemePicker from '@/components/common/ThemePicker';
import type { Session } from '@/types';
import UpdateBanner from '@/components/common/UpdateBanner';
import TunnelBanner from '@/components/common/TunnelBanner';
import SessionCard from './SessionCard';
import { Wordmark } from '@/components/common/Wordmark';
import NewSessionModal from './NewSessionModal';
import ResumeBrowser from '@/components/ResumeBrowser/ResumeBrowser';
import WorkspaceLauncher from '@/components/WorkspaceLauncher/WorkspaceLauncher';
import FilterBar from './FilterBar';
import { HUB_TIPS, getTipAt, pickRandomTipIndex } from './tips';
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
/** Minimum horizontal travel (px) to count a swipe on the tip card. */
const TIP_SWIPE_THRESHOLD = 40;

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
  const [arriving, setArriving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState('');
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SessionFilterState>(() => loadFilterFromStorage());
  const [workspaceLauncherOpen, setWorkspaceLauncherOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const prevLoadingRef = useRef(true);
  const {
    openNewSessionModal,
    openResumeBrowser,
    themePickerOpen,
    openThemePicker,
    closeThemePicker,
  } = useUIStore();

  const dissolvingIds = useSessionStore((s) => s.dissolvingIds);
  const dissolveDelete = useDissolveDelete();

  const loadSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      const visible = list.filter((s) => !s.hidden);
      setSessions((prev) => {
        // Re-include any sessions currently mid-dissolve so the row
        // stays mounted long enough for the disintegrate animation to
        // play. The server has already removed them by this point.
        const visibleIds = new Set(visible.map((s) => s.id));
        const dissolveExtras = prev.filter(
          (s) => useSessionStore.getState().dissolvingIds.has(s.id) && !visibleIds.has(s.id),
        );
        return [...visible, ...dissolveExtras];
      });
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

  // SessionsHub flips arriving=true for ~2s once the initial fetch resolves
  // so the sequential fold-in cascade has room to play (8 cards * 220ms
  // stagger + 0.38s duration ≈ 2.1s).
  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      setArriving(true);
      const t = setTimeout(() => setArriving(false), 2200);
      prevLoadingRef.current = loading;
      return () => clearTimeout(t);
    }
    prevLoadingRef.current = loading;
  }, [loading]);

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
  const visibleSessions = useMemo(() => filterSessions(sessions, filter), [sessions, filter]);
  const filterActive = !isEmptyFilter(filter);

  // Pin a starting tip for the lifetime of this hub mount so the carousel
  // doesn't reshuffle while the user is looking at it. A fresh starting
  // tip is picked on the next visit / refresh, and the user can page
  // forward/back from there.
  const [tipIndex, setTipIndex] = useState<number>(() => pickRandomTipIndex());
  const tip = getTipAt(tipIndex);
  const tipCount = HUB_TIPS.length;
  const showPrevTip = useCallback(() => setTipIndex((i) => i - 1), []);
  const showNextTip = useCallback(() => setTipIndex((i) => i + 1), []);
  const tipSwipeStartX = useRef<number | null>(null);

  function navigateToSession(id: string) {
    window.history.pushState(null, '', `/terminal?session=${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  async function handleDelete(id: string) {
    const session = sessions.find((s) => s.id === id);
    const element = listRef.current?.querySelector<HTMLElement>(
      `[data-session-id="${id}"]`,
    );
    try {
      await dissolveDelete(id, {
        element: element ?? null,
        color: session?.color ?? '#6ec1e4',
        apiDelete: () => deleteSession(id),
        finalize: () => {
          // Hub deletes must clear the GLOBAL session store too, not just our
          // local list. The global store may already hold this session if the
          // user previously visited TerminalApp during the same SPA session
          // (the Map persists across mount/unmount of TerminalApp). Without
          // this, a later SPA navigation back to /terminal would re-mount
          // TerminalPanes for the orphan ids in tabOrder, fail WS attach with
          // "Session not found", and leak the deleted id back into localStorage.
          // removeSession also adds the id to deletedIds so any in-flight
          // attach error toasts are suppressed.
          const store = useSessionStore.getState();
          const ms = store.sessions.get(id);
          if (ms?.companionTermId) store.removeSession(ms.companionTermId);
          store.removeSession(id);
          setSessions((prev) => prev.filter((s) => s.id !== id));
        },
      });
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
            <Wordmark size="sm" animated={false} />
            {version ? (
              <span className={styles.version} data-testid="hub-version">
                v{version}
              </span>
            ) : null}
          </h1>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.headerBtn}
            onClick={openThemePicker}
            aria-label="Choose theme"
            title="Theme"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
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

      <main className={styles.content} aria-busy={loading || undefined}>
        {loading ? null : sessions.length === 0 ? (
          <div className={styles.emptyState} data-testid="empty-state">
            <Wordmark size="md" />
            <span className={styles.emptyText}>No active sessions</span>
            <span className={styles.emptyHint}>
              Tap &quot;+ New Session&quot; to create a new terminal session
            </span>

            <div
              className={styles.tipCard}
              data-testid="hub-tip"
              role="region"
              aria-label="Tip carousel"
              aria-live="polite"
              onTouchStart={(e) => {
                tipSwipeStartX.current = e.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(e) => {
                const start = tipSwipeStartX.current;
                tipSwipeStartX.current = null;
                if (start == null) return;
                const dx = (e.changedTouches[0]?.clientX ?? start) - start;
                if (dx <= -TIP_SWIPE_THRESHOLD) showNextTip();
                else if (dx >= TIP_SWIPE_THRESHOLD) showPrevTip();
              }}
            >
              <span className={styles.tipBadge}>Tip</span>
              <span className={styles.tipIcon} aria-hidden="true">
                {tip.icon}
              </span>
              <div className={styles.tipBody}>
                <strong className={styles.tipTitle}>{tip.title}</strong>
                <span className={styles.tipText}>{tip.body}</span>
              </div>
              <div className={styles.tipNav} data-testid="hub-tip-nav">
                <button
                  type="button"
                  className={styles.tipNavBtn}
                  onClick={showPrevTip}
                  aria-label="Previous tip"
                  data-testid="hub-tip-prev"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <span
                  className={styles.tipCounter}
                  aria-label={`Tip ${(((tipIndex % tipCount) + tipCount) % tipCount) + 1} of ${tipCount}`}
                  data-testid="hub-tip-counter"
                >
                  {(((tipIndex % tipCount) + tipCount) % tipCount) + 1}
                  <span aria-hidden="true"> / {tipCount}</span>
                </span>
                <button
                  type="button"
                  className={styles.tipNavBtn}
                  onClick={showNextTip}
                  aria-label="Next tip"
                  data-testid="hub-tip-next"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
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
                ref={listRef}
                className={styles.sessionsList}
                data-testid="sessions-list"
                data-filter-active={filterActive || undefined}
                data-arriving={arriving || undefined}
              >
                {visibleSessions.map((session, i) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onSelect={navigateToSession}
                    onDelete={handleDelete}
                    revealedId={revealedId}
                    onRevealChange={setRevealedId}
                    index={i}
                    arriving={arriving}
                    dissolving={dissolvingIds.has(session.id)}
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
        <button className={styles.resumeBtn} onClick={openResumeBrowser} aria-label="Resume agent">
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
