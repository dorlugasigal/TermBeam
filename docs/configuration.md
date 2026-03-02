---
title: TermBeam Configuration
description: All TermBeam CLI flags and options — ports, passwords, tunnels, shells, and more.
---

# Configuration

## CLI Flags

| Flag                  | Description                                                      | Default   |
| --------------------- | ---------------------------------------------------------------- | --------- |
| `--password <pw>`     | Set access password (also accepts `--password=<pw>`)             | None      |
| `--generate-password` | Auto-generate a secure password (default behavior)               | On        |
| `--no-password`       | Disable auto-generated password (cannot combine with `--public`) | —         |
| `--tunnel`            | Create an ephemeral devtunnel URL (private access)               | On        |
| `--no-tunnel`         | Disable tunnel                                                   | —         |
| `--persisted-tunnel`  | Create a reusable devtunnel URL (stable across restarts)         | Off       |
| `--public`            | Allow public tunnel access (no Microsoft login required)         | Off       |
| `--port <port>`       | Server port                                                      | `3456`    |
| `--host <addr>`       | Bind address                                                     | `127.0.0.1` |
| `--lan`               | Bind to all interfaces (LAN access)                              | Off       |
| `-h, --help`          | Show help                                                        | —         |
| `-v, --version`       | Show version                                                     | —         |
| `--log-level <level>` | Set log verbosity: `error`, `warn`, `info`, `debug`              | `info`    |

## Environment Variables

| Variable             | Description                                                   | Default           |
| -------------------- | ------------------------------------------------------------- | ----------------- |
| `PORT`               | Server port                                                   | `3456`            |
| `TERMBEAM_PASSWORD`  | Access password                                               | None              |
| `TERMBEAM_CWD`       | Default working directory                                     | Current directory |
| `TERMBEAM_LOG_LEVEL` | Log level                                                     | `info`            |
| `SHELL`              | Fallback shell on Unix (used only if auto-detection fails)    | `/bin/sh`         |
| `COMSPEC`            | Fallback shell on Windows (used only if auto-detection fails) | `cmd.exe`         |

!!! note
CLI flags take precedence over environment variables.

!!! info "Shell Auto-Detection"
TermBeam auto-detects your current shell by inspecting the parent process tree. The `SHELL` (Unix) and `COMSPEC` (Windows) environment variables are only used as fallbacks when detection fails.

!!! info "Legacy Variables"
The environment variables `PTY_PASSWORD` and `PTY_CWD` are also supported as fallbacks for `TERMBEAM_PASSWORD` and `TERMBEAM_CWD` respectively.

## Examples

### Basic Usage

```bash
# Start with defaults (tunnel + auto-generated password)
termbeam

# Start without tunnel (LAN only, auto-generated password)
termbeam --no-tunnel

# Start without password (not recommended)
termbeam --no-password

# Use a specific shell
termbeam /bin/bash

# Use fish shell with custom port
termbeam --port 8080 /usr/bin/fish
```

### With Authentication

```bash
# Set an explicit password
termbeam --password mysecret

# Use environment variable
TERMBEAM_PASSWORD=mysecret termbeam
```

### Network Access

By default, TermBeam binds to localhost only. Use `--lan` or `--host 0.0.0.0` to allow connections from other devices on your network.

```bash
# Localhost only (default behavior)
termbeam

# Allow LAN access
termbeam --lan

# Allow LAN access (equivalent to --lan)
termbeam --host 0.0.0.0

# Create a public tunnel (internet access) — on by default
termbeam
```

### DevTunnel

The `--tunnel` flag creates a private URL using [Azure DevTunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/). By default, only the tunnel owner (you) can access it — visitors must authenticate with the same Microsoft account used by `devtunnel user login`:

```bash
termbeam --password mysecret
```

To allow **public access** (anyone with the URL can connect), add `--public`:

```bash
termbeam --public --password mysecret
```

For a **stable URL** that persists across restarts, use `--persisted-tunnel`:

```bash
termbeam --persisted-tunnel --password mysecret
```

!!! info "Persisted vs Ephemeral Tunnels" - `--tunnel` — Creates a fresh tunnel each time, deleted on shutdown. Good for one-off use. - `--persisted-tunnel` — Saves the tunnel ID to `~/.termbeam/tunnel.json` and reuses it across restarts (30-day expiry). The URL stays the same so you can bookmark it on your phone. To get a fresh URL, just switch back to `--tunnel`.

!!! warning
A password is always auto-generated when using a tunnel. By default, tunnel access is private (owner-only via Microsoft login). Use `--public` to allow public access. **`--public` cannot be combined with `--no-password`** — TermBeam will refuse to start to prevent unauthenticated public exposure.

Requirements:

- `devtunnel` CLI — TermBeam will offer to install it automatically if not found
- Login is handled automatically — if not already logged in, TermBeam will launch `devtunnel user login` for you
