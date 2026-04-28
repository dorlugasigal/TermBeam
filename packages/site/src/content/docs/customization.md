---
title: Customization
description: Tools panel, settings, custom touch-bar keys, and workspaces.
---

TermBeam ships with a single discoverable entry point — the **Tools panel** — that surfaces every action, opens the **Settings**, edits the **Touch Bar**, and manages **Workspaces**. All preferences sync server-side so the same setup follows you between phone, tablet and laptop.

## Tools Panel

Open the panel from the floating ▦ button in the top-right corner, with <kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd>, or by tapping the **Tools** entry on the Sessions Hub. On mobile it slides up from the bottom; on desktop it docks to the right (~420 px wide). It is non-blocking — the terminal stays visible underneath so you can see live changes.

The panel is grouped into seven categorized sections:

| Section      | Highlights                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------ |
| **SESSION**  | New tab, Find in terminal, Rename session, Close session                                   |
| **FILES**    | Browse files, Upload files, Download file, View markdown                                   |
| **VIEW**     | Increase / Decrease font size, Preview port, View code, Git changes, Theme picker (inline) |
| **SHARE**    | Copy link (auto-login URL with token)                                                      |
| **AGENTS**   | Launch agent, Resume agent session                                                         |
| **SETTINGS** | Open the **Settings** panel                                                                |
| **SYSTEM**   | Refresh (clear PWA cache), Clear terminal, About                                           |

The **Theme picker** is rendered inline inside the **VIEW** section — tap the trigger to flip through 38 themes with a live colour-bar preview. Pick a theme and the picker auto-closes.

## Settings

Reach **Settings** from the Tools panel → **Settings…** (or via <kbd>Cmd+,</kbd> / <kbd>Ctrl+,</kbd>). The panel is non-blocking so theme, font and haptics changes are visible against the terminal as you make them.

| Section                      | What it controls                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Appearance**               | Theme picker (live preview cards) and font-size slider.                                                                            |
| **Notifications & Feedback** | Browser notifications when a backgrounded command completes, and haptic feedback on TouchBar key presses.                          |
| **Touch Bar**                | Toggle "Start collapsed by default" and open the **Customize keys** editor.                                                        |
| **New Session Defaults**     | Default folder and default initial command pre-fills used by **+ New session** and by workspace sessions when they don't override. |
| **Workspaces**               | List of named workspaces. Mark one as the default startup workspace, edit per-workspace sessions, drag to reorder.                 |

All of the above is persisted to `~/.termbeam/prefs.json` (mode `0o600`) on the server. The browser keeps a `localStorage` cache (`termbeam-prefs`) for instant first paint and offline UX, but the server file is the source of truth.

## Custom Touch Bar Keys

Open **Settings → Touch Bar → Customize keys** to enter the key editor. The Touch Bar is a dynamic 1–3 row grid with 8 columns; the visible height of the bar follows the row count exactly (a 3-row bar is taller than a 2-row bar) so you always see what you customized.

### Layout rules

- **Grid:** 8 columns × up to 3 rows. The editor refuses to add a 4th row — the bar wouldn't fit comfortably above a mobile keyboard.
- **Cell size:** every key is 1 column wide by default; flag a key as size-2 (e.g. ↵ Enter) to span two columns.
- **Drag to reorder:** drag a slotted key onto another slot to swap, or onto an empty slot to move. The editor renders the same 8-col grid as production so what you see is exactly what ships to the bar.
- **Empty rows are removed automatically** — delete the last key in a row and the row collapses, the bar shrinks, and the live Touch Bar follows.
- **Reset** restores the default 12-key layout (Esc, Copy, Paste, Home, End, ↑, ↵×2, Ctrl, Shift, Tab, ^C).

### Key types

Each key has a label, an optional 2-column size, an optional color, and one of the following payloads:

| Type         | Field      | What it does                                                                                                                                                                                         |
| ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Text**     | `send`     | Writes a literal string to the PTY when pressed (e.g. `\u001b` for Esc, `\r` for Enter, plain text for shortcuts). Pick from a small set of common escape sequences in the picker, or type your own. |
| **Action**   | `action`   | Runs a built-in client action — `copy`, `paste`, `clear`, `find`, etc. — without sending bytes to the PTY.                                                                                           |
| **Modifier** | `modifier` | Latches a Ctrl / Shift / Alt / Meta modifier. The next key press combines with it (so Ctrl + C still sends `^C`). Modifiers visibly highlight when latched.                                          |

