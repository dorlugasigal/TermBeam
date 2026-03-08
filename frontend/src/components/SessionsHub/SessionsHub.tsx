import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { fetchSessions, deleteSession } from '@/services/api';
import { useUIStore } from '@/stores/uiStore';
import type { Session } from '@/types';
import ThemePicker from '@/components/common/ThemePicker';
import UpdateBanner from '@/components/common/UpdateBanner';
import SessionCard from './SessionCard';
import NewSessionModal from './NewSessionModal';
import styles from './SessionsHub.module.css';

const POLL_INTERVAL = 3000;

export default function SessionsHub() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { openNewSessionModal } = useUIStore();
  const redirected = useRef(false);

  const loadSessions = useCallback(async () => {
    try {
      const list = await fetchSessions();
      setSessions(list);

      // Auto-redirect if exactly one session and first load
      if (!redirected.current && list.length === 1) {
        redirected.current = true;
        navigateToSession(list[0]!.id);
      }
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

  function navigateToSession(id: string) {
    window.location.href = `/terminal?session=${id}`;
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

  return (
    <div className={styles.page}>
      <UpdateBanner />

      <header className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>📡</span>
          TermBeam
        </div>
        <div className={styles.spacer} />
        <ThemePicker />
        <button className={styles.headerBtn} onClick={handleShare} aria-label="Share URL" title="Share">
          🔗
        </button>
        <button
          className={styles.headerBtn}
          onClick={handleRefresh}
          aria-label="Refresh sessions"
          title="Refresh"
        >
          <span className={refreshing ? styles.refreshSpin : ''}>↻</span>
        </button>
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
              Tap + to create a new terminal session
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
        className={styles.fab}
        onClick={openNewSessionModal}
        aria-label="New session"
        title="New Session"
      >
        +
      </button>

      <NewSessionModal onCreated={navigateToSession} />
    </div>
  );
}
