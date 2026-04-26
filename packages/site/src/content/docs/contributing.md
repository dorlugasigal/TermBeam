---
title: Contributing
description: Development setup, code conventions, testing workflow, and how to submit pull requests.
---

See [CONTRIBUTING.md](https://github.com/dorlugasigal/TermBeam/blob/main/CONTRIBUTING.md) in the repository root for full contribution guidelines.

## Quick Reference

### Commit Format

```
<type>(<scope>): <description>
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `chore`

### Development

```bash
git clone https://github.com/dorlugasigal/TermBeam.git
cd TermBeam
npm install
npm run dev    # Start with auto-generated password
npm test       # Run tests
```

### Testing

```bash
npm test                # run all unit/integration tests (node:test)
npm run test:coverage   # tests + coverage report (c8)
npm run lint            # syntax-check with node --check
npm run format          # format with Prettier
```

TermBeam also has end-to-end UI tests using [Playwright](https://playwright.dev/) (in `test/e2e-*.test.js` files). These are not included in `npm test` and require a separate Playwright setup.

### Pull Request Checklist

- [ ] Tests pass (`npm test`)
- [ ] New features have tests
- [ ] Commits follow conventional format
- [ ] Documentation updated if needed
- [ ] Manually tested on mobile (if UI changes)

### Architecture Overview

TermBeam follows a one-responsibility-per-file pattern. Key modules:

- **`bin/termbeam.js`** — CLI entry point, dispatches subcommands
- **`src/server/index.js`** — orchestrator that wires Express + WebSocket + PTY
- **`src/server/sessions.js`** — `SessionManager` wrapping `node-pty` lifecycle (create/list/delete)
- **`src/server/auth.js`** — password auth, token cookies, rate limiting
- **`src/server/routes.js`** — Express routes for API and pages
- **`src/server/websocket.js`** — WebSocket message handling (`attach`, `input`, `resize`, `output`)
- **`src/cli/`** — `termbeam resume`, `termbeam list`, interactive setup, service install
- **`src/tunnel/`** — DevTunnel integration (optional public URLs)
- **`src/utils/`** — shells, git metadata, logger, agent detection
- **`src/frontend/`** — React SPA built with Vite + TypeScript (xterm.js, Zustand, Radix UI); compiled to `public/`

For the full architecture, see [Architecture](../architecture/).

### Documentation

- **README.md** — user-facing quick reference (features, CLI flags, security summary)
- **`packages/site/`** — Astro + Starlight site deployed to GitHub Pages (the page you're reading now)
- Preview docs locally: `cd packages/site && npm install && npm run dev`
- Changes to `packages/site/src/content/docs/` pushed to `main` auto-deploy via the Pages workflow

## See Also

- **[API Reference](../api/)** — HTTP endpoints and WebSocket protocol you'll work against
- **[Architecture](../architecture/)** — how the server, frontend, and PTY sessions fit together
- **[Getting Started](../getting-started/)** — install TermBeam and run a local instance
