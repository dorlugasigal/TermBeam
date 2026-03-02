# TermBeam

**Beam your terminal to any device.**

[![npm version](https://img.shields.io/npm/v/termbeam.svg)](https://www.npmjs.com/package/termbeam)
[![CI](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml/badge.svg)](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/dorlugasigal/TermBeam/coverage-data/endpoint.json)](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

TermBeam lets you access your terminal from a phone, tablet, or any browser — no SSH, no port forwarding, no config files. Run one command and scan the QR code.

I built this because I kept needing to run quick commands on my dev machine while away from my desk, and SSH on a phone is painful. TermBeam gives you a real terminal with a touch-friendly UI that actually works on small screens.

[Full documentation](https://dorlugasigal.github.io/TermBeam/)

https://github.com/user-attachments/assets/9dd4f3d7-f017-4314-9b3a-f6a5688e3671

### Mobile UI

<table align="center">
  <tr>
    <td align="center"><img src="docs/assets/screenshots/mobile-session-hub.jpeg" alt="Session hub on mobile" width="250" /></td>
    <td align="center"><img src="docs/assets/screenshots/mobile-session-preview.jpeg" alt="Session preview on mobile" width="250" /></td>
    <td align="center"><img src="docs/assets/screenshots/mobile-terminal.jpeg" alt="Terminal on mobile" width="250" /></td>
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

Requires the [Dev Tunnels CLI](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started):

- **Windows:** `winget install Microsoft.devtunnel`
- **macOS:** `brew install --cask devtunnel`
- **Linux:** `curl -sL https://aka.ms/DevTunnelCliInstall | bash`

Persisted tunnels save a tunnel ID to `~/.termbeam/tunnel.json` so the URL stays the same between sessions.

## CLI Reference

```bash
termbeam [shell] [args...]        # start with a specific shell (default: auto-detect)
termbeam --port 8080              # custom port (default: 3456)
termbeam --host 127.0.0.1        # restrict to localhost (default: 0.0.0.0)
```

| Flag                  | Description                                          | Default        |
| --------------------- | ---------------------------------------------------- | -------------- |
| `--password <pw>`     | Set access password (also accepts `--password=<pw>`) | Auto-generated |
| `--no-password`       | Disable password                                     | —              |
| `--generate-password` | Auto-generate a secure password                      | On             |
| `--tunnel`            | Create an ephemeral devtunnel URL                    | On             |
| `--no-tunnel`         | Disable tunnel (LAN-only)                            | —              |
| `--persisted-tunnel`  | Create a reusable devtunnel URL                      | Off            |
| `--port <port>`       | Server port                                          | `3456`         |
| `--host <addr>`       | Bind address                                         | `0.0.0.0`      |
| `--log-level <level>` | Log verbosity (error/warn/info/debug)                | `info`         |

Environment variables: `PORT`, `TERMBEAM_PASSWORD`, `TERMBEAM_CWD`, `TERMBEAM_LOG_LEVEL`, `SHELL` (Unix fallback), `COMSPEC` (Windows fallback). See [Configuration docs](https://dorlugasigal.github.io/TermBeam/configuration/).

## Security

TermBeam auto-generates a password and creates a tunnel by default, so your terminal is protected out of the box. Be aware that the tunnel exposes your terminal to the internet — use `--no-tunnel` for LAN-only access, or `--host 127.0.0.1` to restrict to your machine only.

Auth uses secure httpOnly cookies with 24-hour expiry, login is rate-limited to 5 attempts per minute, and security headers (X-Frame-Options, X-Content-Type-Options, etc.) are set on all responses. The QR code on startup embeds a share token for password-free login — the token is reusable within its 5-minute validity window, which handles tunnel proxy retries and link preview services. API clients that can't use cookies can authenticate with an `Authorization: Bearer <password>` header. See the [Security Guide](https://dorlugasigal.github.io/TermBeam/security/) for more.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

## Acknowledgments

Special thanks to [@tamirdresher](https://github.com/tamirdresher) for the [blog post](https://www.tamirdresher.com/blog/2026/02/26/squad-remote-control) that inspired the solution idea for this project, and for his [cli-tunnel](https://github.com/tamirdresher/cli-tunnel) implementation.
