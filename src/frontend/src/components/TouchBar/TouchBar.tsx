import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { usePreferencesStore, type TouchBarKey } from '@/stores/preferencesStore';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';
import { uploadImage } from '@/services/api';
import { DEFAULT_TOUCHBAR_KEYS } from './defaultKeys';
import styles from './TouchBar.module.css';

let hapticsUnsupportedWarned = false;

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

type KeyType =
  // Legacy class buckets — kept so historical prefs still render via getKeyClassName
  | 'special'
  | 'modifier'
  | 'icon'
  | 'enter'
  | 'danger'
  // New simplified look vocabulary
  | 'plain'
  | 'accent'
  | 'custom';

interface KeyDef {
  label: string;
  data: string;
  type?: KeyType;
  modifier?: 'ctrl' | 'shift' | 'meta';
  action?: 'copy' | 'paste' | 'cancel' | 'newline' | 'send' | 'mic';
  size?: number;
  /** 1-based starting column in the 8-column grid. Optional — when
   *  unset, CSS grid auto-flows the key to the next empty slot. */
  col?: number;
  bg?: string;
  color?: string;
  /** Stable identity for React keys + mic special-case rendering */
  id?: string;
}

// ── Terminal mode keys —
// Live render uses customKeys (or DEFAULT_TOUCHBAR_KEYS as the default).
// See effectiveRow1 / effectiveRow2 in the component below.

function touchBarKeyToDef(k: TouchBarKey): KeyDef {
  // Map the simplified style enum ('plain' | 'accent' | 'danger' | 'custom')
  // onto our internal KeyType bucket, with a legacy fall-through so prefs
  // saved against the old vocabulary keep rendering until they migrate.
  const styleType = k.style ?? 'plain';
  const mapStyle = (s: typeof styleType): KeyType | undefined => {
    if (s === 'plain' || s === 'custom') return undefined; // base .keyBtn only
    if (s === 'accent') return 'accent';
    if (s === 'danger') return 'danger';
    // Legacy values ('special' | 'modifier' | 'icon' | 'enter' | 'default') —
    // accept and forward so old prefs continue to use their original class.
    if (s === ('default' as typeof s)) return 'special';
    return s as KeyType;
  };
  return {
    id: k.id,
    label: k.label || '·',
    data: k.send,
    type: mapStyle(styleType),
    size: k.size,
    col: k.col,
    bg: k.bg,
    color: k.color,
    // 'alt' is not wired to a UI toggle yet → drop it. 'meta' passes through
    // as a typed no-op so callers (handlePress etc.) just treat it as a
    // non-toggling key for now; full meta handling can land in a follow-up.
    modifier: k.modifier === 'alt' ? undefined : k.modifier,
    // 'newline' / 'send' actions weren't in the legacy KeyAction union; map mic/copy/paste/cancel
    action:
      k.action === 'mic' ||
      k.action === 'copy' ||
      k.action === 'paste' ||
      k.action === 'cancel' ||
      k.action === 'newline'
        ? k.action
        : undefined,
  };
}

const ARROW_MAP: Record<string, string> = {
  '\x1b[A': 'A',
  '\x1b[B': 'B',
  '\x1b[C': 'C',
  '\x1b[D': 'D',
};

const HOME_END_MAP: Record<string, string> = {
  '\x1b[H': 'H',
  '\x1b[F': 'F',
};

function encodeArrowWithModifiers(arrowCode: string, ctrl: boolean, shift: boolean): string {
  const dir = ARROW_MAP[arrowCode];
  if (!dir) return arrowCode;
  if (ctrl && shift) return `\x1b[1;6${dir}`;
  if (ctrl) return `\x1b[1;5${dir}`;
  if (shift) return `\x1b[1;2${dir}`;
  return arrowCode;
}

