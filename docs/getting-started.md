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

1. Start TermBeam with a password:

   ```bash
   termbeam --generate-password
   ```

2. You'll see output like:

   ```
   Generated password: xK9mP2vL8nQ4wR7j

     ████████╗███████╗██████╗ ███╗   ███╗██████╗ ███████╗ █████╗ ███╗   ███╗
     ╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██╔══██╗██╔════╝██╔══██╗████╗ ████║
        ██║   █████╗  ██████╔╝██╔████╔██║██████╔╝█████╗  ███████║██╔████╔██║
        ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║
        ██║   ███████╗██║  ██║██║ ╚═╝ ██║██████╔╝███████╗██║  ██║██║ ╚═╝ ██║
        ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝

     Beam your terminal to any device 📡

     Local:    http://localhost:3456
     LAN:      http://192.168.1.42:3456
     Shell:    /bin/zsh
     Session:  a1b2c3d4
     Auth:     🔒 password

     Scan the QR code or open: http://192.168.1.42:3456
     Password: xK9mP2vL8nQ4wR7j
   ```

3. **On your phone:** Scan the QR code or type the LAN URL
4. **Enter the password** when prompted
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

### Share & Refresh

- Tap the **share button** (↗) to copy the current URL to your clipboard (works over HTTP)
- Tap the **refresh button** (↻) to clear the PWA cache and reload

## Touch Controls

The bottom touch bar provides quick access to:

| Button  | Key                |
| ------- | ------------------ |
| ↑ ↓ ← → | Arrow keys         |
| Tab     | Tab completion     |
| Enter   | Return             |
| Esc     | Escape             |
| ^C      | Ctrl+C (interrupt) |
| ^D      | Ctrl+D (EOF)       |
| ^Z      | Ctrl+Z (suspend)   |
| ^L      | Ctrl+L (clear)     |
| A+ / A- | Zoom in/out        |
