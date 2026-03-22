import { useState, useEffect, useCallback, useRef } from 'react';
import { checkUpdate, triggerUpdate, getUpdateStatus, type UpdateState } from '@/services/api';
import styles from './UpdateBanner.module.css';

const CopyIcon = () => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    width="14"
    height="14"
    style={{ verticalAlign: 'middle', marginRight: 4 }}
  >
    <rect x="5" y="5" width="9" height="9" rx="1.5" />
    <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
  </svg>
);

const CheckIcon = () => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    width="14"
    height="14"
    style={{ verticalAlign: 'middle', marginRight: 4 }}
  >
    <polyline points="3 8.5 6.5 12 13 4" />
  </svg>
);

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
  // Persist the update command across state transitions so it's available in error states
  const commandRef = useRef('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up copied timer on unmount
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    checkUpdate().then((result) => {
      if (result?.updateAvailable) {
        const cmd = result.command ?? 'npm install -g termbeam@latest';
        commandRef.current = cmd;
        setState({
          kind: 'available',
          current: result.current,
          latest: result.latest,
          canAutoUpdate: result.canAutoUpdate ?? false,
          method: result.method ?? 'npm',
          command: cmd,
        });
      }
    });
  }, []);

  // Listen for WebSocket update-progress events (empty deps — attach once)
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
            command: commandRef.current,
          });
        }
      } catch {
        // Not a JSON message — ignore
      }
    }

    window.addEventListener('termbeam:ws-message', handleWsMessage as EventListener);
    return () =>
      window.removeEventListener('termbeam:ws-message', handleWsMessage as EventListener);
  }, []);

  // Poll fallback: when update is in progress, poll /api/update/status every 2s
  // in case WS events aren't reaching us (e.g., SessionsHub with no terminal WS)
  useEffect(() => {
    const isUpdating = state.kind === 'updating' || state.kind === 'restarting';
    if (isUpdating && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const status = await getUpdateStatus();
        if (!status) return;
        if (status.status === 'complete') {
          setState({ kind: 'success', toVersion: status.toVersion || '?' });
        } else if (status.status === 'failed') {
          setState({
            kind: 'failed',
            error: status.error || 'Unknown error',
            command: commandRef.current,
          });
        } else if (status.status === 'restarting') {
          setState({
            kind: 'restarting',
            toVersion: status.toVersion || '?',
            restartStrategy: status.restartStrategy || 'exit',
          });
        } else if (
          status.status === 'installing' ||
          status.status === 'checking-permissions' ||
          status.status === 'verifying'
        ) {
          setState({ kind: 'updating', phase: status.phase || 'Updating...' });
        }
      }, 2000);
    } else if (!isUpdating && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [state.kind]);

  // Auto-dismiss success banner after 5 seconds
  useEffect(() => {
    if (state.kind !== 'success') return;
    const timer = setTimeout(() => setDismissed(true), 5000);
    return () => clearTimeout(timer);
  }, [state.kind]);

  const handleUpdateNow = useCallback(async () => {
    setState({ kind: 'updating', phase: 'Starting update...' });
    try {
      const result = await triggerUpdate();
      if (result.error) {
        setState({
          kind: 'failed',
          error: result.error,
          command: result.command || commandRef.current,
        });
      }
      // If successful, WS events (or poll fallback) will drive the state from here
    } catch (err) {
      setState({
        kind: 'failed',
        error: err instanceof Error ? err.message : 'Update request failed',
        command: commandRef.current,
      });
    }
  }, []);

  const handleCopyCommand = useCallback(async (command: string) => {
    const showCopiedFeedback = () => {
      setShowCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setShowCopied(false), 2000);
    };

    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(command);
        showCopiedFeedback();
        return;
      }
    } catch {
      // Ignore and try the fallback below.
    }

    // Fallback for environments without navigator.clipboard support.
    try {
      const textarea = document.createElement('textarea');
      textarea.value = command;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showCopiedFeedback();
    } catch {
      // Copy failed silently — nothing we can do
    }
  }, []);

  if (state.kind === 'hidden' || dismissed) return null;

  if (state.kind === 'success') {
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
            {showCopied ? (
              <>
                <CheckIcon />
                Copied
              </>
            ) : (
              <>
                <CopyIcon />
                Copy command
              </>
            )}
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
          {showCopied ? (
            <>
              <CheckIcon />
              Copied
            </>
          ) : (
            <>
              <CopyIcon />
              Copy command
            </>
          )}
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
