import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { fetchSessions, deleteSession, fetchVersion } from '@/services/api';
import { useUIStore } from '@/stores/uiStore';
import { useThemeStore } from '@/stores/themeStore';
import { THEMES, type ThemeId } from '@/themes/terminalThemes';
import type { Session } from '@/types';
import UpdateBanner from '@/components/common/UpdateBanner';
import SessionCard from './SessionCard';
import NewSessionModal from './NewSessionModal';
import styles from './SessionsHub.module.css';

const POLL_INTERVAL = 3000;

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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export default function SessionsHub() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState('');
  const [showThemePicker, setShowThemePicker] = useState(false);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const { openNewSessionModal } = useUIStore();
  const { themeId, setTheme } = useThemeStore();

  const loadSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);
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

  function navigateToSession(id: string) {
    window.location.href = `/terminal?id=${id}`;
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
    await loadSessions();
    setTimeout(() => setRefreshing(false), 600);
  }

  function handleShare() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(
      () => toast.success('URL copied to clipboard'),
      () => toast('Could not copy URL'),
    );
  }

  function handleCycleTheme() {
    setShowThemePicker((v) => !v);
  }

  useEffect(() => {
    if (!showThemePicker) return;
    const handler = (e: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setShowThemePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showThemePicker]);

  return (
    <div className={styles.page}>
      <UpdateBanner />

      <header className={styles.header}>
        <h1 className={styles.title}>
          📡 Term<span className={styles.accent}>Beam</span>
        </h1>
        <p className={styles.tagline}>
          Beam your terminal to any device{version ? ` · v${version}` : ''}
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
        >
          <span className={refreshing ? styles.refreshSpin : ''} style={{ display: 'flex' }}>
            <RefreshIcon />
          </span>
        </button>
        <div className={styles.themeWrap} ref={themePickerRef}>
          <button
            className={`${styles.headerBtn} ${styles.themeBtn}`}
            onClick={handleCycleTheme}
            aria-label="Change theme"
            title="Change theme"
          >
            <ThemeIcon />
          </button>
          {showThemePicker && (
            <div className={styles.themeDropdown}>
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  className={`${styles.themeOption} ${theme.id === themeId ? styles.themeOptionActive : ''}`}
                  onClick={() => {
                    setTheme(theme.id as ThemeId);
                    setShowThemePicker(false);
                  }}
                >
                  <span className={styles.themeSwatch} style={{ background: theme.bg }} />
                  {theme.name}
                  {theme.id === themeId && <span className={styles.themeCheck}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className={styles.content}>
        {loading ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>⏳</span>
            <span className={styles.emptyText}>Loading sessions…</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>📡</span>
            <span className={styles.emptyText}>No active sessions</span>
            <span className={styles.emptyHint}>
              Tap &quot;+ New Session&quot; to create a new terminal session
            </span>
          </div>
        ) : (
          <div className={styles.sessionsList}>
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                onSelect={navigateToSession}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      <button
        className={styles.newSessionBtn}
        onClick={openNewSessionModal}
        aria-label="New session"
      >
        + New Session
      </button>

      <NewSessionModal onCreated={navigateToSession} />
    </div>
  );
}
