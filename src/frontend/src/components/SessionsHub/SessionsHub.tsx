import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { fetchSessions, deleteSession, fetchVersion } from '@/services/api';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useDissolveDelete } from '@/hooks/useDissolveDelete';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { navigate } from '@/utils/navigation';
import ThemePicker from '@/components/common/ThemePicker';
import SettingsPanel from '@/components/SettingsPanel/SettingsPanel';
import CustomKeysModal from '@/components/CustomKeysModal/CustomKeysModal';
import ToolsPanel from '@/components/ToolsPanel/ToolsPanel';
import { ConnectionPill, BeamLine } from '@/components/ConnectionStatus/ConnectionPill';
import type { Session } from '@/types';
import UpdateBanner from '@/components/common/UpdateBanner';
import { Wordmark } from '@/components/common/Wordmark';
import ResumeBrowser from '@/components/ResumeBrowser/ResumeBrowser';
import WorkspaceLauncher from '@/components/WorkspaceLauncher/WorkspaceLauncher';
import SessionCard, { Breakable } from './SessionCard';
import NewSessionModal from './NewSessionModal';
import FilterBar from './FilterBar';
import { GitStatusLine } from './GitStatusLine';
import { HUB_TIPS, getTipAt, pickRandomTipIndex } from './tips';
import {
  EMPTY_FILTER,
  deriveFacets,
  filterSessions,
  isEmptyFilter,
  type SessionFilterState,
} from '@/utils/sessionFilter';
import { gitStatusParts, groupSessions, splitRepoName } from '@/utils/sessionDisplay';
import styles from './SessionsHub.module.css';

const POLL_INTERVAL = 3000;
const FILTER_STORAGE_KEY = 'termbeam-hub-filter';
/** Search and facets appear once the list is long enough to need them. */
const FILTER_MIN_SESSIONS = 5;
/** Minimum horizontal travel (px) to count a swipe on the tip card. */
const TIP_SWIPE_THRESHOLD = 40;

/** The list cascades in once per page load, not on every return to the hub. */
let introPlayed = false;
/** Last list seen, so returning to the hub renders instantly (then refreshes). */
let cachedSessions: Session[] | null = null;

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

const svg = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const ToolsIcon = () => (
  <svg {...svg} width={18} height={18}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
  </svg>
);

const SearchIcon = () => (
  <svg {...svg} width={18} height={18}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

const PlusIcon = () => (
  <svg {...svg} strokeWidth={2.2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const ResumeIcon = () => (
  <svg {...svg}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4v4.5H8" />
    <path d="M12 8v4.2l2.8 1.8" />
  </svg>
);

const WorkspaceIcon = () => (
  <svg {...svg}>
    <path d="M12 3.5 3.5 8 12 12.5 20.5 8 12 3.5Z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16 8.5 4.5 8.5-4.5" />
  </svg>
);

const BranchIcon = () => (
  <svg {...svg} width={14} height={14} strokeWidth={2}>
    <circle cx="6" cy="5.5" r="2.2" />
    <circle cx="6" cy="18.5" r="2.2" />
    <circle cx="18" cy="7.5" r="2.2" />
    <path d="M6 7.7v8.6M18 9.7c0 4.3-6 3.8-11 6.6" />
  </svg>
);

const ChevronIcon = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg {...svg} width={16} height={16} strokeWidth={2}>
    <path d={dir === 'left' ? 'M14.5 6 8.5 12l6 6' : 'M9.5 6l6 6-6 6'} />
  </svg>
);

const GitHubMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
  </svg>
);

const GitLabMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="m23.6 9.6-.03-.09-3.26-8.5a.85.85 0 0 0-1.62.06l-2.2 6.74H7.5L5.3 1.07a.85.85 0 0 0-1.62-.06L.43 9.5l-.03.09a6.06 6.06 0 0 0 2 7l.01.01.03.02 4.97 3.73 2.46 1.86 1.5 1.13a1 1 0 0 0 1.22 0l1.5-1.13 2.46-1.86 5-3.75.01-.01a6.06 6.06 0 0 0 2-6.99Z" />
  </svg>
);