### Sizes and styles

- **Size 2** keys span two grid columns. Use this for the most-pressed key (Enter is 2-wide by default). The editor previews the actual width so you can tell at a glance whether your row will fit.
- **Style** can be `plain` (default) or `accent` (a coloured highlight — Enter uses this).
- **Custom color** overrides the accent for a single key (handy for "danger" keys like ^C).

## Workspaces

A **workspace** is a named bundle of sessions you want to spin up together. Each session in a workspace stores its own:

- `name` — human-readable label
- `cwd` — working directory (absolute path; falls back to the server CWD if missing on this host)
- `shell` — full shell path (validated against the host's detected shells; falls back to the runtime default if it doesn't exist on the current machine)
- `color` — accent color shown in tabs and the Sessions Hub
- `initialCommand` — a string written to the shell after spawn (capped at 8192 characters)

### Default workspace and server-side autoboot

Mark **one** workspace as the default and TermBeam's server reads the prefs at startup and spawns those sessions itself, before any client connects. This has two important consequences:

- **Multi-device parity** — open TermBeam on your phone, tablet or laptop and you land on the same set of running sessions, every time.
- **Sticky deletes** — closing a session in the UI stays closed until the next service restart. The server doesn't re-spawn workspace sessions on every page reload, only on its own restart. (The previous client-side autoboot used to re-spawn on every browser refresh, which was confusing.)

If you only have **one** named workspace it is treated as the implicit default — no need to flag it. The legacy single `startupWorkspace` from older versions is still honoured when no named workspace exists.

### Resilience

If a workspace session can't spawn (missing shell after a host migration, deleted directory, …) the server logs a warning, keeps spawning the rest, and reports `Spawned X/N workspace session(s)` in the log. If **every** workspace session fails, the server falls back to a single default session in `config.cwd` so you always land on something interactive.

### Editing workspaces

In **Settings → Workspaces** you can:

- **Save current** — snapshot the currently running sessions into a new workspace.
- **Edit** — rename the workspace, edit each session's name / cwd / shell / color / initial command, drag to reorder, remove individual entries.
- **Set default** — toggle which workspace auto-spawns at server start.
- **Delete** — remove a workspace (does not affect any currently running sessions).

## Where preferences live

| Storage                                             | Contents                                                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.termbeam/prefs.json` (server)                   | Source of truth for all preferences (theme, fonts, defaults, touch-bar keys, workspaces). Written via authenticated `PUT /api/preferences`. |
| `localStorage` `termbeam-prefs` (browser)           | Instant-first-paint cache. Replaced on hydrate by the authoritative server copy.                                                            |
| `localStorage` `termbeam-tab-order` (browser)       | Saved tab order (JSON array of session IDs).                                                                                                |
| `localStorage` `termbeam-hub-filter` (browser)      | Last-used filter on the SessionsHub page.                                                                                                   |
| `localStorage` `termbeam-push-subscribed` (browser) | Whether the browser is subscribed to push notifications.                                                                                    |

The schema is roughly:

```jsonc
{
  "themeId": "one-dark",
  "fontSize": 13,
  "notifications": false,
  "haptics": true,
  "defaultFolder": "",
  "defaultInitialCommand": "",
  "touchBarCollapsed": true,
  "touchBarKeys": [
    { "id": "esc", "label": "Esc", "send": "\u001b", "row": 1, "col": 1 },
    { "id": "enter", "label": "↵", "send": "\r", "size": 2, "row": 1, "col": 7, "style": "accent" },
  ],
  "workspaces": [
    {
      "name": "DevWorkspace",
      "default": true,
      "sessions": [
        {
          "name": "server",
          "cwd": "/path/to/repo",
          "shell": "/bin/zsh",
          "color": "#4a9eff",
          "initialCommand": "npm run dev",
        },
      ],
    },
  ],
  "startupWorkspace": { "enabled": false, "sessions": [] }, // legacy, still honoured
}
```

## See Also

- **[Configuration](../configuration/)** — CLI flags, environment variables, defaults
- **[Usage Guide](../usage-guide/)** — terminal navigation, file browser, port preview, themes
- **[API Reference](../api/)** — `GET / PUT /api/preferences`, `POST /api/sessions`
