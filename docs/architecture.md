# Architecture

## Project Structure

```
termbeam/
├── bin/
│   └── termbeam.js         # CLI entry point
├── src/
│   ├── server.js            # Main orchestrator
│   ├── cli.js               # Argument parsing & help
│   ├── client.js            # WebSocket terminal client (for resume)
│   ├── resume.js            # Resume & sessions CLI commands
│   ├── devtunnel-install.js # DevTunnel CLI auto-installer
│   ├── auth.js              # Authentication & rate limiting
│   ├── sessions.js          # PTY session management
│   ├── routes.js            # Express HTTP routes
│   ├── websocket.js         # WebSocket connection handling
│   ├── git.js               # Git repo detection & status
│   ├── tunnel.js            # DevTunnel integration
│   ├── preview.js           # Port preview reverse proxy
│   ├── service.js           # PM2 service management
│   ├── interactive.js      # Interactive setup wizard
│   ├── prompts.js          # Terminal prompt primitives (color, ask, choose, confirm)
│   ├── shells.js            # Shell detection (cross-platform)
│   ├── logger.js            # Structured logger with levels
│   └── version.js           # Smart version detection
├── public/
│   ├── index.html           # Session manager (mobile UI)
│   ├── terminal.html        # Terminal view (xterm.js, search, notifications, command palette)
│   ├── sw.js                # Service worker (PWA caching)
│   ├── manifest.json        # Web app manifest
│   └── icons/               # PWA icons
├── test/
│   ├── auth.test.js
│   ├── cli.test.js
│   ├── client.test.js
│   ├── resume.test.js
│   ├── interactive.test.js
│   ├── prompts.test.js
│   ├── devtunnel-install.test.js
│   ├── e2e-keybar.test.js
│   ├── integration.test.js
│   ├── logger.test.js
│   ├── preview.test.js
│   ├── routes.test.js
│   ├── sessions.test.js
│   ├── shells.test.js
│   ├── version.test.js
│   └── websocket.test.js
├── docs/                    # MkDocs documentation
├── package.json
└── mkdocs.yml
```

## Module Responsibilities

### `server.js` — Orchestrator

Wires all modules together. Exports `createTermBeamServer()` which creates the Express app, HTTP server, WebSocket server, and returns `{ app, server, wss, sessions, config, auth, start, shutdown }`. The `start()` method begins listening and creates the default session. Handles process lifecycle (shutdown, uncaught exceptions).

### `cli.js` — CLI Interface

Parses command-line arguments and environment variables. Returns a config object used by all other modules. Includes platform-specific shell auto-detection: on Windows it walks the process tree (via `wmic`) looking for PowerShell or cmd.exe; on Unix it inspects the parent process via `ps` and falls back to `$SHELL` or `/bin/sh`.

### `auth.js` — Authentication

Factory function `createAuth(password)` returns an object with middleware, token management, rate limiting, and the login page HTML.

### `sessions.js` — Session Manager

`SessionManager` class wraps the PTY lifecycle. Handles spawning, tracking, listing, updating, and cleaning up terminal sessions. Each session has an auto-assigned color, tracks `lastActivity` timestamps, a `createdAt` timestamp, and supports live updates via the `update()` method. Sessions maintain a scrollback buffer (capped at 200 KB) that is sent to newly connecting clients, and track a `clients` Set of active WebSocket connections. Supports an optional `initialCommand` that is written to the PTY shortly after spawn. The `list()` method detects the live working directory of the shell process (via `lsof` on macOS, `/proc` on Linux) and enriches each session with git repository information, using an async cache to avoid blocking the event loop.

### `git.js` — Git Repository Detection

Detects git repository information for a given directory. Provides `getGitInfo(cwd)` which returns branch name, remote provider (GitHub, GitLab, Bitbucket, Azure DevOps), repository name, and working tree status (staged, modified, untracked counts plus ahead/behind tracking). Also exports `parseRemoteUrl()` and `parseStatus()` for URL parsing and status summarization. All git commands use a 3-second timeout to avoid hanging.

### `routes.js` — HTTP Routes

Registers all Express routes: login page (`GET /login`), auth API, session CRUD (including `PATCH` for updating session color/name), shell detection, directory browser, image upload, version endpoint. The `POST /api/sessions` endpoint validates `shell` against detected shells and `cwd` against the filesystem, and accepts optional `args`, `initialCommand`, `color`, `cols`, and `rows` parameters.

### `websocket.js` — WebSocket Handler

