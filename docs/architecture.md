# Architecture

## Project Structure

```
termbeam/
├── bin/
│   └── termbeam.js              # CLI entry point
├── src/
│   ├── server/                  # HTTP/WS server core
│   │   ├── index.js             # Main orchestrator
│   │   ├── routes.js            # Express HTTP routes
│   │   ├── auth.js              # Authentication & rate limiting
│   │   ├── websocket.js         # WebSocket connection handling
│   │   ├── sessions.js          # PTY session management
│   │   └── preview.js           # Port preview reverse proxy
│   ├── cli/                     # CLI subcommands & tools
│   │   ├── index.js             # Argument parsing & help
│   │   ├── client.js            # WebSocket terminal client (resume)
│   │   ├── resume.js            # Resume/list subcommands
│   │   ├── service.js           # PM2 service management
│   │   ├── interactive.js       # Interactive setup wizard
│   │   └── prompts.js           # Terminal prompt primitives
│   ├── tunnel/                  # DevTunnel integration
│   │   ├── index.js             # DevTunnel lifecycle management
│   │   └── install.js           # DevTunnel CLI auto-installer
│   ├── utils/                   # Shared utilities
│   │   ├── logger.js            # Structured logger with levels
│   │   ├── shells.js            # Shell detection (cross-platform)
│   │   ├── git.js               # Git repo detection & status
│   │   ├── version.js           # Smart version detection
│   │   └── update-check.js      # npm update checking
│   └── frontend/                # React 19 + Vite + TypeScript SPA
│       ├── src/
│       │   ├── App.tsx          # Root component
│       │   ├── main.tsx         # Entry point
│       │   ├── components/      # UI components
│       │   ├── hooks/           # Custom React hooks
│       │   ├── services/        # API & WebSocket clients
│       │   ├── stores/          # Zustand state stores
│       │   ├── styles/          # CSS stylesheets
│       │   ├── themes/          # Terminal themes
│       │   ├── types/           # TypeScript type definitions
│       │   └── sw.ts            # Service worker source
│       ├── package.json
│       ├── vite.config.ts
│       └── tsconfig.json
├── public/                      # Vite build output (gitignored, built from src/frontend/)
├── test/
│   ├── server/                  # Server module tests
│   ├── cli/                     # CLI module tests
│   ├── tunnel/                  # Tunnel module tests
│   ├── utils/                   # Utility module tests
│   ├── integration.test.js      # Cross-cutting integration tests
│   └── e2e-*.test.js            # Playwright E2E tests
├── packages/
│   ├── landing/                 # Landing page (deployed separately)
│   └── demo-video/              # Remotion demo video
├── docs/                        # MkDocs documentation
├── package.json
└── mkdocs.yml
```

## Module Responsibilities

### `server/index.js` — Orchestrator

Wires all modules together. Exports `createTermBeamServer()` which creates the Express app, HTTP server, WebSocket server, and returns `{ app, server, wss, sessions, config, auth, start, shutdown }`. The `start()` method begins listening and creates the default session. Handles process lifecycle (shutdown, uncaught exceptions).

### `cli/index.js` — CLI Interface

Parses command-line arguments and environment variables. Returns a config object used by all other modules. Includes platform-specific shell auto-detection: on Windows it walks the process tree (via `wmic`) looking for PowerShell or cmd.exe; on Unix it inspects the parent process via `ps` and falls back to `$SHELL` or `/bin/sh`.

### `server/auth.js` — Authentication

Factory function `createAuth(password)` returns an object with middleware, token management, rate limiting, and the login page HTML.

### `server/sessions.js` — Session Manager

`SessionManager` class wraps the PTY lifecycle. Handles spawning, tracking, listing, updating, and cleaning up terminal sessions. Each session has an auto-assigned color, tracks `lastActivity` timestamps, a `createdAt` timestamp, and supports live updates via the `update()` method. Sessions maintain a scrollback buffer with a high/low-water mark (trimmed back to ~500k characters when it grows beyond 1,000,000 characters) that is sent to newly connecting clients, and track a `clients` Set of active WebSocket connections. Supports an optional `initialCommand` that is written to the PTY shortly after spawn. The `list()` method detects the live working directory of the shell process (via `lsof` on macOS, `/proc` on Linux) and enriches each session with git repository information, using an async cache to avoid blocking the event loop.

### `utils/git.js` — Git Repository Detection

Detects git repository information for a given directory. Provides `getGitInfo(cwd)` which returns branch name, remote provider (GitHub, GitLab, Bitbucket, Azure DevOps), repository name, and working tree status (staged, modified, untracked counts plus ahead/behind tracking). Also exports `parseRemoteUrl()` and `parseStatus()` for URL parsing and status summarization. All git commands use a 3-second timeout to avoid hanging.

### `server/routes.js` — HTTP Routes

Registers all Express routes: login page (`GET /login`), auth API, session CRUD (including `PATCH` for updating session color/name), shell detection, directory browser, image upload, version endpoint. The `POST /api/sessions` endpoint validates `shell` against detected shells and `cwd` against the filesystem, and accepts optional `args`, `initialCommand`, `color`, `cols`, and `rows` parameters.

