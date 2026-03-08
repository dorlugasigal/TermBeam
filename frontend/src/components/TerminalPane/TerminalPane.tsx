import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useXTerm } from '@/hooks/useXTerm';
import { useTerminalSocket } from '@/hooks/useTerminalSocket';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { uploadImage } from '@/services/api';
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

  const paneRef = useRef<HTMLDivElement>(null);
  const hadConnectedRef = useRef(false);

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

  const { terminalRef, terminal, fitAddon, searchAddon, fit } = useXTerm({
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

  // When connected, force canvas repaints after scrollback is written.
  // The CanvasAddon may defer painting until a user interaction on some
  // browsers/devices; repeatedly refreshing ensures content is visible.
  useEffect(() => {
    if (connected) {
      hadConnectedRef.current = true;
      if (terminal) {
        const timers: ReturnType<typeof setTimeout>[] = [];
        // Refresh at multiple intervals to catch scrollback replay data
        for (const delay of [50, 150, 400, 1000]) {
          timers.push(
            setTimeout(() => {
              fit();
              terminal.refresh(0, terminal.rows - 1);
              terminal.scrollToBottom();
            }, delay),
          );
        }
        // Also focus on first refresh
        timers.push(setTimeout(() => terminal.focus(), 50));
        return () => timers.forEach(clearTimeout);
      }
    }
  }, [connected, terminal, fit]);

  // Keep refs in sync with latest WS functions
  useEffect(() => {
    sendRef.current = send;
    sendResizeRef.current = sendResize;
  });

  // Clear unread indicator when this pane becomes active
  const clearUnread = useSessionStore((s) => s.clearUnread);
  useEffect(() => {
    if (active) {
      clearUnread(sessionId);
    }
  }, [active, sessionId, clearUnread]);

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
    const container = terminal.element;

    const checkScroll = () => {
      const buf = terminal.buffer.active;
      const atBottom = buf.viewportY >= buf.baseY;
      setShowScrollBtn(!atBottom);
    };

    const disposable = terminal.onScroll(checkScroll);
    // Also detect user-initiated scroll (wheel/touch) which may not fire onScroll
    container?.addEventListener('wheel', checkScroll, { passive: true });
    container?.addEventListener('touchmove', checkScroll, { passive: true });

    return () => {
      disposable.dispose();
      container?.removeEventListener('wheel', checkScroll);
      container?.removeEventListener('touchmove', checkScroll);
    };
  }, [terminal]);

  // Update store with terminal/connection refs
  useEffect(() => {
    if (terminal) {
      updateSession(sessionId, { term: terminal, fitAddon, searchAddon, connected, send });
    }
  }, [terminal, fitAddon, searchAddon, connected, send, sessionId, updateSession]);

  // Pinch-to-zoom — raw touch events matching old UI behavior.
  // Only sets touch-action:none while two fingers are down so one-finger
  // scrolling keeps working normally.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;

    let pinchStartDist = 0;
    let pinchStartFont = 0;
    let pinchActive = false;
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;

    function touchDist(t: TouchList) {
      const t0 = t[0]!;
      const t1 = t[1]!;
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        pinchActive = true;
        pinchStartDist = touchDist(e.touches);
        pinchStartFont = useUIStore.getState().fontSize;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!pinchActive || e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const dist = touchDist(e.touches);
      const scale = dist / pinchStartDist;
      const newSize = Math.round(pinchStartFont * scale);
      if (zoomTimer) clearTimeout(zoomTimer);
      zoomTimer = setTimeout(() => {
        useUIStore.getState().setFontSize(newSize);
      }, 50);
    }

    function onTouchEnd() {
      pinchActive = false;
    }

    // Capture phase: intercept before xterm processes touch as scroll
    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    el.addEventListener('touchend', onTouchEnd, { capture: true });
    el.addEventListener('touchcancel', onTouchEnd, { capture: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      if (zoomTimer) clearTimeout(zoomTimer);
    };
  }, []);

  // Scroll to bottom when mobile keyboard opens
  const { keyboardOpen } = useMobileKeyboard();
  useEffect(() => {
    if (keyboardOpen && terminal) {
      terminal.scrollToBottom();
    }
  }, [keyboardOpen, terminal]);

  // Image paste: intercept paste events with image data, upload, and send path to terminal
  useEffect(() => {
    if (!active) return;

    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          e.stopPropagation();
          const blob = item.getAsFile();
          if (!blob) return;

          const uploadPromise = uploadImage(blob, item.type).then((data) => {
            const filePath = data.path;
            if (filePath) sendRef.current(filePath + ' ');
            return data;
          });
          toast.promise(uploadPromise, {
            loading: 'Uploading image...',
            success: 'Image uploaded',
            error: 'Image upload failed',
          });
          return;
        }
      }
    }

    // Capture phase so we intercept before xterm.js processes the paste
    document.addEventListener('paste', onPaste as EventListener, true);
    return () => document.removeEventListener('paste', onPaste as EventListener, true);
  }, [active]);

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
