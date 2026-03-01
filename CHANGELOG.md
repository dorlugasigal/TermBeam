# Changelog

## [1.2.1] - 2026-03-01

- feat(ui): redesign touch key bar with modifier keys and iOS-style layout

## [1.2.0] - 2026-03-01

- feat: add preview proxy, Docker support, and UI improvements

## [1.1.1] - 2026-03-01

- feat(tunnel): add findDevtunnel function and improve error handling for tunnel mode

## [1.1.0] - 2026-03-01

- fix(docs): update terminology from one-time tokens to share tokens for clarity
- feat(auth): QR code auto-login with one-time tokens (#29)

## [1.0.7] - 2026-03-01

- fix(security): allow CDN in connect-src CSP for font loading

## [1.0.6] - 2026-03-01

- fix(routes): resolve static file 404 when installed via npx

## [1.0.5] - 2026-03-01

- fix: use require.resolve to find hoisted node-pty in postinstall

## [1.0.4] - 2026-03-01

- fix: add postinstall to fix node-pty spawn-helper permissions

## [1.0.3] - 2026-03-01

- fix(cli): validate detected shell against /etc/shells allowlist

## [1.0.2] - 2026-03-01

- fix(cli): skip non-shell parent processes in shell detection

## [1.0.1] - 2026-03-01

- fix: detect npx symlink entry point without .js extension

## [1.0.0] - 2026-03-01

- fix: prevent spurious 'session not found' warns on session close (#26)
- feat: v1.0.0 preparation — security, logging, tests, cross-platform CI (#25)
- docs: add GitHub Copilot instructions for repository context
- fix: remove unused social plugin from mkdocs configuration
- feat: update documentation and HTML files for improved clarity and SEO
- fix: adjust spacing in Copilot terminal screen for better alignment
- feat: load JetBrainsMono font for improved typography in PhoneScene
- feat: change video image format to jpeg and set quality to 100
- feat: enhance animations and UI elements in TitleCard and PhoneScene
- feat: update TermBeam to use explicit password management and improve security
- Redesign outro scene with typewriter, particles, and consistent palette (#23)

## [0.2.0] - 2026-02-28

### Changed

- **BREAKING:** Tunnel and auto-generated password are now enabled by default
- Added `--no-tunnel` and `--no-password` flags to opt out of defaults

### Added

- Mobile copy/paste: Copy button opens selectable text overlay, Paste button with clipboard API + fallback modal
- Image paste support — paste images from clipboard, uploaded to server temp directory
- Content-Security-Policy header (script/style/connect sources)
- Cache-Control: no-store header
- WebSocket maxPayload limit (1MB)
- Necessary operational logging (auth events, uploads, WS auth, session lifecycle)
- Folder browser defaults to server working directory

### Fixed

- Key-bar double-press on touch devices (touchstart + synthetic mousedown)
- Paste button not responding on iOS Safari (touchend handler)
- Non-JSON WebSocket messages no longer forwarded to PTY (security)
- Upload size limit now handled safely without destroying request stream

### Removed

- X-XSS-Protection header (deprecated, replaced by CSP)

## [0.1.0] - 2026-02-28

- feat: docs accuracy, side panel UX, SW font caching, test coverage (#22)

## [0.0.9] - 2026-02-27

- feat: implement process tree traversal for Windows to detect user shell
- chore(release): v0.0.8
- Fix/release token (#21)
- Update token in release workflow to use GITHUB_TOKEN
- fix: update token in release workflow to use RELEASE_TOKEN (#20)
- Add dynamic coverage badge from main branch (#19)
- Add dynamic coverage badge from main branch (#18)
- docs: replace Codecov badge in README (#17)
- fix: replace Codecov with instant inline coverage comments (#16)
- test: add version module tests (#15)
- docs: rewrite README, update API docs, add coverage to CI (#14)

## [0.0.8] - 2026-02-27

- Fix/release token (#21)
- Update token in release workflow to use GITHUB_TOKEN
- fix: update token in release workflow to use RELEASE_TOKEN (#20)
- Add dynamic coverage badge from main branch (#19)
- Add dynamic coverage badge from main branch (#18)
- docs: replace Codecov badge in README (#17)
- fix: replace Codecov with instant inline coverage comments (#16)
- test: add version module tests (#15)
- docs: rewrite README, update API docs, add coverage to CI (#14)

## [0.0.7] - 2026-02-27

- feat: persist DevTunnel ID for stable URLs across restarts (#13)
- feat: add PWA support for home screen installation (#12)
- feat: mobile clipboard integration (copy/paste) (#11)
- docs: add guide for running TermBeam as a background service

## [0.0.6] - 2026-02-27

- Enhance terminal UI with theme support and improved styling
- docs: restore full README and add acknowledgments section for Tamir Dresher (#7)
- Update README.md to include acknowledgments section

## [0.0.5] - 2026-02-27

- feat: simplify version bump logic in release workflow
- feat: implement shell detection and initial command execution in sessions

## [0.0.4] - 2026-02-27

- feat: add Remotion demo video project (#6)
- chore(ci): bump actions/checkout from v4 to v6
- chore(ci): bump actions/setup-node from 4 to 6 (#3)
- chore(ci): bump actions/setup-python from 5 to 6 (#2)
- chore(ci): bump actions/upload-pages-artifact from 3 to 4 (#1)

## [0.0.3] - 2026-02-26

- fix: rewrite CHANGELOG update to avoid sed/awk failures on Linux
- fix: pin node-pty to 1.0.0 (1.1.0 has posix_spawnp bug)

## [0.0.2] - 2026-02-26

- docs: update README with enhanced features, usage instructions, and screenshot guidelines
- fix: use Node 24 for npm 11.5.1+ OIDC trusted publishing
- fix: overwrite .npmrc for OIDC trusted publishing
- fix: skip tagging when tag already exists
- fix: clear stale auth token before npm publish for trusted publishing
- feat: add dry-run option to release workflow
- feat: add Contributor Covenant Code of Conduct to promote a respectful community
- fix: use trusted publishing instead of NPM_TOKEN
- feat: add issue templates for bug reports and feature requests, and enhance security policy documentation

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-session terminal management
- Mobile-optimized terminal with touch controls
- Swipe-to-delete sessions
- Folder browser for working directory selection
- Password authentication with token-based sessions
- DevTunnel support for public access
- QR code for quick mobile connection
- Nerd Font support
- Customizable shell and working directory
