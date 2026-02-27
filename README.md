# TermBeam

**Beam your terminal to any device.**

[![npm version](https://img.shields.io/npm/v/termbeam.svg)](https://www.npmjs.com/package/termbeam)
[![CI](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml/badge.svg)](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/dorlugasigal/TermBeam/graph/badge.svg)](https://codecov.io/gh/dorlugasigal/TermBeam)

TermBeam lets you access your terminal from a phone, tablet, or any browser — no SSH, no port forwarding, no config files. Run one command and scan the QR code.

I built this because I kept needing to run quick commands on my dev machine while away from my desk, and SSH on a phone is painful. TermBeam gives you a real terminal with a touch-friendly UI that actually works on small screens.

[Full documentation](https://dorlugasigal.github.io/TermBeam/)

https://github.com/user-attachments/assets/c91ca15d-0c84-400f-bbfa-3d58d1be07ee

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

### Password protection (recommended)

```bash
termbeam --generate-password

# or set your own
termbeam --password mysecret
```

## Features

- **Mobile-first UI** with on-screen touch bar (arrow keys, Tab, Ctrl shortcuts, Esc) and swipe-to-delete session management
- **Multiple sessions** running simultaneously, managed from a single hub page — shows connected client count per session
- **Password auth** with token-based cookies and rate-limited login
- **Folder browser** to pick working directories without typing paths
- **Initial command** — optionally launch a session straight into `htop`, `vim`, or any command
- **Shell detection** — auto-detects your shell on all platforms (PowerShell, cmd, bash, zsh, Git Bash, WSL)
- **QR code on startup** for instant phone connection
- **Light/dark theme** with persistent preference
- **Adjustable font size** via status bar controls, saved across sessions
- **Remote access via [DevTunnel](#remote-access)** — ephemeral or persisted public URLs

## Remote Access

```bash
# One-off tunnel (deleted on shutdown)
termbeam --tunnel --generate-password

# Persisted tunnel (stable URL you can bookmark, reused across restarts, 30-day expiry)
termbeam --persisted-tunnel --generate-password
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

| Flag                  | Description                              | Default     |
| --------------------- | ---------------------------------------- | ----------- |
| `--password <pw>`     | Set access password                      | None        |
| `--generate-password` | Auto-generate a secure password          | —           |
| `--tunnel`            | Create an ephemeral devtunnel URL        | Off         |
| `--persisted-tunnel`  | Create a reusable devtunnel URL          | Off         |
| `--port <port>`       | Server port                              | `3456`      |
| `--host <addr>`       | Bind address                             | `0.0.0.0`   |

Environment variables: `PORT`, `TERMBEAM_PASSWORD`, `TERMBEAM_CWD` (see [Configuration docs](https://dorlugasigal.github.io/TermBeam/configuration/)).

## Security

TermBeam binds to all interfaces (`0.0.0.0`) by default, so it's accessible on your local network out of the box. **Always set a password** when running on a shared network, or pass `--host 127.0.0.1` to restrict access to your machine only.

Auth uses secure httpOnly cookies with 24-hour expiry, login is rate-limited to 5 attempts per minute, and security headers (X-Frame-Options, X-Content-Type-Options, etc.) are set on all responses. API clients that can't use cookies can authenticate with an `Authorization: Bearer <password>` header. See the [Security Guide](https://dorlugasigal.github.io/TermBeam/security/) for more.

## Contributing

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

## Acknowledgments

Special thanks to [@tamirdresher](https://github.com/tamirdresher) for the [blog post](https://www.tamirdresher.com/blog/2026/02/26/squad-remote-control) that inspired the solution idea for this project, and for his [cli-tunnel](https://github.com/tamirdresher/cli-tunnel) implementation.