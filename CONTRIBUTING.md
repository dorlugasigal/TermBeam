# Contributing to TermBeam

Thank you for your interest in contributing! Here's everything you need to know.

## Prerequisites

- **Node.js** ≥ 20
- **npm** ≥ 9
- **Git**
- A terminal (macOS, Linux, or Windows with WSL)

## Setup

```bash
# 1. Fork on GitHub, then clone your fork
git clone https://github.com/<your-username>/TermBeam.git
cd TermBeam

# 2. Install dependencies (also sets up pre-commit hooks via Husky)
npm install

# 3. Verify everything works
npm test
```

## Development

### Running Locally

```bash
# Start with auto-generated password (recommended for dev)
npm run dev

# Start with custom options
node bin/termbeam.js --port 8080 --password dev123

# Start with default settings (no password, localhost only)
npm start
```

Open the printed URL on your phone or browser to test the UI.

### Project Structure

```
termbeam/
├── bin/termbeam.js          # CLI entry point (just requires src/server.js)
├── src/
│   ├── server.js             # Main orchestrator — wires everything together
│   ├── cli.js                # CLI argument parsing, --help, --version
│   ├── auth.js               # Authentication, tokens, rate limiting, login page
│   ├── logger.js             # Structured logger with configurable levels
│   ├── sessions.js           # SessionManager class — PTY lifecycle
│   ├── shells.js             # Shell detection (Windows + Unix)
│   ├── routes.js             # Express HTTP routes (API + pages)
│   ├── websocket.js          # WebSocket connection handling
│   ├── tunnel.js             # DevTunnel integration
│   └── version.js            # Smart version detection (npm vs dev)
├── public/
│   ├── index.html            # Session manager UI (mobile)
│   └── terminal.html         # Terminal UI (xterm.js + touch controls)
├── test/
│   ├── auth.test.js          # Auth module tests
│   ├── cli.test.js           # CLI argument parsing tests
│   ├── integration.test.js   # Integration tests (HTTP + WebSocket)
│   ├── logger.test.js        # Logger module tests
│   ├── routes.test.js        # HTTP route tests
│   ├── sessions.test.js      # Session manager tests (mocked PTY)
│   ├── shells.test.js        # Shell detection tests
│   ├── version.test.js       # Version detection tests
│   └── websocket.test.js     # WebSocket handler tests
├── docs/                     # MkDocs documentation source
├── .github/workflows/        # CI, release, and docs deployment
├── package.json
└── mkdocs.yml
```

### Key Files to Know

| File                   | What it does      | When to edit                              |
| ---------------------- | ----------------- | ----------------------------------------- |
| `src/server.js`        | Orchestrator      | Adding new middleware or startup logic    |
| `src/cli.js`           | CLI parsing       | Adding new flags or env vars              |
| `src/routes.js`        | HTTP routes       | Adding new API endpoints                  |
| `src/websocket.js`     | WebSocket handler | Changing terminal I/O behavior            |
| `src/auth.js`          | Auth system       | Changing authentication logic             |
| `src/sessions.js`      | PTY management    | Changing how sessions are created/managed |
| `src/logger.js`        | Logging           | Changing log format or levels             |
| `src/shells.js`        | Shell detection   | Adding new shell types                    |
| `src/tunnel.js`        | DevTunnel         | Changing tunnel creation or lifecycle     |
| `public/index.html`    | Session list UI   | UI changes on the main screen             |
| `public/terminal.html` | Terminal UI       | Terminal rendering, touch controls        |

### Making Changes

1. Create a feature branch:

   ```bash
   git checkout -b feat/my-feature
   ```

2. Make your changes. The pre-commit hook will automatically:
   - Format staged files with Prettier
   - Syntax-check JS files with `node --check`

3. Run tests locally:

   ```bash
   npm test
   ```

4. Test manually — start the server and verify on your phone:
   ```bash
   npm run dev
   ```