function ProviderMark({ provider }: { provider?: string | null }) {
  const p = provider?.toLowerCase() ?? '';
  if (p.includes('github')) return <GitHubMark />;
  if (p.includes('gitlab')) return <GitLabMark />;
  return null;
}

function GroupHeader({ git }: { git: NonNullable<Session['git']> | null }) {
  if (!git) {
    return (
      <div className={styles.groupHead}>
        <span className={styles.groupNone}>Not in a repository</span>
      </div>
    );
  }
  const { owner, name } = splitRepoName(git.repoName);
  return (
    <div className={styles.groupHead}>
      <div className={styles.repoRow}>
        {name && (
          <span className={styles.repo} title={git.provider ?? undefined}>
            <ProviderMark provider={git.provider} />
            <span>
              {owner && <span className={styles.repoOwner}>{owner}</span>}
              <span className={styles.repoName}>{name}</span>
            </span>
          </span>
        )}
        <GitStatusLine parts={gitStatusParts(git.status)} />
      </div>
      {git.branch && (
        <span className={styles.branch}>
          <BranchIcon />
          <span>
            <Breakable text={git.branch} />
          </span>
        </span>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className={styles.list} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={styles.skeletonRow} style={{ ['--i' as string]: i }}>
          <i style={{ width: '34%' }} />
          <i style={{ width: '62%' }} />
          <i style={{ width: '26%' }} />
        </div>
      ))}
    </div>
  );
}