Handles real-time communication: validates the Origin header to reject cross-origin connections, WebSocket-level authentication (password or token), session attachment, terminal I/O forwarding, and resize events. When multiple clients are connected to the same session, the PTY is resized to the minimum dimensions across all clients.

### `preview.js` — Port Preview Proxy

Reverse-proxies HTTP requests from `/preview/:port/*` to services running on `127.0.0.1`. Allows previewing web apps started inside a terminal session without exposing additional ports. Handles proxy errors (502) and timeouts (504).

### `shells.js` — Shell Detection

Detects available shells on the host system. Returns a list of shell objects with `name`, `path`, and `cmd` fields. Cross-platform: scans known paths on Unix and queries PATH via the `where` command on Windows.

### `logger.js` — Logger

Structured logger with configurable levels (`error`, `warn`, `info`, `debug`). Used by all modules. Level is set via `--log-level` flag or `TERMBEAM_LOG_LEVEL` environment variable.

### `tunnel.js` — DevTunnel

Manages Azure DevTunnel lifecycle: login, create, host, cleanup.

### `devtunnel-install.js` — DevTunnel Installer

Handles automatic installation of the DevTunnel CLI when it's not found on the system. Prompts the user interactively and installs via the appropriate package manager (brew on macOS, curl on Linux, winget on Windows). Used by `server.js` during startup when tunnel mode is enabled.

### `service.js` — PM2 Service Manager

Manages TermBeam as a background service via PM2. Provides an interactive wizard for `termbeam service install` that walks through configuration (name, password, port, access mode, working directory, log level, boot auto-start). Also handles `service status`, `logs`, `restart`, and `uninstall` subcommands. Generates an ecosystem config file at `~/.termbeam/ecosystem.config.js`.

### `resume.js` — Resume & Sessions Commands

Orchestrates the `termbeam resume [name]` and `termbeam sessions` CLI commands. Handles server discovery (reads `~/.termbeam/connection.json` saved by the server on startup), HTTP authentication via `Authorization: Bearer <password>`, session listing, and interactive session selection using `prompts.js`. Also manages connection config read/write lifecycle.

### `client.js` — WebSocket Terminal Client

Low-level terminal client for `termbeam resume`. Connects to a running TermBeam server via WebSocket, authenticates, attaches to a session, and enters raw mode on stdin. Pipes keystrokes as `input` messages and writes `output` messages to stdout. Handles terminal resize events (SIGWINCH), Ctrl+B detach, session exit, and clean terminal restoration.

### `interactive.js` — Setup Wizard

Runs a step-by-step terminal wizard (in an alternate screen buffer) that walks the user through password, port, access mode, and log level configuration. Returns a config object compatible with `createTermBeamServer()`. Invoked by `bin/termbeam.js` when `--interactive` is passed. Uses prompt primitives from `prompts.js`.

### `prompts.js` — Terminal Prompts

Provides ANSI color helpers (`green`, `yellow`, `red`, `cyan`, `bold`, `dim`) and interactive prompt functions (`ask`, `choose`, `confirm`, `createRL`). Extracted from `service.js` so both the service install wizard and the interactive setup wizard can share the same prompt primitives.

### `version.js` — Version Detection

Smart version that shows `1.0.0` for npm installs and `1.0.0-dev (git-hash)` for local development.

### Client-Side Features (`terminal.html`)

The terminal page includes several client-side features that run entirely in the browser:

- **Terminal search** — <kbd>Ctrl+F</kbd> / <kbd>Cmd+F</kbd> opens a search bar overlay powered by the xterm.js `SearchAddon`. Supports regex matching with next/previous navigation.
- **Command completion notifications** — uses the browser Notification API to alert when a command finishes in a background tab. Toggled via a bell icon; preference stored in `localStorage` (`termbeam-notifications`).
- **Command palette** — <kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd> (or the floating ⚙️ button) opens a slide-out tool panel with categorized actions (Session, Search, View, Share, Notifications, System).

## Data Flow

```
Client (Phone Browser)
  │
  ├─ HTTP ──► Express Routes ──► Session Manager
  │              │                     │
  │              ├─ /api/sessions      ├─ create/list/delete
  │              ├─ /api/auth          │
  │              ├─ /api/shells        │
  │              └─ /api/dirs          │
  │                                    │
  └─ WebSocket ──► WS Handler ──► PTY Process
                    │                  │
                    ├─ attach          ├─ spawn shell
                    ├─ input ──────►  ├─ write stdin
                    ├─ resize         ├─ resize terminal
                    └─ output ◄────── └─ read stdout
```
