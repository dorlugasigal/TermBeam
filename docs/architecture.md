# Architecture

## Project Structure

```
termbeam/
├── bin/
│   └── termbeam.js         # CLI entry point
├── src/
│   ├── server.js            # Main orchestrator
│   ├── cli.js               # Argument parsing & help
│   ├── auth.js              # Authentication & rate limiting
│   ├── sessions.js          # PTY session management
│   ├── routes.js            # Express HTTP routes
│   ├── websocket.js         # WebSocket connection handling
│   ├── tunnel.js            # DevTunnel integration
│   └── version.js           # Smart version detection
├── public/
│   ├── index.html           # Session manager (mobile UI)
│   └── terminal.html        # Terminal view (xterm.js)
├── test/
│   ├── cli.test.js
│   ├── auth.test.js
│   └── sessions.test.js
├── docs/                    # MkDocs documentation
├── package.json
└── mkdocs.yml
```

## Module Responsibilities

### `server.js` — Orchestrator

Wires all modules together. Creates the Express app, HTTP server, WebSocket server, and starts listening. Handles process lifecycle (shutdown, uncaught exceptions).

### `cli.js` — CLI Interface

Parses command-line arguments and environment variables. Returns a config object used by all other modules.

### `auth.js` — Authentication

Factory function `createAuth(password)` returns an object with middleware, token management, rate limiting, and the login page HTML.

### `sessions.js` — Session Manager

`SessionManager` class wraps the PTY lifecycle. Handles spawning, tracking, listing, and cleaning up terminal sessions.

### `routes.js` — HTTP Routes

Registers all Express routes: login page, auth API, session CRUD, shell detection, directory browser, version endpoint.

### `websocket.js` — WebSocket Handler

Handles real-time communication: session attachment, terminal I/O forwarding, resize events.

### `tunnel.js` — DevTunnel

Manages Azure DevTunnel lifecycle: login, create, host, cleanup.

### `version.js` — Version Detection

Smart version that shows `1.0.0` for npm installs and `1.0.0-dev (git-hash)` for local development.

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
