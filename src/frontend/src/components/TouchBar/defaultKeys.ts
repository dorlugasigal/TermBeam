import type { TouchBarKey } from '@/stores/preferencesStore';

/**
 * Default touch bar layout — two rows of 8 slots each.
 *
 * ROW1: Esc(1), Copy(2), Paste(3), Home(4), End(5), ↑(6), Enter(7-8) = 8 slots
 * ROW2: Ctrl(1), Shift(2), Tab(3), ^C(4), ←(5), ↓(6), →(7), Mic(8) = 8 slots
 *
 * Each key declares both row + col so deleting/dragging never moves
 * unrelated keys. The rendered grid uses gridColumnStart=col and
 * gridColumn ends at col+size, so empty positions render as drop slots
 * the user can drop other keys onto.
 */
export const DEFAULT_TOUCHBAR_KEYS: TouchBarKey[] = [
  // Row 1
  { id: 'esc', label: 'Esc', send: '\x1b', style: 'plain', row: 1, col: 1 },
  { id: 'copy', label: 'Copy', send: '', style: 'plain', action: 'copy', row: 1, col: 2 },
  { id: 'paste', label: 'Paste', send: '', style: 'plain', action: 'paste', row: 1, col: 3 },
  { id: 'home', label: 'Home', send: '\x1b[H', style: 'plain', row: 1, col: 4 },
  { id: 'end', label: 'End', send: '\x1b[F', style: 'plain', row: 1, col: 5 },
  { id: 'up', label: '↑', send: '\x1b[A', style: 'plain', row: 1, col: 6 },
  { id: 'enter', label: '↵', send: '\r', style: 'accent', size: 2, row: 1, col: 7 },
  // Row 2
  { id: 'ctrl', label: 'Ctrl', send: '', style: 'plain', modifier: 'ctrl', row: 2, col: 1 },
  { id: 'shift', label: 'Shift', send: '', style: 'plain', modifier: 'shift', row: 2, col: 2 },
  { id: 'tab', label: 'Tab', send: '\x09', style: 'plain', row: 2, col: 3 },
  { id: 'ctrl-c', label: '^C', send: '\x03', style: 'danger', row: 2, col: 4 },
  { id: 'left', label: '←', send: '\x1b[D', style: 'plain', row: 2, col: 5 },
  { id: 'down', label: '↓', send: '\x1b[B', style: 'plain', row: 2, col: 6 },
  { id: 'right', label: '→', send: '\x1b[C', style: 'plain', row: 2, col: 7 },
  // Mic action — renders in row 2's last slot
  { id: 'mic', label: 'Mic', send: '', style: 'plain', action: 'mic', row: 2, col: 8 },
];

/** Sort touchbar keys within a row by their starting column.
 *
 *  CSS Grid `auto-flow: row` (the default) doesn't reliably backtrack when
 *  DOM order has a key at a later column ahead of one at an earlier column.
 *  After a drag-swap (e.g. `Tab` at col 3 ↔ `↓` at col 6), the persisted
 *  `touchBarKeys` array still has the keys in their original array order,
 *  so DOM order no longer matches visual column order. Without sorting,
 *  later keys get pushed onto a phantom CSS row 2, where the JS-computed
 *  bar height clips them — they vanish from the rendered TouchBar even
 *  though the customizer's Live Preview still shows them (the Live Preview
 *  shipped this fix in commit ab68d5eb; the runtime bar regressed).
 *
 *  Returns a new array, never mutates input. */
export function sortKeysByCol<T extends { col?: number }>(keys: T[]): T[] {
  return [...keys].sort((a, b) => (a.col ?? 1) - (b.col ?? 1));
}

/** Map from a TouchBarKey "look" preset to the display name shown in the
 *  customizer. */
export const KEY_LOOK_OPTIONS: { value: NonNullable<TouchBarKey['style']>; label: string; description: string }[] = [
  { value: 'plain', label: 'Plain', description: 'Default key style' },
  { value: 'accent', label: 'Accent', description: 'Brand color (Enter, primary actions)' },
  { value: 'danger', label: 'Danger', description: 'Red (^C, destructive)' },
  { value: 'custom', label: 'Custom', description: 'Pick your own background and text colors' },
];