function encodeHomeEndWithModifiers(code: string, ctrl: boolean, shift: boolean): string {
  const dir = HOME_END_MAP[code];
  if (!dir) return code;
  if (ctrl && shift) return `\x1b[1;6${dir}`;
  if (ctrl) return `\x1b[1;5${dir}`;
  if (shift) return `\x1b[1;2${dir}`;
  return code;
}

function sendInput(data: string): void {
  const { sessions, activeId } = useSessionStore.getState();
  if (!activeId) return;
  const ms = sessions.get(activeId);

  // For copilot sessions showing the terminal view, route to the companion PTY
  if (ms?.type === 'copilot') {
    const { showingAgentTerminal } = useUIStore.getState();
    if (showingAgentTerminal && ms.companionTermId) {
      const companion = sessions.get(ms.companionTermId);
      if (companion?.send) {
        companion.send(data);
        return;
      }
    }
    // Chat mode — route to chat input handler
    const handler = useUIStore.getState().chatInputHandler;
    if (handler) handler(data);
    return;
  }

  if (ms?.send) {
    ms.send(data);
  }
}

function refocusTerminal(): void {
  const { sessions, activeId } = useSessionStore.getState();
  if (!activeId) return;
  const ms = sessions.get(activeId);
  if (ms?.type === 'copilot') {
    const { showingAgentTerminal } = useUIStore.getState();
    if (showingAgentTerminal && ms.companionTermId) {
      const companion = sessions.get(ms.companionTermId);
      companion?.term?.focus();
    }
    return;
  }
  ms?.term?.focus();
}

const SWIPE_THRESHOLD = 10;