/** Two devices and the link between them, drawn in hairlines. */
function BeamIllustration() {
  return (
    <svg
      className={styles.illustration}
      width="168"
      height="64"
      viewBox="0 0 168 64"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1" y="9" width="62" height="42" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M22 59h20M32 51v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M11 22l6 5-6 5M21 33h9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="139" y="11" width="28" height="46" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M149 52h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path className={styles.beamTrack} d="M72 32h58" strokeWidth="1.5" strokeLinecap="round" />
      <path className={styles.beamPulse} d="M72 32h58" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function SessionsHub() {
  const [sessions, setSessions] = useState<Session[]>(() => cachedSessions ?? []);
  const [loading, setLoading] = useState(() => cachedSessions === null);
  // The row that shares its name with the terminal tab across the route
  // transition: the session we came back from, then whichever one is opened.
  const [morphId, setMorphId] = useState<string | null>(() => useSessionStore.getState().activeId);
  const [fetchError, setFetchError] = useState(false);
  const [version, setVersion] = useState('');
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<SessionFilterState>(() => loadFilterFromStorage());
  const [workspaceLauncherOpen, setWorkspaceLauncherOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [intro] = useState(() => !introPlayed);
  const wide = useMediaQuery('(min-width: 720px)');
  const listRef = useRef<HTMLDivElement>(null);
  const {
    openNewSessionModal,
    openResumeBrowser,
    themePickerOpen,
    closeThemePicker,
    toggleToolsPanel,
    customKeysModalOpen,
    closeCustomKeysModal,
  } = useUIStore();

  const dissolvingIds = useSessionStore((s) => s.dissolvingIds);
  const dissolveDelete = useDissolveDelete();

  const loadSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      useConnectionStore.getState().reportHttpSuccess();
      setFetchError(false);
      const visible = list.filter((s) => !s.hidden);
      cachedSessions = visible;
      setSessions((prev) => {
        // Keep rows that are mid-delete mounted so their exit can finish —
        // the server has already dropped them by now.
        const visibleIds = new Set(visible.map((s) => s.id));
        const dissolveExtras = prev.filter(
          (s) => useSessionStore.getState().dissolvingIds.has(s.id) && !visibleIds.has(s.id),
        );
        return [...visible, ...dissolveExtras];
      });
    } catch {
      useConnectionStore.getState().reportHttpFailure();
      setFetchError(true);
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
    if (!loading) introPlayed = true;
  }, [loading]);

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
  const groups = useMemo(() => groupSessions(visibleSessions), [visibleSessions]);
  const filterActive = !isEmptyFilter(filter);
  const filterAvailable = !loading && (sessions.length >= FILTER_MIN_SESSIONS || filterActive);
  // Phones keep search behind the bar's magnifier; wide screens show it inline.
  const showFilter = filterAvailable && (wide || searchOpen || filterActive);
  const repoCount = groups.filter((g) => g.key !== 'none').length;
  // A lone group of loose shells needs no "Not in a repository" heading.
  const showGroupHeads = groups.length > 1 || repoCount > 0;

  const [tipIndex, setTipIndex] = useState<number>(() => pickRandomTipIndex());
  const tip = getTipAt(tipIndex);
  const tipCount = HUB_TIPS.length;
  const tipNumber = (((tipIndex % tipCount) + tipCount) % tipCount) + 1;
  const showPrevTip = useCallback(() => setTipIndex((i) => i - 1), []);
  const showNextTip = useCallback(() => setTipIndex((i) => i + 1), []);
  const tipSwipeStartX = useRef<number | null>(null);

  function navigateToSession(id: string) {
    // Name the row before the transition captures the old screen
    flushSync(() => setMorphId(id));
    navigate(`/terminal?session=${id}`);
  }

  async function handleDelete(id: string) {
    const session = sessions.find((s) => s.id === id);
    const element = listRef.current?.querySelector<HTMLElement>(`[data-session-id="${id}"]`);
    try {
      await dissolveDelete(id, {
        element: element ?? null,
        color: session?.color ?? '#6ec1e4',
        apiDelete: () => deleteSession(id),
        finalize: () => {
          // Clear the GLOBAL store too: it may still hold this session from an
          // earlier visit to the terminal view, and a later SPA navigation would
          // otherwise re-mount a pane for it and fail to attach.
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

  // Cmd/Ctrl+K toggles the Tools panel (as in the terminal view) unless the
  // user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        const target = e.target as HTMLElement | null;
        const isEditable =
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.isContentEditable;
        if (isEditable) return;
        e.preventDefault();
        toggleToolsPanel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggleToolsPanel]);

  let subtitle: string;
  if (loading) subtitle = 'Looking for running sessions…';
  else if (fetchError && sessions.length === 0) subtitle = 'Connection interrupted';
  else if (sessions.length === 0) subtitle = 'Nothing running yet';
  else if (filterActive) subtitle = `Showing ${visibleSessions.length} of ${sessions.length}`;
  else {
    subtitle = `${sessions.length} running`;
    if (repoCount > 1) subtitle += ` across ${repoCount} repositories`;
  }

  let rowIndex = 0;

  return (
    <div
      className={styles.page}
      data-scrolled={scrolled || undefined}
      onScroll={(e) => {
        const next = e.currentTarget.scrollTop > 4;
        if (next !== scrolled) setScrolled(next);
      }}
    >
      <UpdateBanner />

      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Wordmark size="sm" animated={false} className={styles.wordmark} />
          <div className={styles.barEnd}>
            <ConnectionPill />
            {filterAvailable && !wide && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setSearchOpen((o) => !o)}
                aria-label="Search sessions"
                aria-expanded={showFilter}
                data-active={showFilter || undefined}
              >
                <SearchIcon />
              </button>
            )}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={toggleToolsPanel}
              aria-label="Tools"
              title="Tools (Ctrl+K)"
              data-testid="palette-trigger"
            >
              <ToolsIcon />
            </button>
          </div>
        </div>
        <BeamLine />
      </header>

      <ThemePicker open={themePickerOpen} onClose={closeThemePicker} hideTrigger />
      <ToolsPanel inHub />
      <SettingsPanel inHub />
      <CustomKeysModal open={customKeysModalOpen} onClose={closeCustomKeysModal} />

      <main className={styles.main} aria-busy={loading || undefined}>
        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>Sessions</h1>
            <p className={styles.subtitle} aria-live="polite">
              {subtitle}
            </p>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnTonal} ${styles.resumeBtn}`}
              onClick={openResumeBrowser}
              aria-label="Resume agent session"
              title="Resume a Copilot or Claude session"
            >
              <ResumeIcon />
              <span className={styles.labelShort}>Resume</span>
              <span className={styles.labelLong}>Resume agent</span>
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnTonal} ${styles.workspaceBtn}`}
              onClick={() => setWorkspaceLauncherOpen(true)}
              aria-label="Open workspace"
              title="Open a saved workspace"
              data-testid="hub-open-workspace-btn"
            >
              <WorkspaceIcon />
              <span className={styles.labelLong}>Open workspace</span>
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary} ${styles.newBtn}`}
              onClick={() => openNewSessionModal()}
              data-testid="hub-new-session-btn"
            >
              <PlusIcon />
              <span>New session</span>
            </button>
          </div>
        </div>

        {showFilter && (
          <FilterBar
            filter={filter}
            facets={facets}
            onChange={setFilter}
            autoFocus={!wide && searchOpen && !filterActive}
          />
        )}

        {loading ? (
          <div role="status" aria-label="Loading sessions">
            <SkeletonList />
          </div>
        ) : fetchError && sessions.length === 0 ? (
          <div className={styles.state} data-testid="hub-unreachable">
            <p className={styles.stateTitle}>Can&apos;t reach your computer</p>
            <p className={styles.stateText}>
              The connection was interrupted. TermBeam keeps retrying on its own.
            </p>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnTonal}`}
              onClick={() => {
                useConnectionStore.getState().retryNow();
                void loadSessions();
              }}
            >
              Retry now
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className={styles.state} data-testid="empty-state">
            <BeamIllustration />
            <p className={styles.stateTitle}>No active sessions</p>
            <p className={styles.stateText}>
              Start a shell on this computer, then pick it up from any device.
            </p>

            <figure
              className={styles.tip}
              data-testid="hub-tip"
              role="region"
              aria-label="Tip"
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
              <figcaption className={styles.tipHead}>
                <span className={styles.tipLabel}>Tip</span>
                <span className={styles.tipNav} data-testid="hub-tip-nav">
                  <button
                    type="button"
                    className={styles.tipNavBtn}
                    onClick={showPrevTip}
                    aria-label="Previous tip"
                    data-testid="hub-tip-prev"
                  >
                    <ChevronIcon dir="left" />
                  </button>
                  <span
                    className={styles.tipCounter}
                    aria-label={`Tip ${tipNumber} of ${tipCount}`}
                    data-testid="hub-tip-counter"
                  >
                    {tipNumber}
                    <span aria-hidden="true"> / {tipCount}</span>
                  </span>
                  <button
                    type="button"
                    className={styles.tipNavBtn}
                    onClick={showNextTip}
                    aria-label="Next tip"
                    data-testid="hub-tip-next"
                  >
                    <ChevronIcon dir="right" />
                  </button>
                </span>
              </figcaption>
              <div key={tipNumber} className={styles.tipBody}>
                <strong className={styles.tipTitle}>{tip.title}</strong>
                <span className={styles.tipText}>{tip.body}</span>
              </div>
            </figure>
          </div>
        ) : visibleSessions.length === 0 ? (
          <div className={styles.state} data-testid="empty-filtered">
            <p className={styles.stateTitle}>No sessions match</p>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnTonal}`}
              onClick={() => setFilter(EMPTY_FILTER)}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div
            ref={listRef}
            className={styles.groups}
            data-testid="sessions-list"
            data-filter-active={filterActive || undefined}
            data-intro={intro || undefined}
          >
            {groups.map((group) => {
              const first = rowIndex;
              const head = showGroupHeads && (
                <GroupHeader git={group.key === 'none' ? null : (group.git ?? null)} />
              );
              const rows = group.sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onSelect={navigateToSession}
                  onDelete={handleDelete}
                  revealedId={revealedId}
                  onRevealChange={setRevealedId}
                  index={rowIndex++}
                  morph={session.id === morphId}
                  dissolving={dissolvingIds.has(session.id)}
                />
              ));
              return (
                <section
                  key={group.key}
                  className={styles.group}
                  style={{ ['--stagger-i' as string]: Math.min(first, 8) }}
                >
                  {head}
                  <div className={styles.list} role="list">
                    {rows}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        {version && (
          <footer className={styles.footer}>
            TermBeam <span data-testid="hub-version">v{version}</span>
          </footer>
        )}
      </main>

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
