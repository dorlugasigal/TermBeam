---
title: Contributing
---

# Contributing

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
npm run test:coverage   # tests + coverage report (c8, 80% threshold)
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
- **`src/server.js`** — orchestrator that wires Express + WebSocket + PTY
- **`src/sessions.js`** — PTY session lifecycle (create/list/delete)
- **`src/auth.js`** — password auth, tokens, rate limiting
- **`src/routes.js`** — Express routes for API and pages
- **`src/websocket.js`** — WebSocket message handling
- **`public/`** — vanilla HTML/JS frontend using xterm.js

For the full architecture, see [Architecture](../architecture/).

### Documentation

- **README.md** — user-facing quick reference
- **`docs/`** — full MkDocs Material site (deployed to GitHub Pages)
- Preview docs locally: `pip install mkdocs-material && mkdocs serve`
- Changes to `docs/` pushed to `main` auto-deploy
