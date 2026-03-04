---
title: Getting Started with TermBeam
description: Install and run TermBeam in under a minute. Access your terminal from any device with one command.
---

# Getting Started

## Prerequisites

- **Node.js** 18 or higher
- A terminal (macOS, Linux, or Windows)

## Installation

### Quick Run (no install)

```bash
npx termbeam
```

### Global Install

```bash
npm install -g termbeam
termbeam
```

## First Run

For a guided setup that walks you through password, port, access mode, and log level:

```bash
termbeam -i
```

Or start directly with defaults:

1. Start TermBeam:

   ```bash
   termbeam
   ```

2. You'll see output like:

   ```
     ████████╗███████╗██████╗ ███╗   ███╗██████╗ ███████╗ █████╗ ███╗   ███╗
     ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔════╝██╔══██╗████╗ ████║
        ██║   █████╗  ██████╔╝██╔████╔██║██████╔╝█████╗  ███████║██╔████╔██║
        ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║
        ██║   ███████╗██║  ██║██║ ╚═╝ ██║██████╔╝███████╗██║  ██║██║ ╚═╝ ██║
        ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝

     Beam your terminal to any device 📡  v1.7.0

     Shell:    /bin/zsh
     Session:  a1b2c3d4
     Auth:     🔒 password
     Bind:     0.0.0.0 (LAN accessible)

     Public:   https://abc123.devtunnels.ms
     Local:    http://localhost:3456
     LAN:      http://192.168.1.42:3456

     █▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█
     █ (QR code here) █
     █▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄█

     Scan the QR code or open: https://abc123.devtunnels.ms
     Password: xK9mP2vL8nQ4wR7j
   ```

3. **On your phone:** Scan the QR code or type the LAN URL
4. **Enter the password** shown in the terminal output
5. You're connected! 🎉

## Creating Sessions

- The default session uses your current shell and working directory
- Tap **+ New** (or **+ New Session** on the hub page) to create additional sessions
- Pick a **color** for each session to tell them apart at a glance
- Use the **📂 folder browser** to pick a working directory
- Optionally set an **initial command** (e.g. `htop`, `vim`)

## Terminal View

### Tabs & Split View

- All open sessions appear as **tabs** in the top bar — tap to switch
- **Drag to reorder** tabs (long-press on mobile to enter drag mode)
- **Hover** (desktop) or **long-press** (mobile) a tab to see a **live preview** of its output
- Tap the **split view** button to view two sessions side-by-side
- On mobile, use the **☰ menu** to open the **side panel** with session cards and previews

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

- Press <kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd> (or tap the **⚙️** button) to open the **command palette**
- Browse categorized actions: **Session**, **Search**, **View**, **Share**, **Notifications**, **System**
- A quick way to discover all available features and shortcuts

### Notifications

- Tap the **🔔 bell icon** in the toolbar to enable **command completion notifications**
- When enabled, you'll receive a browser notification whenever a command finishes in a background tab
- Preference is saved in `localStorage` and persists across sessions
- Requires browser notification permission (requested on first enable)

### Share & Refresh

- Tap the **share button** (↗) to copy a shareable auto-login link to your clipboard; falls back to a manual-copy dialog when clipboard access is unavailable
- Tap the **refresh button** (↻) to clear the PWA cache and reload

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

Font size can be adjusted with **−** / **+** buttons in the top toolbar.

## Running as a Service

Want TermBeam always available in the background? The built-in service installer configures [PM2](https://pm2.keymetrics.io/) for you with an interactive wizard:

```bash
termbeam service install
```

After installation, manage the service with `termbeam service status`, `logs`, `restart`, or `uninstall`. For the full setup guide and alternative methods (systemd, launchd, Windows), see [Running in Background](running-in-background.md).