export default function TouchBar() {
  const ctrlActive = useUIStore((s) => s.touchCtrlActive);
  const shiftActive = useUIStore((s) => s.touchShiftActive);
  const setCtrlActive = useUIStore((s) => s.setTouchCtrl);
  const setShiftActive = useUIStore((s) => s.setTouchShift);
  const customKeys = usePreferencesStore((s) => s.prefs.touchBarKeys);
  const haptics = usePreferencesStore((s) => s.prefs.haptics);
  const startCollapsed = usePreferencesStore((s) => s.prefs.touchBarCollapsed);
  const [collapsed, setCollapsed] = useState<boolean>(startCollapsed);
  const setTouchBarCollapsedLive = useUIStore((s) => s.setTouchBarCollapsedLive);
  // Re-seed local state if the user changes the "Start collapsed" pref so
  // they can preview the effect live without reloading.
  useEffect(() => {
    setCollapsed(startCollapsed);
  }, [startCollapsed]);
  // Mirror the live collapsed state to the UI store so TerminalPane can
  // re-fit when the bar height changes.
  useEffect(() => {
    setTouchBarCollapsedLive(collapsed);
  }, [collapsed, setTouchBarCollapsedLive]);

  const effectiveKeys = useMemo<TouchBarKey[]>(
    () => (customKeys && customKeys.length > 0 ? customKeys : DEFAULT_TOUCHBAR_KEYS),
    [customKeys],
  );
  const micKey = useMemo(() => effectiveKeys.find((k) => k.action === 'mic'), [effectiveKeys]);

  // Group keys by row (1, 2, or 3). Keys with no row default to row 1.
  // The number of distinct rows in use drives the bar height.
  const rowGroups = useMemo(() => {
    const groups: Record<1 | 2 | 3, TouchBarKey[]> = { 1: [], 2: [], 3: [] };
    for (const k of effectiveKeys) {
      const r = Math.min(3, Math.max(1, k.row ?? 1)) as 1 | 2 | 3;
      groups[r].push(k);
    }
    return groups;
  }, [effectiveKeys]);

  const rowCount = useMemo(() => {
    let last = 1;
    for (const r of [1, 2, 3] as const) {
      if (rowGroups[r].length > 0) last = r;
    }
    return last;
  }, [rowGroups]);

  // Publish bar height as a CSS var so .terminalArea sizes itself
  // dynamically. Height = handle padding (36) + N rows of 32 + (N-1) gaps
  // of 4 + 4 bottom padding = 36 + 32N + 4(N-1) + 4 = 36N + 36 = 36*(N+1)
  // For N=2: 108, for N=3: 144.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const expandedH = 36 + rowCount * 32 + (rowCount - 1) * 4 + 4;
    root.style.setProperty('--touchbar-height', collapsed ? '26px' : `${expandedH}px`);
    return () => {
      root.style.removeProperty('--touchbar-height');
    };
  }, [collapsed, rowCount]);
  const activeSessionType = useSessionStore(
    (s) => (s.activeId ? s.sessions.get(s.activeId)?.type : undefined),
  );
  const isAgentMode = activeSessionType === 'copilot';
  const showingAgentTerminal = useUIStore((s) => s.showingAgentTerminal);
  const [flashKey, setFlashKey] = React.useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [micLocked, setMicLocked] = useState(false);
  const recognitionRef = useRef<InstanceType<typeof SpeechRecognitionAPI> | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const micTouchStartY = useRef<number | null>(null);
  const { keyboardOpen, keyboardHeight } = useMobileKeyboard();

  const MIC_LOCK_SWIPE_THRESHOLD = 40;

  const startMic = useCallback(() => {
    if (isRecording) return;
    if (!SpeechRecognitionAPI) {
      toast.error('Speech recognition not supported');
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event?.results?.[i]?.[0]?.transcript;
        if (transcript) {
          sendInput(transcript);
        }
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === 'not-allowed') {
        toast.error('Microphone permission denied');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        toast.error(`Speech error: ${event.error}`);
      }
      setIsRecording(false);
      setMicLocked(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      setMicLocked(false);
      recognitionRef.current = null;
      refocusTerminal();
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
      setMicLocked(false);
    } catch {
      toast.error('Failed to start speech recognition');
      setIsRecording(false);
    }
  }, [isRecording]);

  const stopMic = useCallback(() => {
    if (micLocked) return;
    recognitionRef.current?.stop();
  }, [micLocked]);

  const forceStopMic = useCallback(() => {
    setMicLocked(false);
    recognitionRef.current?.stop();
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  const clearRepeat = useCallback(() => {
    if (repeatTimerRef.current) {
      clearTimeout(repeatTimerRef.current);
      repeatTimerRef.current = null;
    }
    if (repeatIntervalRef.current) {
      clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  }, []);

  const resolveKeyData = useCallback(
    (def: KeyDef): string | null => {
      if (def.modifier || def.action) return null;

      // Shift+Tab
      if (def.data === '\x09' && shiftActive) return '\x1b[Z';

      // Arrow keys with modifiers
      if (ARROW_MAP[def.data]) {
        return encodeArrowWithModifiers(def.data, ctrlActive, shiftActive);
      }

      // Home/End with modifiers
      if (HOME_END_MAP[def.data]) {
        return encodeHomeEndWithModifiers(def.data, ctrlActive, shiftActive);
      }

      return def.data;
    },
    [ctrlActive, shiftActive],
  );

  const flash = useCallback((label: string) => {
    setFlashKey(label);
    setTimeout(() => setFlashKey(null), 120);
  }, []);

  const handleCopy = useCallback(() => {
    useUIStore.getState().openCopyOverlay();
  }, []);

  const handlePaste = useCallback(async () => {
    // Try clipboard.read() first for image support
    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imageType = item.types.find((t: string) => t.startsWith('image/'));
          if (imageType) {
            const blob = await item.getType(imageType);
            const toastId = toast.loading('Uploading image... 0%');
            uploadImage(blob, imageType, (pct) => {
              toast.loading(`Uploading image... ${pct}%`, { id: toastId });
            })
              .then((data) => {
                if (data.path) sendInput(data.path + ' ');
                toast.success('Image uploaded', { id: toastId });
              })
              .catch(() => {
                toast.error('Image upload failed', { id: toastId });
              });
            return;
          }
        }
      } catch {
        // clipboard.read() failed, try text fallback
      }
    }
    // Text paste
    if (navigator.clipboard?.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          sendInput(text);
          refocusTerminal();
          return;
        }
      } catch {
        // Clipboard API failed
      }
    }
    // Final fallback: prompt
    const text = window.prompt('Paste text:');
    if (text) {
      sendInput(text);
      refocusTerminal();
    }
  }, []);

  const handlePress = useCallback(
    (def: KeyDef) => {
      if (def.action === 'copy') {
        flash(def.label);
        handleCopy();
        return;
      }
      if (def.action === 'paste') {
        flash(def.label);
        handlePaste();
        return;
      }
      if (def.action === 'cancel') {
        flash(def.label);
        const cancelHandler = useUIStore.getState().chatCancelHandler;
        if (cancelHandler) cancelHandler();
        return;
      }
      if (def.action === 'newline') {
        flash(def.label);
        const newlineHandler = useUIStore.getState().chatNewlineHandler;
        if (newlineHandler) newlineHandler();
        return;
      }
      if (def.action === 'send') {
        flash(def.label);
        const sendHandler = useUIStore.getState().chatSendHandler;
        if (sendHandler) sendHandler();
        return;
      }

      // Toggle modifiers
      if (def.modifier === 'ctrl') {
        setCtrlActive(!ctrlActive);
        return;
      }
      if (def.modifier === 'shift') {
        setShiftActive(!shiftActive);
        return;
      }

      const data = resolveKeyData(def);
      if (data === null) return;

      flash(def.label);
      sendInput(data);
      if (haptics) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate(15);
          } catch {
            // some browsers throw on rapid calls — non-fatal
          }
        } else if (!hapticsUnsupportedWarned && typeof console !== 'undefined') {
          hapticsUnsupportedWarned = true;
          console.debug(
            '[TouchBar] Haptics requested but navigator.vibrate is unavailable (e.g., iOS Safari).',
          );
        }
      }

      // Refocus terminal after sending key. On mobile, only refocus when
      // the virtual keyboard is already open (avoids popping it up when
      // the user is deliberately using just the touch bar).
      const mobileKeyboardOpen = keyboardHeight > 0;
      if (window.matchMedia?.('(pointer: fine)')?.matches || mobileKeyboardOpen) {
        refocusTerminal();
      }

      // Deactivate sticky modifiers after key press
      if (ctrlActive) setCtrlActive(false);
      if (shiftActive) setShiftActive(false);
    },
    [resolveKeyData, flash, ctrlActive, shiftActive, handleCopy, handlePaste, haptics],
  );

  const handleMouseDown = useCallback(
    (def: KeyDef) => {
      if (def.modifier || def.action) return;
      clearRepeat();
      repeatTimerRef.current = setTimeout(() => {
        repeatIntervalRef.current = setInterval(() => {
          const data = resolveKeyData(def);
          if (data !== null) sendInput(data);
        }, 80);
      }, 400);
    },
    [resolveKeyData, clearRepeat],
  );

  const handleMouseUp = useCallback(() => {
    clearRepeat();
  }, [clearRepeat]);

  const REPEATABLE = new Set(['\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D']);

  const handleTouchStart = useCallback(
    (def: KeyDef, e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      }
      // Start key-repeat for arrow keys on touch hold
      if (REPEATABLE.has(def.data) && !def.modifier && !def.action) {
        clearRepeat();
        repeatTimerRef.current = setTimeout(() => {
          repeatIntervalRef.current = setInterval(() => {
            const data = resolveKeyData(def);
            if (data !== null) sendInput(data);
          }, 80);
        }, 400);
      }
    },
    [resolveKeyData, clearRepeat],
  );

  const handleTouchEnd = useCallback(
    (def: KeyDef, e: React.TouchEvent) => {
      e.preventDefault();
      clearRepeat();
      const start = touchStartRef.current;
      const end = e.changedTouches[0];
      touchStartRef.current = null;

      if (start && end) {
        const dx = Math.abs(end.clientX - start.x);
        const dy = Math.abs(end.clientY - start.y);
        if (dx > SWIPE_THRESHOLD || dy > SWIPE_THRESHOLD) return;
      }

      handlePress(def);
    },
    [handlePress],
  );

  const getKeyClassName = (def: KeyDef): string => {
    const classes = [styles.keyBtn];
    const isModActive =
      (def.modifier === 'ctrl' && ctrlActive) || (def.modifier === 'shift' && shiftActive);

    // Legacy class buckets — kept so prefs saved against the old style
    // vocabulary continue to render with their original look.
    if (def.type === 'special') classes.push(styles.special);
    if (def.type === 'modifier') classes.push(styles.modifier);
    if (def.type === 'icon') classes.push(styles.iconBtn);
    if (def.type === 'enter') classes.push(styles.keyEnter);
    if (def.type === 'danger') classes.push(styles.keyDanger);

    // New simplified vocabulary. `plain` is the default visual (also used for
    // `custom`, where user-supplied bg/color win via inline styles). For the
    // modifier-toggle highlight the .modifier class supplies the .active rule,
    // so attach it whenever a key carries a modifier regardless of its look.
    if (def.type === undefined || def.type === 'plain') classes.push(styles.plain);
    if (def.type === 'accent') classes.push(styles.accent);
    if (def.type === 'danger') classes.push(styles.danger);
    if (def.modifier && def.type !== 'modifier') classes.push(styles.modifier);

    if (isModActive) classes.push(styles.active);
    if (flashKey === def.label) classes.push(styles.flash);

    return classes.join(' ');
  };

  const getTestId = (def: KeyDef): string | undefined => {
    if (def.modifier === 'ctrl') return 'ctrl-btn';
    if (def.modifier === 'shift') return 'shift-btn';
    if (def.action === 'copy') return 'select-btn';
    if (def.action === 'paste') return 'paste-btn';
    return undefined;
  };

  // FIX #5: renderKey now honors size, bg, color for custom keys.
  // Build inline style conditionally so undefined bg/color don't blank out
  // the CSS-class defaults (regression where empty inline style values
  // overrode .special/.keyEnter backgrounds).
  // `size` always applies (defaults now use size:2 for Enter); bg/color only
  // when the user has set custom keys (so the built-in defaults can't be
  // accidentally repainted by inline-style spread).
  const renderKey = (
    def: KeyDef & { size?: number; col?: number; bg?: string; color?: string },
    index?: number,
  ) => {
    const hasCustom = !!(customKeys && customKeys.length > 0);
    // Use explicit grid placement when the key declares a col, so it lands
    // exactly at slot N regardless of array order. Falls back to span-only
    // (CSS grid auto-flow) when col is missing — keeps legacy behaviour.
    const gridColumn = def.col
      ? `${def.col} / span ${def.size ?? 1}`
      : def.size
        ? `span ${def.size}`
        : undefined;
    const inlineStyle: React.CSSProperties = {
      ...(gridColumn ? { gridColumn } : {}),
      ...(hasCustom && def.bg ? { background: def.bg } : {}),
      ...(hasCustom && def.color ? { color: def.color } : {}),
    };
    if (typeof index === 'number') {
      (inlineStyle as Record<string, string | number>)['--key-i'] = index;
    }
    const styleProp = Object.keys(inlineStyle).length > 0 ? inlineStyle : undefined;
    return (
      <button
        key={def.id ?? def.label}
        className={`${getKeyClassName(def)} ${styles.keyAnimIn}`}
        style={styleProp}
        data-testid={getTestId(def)}
        onClick={() => handlePress(def)}
        onMouseDown={() => handleMouseDown(def)}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={(e) => handleTouchStart(def, e)}
        onTouchEnd={(e) => handleTouchEnd(def, e)}
        onTouchCancel={handleMouseUp}
      >
        {def.label}
      </button>
    );
  };

  // No inline height adjustment when the keyboard opens: the viewport meta
  // `interactive-widget=resizes-content` already shrinks the layout viewport,
  // so the fixed-position touchbar naturally sits flush against the keyboard.
  // Adding extra height here previously caused a safe-area-sized gap between
  // the terminal bottom and the touchbar top.

  // In tight landscape, hide the touchbar when the keyboard is open to
  // maximize terminal space. The on-screen keyboard already provides keys.
  const isLandscapeTight =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(orientation: landscape) and (max-height: 500px)')?.matches ?? false);

  if (keyboardOpen && isLandscapeTight) return null;

  const micCol = micKey?.col ?? 8;
  const micButton = SpeechRecognitionAPI ? (
    <button
      className={`${styles.keyBtn} ${styles.special} ${styles.micBtn} ${styles.keyAnimIn} ${isRecording ? styles.recording : ''} ${micLocked ? styles.micLocked : ''}`}
      data-testid="mic-btn"
      style={{ '--key-i': 14, gridColumn: `${micCol} / span 1` } as React.CSSProperties}
      onMouseDown={(e) => {
        e.preventDefault();
        if (micLocked) {
          forceStopMic();
        } else {
          startMic();
        }
      }}
      onMouseUp={() => {
        if (!micLocked) stopMic();
      }}
      onMouseLeave={() => {
        if (!micLocked) stopMic();
      }}
      onTouchStart={(e) => {
        e.preventDefault();
        if (micLocked) {
          forceStopMic();
        } else {
          micTouchStartY.current = e.touches[0]?.clientY ?? null;
          startMic();
        }
      }}
      onTouchMove={(e) => {
        if (!isRecording || micLocked || micTouchStartY.current === null) return;
        const currentY = e.touches[0]?.clientY;
        if (currentY === undefined) return;
        const dy = micTouchStartY.current - currentY;
        if (dy > MIC_LOCK_SWIPE_THRESHOLD) {
          setMicLocked(true);
          micTouchStartY.current = null;
        }
      }}
      onTouchEnd={(e) => {
        e.preventDefault();
        micTouchStartY.current = null;
        if (!micLocked) stopMic();
      }}
      onTouchCancel={() => {
        micTouchStartY.current = null;
        if (!micLocked) stopMic();
      }}
    >
      {micLocked ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      ) : isRecording ? (
        <>
          <span className={styles.micDot} />
          <svg className={styles.lockHint} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
      )}
    </button>
  ) : null;

  // Hide touchbar only for copilot CHAT mode (not when showing terminal)
  if (isAgentMode && !showingAgentTerminal) return null;

  return (
    <div className={styles.touchBarWrapper} data-collapsed={collapsed ? 'true' : 'false'}>
      <div className={styles.touchBar}>
        <button
          type="button"
          className={styles.collapseHandle}
          aria-label={collapsed ? 'Expand TouchBar' : 'Collapse TouchBar'}
          aria-expanded={!collapsed}
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onClick={() => setCollapsed(!collapsed)}
        />
        <div className={styles.rows} aria-hidden={collapsed}>
          {([1, 2, 3] as const).map((rowNum) => {
            if (rowGroups[rowNum].length === 0) return null;
            const rowKeys = rowGroups[rowNum];
            // Mic is rendered separately for its hold-to-record behaviour;
            // exclude it from the regular renderKey loop.
            const nonMicKeys = rowKeys.filter((k) => k.action !== 'mic');
            const rowMic = rowKeys.find((k) => k.action === 'mic');
            const startIndex = (rowNum - 1) * 8;
            return (
              <div key={`row-${rowNum}`} className={styles.row}>
                {nonMicKeys.map((k, i) =>
                  renderKey(touchBarKeyToDef(k), startIndex + i),
                )}
                {rowMic === micKey && micKey && micButton}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
