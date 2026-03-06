---
title: Usage Guide
description: Learn how to use TermBeam's terminal UI — tabs, split view, search, command palette, touch controls, and more.
---

# Usage Guide

Once you've [started TermBeam](getting-started.md) and connected from your device, here's how to make the most of the terminal UI.

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

### Command Palette

- Press <kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd> (or tap the **Tools** button in the toolbar) to open the **command palette**
- Browse categorized actions: **Session**, **Search**, **View**, **Share**, **Notifications**, **System**
- A quick way to discover all available features and shortcuts

### File Upload

- Open the **command palette** and select **Upload files** to send files from your phone (or any browser) to the active session's working directory
- Select one or more files — a confirmation modal shows the file list with sizes and the destination directory
- Use the **folder browser** to choose a different target directory
- Files exceeding 10 MB are flagged and cannot be uploaded
- After upload, a toast notification confirms the count and destination

### Notifications

- Open the **command palette** (<kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd>) and select **Toggle notifications** to enable **command completion notifications**
- When enabled, you'll receive a browser notification whenever a command finishes in a background tab
- Preference is saved in `localStorage` and persists across sessions
- Requires browser notification permission (requested on first enable)

### Share & Refresh

- Open the **command palette** and select **Copy link** to copy a shareable auto-login link to your clipboard; falls back to a manual-copy dialog when clipboard access is unavailable
- Open the **command palette** and select **Refresh** to clear the PWA cache and reload

## Port Preview

If you're running a local web server (e.g., on port 8080), you can preview it through TermBeam without exposing a separate port. Use the **port preview** feature in the command palette (<kbd>Ctrl+K</kbd>) to reverse-proxy any local port through your TermBeam URL.

See the [API Reference](api.md#port-preview) for the underlying REST endpoints.

## Touch Controls

The bottom touch bar provides quick access to:

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

Font size can be adjusted via the **command palette** (Increase / Decrease font size) or with **pinch-to-zoom** on touch devices.

## Themes

TermBeam includes 12 color themes: Dark, Light, Monokai, Solarized Dark, Solarized Light, Nord, Dracula, GitHub Dark, One Dark, Catppuccin, Gruvbox, and Night Owl. Change the theme from the palette icon in the toolbar — your choice is saved in the browser.

---

## See Also

- **[Getting Started](getting-started.md)** — installation and first run
- **[Configuration](configuration.md)** — CLI flags, environment variables, and defaults
- **[Resume & List](resume.md)** — reconnect to running sessions from your terminal
