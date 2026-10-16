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
| `--font <path>`       | Serve a local WOFF2 terminal font to all connected devices                                                    | Bundled font   |
| `--lan`               | Bind to all interfaces (LAN access)                                                                           | Off            |
| `--public-url <url>`  | The address browsers use when TermBeam sits behind your own reverse proxy (e.g. `https://term.example.com`)   | —              |
| `-i, --interactive`   | Interactive setup wizard — walks through password, port, access mode (tunnel type, visibility), and log level | Off            |
| `--force`             | Stop any existing TermBeam server before starting a new one                                                   | Off            |
| `--reset-auth`        | Sign out every remembered device and remove every registered passkey before starting                          | Off            |
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
| `TERMBEAM_CONFIG_DIR` | Location for `connection.json`, `auth.json` and other config  | `~/.termbeam/`    |
| `TERMBEAM_PUBLIC_URL` | Same as `--public-url` (the flag wins when both are set)      | None              |
| `TERMBEAM_FONT`       | Local WOFF2 terminal font path (`--font` takes precedence)    | Bundled font      |
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

### Files in the config directory

| File              | Contents                                                                                                                                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection.json` | Port/host/password of the running server, for `termbeam resume` / `termbeam list`. Removed on shutdown.                                                                                                                                      |
| `auth.json`       | Remembered device sessions (SHA-256 hashes only), passkey public keys, and a scrypt fingerprint of the password. Mode `0600`. Run `--reset-auth` (or delete it while TermBeam is stopped) to sign out every device and remove every passkey. |
| `prefs.json`      | UI preferences synced from Settings.                                                                                                                                                                                                         |
| `tunnel.json`     | The reusable tunnel id for `--persisted-tunnel` (always in `~/.termbeam`).                                                                                                                                                                   |

## Custom Terminal Font

Use `--font` to serve a local WOFF2 font to every device that connects to the server:

```bash
termbeam --font /path/to/your-monospace-font.woff2

# Environment variable alternative (the flag takes precedence)
TERMBEAM_FONT=/path/to/your-monospace-font.woff2 termbeam
```

Relative paths are resolved from the server's working directory. Paths with spaces
should be quoted. Choose a monospace font with the glyphs you need; the bundled
Nerd Font remains available as a fallback for missing glyphs and icons. Browsers
synthesize bold text from the supplied font.

The font is served from the same origin as TermBeam and requires the same
authentication. No separate font hosting, frontend rebuild, or browser installation
is needed. The API exposes an opaque font URL rather than the local filesystem
path. Without this option, TermBeam uses its bundled font as before.

An unreadable file, a non-WOFF2 extension, or an invalid WOFF2 header prevents the
server from starting. If a browser cannot load the font, it uses the bundled font
or the system monospace fallback. Restart TermBeam and reload the page after
changing the font file; its content-based URL ensures the new version is loaded.

## Settings (UI)

TermBeam exposes settings through the **Tools panel**, opened from the ▦ button in the top bar or `Ctrl/Cmd+K`. From there pick **Settings…** (or use the `Cmd/Ctrl+,` shortcut). On phones the Settings panel drops down from the top as a sheet; on desktop it docks to the right (420 px wide). It is non-blocking so theme, font size, collapsed-touchbar and haptics changes can be observed live against the terminal underneath.

For the full UI walkthrough — Tools panel sections, Settings panels, Touch Bar key editor, Workspaces — see **[Customization](../customization/)**.

### Where preferences are stored

Preferences are persisted **server-side** in `~/.termbeam/prefs.json` (mode `0o600`) via the authenticated `GET /api/preferences` and `PUT /api/preferences` endpoints. The browser keeps a `localStorage` cache (`termbeam-prefs`) for instant first paint and offline UX, but the server file is the source of truth — opening TermBeam from a phone, tablet and laptop against the same instance gets the same settings.

The schema is roughly:

```jsonc
{
  "themeId": "one-dark",
  "fontSize": 13,
  "notifications": false,
  "haptics": true,
  "defaultFolder": "",
  "defaultInitialCommand": "",
  "touchBarCollapsed": true,
  "touchBarKeys": [{ "id": "esc", "label": "Esc", "send": "\u001b", "row": 1, "col": 1 }],
  "workspaces": [
    {
      "name": "DevWorkspace",
      "default": true,
      "sessions": [
        {
          "name": "server",
          "cwd": "/path",
          "shell": "/bin/zsh",
          "color": "#4a9eff",
          "initialCommand": "npm run dev",
        },
      ],
    },
  ],
  "startupWorkspace": { "enabled": false, "sessions": [] }, // legacy
}
```

The legacy device-local keys below are still read once on first load after upgrade and migrated into the unified store; they remain device-only:

| Key                          | Description                                              |
| ---------------------------- | -------------------------------------------------------- |
| `termbeam-tab-order`         | Saved tab order (JSON array of session IDs).             |
| `termbeam-hub-filter`        | Last-used filter on the SessionsHub page.                |
| `termbeam-push-subscribed`   | Whether the browser is subscribed to push notifications. |
| `termbeam-review-comments:*` | Per-PR review-comment state (Copilot integration).       |

These can be cleared at any time via the browser's developer tools.

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

## Behind Your Own Reverse Proxy

TermBeam rejects browser requests whose `Origin` doesn't match an address it is reached at (see [Security](../security/#cross-site-protection-websocket--api)). Proxies that keep the original `Host` header (Caddy's default, Tailscale Serve, cloudflared) work out of the box. If your proxy rewrites `Host` — nginx does by default — either forward it:

```nginx
location / {
  proxy_pass http://127.0.0.1:3456;
  proxy_set_header Host $host;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

…or tell TermBeam the public address explicitly:

```bash
termbeam --no-tunnel --public-url https://term.example.com
```

The public URL is trusted for sign-in, passkeys and WebSockets in addition to the tunnel URL. When a request is blocked, the TermBeam log says which origin and `Host` it saw and how to fix it.

## See Also

- **[Usage Guide](../usage-guide/)** — tabs, split view, search, touch controls, and more
- **[Getting Started](../getting-started/)** — install and run TermBeam in under a minute
- **[Security](../security/)** — threat model, safe usage, and security features
- **[Running in Background](../running-in-background/)** — keep TermBeam always available with PM2, systemd, or launchd
