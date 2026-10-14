---
title: Architecture
description: How TermBeam is organized — server modules, frontend, PTY sessions, and WebSocket protocol.
---

## Project Structure

```
termbeam/
├── bin/
│   └── termbeam.js              # CLI entry point
├── src/
│   ├── server/                  # HTTP/WS server core
│   │   ├── index.js             # Main orchestrator
│   │   ├── routes.js            # Express HTTP routes
│   │   ├── auth.js              # Sessions, cookies, middleware & rate limiting
│   │   ├── auth-store.js        # Persisted remembered devices + passkeys (auth.json)
│   │   ├── auth-routes.js       # /api/auth/* — login, logout, devices, passkeys
│   │   ├── webauthn.js          # Passkey (WebAuthn) verification
│   │   ├── cbor.js              # Minimal strict CBOR decoder (WebAuthn)
│   │   ├── origin.js            # Origin / CSRF validation (HTTP + WebSocket)
│   │   ├── websocket.js         # WebSocket connection handling
│   │   ├── sessions.js          # PTY session management
│   │   ├── terminal-modes.js    # Tracks DEC modes for faithful reconnect replay
│   │   ├── preview.js           # Port preview reverse proxy
│   │   ├── copilot-sdk.js       # GitHub Copilot SDK client
│   │   └── push.js              # Web Push notification manager
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
│   │   ├── update-check.js      # npm update checking & install method detection
│   │   ├── update-executor.js   # In-app update engine (state machine, permissions)
│   │   ├── agents.js            # AI agent (Copilot/Claude/etc) detection
│   │   ├── agent-sessions.js    # Tracks active agent-launched sessions
│   │   └── vapid.js             # VAPID key generation & persistence
│   └── frontend/                # React 19 + Vite + TypeScript SPA
│       ├── src/
│       │   ├── App.tsx          # Root component
│       │   ├── main.tsx         # Entry point
│       │   ├── components/      # UI components (common/Sheet.tsx is the shared modal)
│       │   ├── hooks/           # Custom React hooks (useMediaQuery, useTerminalSocket, …)
│       │   ├── services/        # API, WebSocket & push subscription clients
│       │   ├── stores/          # Zustand state stores
│       │   ├── styles/          # tokens.css (design tokens), forms.module.css, animations.css
│       │   ├── themes/          # Terminal themes
│       │   ├── types/           # TypeScript type definitions
│       │   ├── utils/           # sessionDisplay (grouping/formatting), navigation (SPA routing)
│       │   └── sw.ts            # Service worker (caching + push notifications)
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
│   ├── site/                    # Astro + Starlight docs/marketing site
│   └── demo-video/              # Remotion demo video
├── package.json
└── README.md
```

## Module Responsibilities

### `server/index.js` — Orchestrator

Wires all modules together. Exports `createTermBeamServer()` which creates the Express app, HTTP server, WebSocket server, and returns `{ app, server, wss, sessions, config, auth, start, shutdown }`. The `start()` method begins listening and creates the default session. Handles process lifecycle (shutdown, uncaught exceptions).

### `cli/index.js` — CLI Interface

Parses command-line arguments and environment variables. Returns a config object used by all other modules. Includes platform-specific shell auto-detection: on Windows it walks the process tree (via `wmic`) looking for PowerShell or cmd.exe; on Unix it inspects the parent process via `ps` and falls back to `$SHELL` or `/bin/sh`.

### `server/auth.js` — Authentication

Factory function `createAuth(password, { configDir })` returns the auth middleware, device-session management (create / validate with a sliding idle timeout and absolute cap / list / revoke, emitting `revoked` events so open sockets are closed), passkey storage, one-time share tokens, cookie helpers and rate limiting. Unauthenticated page requests are redirected to `/login?next=…`; the login screen itself is the React SPA.

### `server/auth-store.js` — Persisted Auth State

Loads and atomically writes `<configDir>/auth.json` (mode `0600`): remembered sessions as SHA-256 token hashes, passkey public keys (JWK) with signature counters, the WebAuthn user handle, and a scrypt fingerprint of the password so a password change signs remembered devices out.

### `server/auth-routes.js`, `server/webauthn.js`, `server/cbor.js` — Passkeys

`auth-routes.js` registers `/api/auth/*` (password/QR login, status, logout, devices, passkey ceremonies with single-use 3-minute challenges). `webauthn.js` verifies registrations (attestation `none`, COSE → JWK) and assertions (signature over `authenticatorData ‖ SHA-256(clientDataJSON)`, origin, RP ID hash, user presence + verification, signature counter) using only Node's `crypto`; `cbor.js` is a bounded, strict CBOR decoder for attestation objects and COSE keys.

### `server/origin.js` — Cross-Site Protection