### `server/websocket.js` — WebSocket Handler

Handles real-time communication: validates the Origin header to reject cross-origin connections, WebSocket-level authentication (password or token), session attachment, terminal I/O forwarding, and resize events. When multiple clients are connected to the same session, the PTY is resized to the minimum dimensions across active clients (active within the last 60 seconds). Idle clients are excluded from the size calculation so that a backgrounded phone tab does not constrain the terminal when resuming from a laptop. Sends keepalive pings every 30 seconds to help mobile browsers maintain the WebSocket and to surface broken connections sooner at the transport level.

### `server/preview.js` — Port Preview Proxy

Reverse-proxies HTTP requests from `/preview/:port/*` to services running on `127.0.0.1`. Allows previewing web apps started inside a terminal session without exposing additional ports. Handles proxy errors (502) and timeouts (504).

### `utils/shells.js` — Shell Detection

Detects available shells on the host system. Returns a list of shell objects with `name`, `path`, and `cmd` fields. Cross-platform: scans known paths on Unix and queries PATH via the `where` command on Windows.

### `utils/logger.js` — Logger

Structured logger with configurable levels (`error`, `warn`, `info`, `debug`). Used by all modules. Level is set via `--log-level` flag or `TERMBEAM_LOG_LEVEL` environment variable.

### `tunnel/index.js` — DevTunnel

Manages Azure DevTunnel lifecycle: login, create, host, cleanup.

### `tunnel/install.js` — DevTunnel Installer

Handles automatic installation of the DevTunnel CLI when it's not found on the system. Prompts the user interactively and installs via the appropriate package manager (brew on macOS, curl on Linux, winget on Windows). Used by `server.js` during startup when tunnel mode is enabled.

### `cli/service.js` — PM2 Service Manager

Manages TermBeam as a background service via PM2. Provides an interactive wizard for `termbeam service install` that walks through configuration (name, password, port, access mode, working directory, log level, boot auto-start). Also handles `service status`, `logs`, `restart`, and `uninstall` subcommands. Generates an ecosystem config file at `~/.termbeam/ecosystem.config.js`.

### `cli/interactive.js` — Setup Wizard

Runs a step-by-step terminal wizard (in an alternate screen buffer) that walks the user through password, port, access mode, and log level configuration. Returns a config object compatible with `createTermBeamServer()`. Invoked by `bin/termbeam.js` when `--interactive` is passed. Uses prompt primitives from `prompts.js`.

### `cli/prompts.js` — Terminal Prompts

Provides ANSI color helpers (`green`, `yellow`, `red`, `cyan`, `bold`, `dim`) and interactive prompt functions (`ask`, `choose`, `confirm`, `createRL`). Extracted from `service.js` so both the service install wizard and the interactive setup wizard can share the same prompt primitives.

### `utils/update-check.js` — Update Checker

Checks the npm registry for newer versions of TermBeam. Fetches the latest published version from `registry.npmjs.org`, compares it against the running version using semver comparison (`isNewerVersion`), and caches the result for 24 hours in `~/.termbeam/update-check.json` to avoid repeated network requests. Includes `sanitizeVersion()` to strip ANSI escape sequences and control characters from registry responses (terminal injection protection). Also provides `detectInstallMethod()` which inspects environment variables to determine whether TermBeam was installed via npm, npx, yarn, or pnpm, returning the appropriate upgrade command.

### `utils/version.js` — Version Detection

Smart version detection with two paths: npm installs use the `package.json` version as-is, while local development derives the version from git tags. On a clean tag it shows `1.11.0`; when ahead of a tag or with uncommitted changes it shows `1.11.0-dev (v1.11.0-3-gabcdef1)`. Falls back to `package.json` when no semver tag exists.

### Frontend — React SPA

The frontend is a React 19 single-page application built with Vite and TypeScript, located in `src/frontend/`. It builds to `public/`, which Express serves as the static directory. Key dependencies include `@xterm/xterm` (npm package, not CDN), Zustand for state management, Radix UI for dialogs, `@dnd-kit` for drag-and-drop, and Sonner for toast notifications.

The terminal page includes several client-side features:

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

### `client.js` — WebSocket Terminal Client

WebSocket terminal client used by the `resume` command. Handles raw-mode stdin/stdout piping, Ctrl+B detach, terminal resize synchronization via SIGWINCH, and scrollback replay on attach.

### `resume.js` — Resume & List Subcommands

Implements the `termbeam resume [name]` (alias: `termbeam attach`) and `termbeam list` CLI subcommands. Auto-discovers running servers via `~/.termbeam/connection.json`, lists sessions, provides an interactive arrow-key chooser when multiple sessions exist, and delegates terminal attachment to `client.js`.

---

## See Also

- **[API Reference](api.md)** — REST and WebSocket endpoint documentation
- **[Contributing](contributing.md)** — development setup, testing, and pull request guidelines
