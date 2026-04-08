import { useEffect } from 'react';
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

    let next: TunnelState | null = null;
    switch (msg.state) {
      case 'disconnected':
        next = { kind: 'disconnected', provider: msg.provider };
        break;
      case 'reconnecting':
        next = { kind: 'reconnecting' };
        break;
      case 'connected':
        next = { kind: 'hidden' };
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
  const setTunnelState = useTunnelStore((s) => s.setState);

  useEffect(() => {
    ensureGlobalListener();
  }, []);

  const dismiss = () => setTunnelState({ kind: 'hidden' });

  if (tunnelState.kind === 'hidden') return null;

  if (tunnelState.kind === 'disconnected') {
    return (
      <div className={`${styles.banner} ${styles.error}`} data-testid="tunnel-banner">
        <span className={styles.text}>⚠️ Tunnel disconnected — reconnecting automatically</span>
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (tunnelState.kind === 'reconnecting') {
    return (
      <div className={`${styles.banner} ${styles.warning}`} data-testid="tunnel-banner">
        <span className={styles.text}>🔄 Tunnel reconnecting…</span>
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (tunnelState.kind === 'failed') {
    return (
      <div className={`${styles.banner} ${styles.error}`} data-testid="tunnel-banner">
        <span className={styles.text}>
          ❌ Tunnel failed — run &quot;devtunnel user login&quot; on the host
        </span>
        <button className={styles.dismiss} onClick={dismiss} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  return null;
}