Shared origin validation for WebSockets and state-changing API requests. Behind Dev Tunnels the relay rewrites `Host` to `localhost`, so origins are matched against the `Host` header, the public tunnel URL and `X-Forwarded-Host` (trusted only from loopback), and `Sec-Fetch-Site: same-site|cross-site` is refused.

### `server/terminal-modes.js` — Terminal Mode Tracker

Parses PTY output for DEC private mode switches (alternate screen, mouse tracking protocol + encoding, application cursor keys, bracketed paste, focus reporting, cursor visibility, auto-wrap), handling sequences split across chunks. The replay sent on attach ends with a sequence that restores these modes, so a reconnecting client behaves like the original terminal even after the scrollback that contained the original switches has been trimmed.

### `server/sessions.js` — Session Manager

`SessionManager` class wraps the PTY lifecycle. Handles spawning, tracking, listing, updating, and cleaning up terminal sessions. Each session has an auto-assigned color, tracks `lastActivity` timestamps, a `createdAt` timestamp, and supports live updates via the `update()` method. Sessions maintain a scrollback buffer with a high/low-water mark (trimmed back to ~500k characters when it grows beyond 1,000,000 characters) that is sent to newly connecting clients, and track a `clients` Set of active WebSocket connections. Supports an optional `initialCommand` that is written to the PTY shortly after spawn. The `list()` method detects the live working directory of the shell process (via `lsof` on macOS, `/proc` on Linux) and enriches each session with git repository information, using an async cache to avoid blocking the event loop. Includes a process-tree monitor that polls for child process exits every 2 seconds (via `ps` + `awk` to count descendant processes), enabling command-completion detection for push notifications.

### `utils/git.js` — Git Repository Detection