## Testing

We use Node.js built-in test runner (`node:test` + `node:assert`). No extra test framework needed.

```bash
# Run all tests
npm test

# Run a specific test file
node --test test/auth.test.js

# Run tests with verbose output
node --test --test-reporter=spec test/*.test.js
```

### Writing Tests

- Tests live in `test/<module>.test.js`
- Use `node:test` (describe/it) and `node:assert`
- Mock `node-pty` for session tests (see `test/sessions.test.js` for the pattern)
- Clear `require.cache` between tests when testing modules that read `process.argv`

### What to Test

- ✅ Pure logic (parsing, validation, token generation)
- ✅ Middleware behavior (auth, rate limiting)
- ✅ Session lifecycle (create, list, delete, shutdown)
- ⚠️ WebSocket/HTTP integration — manual testing for now

## Code Style

- **Formatter:** Prettier (runs automatically via pre-commit hook)
- **Config:** `.prettierrc` (single quotes, trailing commas, 100 char width)
- **Linting:** `node --check` for syntax validation
- **Manual:** `npm run format` to format all files, `npm run lint` to syntax-check

Key principles:

- Minimal dependencies — prefer built-in Node APIs
- Keep modules focused — one responsibility per file
- Comment _why_, not _what_
- Follow existing patterns in the codebase

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

| Type       | Description        | Example                                        |
| ---------- | ------------------ | ---------------------------------------------- |
| `feat`     | New feature        | `feat(auth): add OAuth2 support`               |
| `fix`      | Bug fix            | `fix(terminal): handle resize on rotation`     |
| `docs`     | Documentation      | `docs: update security guide`                  |
| `refactor` | Code restructuring | `refactor(sessions): extract PTY spawn logic`  |
| `test`     | Tests              | `test(auth): add rate limit edge cases`        |
| `chore`    | Tooling/CI         | `chore(ci): add Node 22 to matrix`             |
| `perf`     | Performance        | `perf(ws): reduce JSON serialization overhead` |

**Breaking changes:** Add `!` after the type:

```
feat!: require password by default
```

## Submitting a Pull Request

1. Push your branch to your fork
2. Open a PR against `main` on [dorlugasigal/TermBeam](https://github.com/dorlugasigal/TermBeam)
3. Fill in the PR template (if available)
4. Ensure CI passes (tests run on Node 20, 22, 24)
5. Wait for review — we'll provide feedback if needed

### PR Checklist

- [ ] Tests pass locally (`npm test`)
- [ ] New features have tests
- [ ] Commits follow conventional format
- [ ] Documentation updated (if user-facing changes)
- [ ] Manually tested on mobile (if UI changes)

## Releasing (Maintainers Only)

Releases are triggered manually via GitHub Actions:

1. Go to **Actions** → **Release** workflow
2. Click **Run workflow**
3. Select the bump type:
   - **patch** (0.0.x) — bug fixes, small changes
   - **minor** (0.x.0) — new features, backward compatible
   - **major** (x.0.0) — breaking changes
4. The workflow automatically:
   - Bumps the version in `package.json`
   - Updates `CHANGELOG.md` with commit history
   - Commits, tags, and pushes
   - Publishes to npm
   - Creates a GitHub Release with auto-generated notes

### Version Flow Example

```
Current: 1.2.3
  → patch bump → 1.2.4
  → minor bump → 1.3.0
  → major bump → 2.0.0
```

## Documentation

Docs are built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) and deployed to GitHub Pages.

```bash
# Install mkdocs locally (one-time)
pip install mkdocs-material

# Preview docs
mkdocs serve

# Docs are in docs/ directory
```

Changes to `docs/` or `mkdocs.yml` pushed to `main` auto-deploy to GitHub Pages.

## Community

- Be kind and respectful to all contributors
- Welcome newcomers and help them get started
- Give constructive feedback
- Assume good intentions

Thank you for making TermBeam better! 📡
