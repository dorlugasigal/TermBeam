<div align="center">

# TermBeam

**Beam your terminal to any device.**

[![npm version](https://img.shields.io/npm/v/termbeam.svg)](https://www.npmjs.com/package/termbeam)
[![npm downloads](https://img.shields.io/npm/dm/termbeam.svg)](https://www.npmjs.com/package/termbeam)
[![CI](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml/badge.svg)](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/dorlugasigal/TermBeam/coverage-data/endpoint.json)](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/termbeam.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

TermBeam lets you access your terminal from a phone, tablet, or any browser — no SSH, no port forwarding, no config files. Run one command and scan the QR code.

I built this because I kept needing to run quick commands on my dev machine while away from my desk, and SSH on a phone is painful. TermBeam gives you a real terminal with a touch-friendly UI that actually works on small screens.

[Full documentation](https://dorlugasigal.github.io/TermBeam/) · [Website](https://termbeam.pages.dev)

https://github.com/user-attachments/assets/9dd4f3d7-f017-4314-9b3a-f6a5688e3671

### Mobile UI

<table align="center">
  <tr>
    <td align="center"><img src="docs/assets/screenshots/mobile-session-hub.jpeg" alt="Session hub on mobile" width="250" /></td>
    <td align="center"><img src="docs/assets/screenshots/mobile-terminal.jpeg" alt="Terminal on mobile" width="250" /></td>
    <td align="center"><img src="docs/assets/screenshots/mobile-session-preview.jpeg" alt="Session preview on mobile" width="250" /></td>
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

### Secure by default

TermBeam starts with a tunnel and auto-generated password out of the box — just run `termbeam` and scan the QR code.

```bash
termbeam                        # tunnel + auto-password (default)
termbeam --password mysecret    # use a specific password
termbeam --no-tunnel            # LAN-only (no tunnel)
termbeam --no-password          # disable password protection
```

## Features

- **Mobile-first UI** with on-screen touch bar (arrow keys, Tab, Enter, Ctrl shortcuts, Esc) and touch-optimized controls
- **Copy/paste support** — Copy button opens text overlay for finger-selectable terminal content; Paste button with clipboard API + fallback modal
- **Image paste** — paste images from clipboard, uploaded to server
- **Tabbed multi-session terminal** — open, switch, and manage multiple sessions from a single tab bar with drag-to-reorder
- **Split view** — view two sessions side-by-side (horizontal on desktop, vertical on mobile)
- **Session colors** — assign a color to each session for quick identification
- **Activity indicators** — see how recently each session had output (e.g. "3s ago", "5m ago")
- **Tab previews** — hover (desktop) or long-press (mobile) a tab to preview the last few lines of output
- **Side panel** (mobile) — slide-out session list with output previews for quick switching
- **Create sessions anywhere** — new session modal available from both the hub page and the terminal page
- **Touch scrolling** — swipe to scroll through terminal history
- **Share button** — share the TermBeam URL via Web Share API, clipboard, or legacy copy fallback (works over HTTP); each share gets a fresh auto-login link with a 5-minute share token
- **QR code auto-login** — scan the QR code to log in automatically without typing the password (share token, 5-minute expiry)
- **Refresh button** — clear PWA/service worker cache and reload to get the latest version
- **iPhone PWA safe area** — full support for `viewport-fit=cover` and safe area insets on notched devices
- **Password auth** with token-based cookies and rate-limited login
- **Folder browser** to pick working directories without typing paths
- **Initial command** — optionally launch a session straight into `htop`, `vim`, or any command
- **Shell detection** — auto-detects your shell on all platforms (PowerShell, cmd, bash, zsh, Git Bash, WSL)
- **QR code on startup** for instant phone connection
- **Command completion notifications** — get browser notifications when a command finishes in a background tab; toggle with the bell icon in the toolbar (opt-in, requires browser permission)
- **Terminal search** — press <kbd>Ctrl+F</kbd> / <kbd>Cmd+F</kbd> to open a search overlay with regex support, powered by xterm.js SearchAddon
- **Command palette** — press <kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd> (or tap the ⚙️ button) to open a slide-out tool panel with categorized actions: Session, Search, View, Share, Notifications, and System
- **Light/dark theme** with persistent preference
- **Adjustable font size** via status bar controls, saved across sessions
- **Port preview** — reverse-proxy a single local web server port and preview it in the browser (HTTP only; no WebSocket/HMR; best with server-rendered apps)
- **Remote access via [DevTunnel](#remote-access)** — ephemeral or persisted public URLs

## Remote Access

```bash
# Tunnel is on by default
termbeam

# Persisted tunnel (stable URL you can bookmark, reused across restarts, 30-day expiry)
termbeam --persisted-tunnel

# LAN-only (no tunnel)
termbeam --no-tunnel
```

If the [Dev Tunnels CLI](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started) is not installed, TermBeam will offer to install it for you automatically. You can also install it manually:

- **Windows:** `winget install Microsoft.devtunnel`
- **macOS:** `brew install --cask devtunnel`
- **Linux:** `curl -sL https://aka.ms/DevTunnelCliInstall | bash`

Persisted tunnels save a tunnel ID to `~/.termbeam/tunnel.json` so the URL stays the same between sessions.

## CLI Reference

```bash
termbeam [shell] [args...]        # start with a specific shell (default: auto-detect)
termbeam --port 8080              # custom port (default: 3456)
termbeam --host 0.0.0.0           # allow LAN access (default: 127.0.0.1)
termbeam --lan                    # shortcut for --host 0.0.0.0
termbeam service install          # interactive PM2 service setup wizard
termbeam service uninstall        # stop & remove PM2 service
termbeam service status           # show PM2 service status
termbeam service logs             # tail PM2 service logs
termbeam service restart          # restart PM2 service
```

| Flag                  | Description                                          | Default        |
| --------------------- | ---------------------------------------------------- | -------------- |
| `--password <pw>`     | Set access password (also accepts `--password=<pw>`) | Auto-generated |
| `--no-password`       | Disable password (cannot combine with `--public`)    | —              |
| `--generate-password` | Auto-generate a secure password                      | On             |
| `--tunnel`            | Create an ephemeral devtunnel URL (private)          | On             |
| `--no-tunnel`         | Disable tunnel (LAN-only)                            | —              |
| `--persisted-tunnel`  | Create a reusable devtunnel URL                      | Off            |
| `--public`            | Allow public tunnel access                           | Off            |
| `--port <port>`       | Server port                                          | `3456`         |
| `--host <addr>`       | Bind address                                         | `127.0.0.1`    |
| `--lan`               | Bind to all interfaces (LAN access)                  | Off            |
| `--log-level <level>` | Log verbosity (error/warn/info/debug)                | `info`         |
| `-h, --help`          | Show help                                            | —              |
| `-v, --version`       | Show version                                         | —              |

| Subcommand          | Description                   |
| ------------------- | ----------------------------- |
| `service install`   | Interactive PM2 service setup |
| `service uninstall` | Stop & remove from PM2        |
| `service status`    | Show PM2 service status       |
| `service logs`      | Tail PM2 service logs         |
| `service restart`   | Restart PM2 service           |

Environment variables: `PORT`, `TERMBEAM_PASSWORD`, `TERMBEAM_CWD`, `TERMBEAM_LOG_LEVEL`, `SHELL` (Unix fallback), `COMSPEC` (Windows fallback). See [Configuration docs](https://dorlugasigal.github.io/TermBeam/configuration/).

## Security

TermBeam auto-generates a password and creates a tunnel by default, so your terminal is protected out of the box. By default, the server binds to `127.0.0.1` (localhost only). Use `--lan` or `--host 0.0.0.0` to allow LAN access, or `--no-tunnel` to disable the tunnel.

Auth uses secure httpOnly cookies with 24-hour expiry, login is rate-limited to 5 attempts per minute, and security headers (X-Frame-Options, X-Content-Type-Options, etc.) are set on all responses. Each QR code contains a single-use share token (5-minute expiry) for password-free login. API clients that can't use cookies can authenticate with an `Authorization: Bearer <password>` header.

For the full threat model, safe usage guidance, and a quick safety checklist, see [SECURITY.md](SECURITY.md). For detailed security feature documentation, see the [Security Guide](https://dorlugasigal.github.io/TermBeam/security/).

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)

## Acknowledgments

Special thanks to [@tamirdresher](https://github.com/tamirdresher) for the [blog post](https://www.tamirdresher.com/blog/2026/02/26/squad-remote-control) that inspired the solution idea for this project, and for his [cli-tunnel](https://github.com/tamirdresher/cli-tunnel) implementation.
