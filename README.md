<div align="center">

# 📡 TermBeam

**Beam your terminal to any device**

[![npm version](https://img.shields.io/npm/v/termbeam.svg)](https://www.npmjs.com/package/termbeam)
[![CI](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml/badge.svg)](https://github.com/dorlugasigal/TermBeam/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Access your terminal from your phone, tablet, or any browser.
Multi-session, mobile-optimized, with touch controls.

[Getting Started](#-quick-start) · [Demo](#-demo) · [Documentation](https://dorlugasigal.github.io/TermBeam/) · [Contributing](CONTRIBUTING.md)

</div>

---

https://github.com/user-attachments/assets/c91ca15d-0c84-400f-bbfa-3d58d1be07ee

## ✨ Features

- 📱 **Mobile-first UI** — Touch-friendly interface designed for phones and tablets
- 🖥️ **Multi-session** — Run multiple terminal sessions simultaneously
- 🔐 **Password auth** — Token-based authentication with rate limiting
- 📂 **Folder browser** — Visual directory picker with breadcrumb navigation
- 👆 **Touch controls** — Arrow keys, Ctrl shortcuts, Tab, Esc via on-screen touch bar
- 🔤 **Nerd Font support** — Full glyph rendering with JetBrains Mono Nerd Font
- 📲 **QR code** — Scan to connect instantly from your phone
- 🌐 **DevTunnel** — Optional public URL for remote access from anywhere
- 🔍 **Adjustable font size** — Pinch or button zoom for any screen
- ↔️ **Swipe to delete** — iOS-style session management
- 🔄 **Smart versioning** — Shows git hash in dev, clean version from npm

## 🚀 Quick Start

```bash
npx termbeam
```

Or install globally:

```bash
npm install -g termbeam
termbeam
```

That's it. Scan the QR code printed in your terminal, or open the URL on any device.

### With password protection (recommended)

```bash
# Auto-generate a secure password
termbeam --generate-password

# Or set your own
termbeam --password mysecret
```

### Remote access from anywhere

```bash
termbeam --tunnel --generate-password
```

> Requires the [Azure Dev Tunnels CLI](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started):
>
> - **Windows:** `winget install Microsoft.devtunnel`
> - **macOS:** `brew install --cask devtunnel`
> - **Linux:** `curl -sL https://aka.ms/DevTunnelCliInstall | bash`

## 📖 Usage

```bash
# Start with your default shell
termbeam

# Use a specific shell
termbeam /bin/bash

# Custom port and listen on all interfaces (LAN access)
termbeam --port 8080 --host 0.0.0.0

# Public tunnel + password (access from anywhere)
termbeam --tunnel --generate-password
```

### CLI Options

| Flag                  | Description                     | Default     |
| --------------------- | ------------------------------- | ----------- |
| `--password <pw>`     | Set access password             | None        |
| `--generate-password` | Auto-generate a secure password | —           |
| `--tunnel`            | Create a public devtunnel URL   | Off         |
| `--port <port>`       | Server port                     | `3456`      |
| `--host <addr>`       | Bind address                    | `127.0.0.1` |
| `-h, --help`          | Show help                       | —           |
| `-v, --version`       | Show version                    | —           |

### Environment Variables

| Variable            | Description                     |
| ------------------- | ------------------------------- |
| `PORT`              | Server port (overrides default) |
| `TERMBEAM_PASSWORD` | Access password                 |
| `TERMBEAM_CWD`      | Default working directory       |

## 🔒 Security

TermBeam is designed for **local network use**. Key security features:

- 🔑 **Token-based auth** with secure, httpOnly cookies (24-hour expiry)
- 🛡️ **Rate limiting** on login (5 attempts per minute)
- 🔒 **Security headers** (X-Frame-Options, X-Content-Type-Options, CSP, etc.)
- 🏠 **Localhost by default** — requires explicit `--host 0.0.0.0` for LAN access

> ⚠️ **Always use a password when exposing to any network.** See the [Security Guide](https://dorlugasigal.github.io/TermBeam/security/) for production deployment tips.

## 🏗️ Architecture

```
termbeam/
├── bin/termbeam.js            # CLI entry point
├── src/
│   ├── server.js              # Main orchestrator
│   ├── cli.js                 # Argument parsing & help
│   ├── auth.js                # Authentication & rate limiting
│   ├── sessions.js            # PTY session lifecycle
│   ├── routes.js              # Express HTTP routes
│   ├── websocket.js           # WebSocket terminal I/O
│   ├── tunnel.js              # DevTunnel integration
│   └── version.js             # Smart version detection
├── public/
│   ├── index.html             # Session manager UI (mobile)
│   └── terminal.html          # Terminal UI (xterm.js)
├── test/                      # Unit tests (node:test)
├── docs/                      # MkDocs documentation
└── .github/workflows/         # CI, Release, Docs deployment
```

See the [Architecture Guide](https://dorlugasigal.github.io/TermBeam/architecture/) for details.

## 📚 Documentation

Full documentation is available at **[dorlugasigal.github.io/TermBeam](https://dorlugasigal.github.io/TermBeam/)**

- [Getting Started](https://dorlugasigal.github.io/TermBeam/getting-started/)
- [Configuration](https://dorlugasigal.github.io/TermBeam/configuration/)
- [Security](https://dorlugasigal.github.io/TermBeam/security/)
- [API Reference](https://dorlugasigal.github.io/TermBeam/api/)
- [Architecture](https://dorlugasigal.github.io/TermBeam/architecture/)

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup and local workflow
- Testing guide (Node.js built-in test runner)
- Commit conventions and PR process
- Release process (maintainers)

## 📄 License

[MIT](LICENSE) — made with ❤️ by [@dorlugasigal](https://github.com/dorlugasigal)
