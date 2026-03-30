import { useEffect, useCallback, useState } from 'react';
import { renewTunnelAuth } from '../../services/api';
import { useTunnelStore } from '../../stores/tunnelStore';
import type { TunnelState } from '../../stores/tunnelStore';
import styles from './TunnelBanner.module.css';

// Global listener — registered once, updates the shared store
let listenerRegistered = false;
function ensureGlobalListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;

  window.addEventListener('termbeam:ws-message', ((e: MessageEvent) => {
    let msg;
    try {
      msg = JSON.parse(typeof e.data === 'string' ? e.data : '');
    } catch {
      return;
    }
    if (msg.type !== 'tunnel-status') return;

    const store = useTunnelStore.getState();
    const prev = store.state;

    let next: TunnelState | null = null;
    switch (msg.state) {
      case 'expiring':
        if (prev.kind !== 'renewing')
          next = { kind: 'expiring', expiresIn: msg.expiresIn, provider: msg.provider };
        break;
      case 'auth-expired':
        if (prev.kind !== 'renewing') next = { kind: 'expired', provider: msg.provider };
        break;
      case 'connected':
        if (prev.kind === 'renewing' || prev.kind === 'expired' || prev.kind === 'expiring') {
          next = { kind: 'renewed' };
        } else {
          next = { kind: 'hidden' };
        }
        break;
      case 'failed':
        next = { kind: 'failed' };
        break;
    }
    if (next) store.setState(next);
  }) as EventListener);
}

export default function TunnelBanner() {
  const tunnelState = useTunnelStore((s) => s.state);
  const kind = tunnelState.kind;
  const setTunnelState = useTunnelStore((s) => s.setState);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ensureGlobalListener();
  }, []);

  useEffect(() => {
    if (kind === 'renewed') {
      const timer = setTimeout(() => setTunnelState({ kind: 'hidden' }), 5000);
      return () => clearTimeout(timer);
    }
  }, [kind, setTunnelState]);

  const handleRenew = useCallback(async () => {
    try {
      const result = await renewTunnelAuth();
      if (result.url && result.code) {
        setTunnelState({ kind: 'renewing', url: result.url, code: result.code });
      } else if (result.ok) {
        setTunnelState({ kind: 'renewed' });
      } else {
        setTunnelState({ kind: 'failed' });
      }
    } catch {
      setTunnelState({ kind: 'failed' });
    }
  }, [setTunnelState]);

  const handleCopy = useCallback((code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const dismiss = useCallback(() => setTunnelState({ kind: 'hidden' }), [setTunnelState]);

  if (tunnelState.kind === 'hidden') return null;

  if (tunnelState.kind === 'expiring') {
    const minutes = Math.max(1, Math.round(tunnelState.expiresIn / 60000));
    return (
      <div className={`${styles.banner} ${styles.warning}`} data-testid="tunnel-banner">
        <span className={styles.text}>
          ⏰ Tunnel token expires in {minutes}m
        </span>
        <button className={styles.actionBtn} onClick={handleRenew}>
          Renew
        </button>
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (tunnelState.kind === 'expired') {
    return (
      <div className={`${styles.banner} ${styles.error}`} data-testid="tunnel-banner">
        <span className={styles.text}>❌ Tunnel auth expired</span>
        <button className={styles.actionBtn} onClick={handleRenew}>
          Renew
        </button>
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (tunnelState.kind === 'renewing') {
    return (
      <div className={`${styles.banner} ${styles.warning}`} data-testid="tunnel-banner">
        <span className={styles.text}>
          🔑 Code: <strong>{tunnelState.code}</strong>
        </span>
        <button className={styles.actionBtn} onClick={() => handleCopy(tunnelState.code)}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <a href={tunnelState.url} target="_blank" rel="noopener noreferrer" className={styles.actionBtn}>
          Open ↗
        </a>
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (tunnelState.kind === 'renewed') {
    return (
      <div className={`${styles.banner} ${styles.success}`} data-testid="tunnel-banner">
        <span className={styles.text}>✓ Tunnel token renewed</span>
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (tunnelState.kind === 'failed') {
    return (
      <div className={`${styles.banner} ${styles.error}`} data-testid="tunnel-banner">
        <span className={styles.text}>Tunnel renewal failed</span>
        <button className={styles.actionBtn} onClick={handleRenew}>
          Retry
        </button>
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  return null;
}
