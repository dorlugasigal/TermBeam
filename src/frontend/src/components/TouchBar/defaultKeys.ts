import type { TouchBarKey } from '@/stores/preferencesStore';

/**
 * Default touch bar layout — two rows of 8 slots each.
 *
 * ROW1: Esc, Copy, Paste, Home, End, ↑, Enter(2 slots) = 8 slots
 * ROW2: Ctrl, Shift, Tab, ^C, ←, ↓, →, Mic (auto slot)  = 8 slots
 *
 * This is the *single source of truth* shared by TouchBar (live render)
 * and CustomKeysModal (customize preview). When `prefs.touchBarKeys` is
 * `null` we use this verbatim.
 */
export const DEFAULT_TOUCHBAR_KEYS: TouchBarKey[] = [
  // Row 1 — total span: 1+1+1+1+1+1+2 = 8
  { id: 'esc', label: 'Esc', send: '\x1b', style: 'plain' },
  { id: 'copy', label: 'Copy', send: '', style: 'plain', action: 'copy' },
  { id: 'paste', label: 'Paste', send: '', style: 'plain', action: 'paste' },
  { id: 'home', label: 'Home', send: '\x1b[H', style: 'plain' },
  { id: 'end', label: 'End', send: '\x1b[F', style: 'plain' },
  { id: 'up', label: '↑', send: '\x1b[A', style: 'plain' },
  { id: 'enter', label: '↵', send: '\r', style: 'accent', size: 2 },
  // Row 2 — total span: 1×7 + mic auto = 8
  { id: 'ctrl', label: 'Ctrl', send: '', style: 'plain', modifier: 'ctrl' },
  { id: 'shift', label: 'Shift', send: '', style: 'plain', modifier: 'shift' },
  { id: 'tab', label: 'Tab', send: '\x09', style: 'plain' },
  { id: 'ctrl-c', label: '^C', send: '\x03', style: 'danger' },
  { id: 'left', label: '←', send: '\x1b[D', style: 'plain' },
  { id: 'down', label: '↓', send: '\x1b[B', style: 'plain' },
  { id: 'right', label: '→', send: '\x1b[C', style: 'plain' },
  // Tail mic action — renders as the mic button in TouchBar
  { id: 'mic', label: 'Mic', send: '', style: 'plain', action: 'mic' },
];

/** Map from a TouchBarKey "look" preset to the display name shown in the
 *  customizer. */
export const KEY_LOOK_OPTIONS: { value: NonNullable<TouchBarKey['style']>; label: string; description: string }[] = [
  { value: 'plain', label: 'Plain', description: 'Default key style' },
  { value: 'accent', label: 'Accent', description: 'Brand color (Enter, primary actions)' },
  { value: 'danger', label: 'Danger', description: 'Red (^C, destructive)' },
  { value: 'custom', label: 'Custom', description: 'Pick your own background and text colors' },
];

