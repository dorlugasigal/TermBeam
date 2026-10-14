# Copilot Instructions for TermBeam

## Build, Test, and Lint

```bash
npm test                              # run all tests (output buffered until done)
node --test 'test/server/*.test.js' 'test/cli/*.test.js' 'test/utils/*.test.js' 'test/tunnel/*.test.js' test/integration.test.js  # all tests with streaming output (preferred for dev/CI agents)
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
- **`configDir` isolation** — every test that calls `createTermBeamServer({ config })` MUST set `configDir` (or `TERMBEAM_CONFIG_DIR` env var) to a fresh `mkdtempSync` temp directory. Without this, the server reads the developer's real `~/.termbeam/prefs.json` and may auto-spawn workspace sessions with a different `cwd`, silently breaking assertions about the default session. `routes.test.js`'s `startServer()` is the canonical example.
- **`--test-force-exit`** — `npm test` passes this flag so dangling Windows ConPTY threads can't keep the worker alive past the 180 s per-file timeout. Tests that legitimately need to leak resources for assertions should be flagged in the suite description.

**Port isolation:** Integration tests use port `0` (OS-assigned random port) to avoid conflicts. Never hardcode ports in tests.

### Playwright E2E

```bash
npx playwright test                   # run e2e tests (chromium, sequential)
npx playwright test --grep @cross-platform  # run the cross-platform PTY smoke test
```

E2E tests live in `test/e2e-*.test.js` and are excluded from `npm test`. See `playwright.config.js` for retries, reporters, and timeouts.

## Architecture

TermBeam is a Node.js CLI tool that exposes a local PTY (pseudo-terminal) over HTTP + WebSocket, with a mobile-optimized browser UI.

**Server flow:** `bin/termbeam.js` → `src/server/index.js` (orchestrator) creates an Express app + WebSocket server, wiring together modules from `src/server/`, `src/cli/`, `src/tunnel/`, and `src/utils/`.

**`src/server/`** — HTTP/WS server core:

- `index.js` — orchestrator: creates Express app + WebSocket server
- `routes.js` — Express routes for API (`/api/sessions`, `/api/auth`) and pages (`/terminal`, `/login`)
- `auth.js` — password auth, device sessions (sliding/absolute expiry, revoke + `revoked` events), cookies, rate limiting, `/login?next=` redirects
- `auth-store.js` — persisted `auth.json` (session token hashes, passkeys, password epoch); `auth-routes.js` — `/api/auth/*` (login, logout, devices, passkeys); `webauthn.js` + `cbor.js` — passkey verification
- `origin.js` — origin/CSRF validation shared by HTTP and WebSocket (DevTunnel rewrites `Host` to localhost)
- `terminal-modes.js` — tracks DEC private modes (alt screen, mouse tracking, bracketed paste…) so reconnect replays restore input state
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
- `git.js` — git metadata and status parsing. Use `getGitInfoAsync()` on any server path (session polling caches refresh with it) — the sync `getGitInfo()` blocks the event loop and every terminal's WebSocket. Status runs with `--no-optional-locks` so polling never takes `index.lock`, and porcelain output must never be trimmed (its leading space is meaningful).
- `version.js` — detects version from package.json
- `update-check.js` — npm update checking
- `copilot-models.js` — Copilot model-id validation and normalization of the SDK's model list. Never hard-code model ids or a default model: the picker lists `GET /api/copilot/models` (cached in `CopilotService.listModels()`), and an omitted model lets Copilot choose the account's default.

**Frontend:** React SPA in `src/frontend/` built with Vite + TypeScript. Builds to `public/` (gitignored build artifact). Uses xterm.js, Zustand for state, and Radix UI for accessible components. Components organized into: ToolsPanel (right slide-in, formerly CommandPalette), Settings (preferences drawer/sheet), FolderBrowser, LoginPage, Modals, Overlays, SearchBar, SessionsHub, SidePanel (left slide-in), TabBar, TerminalApp, TerminalPane, TouchBar, and common reusable components (TopBar, ThemePicker, UpdateBanner).

**UI surfaces (terminology — use these names consistently):**

- **ConnectionPill / ConnectionSheet** (`src/frontend/src/components/ConnectionStatus/`) — the single connection-status system (top bar pill with RTT → sheet with explanation + action), backed by `stores/connectionStore.ts`. Also `UnlockSheet` (in-place re-auth when the session expires, terminals stay mounted) and `PasskeyPrompt` (offer to add a passkey after password/QR login).
- **LoginPage** (`src/frontend/src/components/LoginPage/`) — the only login UI; the server serves the SPA at `/login`. `UnlockForm` is shared with `UnlockSheet`.

- **SidePanel** (`src/frontend/src/components/SidePanel/`) — left slide-in containing the sessions picker. Triggered by the ☰ menu button.
- **ToolsPanel** (`src/frontend/src/components/ToolsPanel/`, formerly `CommandPalette`) — right slide-in titled "Tools". Triggered by the ▦ button or `Cmd/Ctrl+K`. Sections: Session · Files · View · Share · Agents · Settings · System. The Settings section contains a single "Settings…" row that opens the SettingsPanel.
- **SessionsHub** (`src/frontend/src/components/SessionsHub/`) — the home screen. Sessions are grouped by git working tree (`utils/sessionDisplay.ts → groupSessions`, keyed by the server's `git.root`): the group header shows repo, full branch and working-tree status once; rows show name, activity, full path, shell and PID. Phones get a glass action dock and a search toggle in the bar; wide screens show title + inline actions.
- **Sheet** (`src/frontend/src/components/common/Sheet.tsx`) — the one modal surface (Radix Dialog): bottom sheet with drag-to-dismiss on phones, centered dialog on wider screens, `layer="system"` for connection/re-auth sheets. Build new modals on it, with controls from `styles/forms.module.css`.
- **SettingsPanel** (`src/frontend/src/components/SettingsPanel/`) — non-blocking preferences surface. **Top sheet** on mobile that slides down and stops just above the TouchBar (and the keyboard it rides on), so TouchBar edits and "Start collapsed" can be observed live; where there is no TouchBar (the hub) it takes the full height. **Right-side drawer (420 px)** on desktop with no backdrop dim. Reached from the ToolsPanel "Settings…" row or `Cmd/Ctrl+,`. Holds Appearance, Feedback, Touch Bar, Defaults, Workspaces and **Security** (passkeys, signed-in devices, sign out / sign out everywhere) sections with a sticky jump-to-section nav. Backed by `usePreferencesStore`, which syncs to the server via `GET`/`PUT /api/preferences`.

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
- **Design tokens** — frontend colors/spacing/type/motion come from `src/frontend/src/styles/tokens.css` (derived from each theme's variables with `color-mix`); never hard-code colors in component CSS. Use `--on-accent` for text on accent fills (computed per theme by `services/themeContrast.ts`). Grouped lists use `--page` (background) and `--card` (rows), controls use `--fill-tonal` / `--raised`; these flip for light themes, so don't substitute raw `--surface-*`.
- **Type** — Mona Sans (`--font-ui`) everywhere, sentence case, no `text-transform: uppercase` labels; JetBrains Mono (`--font-mono`) only for machine text (paths, branches, PIDs, commands).
- **Never truncate session metadata** — paths, branch names, repo names and git status are shown in full and wrap at separators (`<Breakable>` from `SessionsHub/SessionCard.tsx` inserts `<wbr>` after `/`); no ellipses, no collapsing.
- **In-app navigation** — use `navigate()` / `spaLinkHandler` from `utils/navigation.ts` (not `window.location` or bare `<a href>`). Route changes run through `document.startViewTransition` in `App.tsx`; an element with `view-transition-name: tb-session-name` is the shared element between a hub row and the active terminal tab.
- **CSS Modules + global keyframes** — inside `*.module.css`, animation names are localized; reference the shared keyframes from `styles/animations.css` as `animation: global(tb-rise) …`, otherwise the animation silently never runs (and Radix dialogs never unmount after closing). Exit animations must use a different keyframe name than the entrance (e.g. `tb-sheet-up-exit`), not `reverse`.
- **Cross-platform support** — must work on Windows, macOS, and Linux. Coverage runs the full suite on Ubuntu/Node 22, and the unit job runs it on macOS/Node 24. Playwright runs the full E2E suite on Linux plus a tagged real-PTY smoke test on macOS and Windows.
- **PTY session cleanup** — `pty.kill()` is async; the `onExit` callback removes the session from the Map
- **Coverage exclusion** — `src/tunnel/` directory is excluded from coverage (requires external DevTunnel CLI)
- **Build artifact** — `public/` is a gitignored build artifact; run `npm run build:frontend` to regenerate from `src/frontend/`
- **Connection config** — server writes `~/.termbeam/connection.json` on start (port, host, password) for `termbeam resume` auto-discovery; removed on shutdown

## Environment Variables

- `PORT` — server port (default: 3456)
- `TERMBEAM_PASSWORD` / `PTY_PASSWORD` — access password
- `TERMBEAM_CWD` / `PTY_CWD` — working directory
- `TERMBEAM_LOG_LEVEL` — log level (default: info)
- `TERMBEAM_CONFIG_DIR` — location for `connection.json`, `auth.json`, `prefs.json` (default: `~/.termbeam/`)
- `TERMBEAM_PUBLIC_URL` — public address when running behind your own reverse proxy (same as `--public-url`); trusted by the CSRF guard, WebSocket origin check and passkeys

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

- **Cookie `Secure` flag follows the request** — `secure: !!req.secure`: set behind the HTTPS tunnel (the relay's `X-Forwarded-Proto` is trusted from loopback only), omitted on plain-HTTP localhost/LAN where forcing it would break cookie auth. Cookies are always `HttpOnly` and `SameSite=Strict`.
- **Password compared in constant time** — `auth.safeCompare` copies both inputs into fixed-length zero-padded buffers and compares them with `crypto.timingSafeEqual` (plus a separate length check), so neither content nor length leaks through timing. Rate limiting (5 attempts/min/IP) remains the primary brute-force defense.
- **Tunnel is on by default** — makes the tool useful out of the box (phone on cellular), but this means the terminal is internet-accessible. Password auto-generation compensates.
- **Default bind is `127.0.0.1`** — localhost only by default. Use `--lan` or `--host 0.0.0.0` for LAN access.
- **`--no-password` exists** — for trusted localhost-only scenarios. Never combine with tunnel.
- **Session IDs are 128-bit random** (`crypto.randomBytes(16)`) — unguessable, but not secret (visible in URLs). Auth tokens protect access, not session IDs.
- **Origin validation (WebSocket + API)** — the browser origin must match the `Host` header, the public tunnel URL, or `X-Forwarded-Host` from a loopback proxy; `Sec-Fetch-Site: same-site|cross-site` is refused. The old "one side is localhost" rule was removed: behind DevTunnels `Host` is always `localhost` and `devtunnels.ms` is not on the Public Suffix List, so another tunnel's page could open an authenticated socket.
- **Device sessions** — tokens are persisted only as SHA-256 hashes in `auth.json` (0600), bound to a scrypt fingerprint of the password (password change ⇒ all remembered devices signed out). Remembered: 7-day idle / 30-day absolute; session-only: 2h / 12h, never on disk. Revocation closes open sockets with code `4401`.
- **Passkeys** — WebAuthn with user verification required, attestation `none` (registration requires an existing session), RP ID = the exact host. They survive password changes until removed or `--reset-auth`.
- **Security headers** — X-Frame-Options: DENY, CSP, no-store cache, nosniff, no-referrer on all responses.
- **Shell path validation** — only shells detected by `src/utils/shells.js` are accepted; arbitrary paths are rejected.
