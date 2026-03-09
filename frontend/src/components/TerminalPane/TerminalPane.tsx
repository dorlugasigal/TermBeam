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
  visible?: boolean;
  fontSize?: number;
}

export function TerminalPane({ sessionId, active, visible, fontSize = 14 }: TerminalPaneProps) {
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
    // Apply touch bar Ctrl modifier to virtual keyboard input.
    // When Ctrl is toggled on, convert single printable characters to
    // their control-character equivalents (e.g. 'o' → Ctrl+O = 0x0f).
    const { touchCtrlActive, setTouchCtrl } = useUIStore.getState();
    if (touchCtrlActive && data.length === 1) {
      const code = data.toLowerCase().charCodeAt(0);
      if (code >= 0x61 && code <= 0x7a) {
        // a-z → 0x01-0x1a
        sendRef.current(String.fromCharCode(code - 0x60));
        setTouchCtrl(false);
        return;
      }
    }
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
        // Focus terminal — works on desktop; on mobile, the gesture-based
        // listener below handles it since programmatic focus is restricted.
        timers.push(setTimeout(() => terminal.focus(), 50));
        return () => timers.forEach(clearTimeout);
      }
    }
  }, [connected, terminal, fit]);

  // On mobile, browsers require a user gesture (tap/click) for programmatic
  // focus to succeed. After (re)connect, install a one-shot capture-phase
  // listener that focuses the terminal on the very first touch/click.
  useEffect(() => {
    if (connected && active && terminal) {
      const focusOnce = () => {
        terminal.focus();
        document.removeEventListener('touchstart', focusOnce, true);
        document.removeEventListener('mousedown', focusOnce, true);
      };
      document.addEventListener('touchstart', focusOnce, true);
      document.addEventListener('mousedown', focusOnce, true);
      return () => {
        document.removeEventListener('touchstart', focusOnce, true);
        document.removeEventListener('mousedown', focusOnce, true);
      };
    }
  }, [connected, active, terminal]);

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

  // Refocus terminal when overlays close (command palette, search bar, etc.)
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const searchBarOpen = useUIStore((s) => s.searchBarOpen);
  const sidePanelOpen = useUIStore((s) => s.sidePanelOpen);
  const copyOverlayOpen = useUIStore((s) => s.copyOverlayOpen);
  const anyOverlayOpen = commandPaletteOpen || searchBarOpen || sidePanelOpen || copyOverlayOpen;
  const prevOverlayRef = useRef(anyOverlayOpen);

  useEffect(() => {
    if (prevOverlayRef.current && !anyOverlayOpen && active && terminal) {
      // An overlay just closed — refocus terminal
      requestAnimationFrame(() => terminal.focus());
    }
    prevOverlayRef.current = anyOverlayOpen;
  }, [anyOverlayOpen, active, terminal]);

  // Track scroll position for scroll-to-bottom button.
  // Throttle to avoid excessive React re-renders during rapid output.
  const wasAtBottomRef = useRef(true);
  const scrollThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);

  useEffect(() => {
    if (!terminal) return;
    const container = terminal.element;

    const checkScroll = () => {
      // Skip scroll checks triggered by our own programmatic scrollToBottom
      if (programmaticScrollRef.current) return;
      if (scrollThrottleRef.current) return;
      scrollThrottleRef.current = setTimeout(() => {
        scrollThrottleRef.current = null;
        const buf = terminal.buffer.active;
        const atBottom = buf.viewportY >= buf.baseY;
        wasAtBottomRef.current = atBottom;
        setShowScrollBtn(!atBottom);
      }, 100);
    };

    const disposable = terminal.onScroll(checkScroll);
    // Also detect user-initiated scroll (wheel/touch) which may not fire onScroll
    container?.addEventListener('wheel', checkScroll, { passive: true });
    container?.addEventListener('touchmove', checkScroll, { passive: true });

    // Auto-scroll to bottom when new data arrives, throttled to one RAF
    // to avoid scroll thrashing during rapid output (e.g. long lines)
    const writeDisposable = terminal.onWriteParsed(() => {
      if (!wasAtBottomRef.current) return;
      if (autoScrollRafRef.current !== null) return;
      autoScrollRafRef.current = requestAnimationFrame(() => {
        autoScrollRafRef.current = null;
        const buf = terminal.buffer.active;
        if (buf.viewportY < buf.baseY) {
          programmaticScrollRef.current = true;
          terminal.scrollToBottom();
          programmaticScrollRef.current = false;
        }
      });
    });

    return () => {
      disposable.dispose();
      writeDisposable.dispose();
      if (scrollThrottleRef.current) clearTimeout(scrollThrottleRef.current);
      if (autoScrollRafRef.current !== null) cancelAnimationFrame(autoScrollRafRef.current);
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

          const toastId = toast.loading('Uploading image... 0%');
          uploadImage(blob, item.type, (pct) => {
            toast.loading(`Uploading image... ${pct}%`, { id: toastId });
          })
            .then((data) => {
              const filePath = data.path;
              if (filePath) sendRef.current(filePath + ' ');
              toast.success('Image uploaded', { id: toastId });
            })
            .catch(() => {
              toast.error('Image upload failed', { id: toastId });
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
    terminal?.focus();
    reconnect();
  }, [terminal, reconnect]);

  const handlePaneClick = useCallback(() => {
    terminal?.focus();
  }, [terminal]);

  const showReconnectOverlay = !connected && !exited && hadConnectedRef.current;

  return (
    <div ref={paneRef} className={styles.pane} data-testid="terminal-pane" onClick={handlePaneClick} onTouchStart={handlePaneClick} {...((visible ?? active) ? { 'data-visible': 'true' } : {})}>
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
