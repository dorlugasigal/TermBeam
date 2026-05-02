/**
 * Mobile-first tips shown in the SessionsHub when the user has zero
 * sessions. Curated list — every tip points at a feature that actually
 * exists today and is meaningful for someone driving TermBeam from a
 * phone or tablet on the go.
 *
 * Editorial rules:
 *   • No tip should require a hardware keyboard. TermBeam is mobile-first;
 *     desktop keyboard shortcuts (Cmd+K, Ctrl+,, etc.) are not surfaced
 *     here because the hub renders most often on a phone.
 *   • Every tip must point at a real, shipping feature.
 *   • Keep the body short enough to read in one breath (≤ 130 chars).
 *
 * Add new tips wherever feels topical — order is not significant; the hub
 * picks a random starting tip and the user pages forward/back from there.
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
    body: 'Esc, Tab, Ctrl, arrows — all live one tap away on the bar above the on-screen keyboard',
  },
  {
    icon: '🎤',
    title: 'Talk to your terminal',
    body: 'Drop a Mic key into the TouchBar to dictate commands hands-free',
  },
  {
    icon: '🤏',
    title: 'Pinch to resize',
    body: 'Two-finger pinch on the terminal scales the font — and we remember the size next time',
  },
  {
    icon: '↕️',
    title: 'Stack more keys',
    body: 'Drag the TouchBar handle upward to add up to 3 rows for vim, tmux, or your own combos',
  },
  {
    icon: '⚙️',
    title: 'Customize every key',
    body: 'Tap ▦ → Settings → Touch Bar → Customize to set exactly what each key types',
  },
  {
    icon: '🔗',
    title: 'Beam this terminal anywhere',
    body: 'Tap the share button to copy a URL — open it on any device with the password and you are in',
  },
  {
    icon: '📱',
    title: 'Add to Home Screen',
    body: 'Install TermBeam as a PWA from your browser for full-screen, app-like access',
  },
  {
    icon: '🗂️',
    title: 'Save a workspace',
    body: 'Group your favorite sessions into a workspace from ▦ → Save Workspace, then re-launch with one tap',
  },
  {
    icon: '↺',
    title: 'Pick up where you left off',
    body: 'Resume Agent reattaches to running Claude Code, Codex, or other agent sessions with full history',
  },
  {
    icon: '⏯',
    title: 'Hold an arrow to repeat',
    body: 'Long-press the arrow keys on the TouchBar for fast cursor movement, just like a real keyboard',
  },
  {
    icon: '🛰️',
    title: 'Cellular access on the go',
    body: 'A persistent dev tunnel lets you reach this terminal from your phone over LTE — no VPN needed',
  },
  {
    icon: '🎨',
    title: 'Theme to match your vibe',
    body: 'Tap the palette icon in the header to switch themes — your choice syncs across every device',
  },
  {
    icon: '👈',
    title: 'Swipe a session to delete',
    body: 'Swipe a session card left to reveal its delete button — swipe right to snap it back',
  },
  {
    icon: '🔍',
    title: 'Filter the noise',
    body: 'When you have a few sessions running, the filter bar lets you narrow by repo, branch, or shell',
  },
  {
    icon: '📁',
    title: 'Pin a default folder',
    body: 'Set a default folder in Settings so every new session starts where you actually work',
  },
  {
    icon: '✨',
    title: 'Auto-run on launch',
    body: 'Set a default initial command in Settings to fire vim, tmux, or your agent the moment a session boots',
  },
  {
    icon: '🔔',
    title: 'Get pinged when builds finish',
    body: 'Enable Notifications in Settings — TermBeam beeps and buzzes when a long-running command completes',
  },
  {
    icon: '📳',
    title: 'Feel every keypress',
    body: 'Haptics on iOS-style devices add a subtle buzz to TouchBar taps — toggle in Settings → Notifications',
  },
  {
    icon: '🧭',
    title: 'Jump between sessions',
    body: 'Tap ☰ to slide open the side panel and hop between every running session without leaving the terminal',
  },
  {
    icon: '📋',
    title: 'Copy & paste, no jailbreak',
    body: 'Long-press in the terminal to select text, then use the Copy and Paste keys on the TouchBar',
  },
  {
    icon: '🔄',
    title: 'Always on the latest',
    body: 'A banner appears at the top whenever a new TermBeam version ships — tap to grab the update',
  },
  {
    icon: '📡',
    title: 'Reconnects on its own',
    body: 'Lose signal in the elevator? TermBeam auto-reattaches when your phone is back online, scrollback intact',
  },
  {
    icon: '🪄',
    title: 'Multiple shells, one tap',
    body: 'Open ▦ → New Session and pick zsh, bash, pwsh — TermBeam picks up your installed shells automatically',
  },
  {
    icon: '🧩',
    title: 'Files in agent output? Tap them',
    body: 'When Claude Code or Codex mentions a file path, tap it to open the in-app code viewer — diffs included',
  },
  {
    icon: '🔭',
    title: 'Find in terminal',
    body: 'Open ▦ → Find in terminal to search scrollback — regex is one tap away when you need it',
  },
  {
    icon: '🪟',
    title: 'Split the screen',
    body: 'Tap ▦ → Split to put two terminals side by side — perfect for tests in one and edits in the other',
  },
  {
    icon: '🏷️',
    title: 'Name your sessions',
    body: 'Rename a session from the Tools panel so the side panel reads "api" or "logs" instead of a hash',
  },
  {
    icon: '📤',
    title: 'Push files from your phone',
    body: 'Open ▦ → Upload files to drop photos, configs, or anything else straight into your working directory',
  },
  {
    icon: '📥',
    title: 'Pull files back',
    body: 'Use ▦ → Download file to grab a build artifact, log, or screenshot off the server in one tap',
  },
  {
    icon: '📖',
    title: 'Read READMEs in style',
    body: 'Open ▦ → View markdown to render any .md file from your repo with proper headings and code blocks',
  },
  {
    icon: '🌐',
    title: 'Preview a local port on your phone',
    body: 'Tap ▦ → Preview port to expose a dev server (3000, 5173, …) through the tunnel so you can hit it from anywhere',
  },
  {
    icon: '🪵',
    title: 'See the diff before you commit',
    body: 'Open ▦ → Git changes for a quick look at staged and unstaged hunks without leaving the terminal',
  },
  {
    icon: '🗒️',
    title: 'Tabs inside a session',
    body: 'Tap ▦ → New tab to open another shell inside the same session — switch between them from the tab bar',
  },
  {
    icon: '🧹',
    title: 'Clear without typing',
    body: 'Hit ▦ → Clear terminal when scrollback gets noisy — quicker than reaching for the C key on the on-screen keyboard',
  },
  {
    icon: '🧯',
    title: 'Filter folders as you type',
    body: 'In the folder picker, start typing any path fragment — the list narrows live so you never scroll a deep tree',
  },
  {
    icon: '📎',
    title: 'Paste long text safely',
    body: 'When you paste multi-line content, TermBeam shows a confirm overlay so a stray newline can never run a command by surprise',
  },
  {
    icon: '🔐',
    title: 'One password, many devices',
    body: 'Use the same TermBeam URL and password to attach from your laptop, tablet, and phone at once — every view stays in sync',
  },
  {
    icon: '👀',
    title: 'Watch a teammate live',
    body: 'Multiple browsers attached to the same session see the same output frame-by-frame — great for pair debugging',
  },
  {
    icon: '🌗',
    title: 'Auto theme on iOS / Android',
    body: 'Pick the System theme and TermBeam follows your phone\u2019s light/dark schedule automatically',
  },
  {
    icon: '🖋️',
    title: 'Tweak the font, not the world',
    body: 'Use ▦ → Increase/Decrease font size for finer control than pinch — perfect for reading code on a small screen',
  },
  {
    icon: 'ℹ️',
    title: 'Wondering what version you are on?',
    body: 'Tap ▦ → About to see the running version, your tunnel URL, and quick links to docs',
  },
];

/**
 * Returns a tip chosen at random from {@link HUB_TIPS}. The optional
 * `seed` lets tests pin a deterministic pick. In production the hub
 * generates a fresh seed once per mount so the tip stays stable while
 * the user looks at it but rotates on the next visit.
 */
export function pickRandomTip(seed: number = Math.random()): Tip {
  return HUB_TIPS[pickRandomTipIndex(seed)]!;
}

/**
 * Same as {@link pickRandomTip} but returns the index, so callers that
 * want to seed a navigable carousel know where to start.
 */
export function pickRandomTipIndex(seed: number = Math.random()): number {
  return Math.floor(seed * HUB_TIPS.length) % HUB_TIPS.length;
}

/**
 * Returns the tip at `index`, wrapping around in either direction so
 * navigation never goes out of bounds. Negative values wrap to the end,
 * values past the end wrap back to the start. {@link HUB_TIPS} is never
 * empty (enforced by tests), so this never returns undefined.
 */
export function getTipAt(index: number): Tip {
  const len = HUB_TIPS.length;
  const i = ((index % len) + len) % len;
  return HUB_TIPS[i]!;
}
