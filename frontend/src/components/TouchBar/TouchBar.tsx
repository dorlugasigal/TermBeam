import { useCallback, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/sessionStore';
import styles from './TouchBar.module.css';

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

function encodeArrowWithModifiers(arrowCode: string, ctrl: boolean, shift: boolean): string {
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
      if (def.modifier || def.action) return null;

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

  const handleCopy = useCallback(() => {
    const { sessions, activeId } = useSessionStore.getState();
    if (!activeId) return;
    const ms = sessions.get(activeId);
    if (ms?.term) {
      const selection = ms.term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
    }
  }, []);

  const handlePaste = useCallback(() => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) sendInput(text);
      })
      .catch(() => {});
    refocusTerminal();
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

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, []);

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

  const getKeyClassName = (def: KeyDef): string => {
    const classes = [styles.keyBtn];
    const isModActive =
      (def.modifier === 'ctrl' && ctrlActive) ||
      (def.modifier === 'shift' && shiftActive);

    if (def.type === 'special') classes.push(styles.special);
    if (def.type === 'modifier') classes.push(styles.modifier);
    if (def.type === 'icon') classes.push(styles.iconBtn);
    if (def.type === 'enter') classes.push(styles.keyEnter);
    if (def.type === 'danger') classes.push(styles.keyDanger);
    if (isModActive) classes.push(styles.active);
    if (flashKey === def.label) classes.push(styles.flash);

    return classes.join(' ');
  };

  const renderKey = (def: KeyDef) => (
    <button
      key={def.label}
      className={getKeyClassName(def)}
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

  return (
    <div className={styles.touchBar}>
      <div className={styles.row}>{ROW1.map(renderKey)}</div>
      <div className={styles.row}>{ROW2.map(renderKey)}</div>
    </div>
  );
}
