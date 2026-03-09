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
  const [reconnectGraceExpired, setReconnectGraceExpired] = useState(false);

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

  const { send, sendResize, connected, reconnecting, reconnect } = useTerminalSocket({
    sessionId,
    terminal,
    onExit: handleExit,
  });

  // When connected, force a single canvas repaint after scrollback is written.
  // The CanvasAddon may defer painting until a user interaction on some
  // browsers/devices; one delayed refresh ensures content is visible.
  useEffect(() => {
    if (connected) {
      hadConnectedRef.current = true;
      if (terminal) {
        const timer = setTimeout(() => {
          fit();
          terminal.refresh(0, terminal.rows - 1);
          terminal.scrollToBottom();
        }, 200);
        // Focus terminal — works on desktop; on mobile, the gesture-based
        // listener below handles it since programmatic focus is restricted.
        const focusTimer = setTimeout(() => terminal.focus(), 50);
        return () => {
          clearTimeout(timer);
          clearTimeout(focusTimer);
        };
      }
    }
  }, [connected, terminal, fit]);

  // On mobile, our touch scroll handler prevents touchmove default, which
  // blocks the browser from synthesising click events. We need a persistent
  // tap-to-focus listener (touchend with distance check) so that tapping the
  // terminal still opens the soft keyboard. The listener is scoped to the
  // pane and checks that the tap target is inside the terminal container —
  // tapping UI buttons (e.g. scroll-to-bottom) won't trigger focus.
  useEffect(() => {
    if (!terminal || !active) return;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    const el = paneRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTarget: Element | null = null;
    const TAP_THRESHOLD = 10;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        startX = e.touches[0]!.clientX;
        startY = e.touches[0]!.clientY;
        startTarget = e.target as Element | null;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!startTarget) return;
      const touch = e.changedTouches[0]!;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < TAP_THRESHOLD && Math.abs(dy) < TAP_THRESHOLD) {
        // Check the original touchstart target — not elementFromPoint at
        // touchend time. UI buttons (e.g. scroll-to-bottom) may disappear
        // between touchstart and touchend, causing elementFromPoint to
        // resolve to the terminal behind them and incorrectly open the
        // mobile keyboard.
        if (startTarget && terminalRef.current?.contains(startTarget)) {
          terminal.focus();
        }
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    el.addEventListener('touchend', onTouchEnd, { capture: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchend', onTouchEnd, { capture: true });
    };
  }, [terminal, active]);

  // Keep refs in sync with latest WS functions
  useEffect(() => {
    sendRef.current = send;
    sendResizeRef.current = sendResize;
  });

  // Clear unread indicator when this pane becomes active
  const clearUnread = useSessionStore((s) => s.clearUnread);

  // Two-phase reconnect: show subtle indicator first, escalate after grace period
  const RECONNECT_GRACE_MS = 8000;
  useEffect(() => {
    if (connected) {
      setReconnectGraceExpired(false);
      return;
    }
    if (!hadConnectedRef.current) return;
    const timer = setTimeout(() => setReconnectGraceExpired(true), RECONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [connected]);

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
    // Listen on the viewport's native scroll event as a backup — our mobile
    // touch handler scrolls the viewport directly, so the wheel listener
    // alone may not catch all scroll activity.
    const viewport = container?.querySelector('.xterm-viewport') ?? null;
    viewport?.addEventListener('scroll', checkScroll, { passive: true });

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
      viewport?.removeEventListener('scroll', checkScroll);
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
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchmove', onTouchMove, { capture: true });
      el.removeEventListener('touchend', onTouchEnd, { capture: true });
      el.removeEventListener('touchcancel', onTouchEnd, { capture: true });
      if (zoomTimer) clearTimeout(zoomTimer);
    };
  }, []);

  // On mobile, xterm.js intercepts touch on this.element (.xterm) for coarse
  // 1:1 pixel scrolling with no momentum. Since xterm registers its handlers
  // first on .xterm, we register on the PARENT container (terminalRef) in
  // capture phase — capture goes parent→child, so our handler fires before
  // xterm's and stopPropagation prevents the event from reaching .xterm.
  // See also: pointer-events:none CSS on .xterm-screen children to prevent
  // touch "escape" when the finger crosses DOM-rendered text span boundaries
  // (known xterm.js issue https://github.com/xtermjs/xterm.js/issues/3613).
  useEffect(() => {
    if (!terminal) return;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    const container = terminalRef.current;
    if (!container) return;
    const xtermEl = terminal.element;
    if (!xtermEl) return;
    const viewport = xtermEl.querySelector('.xterm-viewport') as HTMLElement | null;
    if (!viewport) return;
    const vp = viewport;

    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let coastRaf = 0;
    let tracking = false;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      cancelAnimationFrame(coastRaf);
      tracking = true;
      lastY = e.touches[0]!.clientY;
      lastTime = performance.now();
      velocity = 0;
      e.preventDefault();
      e.stopPropagation();
    }

    function onTouchMove(e: TouchEvent) {
      if (!tracking || e.touches.length !== 1) {
        tracking = false;
        return;
      }
      e.stopPropagation();
      e.preventDefault();

      const y = e.touches[0]!.clientY;
      const now = performance.now();
      const dt = now - lastTime;
      const dy = lastY - y;

      if (Math.abs(dy) >= 1) {
        if (dt > 0) {
          velocity = dy / dt;
        }
        vp.scrollTop += dy;
        wasAtBottomRef.current = false;
        lastY = y;
        lastTime = now;
      }
    }

    function coast() {
      velocity *= 0.96;
      if (Math.abs(velocity) < 0.05) return;
      vp.scrollTop += velocity * 16;
      coastRaf = requestAnimationFrame(coast);
    }

    function onTouchEnd() {
      if (!tracking) return;
      tracking = false;
      if (Math.abs(velocity) > 0.15) {
        coastRaf = requestAnimationFrame(coast);
      }
    }

    container.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    container.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    container.addEventListener('touchend', onTouchEnd, { capture: true });
    container.addEventListener('touchcancel', onTouchEnd, { capture: true });

    return () => {
      cancelAnimationFrame(coastRaf);
      container.removeEventListener('touchstart', onTouchStart, { capture: true });
      container.removeEventListener('touchmove', onTouchMove, { capture: true });
      container.removeEventListener('touchend', onTouchEnd, { capture: true });
      container.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    };
  }, [terminal]);

  // Fit and scroll when mobile keyboard opens/closes.
  // Uses a short RAF delay so the container has settled at its new size
  // before we refit — avoids a flicker from fitting at an intermediate size.
  const { keyboardOpen } = useMobileKeyboard();
  useEffect(() => {
    if (terminal && (visible ?? active)) {
      const rafId = requestAnimationFrame(() => {
        fit();
        terminal.refresh(0, terminal.rows - 1);
        if (keyboardOpen) {
          terminal.scrollToBottom();
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [keyboardOpen, terminal, fit, visible, active]);

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

  const scrollToBottom = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (terminal) {
        programmaticScrollRef.current = true;
        terminal.scrollToBottom();
        programmaticScrollRef.current = false;
        wasAtBottomRef.current = true;
        setShowScrollBtn(false);
        terminal.focus();
      }
    },
    [terminal],
  );

  const handleReconnect = useCallback(() => {
    terminal?.clear();
    terminal?.focus();
    reconnect();
  }, [terminal, reconnect]);

  const handlePaneClick = useCallback(() => {
    terminal?.focus();
  }, [terminal]);

  const showReconnectOverlay = !connected && !exited && hadConnectedRef.current;
  const showReconnectingIndicator = showReconnectOverlay && reconnecting && !reconnectGraceExpired;
  const showDisconnectedOverlay = showReconnectOverlay && (!reconnecting || reconnectGraceExpired);

  return (
    <div
      ref={paneRef}
      className={styles.pane}
      data-testid="terminal-pane"
      onClick={handlePaneClick}
      {...((visible ?? active) ? { 'data-visible': 'true' } : {})}
    >
      <div ref={terminalRef} className={styles.terminalContainer} />

      {showScrollBtn && (
        <button
          className={styles.scrollToBottom}
          onClick={scrollToBottom}
          tabIndex={0}
          aria-label="Scroll to bottom"
        >
          ↓
        </button>
      )}

      {showReconnectingIndicator && (
        <div className={styles.reconnectingBar} data-testid="reconnecting-indicator">
          <span className={styles.reconnectingDot} />
          <span>Reconnecting…</span>
        </div>
      )}

      {showDisconnectedOverlay && (
        <div className={styles.reconnectOverlay} data-testid="reconnect-overlay">
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
