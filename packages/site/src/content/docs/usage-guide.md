---
title: Usage Guide
description: Learn how to use TermBeam's terminal UI — tabs, split view, search, command palette, touch controls, and more.
---

# Usage Guide

Once you've [started TermBeam](../getting-started/) and connected from your device, here's how to make the most of the terminal UI.

## Terminal View

### Tabs & Split View

- All open sessions appear as **tabs** in the top bar — tap to switch
- **Drag to reorder** tabs (long-press on mobile to enter drag mode)
- **Hover** (desktop) or **long-press** (mobile) a tab to see a **live preview** of its output
- Tap the **split view** button to view two sessions side-by-side
- On mobile, tap the **Sessions** button to open the **side panel** with session cards and previews

### Session Colors & Activity

- Each session has a colored dot for quick identification
- **Activity labels** (e.g. "3s", "5m") show time since the last output

### Scrolling

- **Swipe up/down** to scroll through terminal history on touch devices
- Scrollbar is hidden to save space but scrolling works normally

### Search

- Press <kbd>Ctrl+F</kbd> / <kbd>Cmd+F</kbd> to open the **search bar** overlay
- Supports **regex** matching with next/previous navigation
- Press <kbd>Escape</kbd> to close the search bar

### Tools panel

- Press <kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd> (or tap the floating ▦ button in the top-right) to open the **Tools panel**
- Browse categorized actions: **Session · Files · View · Share · Agents · Settings · System**
- The panel is the entry point for **Settings**, the **Touch Bar key editor** and the **Workspace launcher** — see [Customization](../customization/) for the full feature set

### File Upload

- Open the **Tools panel** and select **Upload files** to send files from your phone (or any browser) to the active session's working directory
- Select one or more files — a confirmation modal shows the file list with sizes and the destination directory
- Use the **folder browser** to choose a different target directory
- Files exceeding 10 MB are flagged and cannot be uploaded
- After upload, a toast notification confirms the count and destination

### File Browser

The file browser lets you browse and download files from a session's working directory directly in the browser — useful for pulling logs, configs, or build artifacts to your phone or laptop.

1. Open the **side panel** (hamburger menu or swipe from left)
2. Tap **⬇️ Download File** in the footer — the panel switches to show the active session's files
3. Navigate into subdirectories by tapping folder entries
4. Tap the **⬇️** button next to any file to download it
5. Use the **breadcrumb bar** at the top to jump back to parent directories
6. Tap **←** to return to the sessions list

:::note
Browsing is restricted to the session's working directory and its subdirectories — you cannot navigate above it. Files up to 100 MB can be downloaded. Hidden files (starting with `.`) are not shown.
:::

### Markdown Viewer

Markdown files (`.md`, `.markdown`) can be previewed directly in the file browser without downloading them.

1. Open the **file browser** (see above)
2. Navigate to a directory containing markdown files — they appear with a **👁️** icon
3. Tap the file name to open the rendered preview
4. The viewer supports **GitHub Flavored Markdown**: tables, task lists, strikethrough, fenced code blocks, and more
5. Tap **←** to return to the file listing

:::note
The viewer loads files up to 2 MB. For larger files, use the download button instead.
:::

### Notifications

- Open the **Tools panel** (<kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd>) → **Settings…** to enable **command completion notifications**
- When enabled, you'll receive a browser notification whenever a command finishes in a background tab
- Preference is server-synced and persists across devices
- Requires browser notification permission (requested on first enable)

### Share & Refresh

- Open the **Tools panel** and select **Copy link** to copy a shareable auto-login link to your clipboard; falls back to a manual-copy dialog when clipboard access is unavailable
- Open the **Tools panel** and select **Refresh** to clear the PWA cache and reload

## Port Preview

If you're running a local web server (e.g., on port 8080), you can preview it through TermBeam without exposing a separate port. Use the **port preview** feature in the Tools panel (<kbd>Ctrl+K</kbd>) to reverse-proxy any local port through your TermBeam URL.

See the [API Reference](../api/#port-preview) for the underlying REST endpoints.

## Touch Controls

The bottom touch bar provides quick access to common keys. The default layout is:

| Button  | Action                                              |
| ------- | --------------------------------------------------- |
| Esc     | Escape                                              |
| Copy    | Copy terminal content to clipboard (text overlay)   |
| Paste   | Paste from clipboard (with fallback modal)          |
| Home    | Move cursor to beginning of line                    |
| End     | Move cursor to end of line                          |
| ↑ ↓ ← → | Arrow keys                                          |
| ↵       | Enter / Return                                      |
| Ctrl    | Toggle Ctrl modifier (tap, then press another key)  |
| Shift   | Toggle Shift modifier (tap, then press another key) |
| Tab     | Tab completion                                      |
| ^C      | Ctrl+C (interrupt process)                          |

The bar is fully customizable — see [Customization → Custom Touch Bar Keys](../customization/#custom-touch-bar-keys) to add, remove, reorder, or re-style keys (8-column grid up to 3 rows). Font size can be adjusted via the **Tools panel** (Increase / Decrease font size) or with **pinch-to-zoom** on touch devices.

## Themes

TermBeam includes 38 color themes: Dark, Light, Monokai, Solarized Dark, Solarized Light, Nord, Dracula, GitHub Dark, One Dark, Catppuccin, Gruvbox, Night Owl, Tokyo Night, Rosé Pine, Kanagawa, Everforest, Ayu Dark, Matrix, Cyberpunk, Sunset Glow, Synthwave, Aurora, Deep Ocean, Neon Noir, Frost Byte, Vice City, Radical, Material Ocean, Sakura, Dark Teal, Blue Mist, Cyan Punch, Earth Tone, Crimson Night, Golden Night, Red Alert, Espresso, and Forest Floor. Open the **Tools panel** → **VIEW** section and pick from the inline theme picker — your choice is saved server-side and follows you across devices.

---

## See Also

- **[Customization](../customization/)** — Tools panel, Settings, Touch Bar key editor, Workspaces
- **[Getting Started](../getting-started/)** — installation and first run
- **[Configuration](../configuration/)** — CLI flags, environment variables, and defaults
- **[Resume & List](../resume/)** — reconnect to running sessions from your terminal
