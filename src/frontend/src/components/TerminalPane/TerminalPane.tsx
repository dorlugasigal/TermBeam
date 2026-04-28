import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useXTerm } from '@/hooks/useXTerm';
import { useTerminalSocket } from '@/hooks/useTerminalSocket';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { uploadImage } from '@/services/api';
import styles from './TerminalPane.module.css';

function isEditable(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

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

  // iOS soft-keyboard flicker guard: tracks when the user last performed a
  // touch gesture that focused the textarea. iOS takes ~200–500ms to fire
  // visualViewport.resize after a tap, and any programmatic .focus() call
  // during that window can be interpreted as a non-gesture re-focus and
  // dismiss the just-opening keyboard. We use this ref to suppress every
  // programmatic refocus path on touch devices for a short window after the
  // user-gesture focus, regardless of whether keyboardOpen has flipped yet.
  const lastTouchFocusAtRef = useRef(0);
  const TOUCH_FOCUS_GUARD_MS = 700;
  const isTouchDeviceRef = useRef(
    typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0),
  );
  // True when on a touch device and the user-gesture focus happened recently —
  // any programmatic .focus() during this window risks dismissing iOS's soft
  // keyboard mid-animation.
  const inTouchFocusWindow = useCallback(
    () =>
      isTouchDeviceRef.current &&
      Date.now() - lastTouchFocusAtRef.current < TOUCH_FOCUS_GUARD_MS,
    [],
  );

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
    const { touchCtrlActive, setTouchCtrl } = useUIStore.getState();
    if (touchCtrlActive && data.length === 1) {
      const code = data.toLowerCase().charCodeAt(0);
      if (code >= 0x61 && code <= 0x7a) {
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
        // Skip the programmatic focus on touch devices when the user just
        // tapped — re-focusing during iOS's keyboard-open animation is the
        // primary cause of the keyboard-flicker (open then immediately close)
        // bug, so we let the user-gesture focus call from the touchend handler
        // be the only focus attempt.
        const focusTimer = setTimeout(() => {
          if (inTouchFocusWindow()) return;
          terminal.focus();
        }, 50);
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
  // In split view, both panes are visible — register on any visible pane so
  // tapping the unfocused pane activates it and moves keyboard focus there.
  const setActiveId = useSessionStore((s) => s.setActiveId);
  const isVisible = visible ?? active;
  useEffect(() => {
    if (!terminal || !isVisible) return;
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
          if (!active) setActiveId(sessionId);
          // Mark this as a user-gesture focus so all programmatic refocus
          // paths skip for the next ~700ms — iOS dismisses the keyboard if
          // any non-gesture .focus() lands during the open animation.
          lastTouchFocusAtRef.current = Date.now();
          terminal.focus();
          terminal.textarea?.focus({ preventScroll: true }); // xterm.js #789 workaround

          // Forward tap as synthetic mouse events so xterm.js can report
          // click coordinates to TUI apps (gh, vim, fzf, etc.) that have
          // enabled mouse tracking mode. When no app has mouse mode active,
          // xterm.js ignores the mouse event — no side effects.
          //
          // CRITICAL: defer this past the iOS keyboard-open animation
          // (~250-500ms). Dispatching mouse events synchronously triggers
          // xterm internal DOM/focus churn that races with iOS's keyboard
          // animation and dismisses the just-opened keyboard, especially
          // on bottom-half taps where iOS is also trying to scroll the
          // tap target into view.
          const xtermEl = terminal.element;
          if (xtermEl) {
            const mouseOpts: MouseEventInit = {
              clientX: startX,
              clientY: startY,
              button: 0,
              buttons: 1,
              bubbles: true,
              cancelable: true,
            };
            setTimeout(() => {
              // Skip if user has interacted again in the meantime — another
              // touch-focus would be in progress and re-dispatching mouse
              // events would fire xterm's INTERNAL .focus() (xterm's own
              // mousedown handler calls this.focus() unconditionally),
              // bypassing our focus guards and dismissing iOS's keyboard.
              if (inTouchFocusWindow()) return;
              // Also bail if textarea no longer has focus — the user moved
              // on (overlay opened, switched panes, etc.) and forwarding the
              // tap as a mouse event would steal focus back.
              if (document.activeElement !== terminal.textarea) return;
              xtermEl.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
              xtermEl.dispatchEvent(new MouseEvent('mouseup', { ...mouseOpts, buttons: 0 }));
            }, TOUCH_FOCUS_GUARD_MS + 150);
          }

          // CRITICAL: prevent iOS from synthesizing a click event ~300ms later.
          // That synthetic click would fire handlePaneClick which calls
          // terminal.focus() AGAIN — landing mid-flight in iOS's keyboard-open
          // animation and causing the keyboard to flicker open then close.
          // The focus is already done above; we don't need the click.
          e.preventDefault();
        }
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    el.addEventListener('touchend', onTouchEnd, { capture: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchend', onTouchEnd, { capture: true });
    };
  }, [terminal, isVisible, active, sessionId, setActiveId]);

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
  // After a visibility transition the canvas may be stale (render frames
  // dropped while hidden) and fit() can be a no-op if the dimensions
  // haven't changed. Use requestAnimationFrame to ensure the browser has
  // completed layout, then force a full re-render.
  useEffect(() => {
    if (active && terminal) {
      const rafId = requestAnimationFrame(() => {
        fit();
        terminal.refresh(0, terminal.rows - 1);
        terminal.scrollToBottom();
        // On touch devices, skip the programmatic focus when the user just
        // tapped — the touchend handler already focused under the user
        // gesture, and a second non-gesture .focus() during iOS's keyboard
        // animation can cause the keyboard to flicker (open→dismiss).
        if (!inTouchFocusWindow()) terminal.focus();
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [active, terminal, fit, inTouchFocusWindow]);

  // Re-fit the terminal when the touchbar collapses/expands (its height
  // changes via a ~320ms cubic-bezier transition with rows fading too).
  // Schedule fits during the animation so the terminal keeps tracking
  // the available viewport in real time.
  const touchBarCollapsedLive = useUIStore((s) => s.touchBarCollapsedLive);
  useEffect(() => {
    if (!active || !terminal) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Fire fit() repeatedly during the bar's height transition (the bar
    // takes ~320ms + 150ms delay to fully resolve in either direction).
    [0, 80, 180, 320, 500].forEach((ms) => {
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          fit();
        }, ms),
      );
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [touchBarCollapsedLive, active, terminal, fit]);

  // Refocus terminal when overlays close (tools panel, search bar, etc.)
  const toolsPanelOpen = useUIStore((s) => s.toolsPanelOpen);
  const searchBarOpen = useUIStore((s) => s.searchBarOpen);
  const sidePanelOpen = useUIStore((s) => s.sidePanelOpen);
  const copyOverlayOpen = useUIStore((s) => s.copyOverlayOpen);
  const anyOverlayOpen = toolsPanelOpen || searchBarOpen || sidePanelOpen || copyOverlayOpen;
  const prevOverlayRef = useRef(anyOverlayOpen);

  useEffect(() => {
    if (prevOverlayRef.current && !anyOverlayOpen && active && terminal) {
      // An overlay just closed — refocus terminal. Skip if the user just
      // tapped to focus (avoids fighting iOS's keyboard-open animation).
      if (!inTouchFocusWindow()) {
        requestAnimationFrame(() => terminal.focus());
      }
    }
    prevOverlayRef.current = anyOverlayOpen;
  }, [anyOverlayOpen, active, terminal, inTouchFocusWindow]);

  // xterm.js bug workaround (#789): TUI apps that enable mouse tracking
  // (bubbletea, vim, htop) can cause xterm.js to lose its internal focus
  // state. When the app exits (alt-screen → normal), the terminal appears
  // focused but the hidden <textarea> that captures keystrokes has lost
  // focus, making it impossible to type. Detect this transition and
  // forcefully restore focus.
  const wasAltScreenRef = useRef(false);
  useEffect(() => {
    if (!terminal || !active) return;

    const disposable = terminal.buffer.onBufferChange((buf) => {
      const isAlt = buf.type === 'alternate';
      if (wasAltScreenRef.current && !isAlt) {
        // TUI app just exited alt-screen — force focus restoration unless
        // the user just tapped (iOS keyboard-open animation guard).
        if (!inTouchFocusWindow()) {
          requestAnimationFrame(() => {
            terminal.focus();
            terminal.textarea?.focus({ preventScroll: true });
          });
        }
      }
      wasAltScreenRef.current = isAlt;
    });

    return () => disposable.dispose();
  }, [terminal, active, inTouchFocusWindow]);

  // Mobile focus guard: when the terminal textarea loses focus unexpectedly
  // (e.g. PTY resize reflow after another client disconnects, or xterm.js
  // mouse-mode bug #789), immediately re-focus it. Mobile browsers block
  // programmatic .focus() from timers/callbacks, but within a blur event
  // handler we get a brief window where re-focusing still works.
  // Only active when the pane is focused and no overlay is stealing focus.
  const { keyboardOpen } = useMobileKeyboard();
  // Track when the keyboard last toggled, so the focus guard can skip its
  // refocus attempt during the iOS keyboard open/close animation. Re-focusing
  // mid-animation triggers the very flicker we're trying to avoid (the OS
  // dismisses the keyboard if it sees a programmatic focus during transition).
  const kbToggleAtRef = useRef(0);
  const prevKbOpenRef = useRef(keyboardOpen);
  useEffect(() => {
    if (prevKbOpenRef.current !== keyboardOpen) {
      kbToggleAtRef.current = Date.now();
      prevKbOpenRef.current = keyboardOpen;
    }
  }, [keyboardOpen]);

  useEffect(() => {
    if (!terminal || !active) return;
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;
    const ta = terminal.textarea;
    if (!ta) return;

    let refocusTimer: ReturnType<typeof setTimeout> | null = null;
    const onBlur = (ev: FocusEvent) => {
      // Don't fight legitimate blurs (overlay open, pane inactive, etc.)
      const { toolsPanelOpen, searchBarOpen, sidePanelOpen, copyOverlayOpen } =
        useUIStore.getState();
      if (toolsPanelOpen || searchBarOpen || sidePanelOpen || copyOverlayOpen) return;

      // If focus is moving to another editable element (e.g. review comment
      // composer, rename dialog), let it keep focus instead of stealing back.
      const next = (ev.relatedTarget as HTMLElement | null) ?? null;
      if (isEditable(next)) return;

      // Skip refocus during a keyboard open/close transition. iOS fires blur
      // as part of its animation; refocusing at this moment causes the OS to
      // dismiss the keyboard right after it appears (the bottom-half tap
      // flicker). Wait for the transition to settle before guarding focus.
      // Two windows are considered:
      //  - kbToggleAtRef: time since visualViewport.resize fired
      //  - lastTouchFocusAtRef: time since the user-gesture focus (covers
      //    the gap *before* visualViewport fires, which is the main flicker
      //    window — iOS animation is ~250–500ms).
      if (Date.now() - kbToggleAtRef.current < TOUCH_FOCUS_GUARD_MS) return;
      if (Date.now() - lastTouchFocusAtRef.current < TOUCH_FOCUS_GUARD_MS) return;

      // Delay the re-focus check. On iOS, relatedTarget can be null during
      // focus transitions — we need to check document.activeElement after
      // the browser has settled on the new focus target.
      if (refocusTimer) clearTimeout(refocusTimer);
      refocusTimer = setTimeout(() => {
        refocusTimer = null;
        // Bail out if a keyboard transition started after the blur fired.
        if (Date.now() - kbToggleAtRef.current < TOUCH_FOCUS_GUARD_MS) return;
        if (Date.now() - lastTouchFocusAtRef.current < TOUCH_FOCUS_GUARD_MS) return;
        if (isEditable(document.activeElement as HTMLElement | null)) return;
        if (document.activeElement !== ta) {
          ta.focus({ preventScroll: true });
        }
      }, 50);
    };

    ta.addEventListener('blur', onBlur);
    return () => {
      ta.removeEventListener('blur', onBlur);
      if (refocusTimer) clearTimeout(refocusTimer);
    };
  }, [terminal, active]);

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
  //
  // Alt-screen handling: TUI apps (Copilot CLI, vim, tmux) use the alternate
  // screen buffer which has no scrollback. In this mode we convert touch scroll
  // deltas into arrow key sequences (matching xterm's built-in wheel behavior)
  // so the app receives Up/Down input instead of a no-op viewport scroll.
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
    function isAltScreen(): boolean {
      return terminal!.buffer.active.type === 'alternate';
    }

    // Dispatch a synthetic wheel event so xterm.js handles it natively —
    // it sends mouse wheel sequences when mouse tracking is on (TUI apps)
    // or arrow keys when it's off (less, man, etc.)
    function emitWheel(dy: number) {
      const wheelEvt = new WheelEvent('wheel', {
        deltaY: dy,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        bubbles: true,
        cancelable: true,
      });
      vp.dispatchEvent(wheelEvt);
    }

    // Use a "lazy claim" pattern: don't preventDefault on touchstart so that
    // taps can still synthesise mouse events for TUI apps. Only claim the
    // gesture once actual movement is detected in touchmove.
    const SCROLL_CLAIM_PX = 4;
    let startY = 0;
    let claimed = false;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      cancelAnimationFrame(coastRaf);
      tracking = true;
      claimed = false;
      startY = e.touches[0]!.clientY;
      lastY = startY;
      lastTime = performance.now();
      velocity = 0;
      // Don't preventDefault here — allow taps to reach xterm.js mouse handler
      e.stopPropagation();
    }

    function onTouchMove(e: TouchEvent) {
      if (!tracking || e.touches.length !== 1) {
        tracking = false;
        return;
      }

      const y = e.touches[0]!.clientY;

      // Claim the gesture once movement exceeds threshold
      if (!claimed) {
        if (Math.abs(y - startY) < SCROLL_CLAIM_PX) return;
        claimed = true;
      }

      e.stopPropagation();
      e.preventDefault();

      const now = performance.now();
      const dt = now - lastTime;
      const dy = lastY - y;

      if (Math.abs(dy) >= 1) {
        if (isAltScreen()) {
          emitWheel(dy);
        } else {
          if (dt > 0) {
            velocity = dy / dt;
          }
          vp.scrollTop += dy;
          wasAtBottomRef.current = false;
        }
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
      // Momentum coasting only for claimed scrolls in normal buffer
      if (claimed && !isAltScreen() && Math.abs(velocity) > 0.15) {
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
  // When opening, we wait long enough for the iOS keyboard animation to finish
  // (~250ms) before refitting xterm — fitting mid-animation can blur the
  // textarea and dismiss the keyboard right after it appears.
  useEffect(() => {
    if (terminal && (visible ?? active)) {
      const delay = keyboardOpen ? 320 : 16;
      const timerId = setTimeout(() => {
        fit();
        terminal.refresh(0, terminal.rows - 1);
        if (keyboardOpen) {
          terminal.scrollToBottom();
        }
      }, delay);
      return () => clearTimeout(timerId);
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
      // stopPropagation prevents the pane's onClick (which calls terminal.focus())
      // from firing — intentional so tapping this button on mobile does NOT open
      // the soft keyboard.
      e.stopPropagation();
      if (terminal) {
        programmaticScrollRef.current = true;
        terminal.scrollToBottom();
        programmaticScrollRef.current = false;
        wasAtBottomRef.current = true;
        setShowScrollBtn(false);
        // NOTE: Do NOT call terminal.focus() here — on mobile devices that
        // would open the soft keyboard, covering half the terminal. Users who
        // want to type can tap the terminal area directly.
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
    if (!active) setActiveId(sessionId);
    // On touch devices, if the user just tapped (touchend handler already
    // focused), skip the focus call here — iOS may dispatch a synthesized
    // click event ~300ms after touchend, landing mid-flight in the keyboard-
    // open animation. Re-focusing then dismisses the keyboard. The touchend
    // handler also calls preventDefault() to suppress this synthetic click,
    // but this is a defensive guard in case that fails.
    if (inTouchFocusWindow()) return;
    // Belt-and-suspenders: focus both the terminal and its internal textarea.
    // xterm.js bug #789 can leave the textarea unfocused after mouse-mode TUI
    // interactions, making terminal.focus() alone insufficient.
    // Stamp lastTouchFocusAtRef on touch devices so subsequent programmatic
    // refocus paths skip during the iOS keyboard-open animation window.
    if (isTouchDeviceRef.current) {
      lastTouchFocusAtRef.current = Date.now();
    }
    terminal?.focus();
    terminal?.textarea?.focus({ preventScroll: true });
  }, [terminal, active, sessionId, setActiveId, inTouchFocusWindow]);

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
      {/* Terminal container */}
      <div
        ref={terminalRef}
        className={styles.terminalContainer}
      />

      {showScrollBtn && (
        <button
          className={styles.scrollToBottom}
          onClick={scrollToBottom}
          // tabIndex={-1}: intentionally removed from tab order so that
          // tapping this button on mobile doesn't make it the active element
          // and inadvertently open the soft keyboard. The button is still
          // reachable via screen readers through its aria-label.
          tabIndex={-1}
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
