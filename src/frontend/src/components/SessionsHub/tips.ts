/**
 * Mobile-first tips shown in the SessionsHub when the user has zero
 * sessions. Curated list — every tip points at a feature that actually
 * exists today and is meaningful for someone driving TermBeam from a
 * phone or tablet on the go.
 *
 * Add new tips to the end of the array. Tips with leading icons are
 * fine; keep the body short enough to read in one breath.
 */
export interface Tip {
  /** 1-3 character emoji or symbol shown to the left. */
  icon: string;
  /** Short headline (≤ 40 chars works best on a phone). */
  title: string;
  /** Body. One sentence. No trailing period required. */
  body: string;
}

export const HUB_TIPS: Tip[] = [
  {
    icon: '⌨️',
    title: 'TouchBar is your secret weapon',
    body: 'Esc, Tab, Ctrl, arrows — all live one tap away on the bar above the keyboard',
  },
  {
    icon: '🎤',
    title: 'Talk to your terminal',
    body: 'Drop a Mic key into the TouchBar to dictate commands hands-free',
  },
  {
    icon: '🤏',
    title: 'Pinch to resize',
    body: 'Two-finger pinch on the terminal scales the font — and we remember the size',
  },
  {
    icon: '↕️',
    title: 'Stack more keys',
    body: 'Drag the TouchBar handle upward to add up to 3 rows for vim, tmux, or your own combos',
  },
  {
    icon: '⚙️',
    title: 'Customize every key',
    body: 'Open Tools (▦) → Settings → Touch Bar → Customize to set what each key types',
  },
  {
    icon: '🔗',
    title: 'Beam this terminal anywhere',
    body: 'Hit the share button to copy a URL — open it on any device with the password',
  },
  {
    icon: '📱',
    title: 'Add to Home Screen',
    body: 'Install TermBeam as a PWA from your browser for full-screen, app-like access',
  },
  {
    icon: '🗂️',
    title: 'Save a workspace',
    body: 'Group your favorite sessions into a workspace from Tools → Save Workspace, then re-launch with one tap',
  },
  {
    icon: '↺',
    title: 'Pick up where you left off',
    body: 'Resume Agent reattaches to running Claude Code, Codex, or other agent sessions with full history',
  },
  {
    icon: '⌘K',
    title: 'Keyboard-shortcut everything',
    body: 'Cmd/Ctrl+K opens the Tools panel, Cmd/Ctrl+, opens Settings — handy with a Bluetooth keyboard',
  },
  {
    icon: '⏯',
    title: 'Hold an arrow to repeat',
    body: 'Long-press the arrow keys on the TouchBar for fast cursor movement, just like a real keyboard',
  },
  {
    icon: '🛰️',
    title: 'Cellular access on the go',
    body: 'A persistent dev tunnel lets you reach this terminal from your phone over LTE, no VPN needed',
  },
];

/**
 * Returns a tip chosen at random from {@link HUB_TIPS}. The optional
 * `seed` lets tests pin a deterministic pick. In production we generate
 * a fresh seed once per render so the tip stays stable while the user
 * looks at it but rotates on the next visit.
 */
export function pickRandomTip(seed: number = Math.random()): Tip {
  const idx = Math.floor(seed * HUB_TIPS.length) % HUB_TIPS.length;
  return HUB_TIPS[idx]!;
}
