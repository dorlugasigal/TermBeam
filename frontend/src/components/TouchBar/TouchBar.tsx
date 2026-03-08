import { useCallback, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import styles from './TouchBar.module.css';

interface KeyDef {
  label: string;
  data: string;
  modifier?: 'ctrl' | 'shift';
}

const ROW1: KeyDef[] = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\x09' },
  { label: 'Ctrl', data: '', modifier: 'ctrl' },
  { label: 'Alt', data: '\x1b' },
  { label: 'Shift', data: '', modifier: 'shift' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '-', data: '-' },
  { label: '/', data: '/' },
];

const ROW2: KeyDef[] = [
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'Home', data: '\x1b[H' },
  { label: 'End', data: '\x1b[F' },
];

const ARROW_MAP: Record<string, string> = {
  '\x1b[A': 'A',
  '\x1b[B': 'B',
  '\x1b[C': 'C',
  '\x1b[D': 'D',
};

function encodeArrowWithModifiers(
  arrowCode: string,
  ctrl: boolean,
  shift: boolean,
): string {
  const dir = ARROW_MAP[arrowCode];
  if (!dir) return arrowCode;
  if (ctrl && shift) return `\x1b[1;6${dir}`;
  if (ctrl) return `\x1b[1;5${dir}`;
  if (shift) return `\x1b[1;2${dir}`;
  return arrowCode;
}

function sendInput(data: string): void {
  const { sessions, activeId } = useSessionStore.getState();
  if (!activeId) return;
  const ms = sessions.get(activeId);
  if (ms?.ws?.readyState === WebSocket.OPEN) {
    ms.ws.send(JSON.stringify({ type: 'input', data }));
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
  const [ctrlActive, setCtrlActive] = useState(false);
  const [shiftActive, setShiftActive] = useState(false);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const repeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

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
      if (def.modifier) return null;

      // Shift+Tab
      if (def.data === '\x09' && shiftActive) return '\x1b[Z';

      // Arrow keys with modifiers
      if (ARROW_MAP[def.data]) {
        return encodeArrowWithModifiers(def.data, ctrlActive, shiftActive);
      }

      return def.data;
    },
    [ctrlActive, shiftActive],
  );

  const flash = useCallback((label: string) => {
    setFlashKey(label);
    setTimeout(() => setFlashKey(null), 120);
  }, []);

  const handlePress = useCallback(
    (def: KeyDef) => {
      // Toggle modifiers
      if (def.modifier === 'ctrl') {
        setCtrlActive((v) => !v);
        return;
      }
      if (def.modifier === 'shift') {
        setShiftActive((v) => !v);
        return;
      }

      const data = resolveKeyData(def);
      if (data === null) return;

      flash(def.label);
      sendInput(data);

      // Deactivate sticky modifiers after key press
      if (ctrlActive) setCtrlActive(false);
      if (shiftActive) setShiftActive(false);

      refocusTerminal();
    },
    [resolveKeyData, flash, ctrlActive, shiftActive],
  );

  const handleMouseDown = useCallback(
    (def: KeyDef) => {
      if (def.modifier) return;
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

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch) {
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      }
    },
    [],
  );

  const handleTouchEnd = useCallback(
    (def: KeyDef, e: React.TouchEvent) => {
      e.preventDefault();
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

  const renderKey = (def: KeyDef) => {
    const isActive =
      (def.modifier === 'ctrl' && ctrlActive) ||
      (def.modifier === 'shift' && shiftActive);
    const isFlash = flashKey === def.label;

    return (
      <button
        key={def.label}
        className={`${styles.key} ${isActive ? styles.active : ''} ${isFlash ? styles.flash : ''}`}
        data-key={def.data}
        onClick={() => handlePress(def)}
        onMouseDown={() => handleMouseDown(def)}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchEnd={(e) => handleTouchEnd(def, e)}
      >
        {def.label}
      </button>
    );
  };

  return (
    <div className={styles.touchBar}>
      <div className={styles.row}>{ROW1.map(renderKey)}</div>
      <div className={styles.row}>{ROW2.map(renderKey)}</div>
    </div>
  );
}
