# Copilot Instructions for TermBeam

## Build, Test, and Lint

```bash
npm test                              # run all tests (output buffered until done)
node --test 'test/server/*.test.js' 'test/cli/*.test.js' 'test/utils/*.test.js' test/integration.test.js  # all tests with streaming output (preferred for dev/CI agents)
node --test test/server/auth.test.js  # run a single test file
npm run test:coverage                 # tests + coverage (c8, 92% threshold)
npm run lint                          # syntax-check with node --check
npm run format                        # format with Prettier
npm run dev                           # start with auto-generated password
npm start                             # start with defaults
```

> **Agent note:** Prefer the `node --test` glob command over `npm test` when you need streaming output. The `npm test` script wraps `node --test` in `execFileSync` which buffers all output until completion — this makes it look like tests are hanging when they're actually running fine. The direct command gives real-time feedback. Use quoted glob patterns (`'test/server/*.test.js'`) — bare directory paths (e.g. `test/server`) cause `MODULE_NOT_FOUND` errors.

Pre-commit hooks (Husky + lint-staged) auto-format and syntax-check staged files.

### Testing Best Practices

**Suite overview:** 575+ tests, ~17s total. Tests run in parallel child processes via Node's built-in test runner. Most files run in <1s; `integration.test.js` (~17s) and `test/cli/service.test.js` (~9s) are the slow outliers.

**Slow tests and why:**

- `integration.test.js` — uses real PTY servers, has polling loops and a 7s sleep for git cache invalidation
- `test/cli/service.test.js` — heavy `require.cache` manipulation and `process.exit` mocking

**Test isolation rules (critical for reliability):**

- **`process.exit` mocks** — always restore in `afterEach`, never inline. Failing to restore breaks subsequent tests.
- **`console.log`/`console.error` mocks** — same rule: restore in `afterEach`.
- **`test/cli/service.test.js`** — uses `loadServiceWithMocks()` pattern; always call `.restore()` in `afterEach`.
- **`test/server/sessions.test.js`** — manipulates `require.cache` for node-pty mocking; clear cache between tests.
- **`test/cli/resume.test.js`** — uses `TERMBEAM_CONFIG_DIR` env var pointing to a temp directory for isolation.
- **WebSocket connections** — close in `finally` blocks or `after()` hooks to prevent connection leaks.
- **Windows temp directory cleanup** — on Windows, node-pty ConPTY holds directory locks after `pty.kill()`. Use `await safeCleanup(dir)` (async `fs.promises.rm` with `maxRetries`) instead of `fs.rmSync` in `after()` hooks and `finally` blocks when the temp dir was used as a PTY CWD. See the `safeCleanup()` helper in `test/server/routes.test.js`.

**Port isolation:** Integration tests use port `0` (OS-assigned random port) to avoid conflicts. Never hardcode ports in tests.

### Playwright E2E

```bash
npx playwright test                   # run e2e tests (chromium, sequential)
```

E2E tests live in `test/e2e-*.test.js` and are excluded from `npm test`. See `playwright.config.js` for retries, reporters, and timeouts.

## Architecture

TermBeam is a Node.js CLI tool that exposes a local PTY (pseudo-terminal) over HTTP + WebSocket, with a mobile-optimized browser UI.

**Server flow:** `bin/termbeam.js` → `src/server/index.js` (orchestrator) creates an Express app + WebSocket server, wiring together modules from `src/server/`, `src/cli/`, `src/tunnel/`, and `src/utils/`.

**`src/server/`** — HTTP/WS server core:

- `index.js` — orchestrator: creates Express app + WebSocket server
- `routes.js` — Express routes for API (`/api/sessions`, `/api/auth`) and pages (`/terminal`, `/login`)
- `auth.js` — password auth, token cookies, rate limiting, login page
- `sessions.js` — `SessionManager` class wrapping `node-pty` lifecycle (create/list/delete/shutdown), sessions stored in a `Map`, clients tracked per session in a `Set`
- `websocket.js` — handles WebSocket messages (`attach`, `input`, `resize`, `output`, `exit`)
- `preview.js` — local preview proxy for forwarding requests to a port

**`src/cli/`** — CLI subcommands & tools:

- `index.js` — parses CLI flags and env vars into a config object
- `client.js` — WebSocket terminal client: raw mode stdin/stdout piping, Ctrl+B detach, resize (SIGWINCH), scrollback replay. Used by `resume.js`.
- `resume.js` — `termbeam resume [name]`: connects to a running server via WebSocket, lists sessions, auto-selects or interactive chooser, delegates to `client.js`. Also handles `termbeam list` (read-only list).
- `service.js` — `termbeam service <action>`: PM2-based background service management
- `interactive.js` — interactive CLI setup wizard
- `prompts.js` — reusable CLI prompt utilities

**`src/tunnel/`** — DevTunnel integration:

- `index.js` — optional DevTunnel integration for public URLs
- `install.js` — DevTunnel CLI installer (cross-platform helper)

**`src/utils/`** — Shared utilities:

- `logger.js` — structured logger with levels (error/warn/info/debug)
- `shells.js` — cross-platform shell detection
- `git.js` — git metadata and status parsing
- `version.js` — detects version from package.json
- `update-check.js` — npm update checking

**Frontend:** React SPA in `src/frontend/` built with Vite + TypeScript. Builds to `public/` (gitignored build artifact). Uses xterm.js, Zustand for state, and Radix UI for accessible components. Components organized into: CommandPalette, FolderBrowser, LoginPage, Modals, Overlays, SearchBar, SessionsHub, SidePanel, TabBar, TerminalApp, TerminalPane, TouchBar, and common reusable components (TopBar, ThemePicker, UpdateBanner).

**WebSocket protocol:** JSON messages over `/ws`. Client sends `attach`, `input`, `resize`; server sends `output`, `attached`, `exit`, `error`. Auth is validated at WebSocket upgrade or first message.

`createTermBeamServer(overrides)` returns `{ app, server, wss, sessions, config, auth, start, shutdown }` — auto-starts only when run from CLI. Tests use this factory to create isolated server instances.

## Key Conventions

- **CommonJS modules** — all source uses `require`/`module.exports`
- **Node.js built-in test runner** — `node:test` (describe/it) + `node:assert`, no external test framework
- **Test file naming:** `test/<category>/<module>.test.js`, tests mirror `src/` subdirectory structure (e.g. `test/server/`, `test/cli/`, `test/utils/`)
- **Mocking pattern:** Mock `node-pty` by manipulating `require.cache` before requiring the module under test; clear cache between tests when testing modules that read `process.argv` (see `test/server/sessions.test.js`)
- **Conventional Commits** — `feat/fix/docs/refactor/test/chore/perf` with optional scope, e.g. `feat(auth): add OAuth2 support`
- **Minimal dependencies** — prefer built-in Node.js APIs over npm packages
- **One responsibility per file** — modules organized in `src/server/`, `src/cli/`, `src/tunnel/`, `src/utils/`, each owning a single concern
- **Prettier formatting** — single quotes, trailing commas, 100 char width, semicolons (`.prettierrc`)
- **Cross-platform support** — must work on Windows, macOS, and Linux; CI tests on Ubuntu + Windows with Node 20, 22, 24
- **PTY session cleanup** — `pty.kill()` is async; the `onExit` callback removes the session from the Map
- **Coverage exclusion** — `src/tunnel/` directory is excluded from coverage (requires external DevTunnel CLI)
- **Build artifact** — `public/` is a gitignored build artifact; run `npm run build:frontend` to regenerate from `src/frontend/`
- **Connection config** — server writes `~/.termbeam/connection.json` on start (port, host, password) for `termbeam resume` auto-discovery; removed on shutdown

## Environment Variables

- `PORT` — server port (default: 3456)
- `TERMBEAM_PASSWORD` / `PTY_PASSWORD` — access password
- `TERMBEAM_CWD` / `PTY_CWD` — working directory
- `TERMBEAM_LOG_LEVEL` — log level (default: info)
- `TERMBEAM_CONFIG_DIR` — location for `connection.json` (default: `~/.termbeam/`)

## Documentation

TermBeam has two layers of documentation that must stay in sync with code changes:

- **`README.md`** — user-facing quick reference (features, CLI flags, security summary). Update when adding/removing CLI flags, features, or changing defaults.
- **`packages/site/`** — unified Astro Starlight site (landing + docs) deployed to GitHub Pages. Navigation defined in `packages/site/astro.config.mjs` (sidebar groups). Docs content lives in `packages/site/src/content/docs/`. Update the relevant page when changing behavior:
  - `configuration.md` — CLI flags and env vars
  - `resume.md` — `termbeam resume` and `termbeam list` commands
  - `security.md` — auth, headers, threat model
  - `api.md` — HTTP and WebSocket API
  - `architecture.md` — system design
  - `getting-started.md` — installation and first run

Use Starlight admonition syntax (`:::note`, `:::tip`, `:::caution`, `:::danger`) — not MkDocs `!!!` blocks. Cross-link with **relative slug paths** (e.g. `[text](../configuration/)`) — the browser resolves these against the current page URL, preserving the `/TermBeam` base prefix. Never use root-absolute paths like `/configuration/` (they bypass the base prefix and 404 on GitHub Pages) or `.md` paths (Astro content collections do not auto-rewrite `.md` extensions inside `src/content/docs/`).

Preview locally: `cd packages/site && npm install && npm run dev`. Build: `npm run build` (outputs to `packages/site/dist/`).

Changes to `packages/site/**` pushed to `main` auto-deploy to GitHub Pages.

## CI and Publishing

- Release workflow: `.github/workflows/release.yml` bumps version, updates `CHANGELOG.md`, tags, and publishes to npm.
- `prepublishOnly` runs `npm run build:frontend && npm test` before publish.
- `postinstall` fixes `node-pty` prebuild permissions (spawn-helper).
- Site (landing + docs) deploys via `.github/workflows/pages.yml` from `packages/site/`.

**IMPORTANT:** When asked to create a PR, open a PR, push to main, publish, release, or submit changes, **always use the `publish` skill**. It orchestrates the full workflow: local tests, lint, coverage, docs check, commit, push (or PR flow with proper branch naming), CI verification, and release. Do not manually run `gh pr create` or `git push origin main` — the skill handles all of this with the correct conventions.

**CRITICAL — PR Review Process:** NEVER merge a PR until ALL review comments from ALL review rounds are addressed and resolved. After fixing comments, reply to each thread on the PR confirming the fix. Check for additional review rounds — Copilot and other reviewers may post follow-up comments after the initial review. Only merge when every comment thread is resolved.

## Demo Video

The demo video lives in `packages/demo-video/` and is built with Remotion 4 + TypeScript + React, using the remotion agent skill "npx skills add remotion-dev/skills".

**Structure:** `packages/demo-video/src/TermBeamDemo.tsx` is the main composition (3840×2160, 30fps). It sequences scenes via `<Sequence>` components: Intro → TitleCards → CliTerminal → PhoneScene → Outro. Each scene is a separate component in `packages/demo-video/src/`.

**Editing:** To preview changes, run `npm run dev` inside `packages/demo-video/` to open Remotion Studio. Timing constants (frame durations) are at the top of `TermBeamDemo.tsx`. The design is authored at 1080p and scaled 2× to 4K.

**Rendering:**

```bash
cd packages/demo-video

# Highest quality under 10 MB (tune CRF — lower = better quality, larger file):
npx remotion render TermBeamDemo "out/TermBeam-Demo-4K.mp4" --image-format png --crf 18

# Near-lossless (large file, ~95 MB):
npx remotion render TermBeamDemo "out/TermBeam-Demo-4K.mp4" --image-format png --crf 1
```

CRF 0 is not supported by Remotion's H.264 encoder. Start with `--crf 18` for a good quality/size balance and adjust down if needed to stay under 10 MB.

## Security Decisions

These are intentional design choices — not bugs:

- **Cookie `secure` flag is off** — TermBeam runs over HTTP locally; TLS is handled at the tunnel proxy layer (DevTunnels). Setting `secure` would break cookie auth on LAN.
- **Password compared in constant time** — `auth.safeCompare` SHA-256-hashes both sides and uses `crypto.timingSafeEqual` to prevent timing-based recovery. Rate limiting (5 attempts/min/IP) remains the primary brute-force defense.
- **Tunnel is on by default** — makes the tool useful out of the box (phone on cellular), but this means the terminal is internet-accessible. Password auto-generation compensates.
- **Default bind is `127.0.0.1`** — localhost only by default. Use `--lan` or `--host 0.0.0.0` for LAN access.
- **`--no-password` exists** — for trusted localhost-only scenarios. Never combine with tunnel.
- **Session IDs are 128-bit random** (`crypto.randomBytes(16)`) — unguessable, but not secret (visible in URLs). Auth tokens protect access, not session IDs.
- **WebSocket origin validation** — cross-origin connections are rejected (close code 1008) unless one side is localhost, preventing malicious websites from connecting to a local instance.
- **Security headers** — X-Frame-Options: DENY, CSP, no-store cache, nosniff, no-referrer on all responses.
- **Shell path validation** — only shells detected by `src/utils/shells.js` are accepted; arbitrary paths are rejected.
