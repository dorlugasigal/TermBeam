import { useCallback, useEffect, useRef, useState } from 'react';
import { usePinch } from '@use-gesture/react';
import { toast } from 'sonner';
import { useXTerm } from '@/hooks/useXTerm';
import { useTerminalSocket } from '@/hooks/useTerminalSocket';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import styles from './TerminalPane.module.css';

interface TerminalPaneProps {
  sessionId: string;
  active: boolean;
  fontSize?: number;
}

export function TerminalPane({ sessionId, active, fontSize = 14 }: TerminalPaneProps) {
  const [exited, setExited] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setFontSize = useUIStore((s) => s.setFontSize);

  const paneRef = useRef<HTMLDivElement>(null);
  const hadConnectedRef = useRef(false);
  const pinchBaseSizeRef = useRef(fontSize);

  // Refs to hold latest WS send functions so xterm callbacks stay stable
  const sendRef = useRef<(data: string) => void>(() => {});
  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {});

  const handleExit = useCallback(
    (id: string) => {
      setExited(true);
      updateSession(id, { exited: true });
    },
    [updateSession],
  );

  const handleData = useCallback((data: string) => {
    sendRef.current(data);
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    sendResizeRef.current(cols, rows);
  }, []);

  const handleSelectionChange = useCallback((selection: string) => {
    if (selection) {
      navigator.clipboard.writeText(selection).then(
        () => toast.success('Copied to clipboard'),
        () => {}, // Clipboard API may not be available
      );
    }
  }, []);

  const { terminalRef, terminal, fit } = useXTerm({
    fontSize,
    onData: handleData,
    onResize: handleResize,
    onSelectionChange: handleSelectionChange,
  });

  const { send, sendResize, connected, reconnect } = useTerminalSocket({
    sessionId,
    terminal,
    onExit: handleExit,
  });

  // Track whether connection was ever established
  useEffect(() => {
    if (connected) hadConnectedRef.current = true;
  }, [connected]);

  // Keep refs in sync with latest WS functions
  useEffect(() => {
    sendRef.current = send;
    sendResizeRef.current = sendResize;
  });

  // Fit, refresh, and focus when becoming active.
  // After a display:none → display:flex transition the canvas may be stale
  // (render frames dropped while hidden) and fit() can be a no-op if the
  // dimensions haven't changed. Use requestAnimationFrame to ensure the
  // browser has completed layout, then force a full re-render.
  useEffect(() => {
    if (active && terminal) {
      const rafId = requestAnimationFrame(() => {
        fit();
        terminal.refresh(0, terminal.rows - 1);
        terminal.scrollToBottom();
        terminal.focus();
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [active, terminal, fit]);

  // Track scroll position for scroll-to-bottom button
  useEffect(() => {
    if (!terminal) return;

    const disposable = terminal.onScroll(() => {
      const buf = terminal.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;
      setShowScrollBtn(!atBottom);
    });

    return () => disposable.dispose();
  }, [terminal]);

  // Update store with terminal/connection refs
  useEffect(() => {
    if (terminal) {
      updateSession(sessionId, { term: terminal, connected, send });
    }
  }, [terminal, connected, send, sessionId, updateSession]);

  // Pinch-to-zoom gesture
  usePinch(
    ({ offset: [scale], first }) => {
      if (first) pinchBaseSizeRef.current = fontSize;
      const newSize = Math.round(
        Math.min(32, Math.max(2, pinchBaseSizeRef.current * scale)),
      );
      setFontSize(newSize);
    },
    {
      target: paneRef,
      scaleBounds: { min: 0.15, max: 2.5 },
      eventOptions: { passive: false },
    },
  );

  // Scroll to bottom when mobile keyboard opens
  const { keyboardOpen } = useMobileKeyboard();
  useEffect(() => {
    if (keyboardOpen && terminal) {
      terminal.scrollToBottom();
    }
  }, [keyboardOpen, terminal]);

  const scrollToBottom = useCallback(() => {
    if (terminal) {
      terminal.scrollToBottom();
      setShowScrollBtn(false);
    }
  }, [terminal]);

  const handleReconnect = useCallback(() => {
    terminal?.clear();
    reconnect();
  }, [terminal, reconnect]);

  const showReconnectOverlay = !connected && !exited && hadConnectedRef.current;

  return (
    <div ref={paneRef} className={styles.pane}>
      <div ref={terminalRef} className={styles.terminalContainer} />

      {showScrollBtn && (
        <button
          className={styles.scrollToBottom}
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
        >
          ↓
        </button>
      )}

      {showReconnectOverlay && (
        <div className={styles.reconnectOverlay}>
          <div className={styles.reconnectContent}>
            <span className={styles.reconnectMessage}>Session disconnected</span>
            <div className={styles.reconnectActions}>
              <a href="/" className={styles.reconnectBtn}>
                Sessions
              </a>
              <button className={styles.reconnectBtn} onClick={handleReconnect}>
                Reconnect
              </button>
            </div>
          </div>
        </div>
      )}

      {exited && (
        <div className={styles.exitOverlay}>
          <span className={styles.exitMessage}>Session ended</span>
        </div>
      )}
    </div>
  );
}
