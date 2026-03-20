import { useState, useEffect, useCallback } from 'react';
import { checkUpdate, triggerUpdate, type UpdateState } from '@/services/api';
import styles from './UpdateBanner.module.css';

type BannerState =
  | { kind: 'hidden' }
  | {
      kind: 'available';
      current: string;
      latest: string;
      canAutoUpdate: boolean;
      method: string;
      command: string;
    }
  | { kind: 'updating'; phase: string }
  | { kind: 'restarting'; toVersion: string; restartStrategy: string }
  | { kind: 'failed'; error: string; command: string }
  | { kind: 'success'; toVersion: string };

export default function UpdateBanner() {
  const [state, setState] = useState<BannerState>({ kind: 'hidden' });
  const [dismissed, setDismissed] = useState(false);
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    checkUpdate().then((result) => {
      if (result?.updateAvailable) {
        setState({
          kind: 'available',
          current: result.current,
          latest: result.latest,
          canAutoUpdate: result.canAutoUpdate ?? false,
          method: result.method ?? 'npm',
          command: result.command ?? 'npm install -g termbeam@latest',
        });
      }
    });
  }, []);

  // Listen for WebSocket update-progress events
  useEffect(() => {
    function handleWsMessage(event: MessageEvent) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'update-progress') return;
        const s = msg as UpdateState;
        if (
          s.status === 'installing' ||
          s.status === 'checking-permissions' ||
          s.status === 'verifying'
        ) {
          setState({ kind: 'updating', phase: s.phase || 'Updating...' });
        } else if (s.status === 'restarting') {
          setState({
            kind: 'restarting',
            toVersion: s.toVersion || '?',
            restartStrategy: s.restartStrategy || 'exit',
          });
        } else if (s.status === 'complete') {
          setState({ kind: 'success', toVersion: s.toVersion || '?' });
        } else if (s.status === 'failed') {
          setState({
            kind: 'failed',
            error: s.error || 'Unknown error',
            command: (state as { command?: string }).command || '',
          });
        }
      } catch {
        // Not a JSON message — ignore
      }
    }

    // Attach to all existing WebSocket connections via a global event
    window.addEventListener('termbeam:ws-message', handleWsMessage as EventListener);
    return () =>
      window.removeEventListener('termbeam:ws-message', handleWsMessage as EventListener);
  }, [state]);

  const handleUpdateNow = useCallback(async () => {
    setState({ kind: 'updating', phase: 'Starting update...' });
    try {
      const result = await triggerUpdate();
      if (result.error) {
        setState({
          kind: 'failed',
          error: result.error,
          command: result.command || '',
        });
      }
      // If successful, WS events will drive the state from here
    } catch (err) {
      setState({
        kind: 'failed',
        error: err instanceof Error ? err.message : 'Update request failed',
        command: '',
      });
    }
  }, []);

  const handleCopyCommand = useCallback((command: string) => {
    navigator.clipboard.writeText(command).then(() => {
      setShowCopied(true);
      setTimeout(() => setShowCopied(false), 2000);
    });
  }, []);

  if (state.kind === 'hidden' || dismissed) return null;

  if (state.kind === 'success') {
    // Auto-dismiss after 5 seconds
    setTimeout(() => setDismissed(true), 5000);
    return (
      <div className={`${styles.banner} ${styles.success}`}>
        <span className={styles.text}>✓ Updated to v{state.toVersion}</span>
      </div>
    );
  }

  if (state.kind === 'restarting') {
    return (
      <div className={`${styles.banner} ${styles.updating}`}>
        <span className={styles.spinner}>⟳</span>
        <span className={styles.text}>
          {state.restartStrategy === 'pm2'
            ? `Updated to v${state.toVersion}. Restarting...`
            : `Updated to v${state.toVersion}. Please restart TermBeam.`}
        </span>
      </div>
    );
  }

  if (state.kind === 'updating') {
    return (
      <div className={`${styles.banner} ${styles.updating}`}>
        <span className={styles.spinner}>⟳</span>
        <span className={styles.text}>{state.phase}</span>
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className={`${styles.banner} ${styles.error}`}>
        <span className={styles.text}>Update failed: {state.error}</span>
        {state.command && (
          <button
            className={styles.actionBtn}
            onClick={() => handleCopyCommand(state.command)}
            title="Copy manual update command"
          >
            {showCopied ? '✓ Copied' : '📋 Copy command'}
          </button>
        )}
        <button className={styles.dismiss} onClick={() => setDismissed(true)} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  // state.kind === 'available'
  return (
    <div className={styles.banner}>
      <span className={styles.text}>
        Update available: v{state.current} → v{state.latest}
      </span>
      {state.canAutoUpdate ? (
        <button className={styles.actionBtn} onClick={handleUpdateNow}>
          Update Now
        </button>
      ) : (
        <button
          className={styles.actionBtn}
          onClick={() => handleCopyCommand(state.command)}
          title={state.command}
        >
          {showCopied ? '✓ Copied' : '📋 Copy command'}
        </button>
      )}
      <button
        className={styles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss update banner"
      >
        ✕
      </button>
    </div>
  );
}
