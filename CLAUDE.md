# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build, Test, and Lint

```bash
npm test                              # run all tests
node --test test/auth.test.js         # run a single test file
npm run test:coverage                 # tests + coverage (c8, 80% threshold)
npm run lint                          # syntax-check with node --check
npm run format                        # format with Prettier
```

Pre-commit hooks (Husky + lint-staged) auto-format and syntax-check staged files.

## Architecture

TermBeam is a Node.js CLI tool that exposes a local PTY (pseudo-terminal) over HTTP + WebSocket, with a mobile-optimized browser UI.

**Server flow:** `bin/termbeam.js` → `src/server.js` (orchestrator) creates an Express app + WebSocket server, wiring together:

- `cli.js` — parses CLI flags and env vars into a config object
- `auth.js` — password auth, token cookies, rate limiting, login page
- `sessions.js` — `SessionManager` class wrapping `node-pty` lifecycle (create/list/delete/shutdown), sessions stored in a `Map`, clients tracked per session in a `Set`
- `routes.js` — Express routes for API (`/api/sessions`, `/api/auth`) and pages (`/terminal`, `/login`)
- `websocket.js` — handles WebSocket messages (`attach`, `input`, `resize`, `output`, `exit`)
- `tunnel.js` — optional ngrok integration for public URLs
- `logger.js` — structured logger with levels (error/warn/info/debug)
- `shells.js` — cross-platform shell detection
- `version.js` — detects version from package.json

**Frontend:** Two vanilla HTML/JS files in `public/` using xterm.js via CDN:

- `index.html` — session manager (list, create, connect)
- `terminal.html` — terminal UI with touch bar, multi-tab sessions, split view

**WebSocket protocol:** JSON messages over `/ws`. Client sends `attach`, `input`, `resize`; server sends `output`, `attached`, `exit`, `error`. Auth is validated at WebSocket upgrade or first message.

`createTermBeamServer(overrides)` returns `{ app, server, wss, sessions, config, auth, start, shutdown }` — auto-starts only when run from CLI. Tests use this factory to create isolated server instances.

## Key Conventions

- **CommonJS modules** — all source uses `require`/`module.exports`
- **Node.js built-in test runner** — `node:test` (describe/it) + `node:assert`, no external test framework
- **Test file naming:** `test/<module>.test.js`, one test file per source module
- **Mocking pattern:** Mock `node-pty` by manipulating `require.cache` before requiring the module under test; clear cache between tests when testing modules that read `process.argv` (see `test/sessions.test.js`)
- **Conventional Commits** — `feat/fix/docs/refactor/test/chore/perf` with optional scope, e.g. `feat(auth): add OAuth2 support`
- **Minimal dependencies** — prefer built-in Node.js APIs over npm packages
- **One responsibility per file** — each `src/*.js` module owns a single concern
- **Prettier formatting** — single quotes, trailing commas, 100 char width, semicolons (`.prettierrc`)
- **Cross-platform support** — must work on Windows, macOS, and Linux; CI tests on Ubuntu + Windows with Node 18, 20, 22
- **PTY session cleanup** — `pty.kill()` is async; the `onExit` callback removes the session from the Map
- **Coverage exclusion** — `src/tunnel.js` is excluded from coverage (requires external ngrok CLI)

## Documentation

TermBeam has two layers of documentation that must stay in sync with code changes:

- **`README.md`** — user-facing quick reference (features, CLI flags, security summary). Update when adding/removing CLI flags, features, or changing defaults.
- **`docs/`** — full MkDocs Material site deployed to GitHub Pages. Navigation defined in `mkdocs.yml`. Update the relevant page when changing behavior:
  - `docs/configuration.md` — CLI flags and env vars
  - `docs/security.md` — auth, headers, threat model
  - `docs/api.md` — HTTP and WebSocket API
  - `docs/architecture.md` — system design
  - `docs/getting-started.md` — installation and first run

Preview docs locally: `pip install mkdocs-material && mkdocs serve`

## Demo Video

The demo video lives in `demo-video/` and is built with Remotion 4 + TypeScript + React.

**Structure:** `demo-video/src/TermBeamDemo.tsx` is the main composition (3840×2160, 30fps). It sequences scenes via `<Sequence>` components.

**Editing:** Run `npm run dev` inside `demo-video/` to open Remotion Studio.

**Rendering:**

```bash
cd demo-video
npx remotion render TermBeamDemo "out/TermBeamDemo.mp4" --image-format png --crf 18
```

## Security Decisions

These are intentional design choices — not bugs:

- **Cookie `secure` flag is off** — TermBeam runs over HTTP locally; TLS is handled at the tunnel proxy layer (DevTunnels). Setting `secure` would break cookie auth on LAN.
- **Password compared in constant time?** No — the password is short-lived and auto-generated; rate limiting (5 attempts/min/IP) is the primary brute-force defense.
- **Tunnel is on by default** — makes the tool useful out of the box (phone on cellular), but this means the terminal is internet-accessible. Password auto-generation compensates.
- **`--no-password` exists** — for trusted localhost-only scenarios. Never combine with tunnel.
- **Session IDs are 128-bit random** (`crypto.randomBytes(16)`) — unguessable, but not secret (visible in URLs). Auth tokens protect access, not session IDs.
- **WebSocket origin validation** — cross-origin connections are rejected (close code 1008) unless one side is localhost.
- **Shell path validation** — only shells detected by `src/shells.js` are accepted; arbitrary paths are rejected.
