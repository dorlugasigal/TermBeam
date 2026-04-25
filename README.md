<div align="center">

# TermBeam

**Beam your terminal to any device.**

[![npm version](https://img.shields.io/npm/v/termbeam.svg)](https://www.npmjs.com/package/termbeam)
[![npm downloads](https://img.shields.io/npm/dm/termbeam.svg)](https://www.npmjs.com/package/termbeam)
[![CI](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml/badge.svg)](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/dorlugasigal/TermBeam/coverage-data/endpoint.json)](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/dorlugasigal/TermBeam/badge)](https://securityscorecards.dev/viewer/?uri=github.com/dorlugasigal/TermBeam)
[![Node.js](https://img.shields.io/node/v/termbeam.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

TermBeam lets you access your terminal from a phone, tablet, or any browser — no SSH, no port forwarding, no configuration needed. Run one command and scan the QR code.

[Full documentation](https://dorlugasigal.github.io/TermBeam/) · [Website](https://termbeam.pages.dev)

https://github.com/user-attachments/assets/9dd4f3d7-f017-4314-9b3a-f6a5688e3671

### Mobile UI

<table align="center">
  <tr>
    <td align="center"><img src="packages/site/public/mobile-session-hub.jpeg" alt="Session hub on mobile" width="250" /></td>
    <td align="center"><img src="packages/site/public/mobile-terminal.jpeg" alt="Terminal with touch bar on mobile" width="250" /></td>
    <td align="center"><img src="packages/site/public/mobile-session-preview.jpeg" alt="File browser on mobile" width="250" /></td>
    <td align="center"><img src="packages/site/public/mobile-command-palette.jpeg" alt="Command palette on mobile" width="250" /></td>
  </tr>
</table>

## Quick Start

```bash
npx termbeam
```

Or install globally:

```bash
npm install -g termbeam
termbeam
```

Scan the QR code printed in your terminal, or open the URL on any device.

```bash
termbeam                        # tunnel + auto-password (default)
termbeam --password mysecret    # custom password
termbeam --no-tunnel            # LAN only
termbeam -i                     # interactive setup wizard
```

## Features

### Mobile-First

- **No SSH client needed** — just open a browser on any device
- **Touch-optimized key bar** with arrows, Tab, Ctrl, Esc, copy, paste, and more
- **Swipe scrolling**, pinch zoom, and text selection overlay for copy-paste
- **iPhone PWA safe-area support** for a native-app feel

### Multi-Session

- **Tabbed terminals** with drag-to-reorder and live tab previews on hover/long-press
- **Split view** — two sessions side-by-side (auto-rotates horizontal/vertical)
- **Session colors and activity indicators** for at-a-glance status
- **Folder browser** for picking working directory, optional initial command per session

### Productivity

- **Terminal search** with regex, match count, and prev/next navigation
- **Command palette** (Ctrl+K / Cmd+K) for quick access to all actions
- **File upload** — send files from your phone to the session's working directory
- **File browser & download** — browse files in a session's working directory from the side panel and download them to your device
- **Markdown viewer** — preview `.md` files rendered with GitHub Flavored Markdown directly in the browser
- **Git changes view** — view git status, diffs, blame, and commit history in the code viewer. Toggle between Files and Changes tabs, view staged/unstaged diffs with syntax highlighting, and see per-line blame annotations
- **Push notifications** — get native push notifications on your phone when commands complete, even when the app is in the background. Uses Web Push API with VAPID authentication
- **In-app updates** — auto-update from the UI for npm/yarn/pnpm global installs, with copy-command fallback for other methods
- **Completion notifications** — browser alerts when background commands finish
- **30 color themes** with adjustable font size
- **Port preview** — reverse-proxy a local web server through TermBeam
- **Image paste** from clipboard

### Secure by Default

- **Auto-generated password** with rate limiting and httpOnly cookies
- **QR code auto-login** with single-use share tokens (5-min expiry)
- **DevTunnel integration** for secure remote access — ephemeral or persisted URLs
- **Security headers** (X-Frame-Options, CSP, nosniff) on all responses; only detected shells allowed

## How It Works

TermBeam starts a lightweight web server that spawns a PTY (pseudo-terminal) with your shell, serves a mobile-optimized [xterm.js](https://xtermjs.org/) UI via Express, and bridges the two over WebSocket. Multiple clients can view the same session simultaneously, and sessions persist when all clients disconnect.

```mermaid
flowchart LR
  A["Phone / Browser"] <-->|WebSocket| B["TermBeam Server"]
  B <-->|PTY| C["Shell (zsh/bash)"]
  B -->|Express| D["Web UI (xterm.js)"]
  B -.->|Optional| E["DevTunnel"]
```

## CLI Highlights

| Flag                  | Description                                     | Default        |
| --------------------- | ----------------------------------------------- | -------------- |
| `--password <pw>`     | Set access password                             | Auto-generated |
| `--no-password`       | Disable password protection                     | —              |
| `--tunnel`            | Create an ephemeral devtunnel URL               | On             |
| `--no-tunnel`         | Disable tunnel (LAN-only)                       | —              |
| `--persisted-tunnel`  | Reusable devtunnel URL (stable across restarts) | Off            |
| `--port <port>`       | Server port                                     | `3456`         |
| `--host <addr>`       | Bind address                                    | `127.0.0.1`    |
| `--lan`               | Bind to all interfaces (LAN access)             | Off            |
| `--public`            | Allow public tunnel access (no Microsoft login) | Off            |
| `-i, --interactive`   | Interactive setup wizard                        | Off            |
| `--log-level <level>` | Log verbosity (error/warn/info/debug)           | `info`         |

For all flags, subcommands, and environment variables, see the [Configuration docs](https://dorlugasigal.github.io/TermBeam/configuration/).

## Background Service

Run TermBeam as an always-on background service using the built-in PM2 integration:

```bash
termbeam service install     # interactive wizard — configures PM2, password, tunnel, boot auto-start
termbeam service status      # check process info, uptime, memory
termbeam service logs        # tail live logs
termbeam service restart     # restart after config changes
termbeam service uninstall   # stop and remove the service
```

The installer checks for [PM2](https://pm2.keymetrics.io/) (and offers to install it), then walks you through password, port, access mode, and boot auto-start options. Config is saved to `~/.termbeam/ecosystem.config.js`.

For systemd, launchd, and Windows Task Scheduler setup, see the [Running in Background docs](https://dorlugasigal.github.io/TermBeam/running-in-background/).

## Security

TermBeam auto-generates a password and creates a secure tunnel by default, binding to `127.0.0.1` (localhost only). Auth uses httpOnly cookies with 24-hour expiry, login is rate-limited to 5 attempts per minute, QR codes contain single-use share tokens (5-min expiry), and security headers (X-Frame-Options, CSP, nosniff) are set on all responses.

For the full threat model and safety checklist, see [SECURITY.md](SECURITY.md). For detailed security documentation, see the [Security Guide](https://dorlugasigal.github.io/TermBeam/security/).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)

## Acknowledgments

Special thanks to [@tamirdresher](https://github.com/tamirdresher) for the [blog post](https://www.tamirdresher.com/blog/2026/02/26/squad-remote-control) that inspired the solution idea for this project, and for his [cli-tunnel](https://github.com/tamirdresher/cli-tunnel) implementation.
