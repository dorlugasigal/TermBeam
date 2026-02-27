# Configuration

## CLI Flags

| Flag                  | Description                     | Default   |
| --------------------- | ------------------------------- | --------- |
| `--password <pw>`     | Set access password             | None      |
| `--generate-password` | Auto-generate a secure password | —         |
| `--tunnel`            | Create a public devtunnel URL   | Off       |
| `--new-tunnel`        | Force a fresh tunnel (ignore persisted) | Off |
| `--port <port>`       | Server port                     | `3456`    |
| `--host <addr>`       | Bind address                    | `0.0.0.0` |
| `-h, --help`          | Show help                       | —         |
| `-v, --version`       | Show version                    | —         |

## Environment Variables

| Variable            | Description               | Default           |
| ------------------- | ------------------------- | ----------------- |
| `PORT`              | Server port               | `3456`            |
| `TERMBEAM_PASSWORD` | Access password           | None              |
| `TERMBEAM_CWD`      | Default working directory | Current directory |
| `SHELL`             | Default shell             | `/bin/zsh`        |

!!! note
CLI flags take precedence over environment variables.

!!! info "Legacy Variables"
The environment variables `PTY_PASSWORD` and `PTY_CWD` are also supported as fallbacks for `TERMBEAM_PASSWORD` and `TERMBEAM_CWD` respectively.

## Examples

### Basic Usage

```bash
# Start with defaults (localhost only, no password)
termbeam

# Use a specific shell
termbeam /bin/bash

# Use fish shell with custom port
termbeam --port 8080 /usr/bin/fish
```

### With Authentication

```bash
# Set a password
termbeam --password mysecret

# Auto-generate a secure password (recommended)
termbeam --generate-password

# Use environment variable
TERMBEAM_PASSWORD=mysecret termbeam
```

### Network Access

```bash
# Listen on all interfaces (LAN access)
termbeam --host 0.0.0.0 --generate-password

# Create a public tunnel (internet access)
termbeam --tunnel --generate-password
```

### DevTunnel

The `--tunnel` flag creates a public URL using [Azure DevTunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/):

```bash
termbeam --tunnel --password mysecret
```

!!! info "Tunnel Persistence"
    TermBeam persists the tunnel ID to `~/.termbeam/tunnel.json` so the same
    public URL is reused across restarts. The tunnel is **not** deleted on
    shutdown — only the host process is stopped. Use `--new-tunnel` to force
    creation of a fresh tunnel.

!!! warning
Always use a password when using `--tunnel`. The tunnel URL is publicly accessible.

Requirements:

- `devtunnel` CLI must be installed
- Login is handled automatically — if not already logged in, TermBeam will launch `devtunnel user login` for you