Detects git repository information for a given directory. Provides `getGitInfoAsync(cwd)` (and a synchronous `getGitInfo(cwd)` for scripts) which returns branch name, remote provider (GitHub, GitLab, Bitbucket, Azure DevOps), repository name, repository root, and working tree status (staged, modified, untracked counts plus ahead/behind tracking). Server code uses the async version: the session list caches git info per session and refreshes it in the background, so git never blocks the event loop (and with it every terminal's WebSocket). Status runs with `--no-optional-locks` so background polling never holds `index.lock` while you commit. Also exports `getGitRoot()`, `parseRemoteUrl()` and `parseStatus()`. Git commands are time-limited so they can't hang.

### `server/routes.js` — HTTP Routes

Registers all Express routes: the SPA login page (`GET /login`, redirecting signed-in visitors to a validated `next`), the auth API (via `auth-routes.js`), session CRUD (including `PATCH` for updating session color/name), shell detection, directory browser, image upload, version endpoint. The `POST /api/sessions` endpoint validates `shell` against detected shells and `cwd` against the filesystem, and accepts optional `args`, `initialCommand`, `color`, `cols`, and `rows` parameters.

### `server/websocket.js` — WebSocket Handler

Handles real-time communication: validates the origin (see `origin.js`), WebSocket-level authentication (cookie session, token or password), periodic session re-validation and immediate close (code `4401`) when a device is signed out, application `ping`/`pong` for RTT, session attachment with a replay snapshot, terminal I/O forwarding, resize events, and `broadcast()` of `tunnel-status` / update progress to authenticated clients only. When multiple clients are connected to the same session, the PTY is resized to the minimum dimensions across active clients (active within the last 60 seconds). Idle clients are excluded from the size calculation so that a backgrounded phone tab does not constrain the terminal when resuming from a laptop. Sends keepalive pings every 15 seconds and terminates connections that do not reply with a pong.

### `server/push.js` — Push Notification Manager

`PushManager` class for Web Push notifications. Manages VAPID authentication, push subscriptions (in-memory), and notification delivery via the `web-push` npm package. Exposes methods for subscribing/unsubscribing clients and sending notifications when commands complete in a session.

### `server/preview.js` — Port Preview Proxy

Reverse-proxies HTTP requests from `/preview/:port/*` to services running on `127.0.0.1`. Allows previewing web apps started inside a terminal session without exposing additional ports. Handles proxy errors (502) and timeouts (504).

### `utils/shells.js` — Shell Detection

Detects available shells on the host system. Returns a list of shell objects with `name`, `path`, and `cmd` fields. Cross-platform: scans known paths on Unix and queries PATH via the `where` command on Windows.

### `utils/logger.js` — Logger

Structured logger with configurable levels (`error`, `warn`, `info`, `debug`). Used by all modules. Level is set via `--log-level` flag or `TERMBEAM_LOG_LEVEL` environment variable.

### `tunnel/index.js` — DevTunnel

Manages Azure DevTunnel lifecycle: login, create, host, cleanup. Includes a fully asynchronous **watchdog** (no `execFileSync` on any periodic path — previously a synchronous `devtunnel` call every 30 seconds froze all terminal I/O):

- **Health check** — every 30 seconds, runs `devtunnel show <id> --json` and reads the host connection count.
- **Zombie detection** — two consecutive failures (0 host connections, parse errors) kill the stale host process and schedule a restart.
- **Crash detection** — the host process `exit` handler restarts immediately; output is classified so a "Tunnel not found" exit triggers recovery instead of endless restarts.
- **Sleep / wake detection** — a 10-second timer that fires late reveals a suspended laptop; on resume the tunnel is checked at once and restarted after a single failure.
- **Expired / deleted tunnel recovery** — Dev Tunnel expiration is a sliding inactivity window that a long sleep can exceed. The watchdog first runs `devtunnel update --expiration`, and if the tunnel is gone creates a replacement with the same settings (persisted id saved), then emits `recreated` and `url-changed` so the server prints the new URL + QR and notifies clients. Healthy tunnels have their expiration extended every 6 hours.
- **Auto-restart** — exponential backoff (1s → 2s → 5s → 10s → 15s → 30s), up to 10 attempts before transitioning to network-wait.
- **Auth-wait system** — detects host login expiry, pauses, polls (asynchronously) for `devtunnel user login`, and reconnects once a fresh token exists.
- **Network-wait system** — detects DNS / connectivity errors (e.g. `ENOTFOUND`, `EAI_AGAIN`), probes the tunnel service via DNS every 30 seconds and reconnects once reachable. Network errors do not consume restart attempts.
- **Relay monitoring** — `devtunnel host` output is watched for relay lost / restored lines.
- **Token lifetime monitoring** — refreshed every 10 minutes into a cache (`getCachedLoginInfo()`) that `GET /api/tunnel/status` reads without spawning a process.
- **Event emitter** — `tunnelEvents` emits `connected`, `disconnected`, `reconnecting`, `network-lost`, `network-restored`, `auth-expired`, `auth-restored`, `relay-lost`, `relay-restored`, `resumed`, `recreated`, `url-changed`, `failed`. The server mirrors them into `GET /api/tunnel/status` and a `tunnel-status` WebSocket broadcast.

Also exports `getLoginInfo()` (returns current auth provider and token expiry) and `parseLoginInfo()` (parses raw `devtunnel` CLI output into structured login metadata).

### `tunnel/install.js` — DevTunnel Installer

Handles automatic installation of the DevTunnel CLI when it's not found on the system. Prompts the user interactively and installs via the appropriate package manager (brew on macOS, curl on Linux, winget on Windows). Used by `server.js` during startup when tunnel mode is enabled.

### `cli/service.js` — PM2 Service Manager

Manages TermBeam as a background service via PM2. Provides an interactive wizard for `termbeam service install` that walks through configuration (name, password, port, access mode, working directory, log level, boot auto-start). Also handles `service status`, `logs`, `restart`, and `uninstall` subcommands. Generates an ecosystem config file at `~/.termbeam/ecosystem.config.js`.

### `cli/interactive.js` — Setup Wizard

Runs a step-by-step terminal wizard (in an alternate screen buffer) that walks the user through password, port, access mode, and log level configuration. Returns a config object compatible with `createTermBeamServer()`. Invoked by `bin/termbeam.js` when `--interactive` is passed. Uses prompt primitives from `prompts.js`.

### `cli/prompts.js` — Terminal Prompts

Provides ANSI color helpers (`green`, `yellow`, `red`, `cyan`, `bold`, `dim`) and interactive prompt functions (`ask`, `choose`, `confirm`, `createRL`). Extracted from `service.js` so both the service install wizard and the interactive setup wizard can share the same prompt primitives.

### `utils/vapid.js` — VAPID Key Management

Generates and persists VAPID key pairs for Web Push authentication. Keys are stored in `~/.termbeam/vapid.json` and reused across server restarts so that existing push subscriptions remain valid.

### `utils/update-check.js` — Update Checker

Checks npm and GitHub Releases for newer versions of TermBeam and uses the newest valid stable version. GitHub provides a fallback when `registry.npmjs.org` is blocked or a registry proxy is stale. The result is compared against the running version using semver comparison (`isNewerVersion`) and cached for 24 hours in `~/.termbeam/update-check.json`. Includes `sanitizeVersion()` to strip ANSI escape sequences and control characters from responses (terminal injection protection). Also provides `detectInstallMethod()` which inspects environment variables to determine whether TermBeam was installed via npm, npx, yarn, or pnpm, returning the appropriate upgrade command.

### `utils/version.js` — Version Detection

Smart version detection with two paths: npm installs use the `package.json` version as-is, while local development derives the version from git tags. On a clean tag it shows `1.11.0`; when ahead of a tag or with uncommitted changes it shows `1.11.0-dev (v1.11.0-3-gabcdef1)`. Falls back to `package.json` when no semver tag exists.

### Frontend — React SPA

The frontend is a React 19 single-page application built with Vite and TypeScript, located in `src/frontend/`. It builds to `public/`, which Express serves as the static directory. Key dependencies include `@xterm/xterm` (npm package, not CDN), Zustand for state management, Radix UI for dialogs, `@dnd-kit` for drag-and-drop, and Sonner for toast notifications.

**Connection & auth on the client.** `stores/connectionStore.ts` is the single authority for link state (`connecting`, `online`, `reconnecting`, `offline`, `host-unreachable`, `tunnel-auth`, `auth-expired`, `updating`). Sockets and pollers report facts; when the link drops the store diagnoses _why_ with `probeServer()` — a `fetch` of `/api/auth/status` with `redirect: 'manual'`, because an expired private-tunnel sign-in answers with a cross-origin 302 that a normal `fetch` reports as an opaque network error — and pauses sockets until reconnecting can succeed. The `ConnectionPill` (top bar), `ConnectionSheet`, in-place `UnlockSheet` (passkey or password, terminals stay mounted) and `PasskeyPrompt` render it. Design tokens live in `styles/tokens.css` and are derived from each theme's colors; `services/themeContrast.ts` sets `data-tone` and a contrast-safe `--on-accent` per theme.

**Screens and navigation.** `App.tsx` routes between the login page, the sessions hub and the terminal from `location.pathname`; in-app links go through `utils/navigation.ts` (`navigate()` / `spaLinkHandler`) instead of full reloads, and each route change runs inside `document.startViewTransition` so screens cross-fade and the opened session's name morphs from its hub row into the terminal tab. The hub groups sessions by git working tree (`utils/sessionDisplay.ts`, keyed by the server's `git.root`) so a repo's branch and status appear once above its sessions, and shows paths, branches and status in full — wrapping, never truncated. Every modal is built on `components/common/Sheet.tsx` (bottom sheet with drag-to-dismiss on phones, centered dialog on desktop) with controls from `styles/forms.module.css`.

