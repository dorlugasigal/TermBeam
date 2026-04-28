import type { TouchBarKey } from '@/stores/preferencesStore';

/**
 * Default touch bar layout — 14 keys split across 2 rows of 7 + a microphone
 * action key tucked into the auto slot of row 2. This is the *single source
 * of truth* shared by TouchBar (live render) and CustomKeysModal (customize
 * preview). When `prefs.touchBarKeys` is `null` we use this verbatim.
 */
export const DEFAULT_TOUCHBAR_KEYS: TouchBarKey[] = [
  // Row 1
  { id: 'esc', label: 'Esc', send: '\x1b', style: 'special' },
  { id: 'copy', label: 'Copy', send: '', style: 'special', action: 'copy' },
  { id: 'paste', label: 'Paste', send: '', style: 'special', action: 'paste' },
  { id: 'home', label: 'Home', send: '\x1b[H', style: 'special' },
  { id: 'end', label: 'End', send: '\x1b[F', style: 'special' },
  { id: 'up', label: '↑', send: '\x1b[A', style: 'icon' },
  { id: 'enter', label: '↵', send: '\r', style: 'enter' },
  // Row 2
  { id: 'ctrl', label: 'Ctrl', send: '', style: 'modifier', modifier: 'ctrl' },
  { id: 'shift', label: 'Shift', send: '', style: 'modifier', modifier: 'shift' },
  { id: 'tab', label: 'Tab', send: '\x09', style: 'special' },
  { id: 'ctrl-c', label: '^C', send: '\x03', style: 'danger' },
  { id: 'left', label: '←', send: '\x1b[D', style: 'icon' },
  { id: 'down', label: '↓', send: '\x1b[B', style: 'icon' },
  { id: 'right', label: '→', send: '\x1b[C', style: 'icon' },
  // Tail mic action — renders as the mic button in TouchBar
  { id: 'mic', label: 'Mic', send: '', style: 'special', action: 'mic' },
];

/** Map from a TouchBarKey "look" preset to the display name shown in the
 *  customizer. Keep them friendly; "Style" is jargon. */
export const KEY_LOOK_OPTIONS: { value: NonNullable<TouchBarKey['style']>; label: string }[] = [
  { value: 'default', label: 'Plain' },
  { value: 'special', label: 'Subtle' },
  { value: 'modifier', label: 'Sticky' },
  { value: 'icon', label: 'Glyph' },
  { value: 'enter', label: 'Accent' },
  { value: 'danger', label: 'Danger' },
];
