---
title: Getting Started with TermBeam
description: Install TermBeam and connect to your terminal from any device in under a minute.
---

# Getting Started

## Prerequisites

- **Node.js** 20 or higher
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

     Beam your terminal to any device 📡  v1.x.x

     Shell:    /bin/zsh
     Session:  a1b2c3d4
     Auth:     🔒 password
     Bind:     127.0.0.1 (localhost only)

     Public:   https://abc123.devtunnels.ms
     Local:    http://localhost:3456

     █▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀█
     █ (QR code here) █
     █▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄█

     Scan the QR code or open: https://abc123.devtunnels.ms
     Password: xK9mP2vL8nQ4wR7j
   ```

3. **On your phone:** Scan the QR code or open the Public URL
4. **Enter the password** shown in the terminal output
5. You're connected! 🎉

## Creating Sessions

- The default session uses your current shell and working directory
- Tap **+ New** (or **+ New Session** on the hub page) to create additional sessions
- Pick a **color** for each session to tell them apart at a glance
- Use the **folder browser** to pick a working directory
- Optionally set an **initial command** that runs when the session starts — useful for launching tools like `htop`, `vim`, `docker logs -f`, or any long-running command

For a walkthrough of the terminal UI — tabs, split view, search, touch controls, and more — see the [Usage Guide](../usage-guide/).

## Running as a Service

Want TermBeam always available in the background? The built-in service installer configures [PM2](https://pm2.keymetrics.io/) for you with an interactive wizard:

```bash
termbeam service install
```

After installation, manage the service with `termbeam service status`, `logs`, `restart`, or `uninstall`. For the full setup guide and alternative methods (systemd, launchd, Windows), see [Running in Background](../running-in-background/).

---

## See Also

- **[Usage Guide](../usage-guide/)** — tabs, split view, search, touch controls, themes, and more
- **[Configuration](../configuration/)** — CLI flags, environment variables, and defaults
- **[Resume & List](../resume/)** — reconnect to running sessions from your terminal
- **[Running in Background](../running-in-background/)** — keep TermBeam always available with PM2, systemd, or launchd
