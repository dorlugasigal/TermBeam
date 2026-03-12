import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useMobileKeyboard } from '@/hooks/useMobileKeyboard';
import { uploadImage } from '@/services/api';
import styles from './TouchBar.module.css';

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    : null;

type KeyType = 'special' | 'modifier' | 'icon' | 'enter' | 'danger';

interface KeyDef {
  label: string;
  data: string;
  type?: KeyType;
  modifier?: 'ctrl' | 'shift';
  action?: 'copy' | 'paste';
}

// Row 1: Esc, Copy, Paste, Home, End, ↑, ↵
const ROW1: KeyDef[] = [
  { label: 'Esc', data: '\x1b', type: 'special' },
  { label: 'Copy', data: '', type: 'special', action: 'copy' },
  { label: 'Paste', data: '', type: 'special', action: 'paste' },
  { label: 'Home', data: '\x1b[H', type: 'special' },
  { label: 'End', data: '\x1b[F', type: 'special' },
  { label: '↑', data: '\x1b[A', type: 'icon' },
  { label: '↵', data: '\r', type: 'enter' },
];

// Row 2: Ctrl, Shift, Tab, ^C, ←, ↓, →
const ROW2: KeyDef[] = [
  { label: 'Ctrl', data: '', type: 'modifier', modifier: 'ctrl' },
  { label: 'Shift', data: '', type: 'modifier', modifier: 'shift' },
  { label: 'Tab', data: '\x09', type: 'special' },
  { label: '^C', data: '\x03', type: 'danger' },
  { label: '←', data: '\x1b[D', type: 'icon' },
  { label: '↓', data: '\x1b[B', type: 'icon' },
  { label: '→', data: '\x1b[C', type: 'icon' },
];

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
  if (ms?.send) {
    ms.send(data);
  }
}

function refocusTerminal(): void {
  const { sessions, activeId } = useSessionStore.getState();
  if (!activeId) return;
  const ms = sessions.get(activeId);
  ms?.term?.focus();
}

const SWIPE_THRESHOLD = 10;

export default function TouchBar() {
  const ctrlActive = useUIStore((s) => s.touchCtrlActive);
  const shiftActive = useUIStore((s) => s.touchShiftActive);
  const setCtrlActive = useUIStore((s) => s.setTouchCtrl);
  const setShiftActive = useUIStore((s) => s.setTouchShift);
  const [flashKey, setFlashKey] = React.useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<InstanceType<typeof SpeechRecognitionAPI> | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const { keyboardOpen, keyboardHeight } = useMobileKeyboard();

  const toggleMic = useCallback(() => {
    if (isRecording) {
      recognitionRef.current?.stop();
      return;
    }

    if (!SpeechRecognitionAPI) {
      toast.error('Speech recognition not supported');
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript;
      if (transcript) {
        sendInput(transcript);
        refocusTerminal();
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === 'not-allowed') {
        toast.error('Microphone permission denied');
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        toast.error(`Speech error: ${event.error}`);
      }
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
    } catch {
      toast.error('Failed to start speech recognition');
      setIsRecording(false);
    }
  }, [isRecording]);

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
    [resolveKeyData, flash, ctrlActive, shiftActive, handleCopy, handlePaste],
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

    if (def.type === 'special') classes.push(styles.special);
    if (def.type === 'modifier') classes.push(styles.modifier);
    if (def.type === 'icon') classes.push(styles.iconBtn);
    if (def.type === 'enter') classes.push(styles.keyEnter);
    if (def.type === 'danger') classes.push(styles.keyDanger);
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

  const renderKey = (def: KeyDef) => (
    <button
      key={def.label}
      className={getKeyClassName(def)}
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

  // When keyboard is open, extend the touchbar downward to fill the gap
  // between the key buttons and the keyboard (no floating look)
  const touchBarStyle: React.CSSProperties =
    keyboardHeight > 0
      ? {
          height: `${80 + keyboardHeight}px`,
          paddingBottom: `${keyboardHeight}px`,
        }
      : {};

  // In tight landscape, hide the touchbar when the keyboard is open to
  // maximize terminal space. The on-screen keyboard already provides keys.
  const isLandscapeTight =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(orientation: landscape) and (max-height: 500px)')?.matches ?? false);

  if (keyboardOpen && isLandscapeTight) return null;

  return (
    <div className={styles.touchBar} style={touchBarStyle}>
      <div className={styles.row}>{ROW1.map(renderKey)}</div>
      <div className={styles.row}>
        {ROW2.map(renderKey)}
        {SpeechRecognitionAPI && (
          <button
            className={`${styles.keyBtn} ${styles.special} ${isRecording ? styles.recording : ''}`}
            data-testid="mic-btn"
            onClick={toggleMic}
          >
            {isRecording ? '⏹' : '🎤'}
          </button>
        )}
      </div>
    </div>
  );
}
