---
title: Resume & List
description: Reconnect to running TermBeam sessions from your terminal — list, attach, and detach without a browser.
---

TermBeam includes CLI commands for reconnecting to running sessions directly from your terminal — no browser needed. Think `tmux attach` or `screen -r`, but for TermBeam.

## Quick Start

```bash
# List all active sessions
termbeam list

# Reconnect to a running session (interactive chooser if multiple)
termbeam resume
# or equivalently:
termbeam attach

# Reconnect by session name
termbeam resume my-project

# Detach without closing the session
# Press Ctrl+B
```

## `termbeam resume` (alias: `termbeam attach`)

Connects to a running TermBeam server and attaches to a session via WebSocket, piping your terminal's stdin/stdout directly. The experience is identical to working in the original terminal.

### Usage

```
termbeam resume [name] [options]
termbeam attach [name] [options]   # alias
```

### Arguments

| Argument | Description                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `name`   | Session name or ID prefix to connect to. If omitted and multiple sessions exist, an interactive arrow-key chooser is displayed. |

### Options

| Flag                 | Description                    | Default                                      |
| -------------------- | ------------------------------ | -------------------------------------------- |
| `--port <port>`      | Server port                    | From `~/.termbeam/connection.json` or `3456` |
| `--host <host>`      | Server host                    | From config or `localhost`                   |
| `--password <pw>`    | Server password                | From config or interactive prompt            |
| `--detach-key <key>` | Key to detach from the session | Ctrl+B                                       |
| `-h, --help`         | Show help                      | —                                            |

### Session Selection

- **Single session** — auto-attaches, no prompt needed.
- **Multiple sessions** — displays an arrow-key chooser showing session name, ID, working directory, uptime, and connected clients.
- **Name provided** — matches by exact name (case-insensitive) or ID prefix. Shows available sessions if no match found.

### Detaching

Press **Ctrl+B** to detach from a session. This disconnects your terminal client without affecting the running session — other clients (browser, other resume connections) remain connected, and the session continues running.

<!-- prettier-ignore -->
:::tip[Custom detach key]
Use `--detach-key` to change the detach key. Supports `\xNN` hex, `^X` caret, and `ctrl+X` notation. For example, `--detach-key '^A'` uses Ctrl+A, `--detach-key '\x01'` does the same, or `--detach-key 'q'` uses lowercase q.
:::

### Scrollback

When you attach to a session, the existing scrollback buffer (up to ~500,000 characters; trimmed when the buffer exceeds 1,000,000) is replayed automatically. You'll see the terminal output as if you'd been connected the whole time.

## `termbeam list`

Lists all active sessions on a running TermBeam server in a formatted table.

### Usage

```
termbeam list [--json]
```

Connection details are read automatically from `~/.termbeam/connection.json`.

### Options

| Flag     | Description                         |
| -------- | ----------------------------------- |
| `--json` | Output session data as a JSON array |

### Output

```
  3 sessions on http://localhost:3456

  NAME          ID        CWD                    UPTIME    CLIENTS
  my-project    a1b2c3d4  /home/user/project     2h 15m   1
  api-server    e5f6a7b8  /home/user/api         45m      0
  scratch       c9d0e1f2  /tmp                   5m       2

  Tip: use --json for machine-readable output
```

With `--json`, outputs a JSON array suitable for scripting:

```bash
termbeam list --json
# [{"id":"a1b2c3d4...","name":"my-project","cwd":"/home/user/project","createdAt":"2026-03-18T00:00:00Z","clients":1,...}]

# Pipe to jq for pretty-printing
termbeam list --json | jq .
```

## Zero-Config Discovery

When a TermBeam server starts, it saves connection details to `~/.termbeam/connection.json`:

```json
{
  "port": 3456,
  "host": "localhost",
  "password": "auto-generated-password"
}
```

The `resume` (or `attach`) and `list` commands read this file automatically, so you don't need to remember or type the port and password. The file is removed when the server shuts down.

<!-- prettier-ignore -->
:::note[Multiple servers]
If you run multiple TermBeam instances, only the most recently started server's config is saved. Use `--port` and `--password` flags to connect to a specific server.
:::

## Authentication

The resume client authenticates using the same password as the web UI:

1. **Auto-detected** — reads password from `~/.termbeam/connection.json` (written by the server on start).
2. **Explicit** — pass `--password <pw>` on the command line.
3. **Interactive** — if no password is available and the server requires one, you'll be prompted.
4. **No-password mode** — if the server was started with `--no-password`, no authentication is needed.

## Examples

### Basic reconnection workflow

```bash
# Terminal 1: Start TermBeam
termbeam --no-tunnel

# Terminal 2: Reconnect from another terminal
termbeam resume
```

### Reconnect to a specific session

```bash
termbeam resume api-server
```

### Connect to a server on a different port

```bash
termbeam resume --port 4000 --password mysecret
```

### Quick glance at running sessions

```bash
termbeam list
```

---

## See Also

- **[Getting Started](../getting-started/)** — install and run TermBeam in under a minute
- **[Configuration](../configuration/)** — CLI flags, environment variables, and defaults
- **[Running in Background](../running-in-background/)** — keep TermBeam always available with PM2, systemd, or launchd
