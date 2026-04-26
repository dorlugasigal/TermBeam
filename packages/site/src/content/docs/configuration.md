---
title: TermBeam Configuration
description: All TermBeam CLI flags and options — ports, passwords, tunnels, shells, and more.
---

## CLI Flags

| Flag                  | Description                                                                                                   | Default        |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | -------------- |
| `--password <pw>`     | Set access password (also accepts `--password=<pw>`)                                                          | Auto-generated |
| `--generate-password` | Auto-generate a secure password (default behavior)                                                            | On             |
| `--no-password`       | Disable password authentication (cannot combine with `--public`)                                              | —              |
| `--tunnel`            | Create an ephemeral devtunnel URL (private access)                                                            | On             |
| `--no-tunnel`         | Disable tunnel                                                                                                | —              |
| `--persisted-tunnel`  | Create a reusable devtunnel URL (stable across restarts)                                                      | Off            |
| `--public`            | Allow public tunnel access (no Microsoft login required)                                                      | Off            |
| `--port <port>`       | Server port (must be 1-65535)                                                                                 | `3456`         |
| `--host <addr>`       | Bind address                                                                                                  | `127.0.0.1`    |
| `--lan`               | Bind to all interfaces (LAN access)                                                                           | Off            |
| `-i, --interactive`   | Interactive setup wizard — walks through password, port, access mode (tunnel type, visibility), and log level | Off            |
| `--force`             | Stop any existing TermBeam server before starting a new one                                                   | Off            |
| `-h, --help`          | Show help                                                                                                     | —              |
| `-v, --version`       | Show version                                                                                                  | —              |
| `--log-level <level>` | Set log verbosity: `error`, `warn`, `info`, `debug`                                                           | `info`         |

## Environment Variables

| Variable              | Description                                                   | Default           |
| --------------------- | ------------------------------------------------------------- | ----------------- |
| `PORT`                | Server port                                                   | `3456`            |
| `TERMBEAM_PASSWORD`   | Access password                                               | None              |
| `TERMBEAM_CWD`        | Default working directory                                     | Current directory |
| `TERMBEAM_LOG_LEVEL`  | Log level                                                     | `info`            |
| `TERMBEAM_CONFIG_DIR` | Location for `connection.json` and other config files         | `~/.termbeam/`    |
| `SHELL`               | Fallback shell on Unix (used only if auto-detection fails)    | `/bin/sh`         |
| `COMSPEC`             | Fallback shell on Windows (used only if auto-detection fails) | `cmd.exe`         |

<!-- prettier-ignore -->
:::note
CLI flags take precedence over environment variables.
:::

<!-- prettier-ignore -->
:::tip[Shell Auto-Detection]
TermBeam auto-detects your current shell by inspecting the parent process tree. The `SHELL` (Unix) and `COMSPEC` (Windows) environment variables are only used as fallbacks when detection fails.
:::

<!-- prettier-ignore -->
:::tip[Legacy Variables]
The environment variables `PTY_PASSWORD` and `PTY_CWD` are also supported as fallbacks for `TERMBEAM_PASSWORD` and `TERMBEAM_CWD` respectively.
:::

## Client-Side Settings (localStorage)

The browser UI stores the following preferences in `localStorage`:

| Key                      | Description                                               | Default |
| ------------------------ | --------------------------------------------------------- | ------- |
| `termbeam-notifications` | Command completion notifications enabled (`true`/`false`) | `true`  |
| `termbeam-font-size`     | Terminal font size                                        | `14`    |
| `termbeam-theme`         | Light/dark theme preference                               | `dark`  |
| `termbeam-tab-order`     | Saved tab order (JSON array of session IDs)               | None    |

These settings are per-browser and persist across sessions. They can be cleared by the user via the browser's developer tools or the Refresh button in the toolbar.

## Subcommands

### `termbeam service`

TermBeam includes a `service` subcommand for managing a PM2-based background service. Run `termbeam service install` to launch an interactive wizard that configures and starts the service.

| Subcommand          | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| `service install`   | Interactive wizard — configures password, port, access mode, and more |
| `service uninstall` | Stops the PM2 process, removes it, and deletes the ecosystem config   |
| `service status`    | Shows detailed PM2 process status (uptime, memory, restarts)          |
| `service logs`      | Tails PM2 logs (last 200 lines + live stream)                         |
| `service restart`   | Restarts the PM2 process                                              |

<!-- prettier-ignore -->
:::tip[Ecosystem config]
The wizard saves its configuration to `~/.termbeam/ecosystem.config.js`. You can edit this file manually and run `termbeam service restart` to apply changes.
:::

For a full walkthrough of the wizard steps and each subcommand, see [Running in Background](../running-in-background/#interactive-setup-easiest).

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

### Interactive Setup

```bash
# Launch the guided setup wizard
termbeam -i
```

The wizard walks through password, port, access mode, and log level with an interactive TUI.

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

# Tunnel is on by default (private, owner-only access)
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

<!-- prettier-ignore -->
:::tip[Persisted vs Ephemeral Tunnels]
- `--tunnel` — Creates a fresh tunnel each time, deleted on shutdown. Good for one-off use.
- `--persisted-tunnel` — Saves the tunnel ID to `~/.termbeam/tunnel.json` and reuses it across restarts (30-day expiry). The URL stays the same so you can bookmark it on your phone. To get a fresh URL, just switch back to `--tunnel`.
:::

<!-- prettier-ignore -->
:::caution
A password is always auto-generated by default. By default, tunnel access is private (owner-only via Microsoft login). Use `--public` to allow public access. **`--public` cannot be combined with `--no-password`** — TermBeam will refuse to start to prevent unauthenticated public exposure.
:::

Requirements:

- `devtunnel` CLI — TermBeam will offer to install it automatically if not found
- Login is handled automatically — if not already logged in, TermBeam will attempt browser login first, then fall back to device code flow if the browser is unavailable (useful in WSL or headless environments)

---

## See Also

- **[Usage Guide](../usage-guide/)** — tabs, split view, search, touch controls, and more
- **[Getting Started](../getting-started/)** — install and run TermBeam in under a minute
- **[Security](../security/)** — threat model, safe usage, and security features
- **[Running in Background](../running-in-background/)** — keep TermBeam always available with PM2, systemd, or launchd
