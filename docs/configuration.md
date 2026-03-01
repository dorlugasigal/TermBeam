---
title: TermBeam Configuration
description: All TermBeam CLI flags and options — ports, passwords, tunnels, shells, and more.
---

# Configuration

## CLI Flags

| Flag                  | Description                     | Default   |
| --------------------- | ------------------------------- | --------- |
| `--password <pw>`     | Set access password (also accepts `--password=<pw>`) | None      |
| `--generate-password` | Auto-generate a secure password (default behavior) | On        |
| `--no-password`       | Disable auto-generated password | —         |
| `--tunnel`            | Create an ephemeral devtunnel URL | On        |
| `--no-tunnel`         | Disable tunnel                  | —         |
| `--persisted-tunnel`  | Create a reusable devtunnel URL (stable across restarts) | Off |
| `--port <port>`       | Server port                     | `3456`    |
| `--host <addr>`       | Bind address                    | `0.0.0.0` |
| `-h, --help`          | Show help                       | —         |
| `-v, --version`       | Show version                    | —         |
| `--log-level <level>` | Set log verbosity: `error`, `warn`, `info`, `debug` | `info` |

## Environment Variables

| Variable            | Description               | Default           |
| ------------------- | ------------------------- | ----------------- |
| `PORT`              | Server port               | `3456`            |
| `TERMBEAM_PASSWORD` | Access password           | None              |
| `TERMBEAM_CWD`      | Default working directory | Current directory |
| `TERMBEAM_LOG_LEVEL`| Log level                 | `info`            |
| `SHELL`             | Fallback shell on Unix (used only if auto-detection fails) | `/bin/sh` |
| `COMSPEC`           | Fallback shell on Windows (used only if auto-detection fails) | `cmd.exe` |

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

```bash
# Listen on all interfaces with auto-generated password (default behavior)
termbeam

# Localhost only, no tunnel
termbeam --no-tunnel --host 127.0.0.1

# Create a public tunnel (internet access) — on by default
termbeam
```

### DevTunnel

The `--tunnel` flag creates an ephemeral public URL using [Azure DevTunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/):

```bash
termbeam --password mysecret
```

For a **stable URL** that persists across restarts, use `--persisted-tunnel`:

```bash
termbeam --persisted-tunnel --password mysecret
```

!!! info "Persisted vs Ephemeral Tunnels"
    - `--tunnel` — Creates a fresh tunnel each time, deleted on shutdown. Good for one-off use.
    - `--persisted-tunnel` — Saves the tunnel ID to `~/.termbeam/tunnel.json` and reuses it across restarts (30-day expiry). The URL stays the same so you can bookmark it on your phone. To get a fresh URL, just switch back to `--tunnel`.

!!! warning
A password is always auto-generated when using a tunnel. The tunnel URL is publicly accessible.

Requirements:

- `devtunnel` CLI must be installed
- Login is handled automatically — if not already logged in, TermBeam will launch `devtunnel user login` for you
