import type { TouchBarKey } from '@/stores/preferencesStore';

/**
 * Default touch bar layout — two rows of 8 slots each.
 *
 * ROW1: Esc, Copy, Paste, Home, End, ↑, Enter(2 slots) = 8 slots
 * ROW2: Ctrl, Shift, Tab, ^C, ←, ↓, →, Mic (auto slot)  = 8 slots
 *
 * Each key carries its row explicitly so that deleting/reordering a key
 * never shifts unrelated keys into different slots. Within a row, keys
 * fill from left in array order.
 */
export const DEFAULT_TOUCHBAR_KEYS: TouchBarKey[] = [
  // Row 1
  { id: 'esc', label: 'Esc', send: '\x1b', style: 'plain', row: 1 },
  { id: 'copy', label: 'Copy', send: '', style: 'plain', action: 'copy', row: 1 },
  { id: 'paste', label: 'Paste', send: '', style: 'plain', action: 'paste', row: 1 },
  { id: 'home', label: 'Home', send: '\x1b[H', style: 'plain', row: 1 },
  { id: 'end', label: 'End', send: '\x1b[F', style: 'plain', row: 1 },
  { id: 'up', label: '↑', send: '\x1b[A', style: 'plain', row: 1 },
  { id: 'enter', label: '↵', send: '\r', style: 'accent', size: 2, row: 1 },
  // Row 2
  { id: 'ctrl', label: 'Ctrl', send: '', style: 'plain', modifier: 'ctrl', row: 2 },
  { id: 'shift', label: 'Shift', send: '', style: 'plain', modifier: 'shift', row: 2 },
  { id: 'tab', label: 'Tab', send: '\x09', style: 'plain', row: 2 },
  { id: 'ctrl-c', label: '^C', send: '\x03', style: 'danger', row: 2 },
  { id: 'left', label: '←', send: '\x1b[D', style: 'plain', row: 2 },
  { id: 'down', label: '↓', send: '\x1b[B', style: 'plain', row: 2 },
  { id: 'right', label: '→', send: '\x1b[C', style: 'plain', row: 2 },
  // Mic action — renders in row 2's auto slot
  { id: 'mic', label: 'Mic', send: '', style: 'plain', action: 'mic', row: 2 },
];

/** Map from a TouchBarKey "look" preset to the display name shown in the
 *  customizer. */
export const KEY_LOOK_OPTIONS: { value: NonNullable<TouchBarKey['style']>; label: string; description: string }[] = [
  { value: 'plain', label: 'Plain', description: 'Default key style' },
  { value: 'accent', label: 'Accent', description: 'Brand color (Enter, primary actions)' },
  { value: 'danger', label: 'Danger', description: 'Red (^C, destructive)' },
  { value: 'custom', label: 'Custom', description: 'Pick your own background and text colors' },
];