The terminal page includes several client-side features:

- **Terminal search** — <kbd>Ctrl+F</kbd> / <kbd>Cmd+F</kbd> opens a search bar overlay powered by the xterm.js `SearchAddon`. Supports regex matching with next/previous navigation.
- **Command completion notifications** — uses the browser Notification API to alert when a command finishes in a background tab. Toggled via a bell icon; preference stored in `localStorage` (`termbeam-notifications`).
- **Push notifications** — native push notifications via the Web Push API, delivered even when the browser tab is closed. The service worker (`sw.ts`) handles push events and uses the Badge API to show unread counts. Push subscription lifecycle (subscribe, unsubscribe, VAPID key mismatch detection) is managed by `services/pushSubscription.ts`.
- **Git changes view** — `GitChanges/`, `DiffViewer/`, and `BlameGutter/` components in the CodeViewer directory provide a full git integration UI: staged/unstaged diffs with syntax highlighting, per-line blame annotations, and commit history browsing.
- **Tools panel** — <kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd> (or the floating ▦ button) opens a slide-out sheet with categorized actions (Session, Files, View, Share, Agents, Settings, System). Settings, the workspace launcher and the touch-bar key editor are inline panels reachable from this entry point.
- **Workspace autoboot (server-side)** — at startup `src/server/index.js` reads `~/.termbeam/prefs.json` and, if a workspace is flagged `default: true` (or there is exactly one named workspace, or the legacy `startupWorkspace.enabled` is true), spawns each session itself. Each session's saved `shell` is validated against the host's detected shells and falls back to the runtime default if missing (covers the host-migration case where saved shells no longer exist). If every workspace session fails to spawn, the server falls back to a single default session so the user always lands on something. This replaced the previous client-side autoboot so deleting a session in the UI stays deleted until the next service restart. When no workspace is configured the server falls back to a single default session in `config.cwd`.

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
                    ├─ output ◄────── └─ read stdout
                    └─ notification ──► Push Manager ──► Web Push
```

### `client.js` — WebSocket Terminal Client

WebSocket terminal client used by the `resume` command. Handles raw-mode stdin/stdout piping, Ctrl+B detach, terminal resize synchronization via SIGWINCH, and scrollback replay on attach.

### `resume.js` — Resume & List Subcommands

Implements the `termbeam resume [name]` (alias: `termbeam attach`) and `termbeam list` CLI subcommands. Auto-discovers running servers via `~/.termbeam/connection.json`, lists sessions, provides an interactive arrow-key chooser when multiple sessions exist, and delegates terminal attachment to `client.js`.

---

## See Also

- **[API Reference](../api/)** — REST and WebSocket endpoint documentation
- **[Contributing](../contributing/)** — development setup, testing, and pull request guidelines
