# Changelog

## [1.21.1] - 2026-04-21

- fix(windows): service wizard uses getDefaultShell instead of COMSPEC
- fix(windows): use tasklist fallback when wmic unavailable for shell detection
- fix(windows): add windowsHide to all child_process calls
- fix(windows): hide devtunnel console windows and fix DEP0190 deprecation

## [1.21.0] - 2026-04-20

- feat(review): add Review Mode to diff viewer + SessionsHub filter chips (#195)

## [1.20.4] - 2026-04-19

- fix(tunnel): add network-wait mode for transient DNS outages

## [1.20.3] - 2026-04-19

- fix(code-viewer): lazy-load file tree, allow in-root symlinks, auto-refresh git status

## [1.20.2] - 2026-04-14

- chore(deps): bump prettier from 3.8.1 to 3.8.2 (#189)
- chore(deps): bump @github/copilot-sdk from 0.2.1 to 0.2.2 (#190)
- chore(deps): bump better-sqlite3 from 12.8.0 to 12.9.0 (#188)
- chore(ci): bump actions/upload-pages-artifact from 4.0.0 to 5.0.0 (#187)
- chore(ci): bump actions/github-script from 8.0.0 to 9.0.0 (#185)
- chore(ci): bump softprops/action-gh-release from 2.6.1 to 3.0.0 (#186)
- chore(ci): bump actions/upload-artifact from 7.0.0 to 7.0.1 (#184)

## [1.20.1] - 2026-04-11

- fix(copilot): register companion PTY in session store and hide from UI
- chore(deps): bump eslint from 10.1.0 to 10.2.0 (#180)
- chore(ci): bump davelosert/vitest-coverage-report-action from 2.10.0 to 2.11.2 (#178)
- chore(deps): bump @playwright/test from 1.58.2 to 1.59.1 (#179)

## [1.20.0] - 2026-04-08

- feat(copilot): integrate Copilot SDK agent with chat UI, tests, and code review fixes (#183)
- Revert "docs: add background service section to README"
- docs: add background service section to README
- feat(landing): add themes demo, fix video pacing and content

## [1.19.5] - 2026-04-05

- feat(landing): add theme switcher to hub video, fix voice to paste not type

## [1.19.4] - 2026-04-05

- feat(landing): re-record showcase videos with real UI interactions
- fix(landing): re-record videos at 2x resolution with high quality
- fix(landing): re-record videos showing real UI features
- feat(landing): replace showcase images with autoplay video clips
- fix(landing): extend noise overlay to prevent edge artifacts
- fix(landing): remove subtle border lines between feature sections
- fix(landing): add showcase images to repo
- feat(landing): section-based showcase redesign with correct logos
- fix(landing): improve a11y — add main landmark, fix footer contrast
- docs: update screenshots and landing page features

## [1.19.3] - 2026-04-04

- fix(security): prevent path traversal in file endpoints and fix preview redirect loop

## [1.19.2] - 2026-04-04

- fix(test): wait for shell options to load in E2E test

## [1.19.1] - 2026-04-04

- fix(api): allow OpenCode session IDs in resume-command validation
- fix(ui): mobile terminal uses full screen width — custom fit bypasses scrollbar
- fix(ui): stretch xterm screen/rows to full width via JS + MutationObserver
- fix(ui): eliminate terminal right-edge gap via container background sync
- fix(ui): override inline width on xterm row divs for full-width terminal
- fix(ui): stretch xterm-screen to fill full viewport width
- fix(ui): terminal uses full width on mobile via JS scrollbar override
- fix(ui): terminal fills full width on mobile + update E2E theme list
- fix(ui): theme selection highlights immediately on click
- refactor(ui): remove retro-amber and lavender-dream themes
- feat(ui): add 10 new themes — dark-teal, blue-mist, cyan-punch, earth-tone, crimson-night, golden-night, red-alert, lavender-dream, espresso, forest-floor
- feat(agents): add OpenCode session support + fix theme palette colors
- feat(ui): theme palette preview + PR review process docs
- fix(security): address remaining review comments — input validation, async safety, a11y

## [1.19.0] - 2026-04-04

- feat(agents): add AI agent launch, resume browser, and session detection (#176)
- chore(ci): bump davelosert/vitest-coverage-report-action from 2.9.3 to 2.10.0 (#173)
- chore(ci): bump actions/deploy-pages from 4.0.5 to 5.0.0 (#172)
- chore(ci): bump actions/configure-pages from 5.0.0 to 6.0.0 (#171)
- chore(ci): bump github/codeql-action from 4.34.1 to 4.35.1 (#175)
- chore(deps): bump express-rate-limit from 8.3.1 to 8.3.2 (#174)

## [1.18.1] - 2026-03-30

- fix(server): track live PTY CWD and remove redundant tunnel renewal UI

## [1.18.0] - 2026-03-30

- feat(tunnel): auth expiry detection, in-app renewal, and token monitoring
- fix(tunnel): handle DevTunnel auth expiry and prefer Entra login

## [1.17.8] - 2026-03-30

- fix(frontend): single-click tabs, smart session naming, push reliability (#169)

## [1.17.7] - 2026-03-27

- fix(ui): refresh button triggers full reload and update restart auto-recovers (#168)
- fix(ci): exclude solo-dev checks from scorecard monitor

## [1.17.6] - 2026-03-27

- feat(security): improve OpenSSF scorecard score (#163)

## [1.17.5] - 2026-03-26

- fix(git): resolve diff/blame paths from repo root and scope CodeViewer state per session

## [1.17.4] - 2026-03-23

- fix(tunnel): add watchdog for auto-recovery and keep keyboard on tab switch (#161)
- chore(deps): bump eslint from 10.0.3 to 10.1.0 (#159)
- chore(deps): bump ws from 8.19.0 to 8.20.0 (#158)
- chore(ci): bump github/codeql-action from 4.33.0 to 4.34.1 (#157)

## [1.17.3] - 2026-03-22

- fix(test): correct actionLogs spawn opts assertion for cross-platform CI
- fix(service): Windows and WSL compatibility for PM2 service management

## [1.17.2] - 2026-03-22

- fix(update): enable auto-update for source installs running under PM2

## [1.17.1] - 2026-03-22

- fix(ui): open code viewer as overlay to preserve terminal connection

## [1.17.0] - 2026-03-22

- feat(update): in-app update mechanism with two-tier strategy (#150)

## [1.16.0] - 2026-03-22

- feat(viewer,notifications): git changes view and push notifications (#156)
- fix: restore +New button (desktop only) and fix E2E tests (#155)
- feat: built-in code viewer with file explorer, syntax highlighting, and markdown preview (#154)

## [1.15.2] - 2026-03-20

- fix(focus): tap-to-cursor for TUI apps and mobile focus resilience

## [1.15.1] - 2026-03-20

- fix(e2e): update split view test for cycling labels
- test(split): add unit tests for split mode cycling logic
- feat(split): cycle split orientation and add pane focus indicator (#149)
- fix(test): add --test-timeout=60s to prevent Windows CI hangs
- perf(test): speed up Windows E2E by removing redundant waits
- fix(test): resolve Windows CI EBUSY errors in routes test cleanup

## [1.15.0] - 2026-03-20

- test: add coverage for file endpoint security features
- fix: address PR review comments — security, a11y, docs
- feat(download): add confirmation dialog and progress bar
- fix(markdown): attach pinch listeners to container, read refs lazily
- perf(markdown): smooth pinch-zoom with RAF, fix center tracking
- fix(markdown): zoom centers on pinch midpoint
- fix(markdown): true bitmap-style pinch-to-zoom
- fix(markdown): use CSS zoom for pinch-to-zoom
- fix(markdown): true visual zoom with proper scroll panning
- fix(markdown): clamp zoom min to 100%, fix pan scrolling
- fix(markdown): implement JS-based pinch-to-zoom
- feat(markdown): add emoji shortcodes and pinch-to-zoom
- feat: upgrade markdown viewer with images, mermaid, HTML, and links
- fix: remove path traversal restriction, enable parent directory navigation
- feat(ui): split markdown viewer into separate tool in CommandPalette
- fix(ui): move download button into CommandPalette side toolbar
- fix(ui): add disabled styling for download toolbar button
- feat(ui): add download button to top bar toolbar
- fix: rename button to Download File
- fix: update docs to match renamed Downloads button
- fix: rename Files button to Downloads in side panel
- docs: add file browser, download, and markdown viewer documentation
- feat: add markdown file viewer in file browser

## [1.14.7] - 2026-03-18

- fix(pwa): serve icons from landing page to bypass DevTunnel auth

## [1.14.6] - 2026-03-18

- Revert "feat(tunnel): make tunnel public by default for PWA compatibility"

## [1.14.5] - 2026-03-18

- feat(tunnel): make tunnel public by default for PWA compatibility

## [1.14.4] - 2026-03-18

- fix(pwa): add icon/manifest tags to login page and fix maskable purpose

## [1.14.3] - 2026-03-18

- fix(pwa): allow Safari to cache icons for home screen display

## [1.14.2] - 2026-03-18

- fix(pwa): add 180x180 apple-touch-icon for Safari iOS home screen

## [1.14.1] - 2026-03-18

- fix(wsl): prevent hang on devtunnel device code login and improve node-pty error

## [1.14.0] - 2026-03-18

- feat(cli): add --json flag to termbeam list command

## [1.13.6] - 2026-03-18

- fix(pwa): prevent stale login page after idle on no-password servers

## [1.13.5] - 2026-03-17

- fix(auth): detect tunnel auth expiry and reload PWA

## [1.13.4] - 2026-03-17

- fix(auth): simplify auth flow — remove localStorage caching

## [1.13.3] - 2026-03-17

- chore(release): v1.13.2 [skip ci]
- fix(service): boot persistence and SW auth reliability

## [1.13.2] - 2026-03-17

- fix(service): boot persistence and SW auth reliability

## [1.13.2] - 2026-03-16

- fix(auth): prevent white page in no-password mode after idle
- chore(deps): bump lint-staged from 16.3.2 to 16.4.0 (#144)
- chore(ci): bump github/codeql-action from 4.32.6 to 4.33.0 (#145)
- chore(ci): bump softprops/action-gh-release from 2.5.0 to 2.6.1 (#143)
- fix(ci): include all transitive deps in pinned requirements
- fix(ci): improve OpenSSF Scorecard token-permissions and pinned-dependencies

## [1.13.1] - 2026-03-15

- fix(security): resolve flatted DoS vulnerability and update publish skill
- feat(logging): add comprehensive logging across all server and CLI modules (#142)

## [1.13.0] - 2026-03-12

- fix(frontend): add safe-area-inset-top to SessionsHub for PWA mode
- fix(touchbar): float lock hint chevron above mic button
- feat(touchbar): professional mic icons and lock hint
- feat(touchbar): bigger circle, swipe-up to lock mic recording
- fix(touchbar): fix arrow alignment with CSS Grid and simplify mic handler
- feat(frontend): add speech-to-text mic button to TouchBar
- fix(frontend): enable touch scrolling in alt-screen mode (TUI apps)

## [1.12.5] - 2026-03-09

- chore(ci): bump github/codeql-action from 3.32.5 to 4.32.6 (#137)
- chore(deps): bump eslint from 10.0.2 to 10.0.3 (#138)
- chore(deps): bump express-rate-limit from 8.3.0 to 8.3.1 (#136)
- chore(ci): bump aquasecurity/trivy-action from 0.34.2 to 0.35.0 (#135)
- fix(frontend): revert scroll-to-bottom focus/tabIndex — prevents mobile keyboard
- feat(frontend): improve mobile touch scrolling and update PWA icons (#140)

## [1.12.4] - 2026-03-09

- fix(deps): patch serialize-javascript vulnerability (GHSA-5c6j-r48x-rmvq) (#134)

## [1.12.3] - 2026-03-09

- refactor: reorganize repository file structure (#133)

## [1.12.2] - 2026-03-09

- docs: fix inaccuracies across README, docs, and landing page
- feat(ui): seamless background reconnect and smart notifications (#132)

## [1.12.1] - 2026-03-09

- feat(ui): add 18 themes and fix alt-screen reconnection (#130)

## [1.12.0] - 2026-03-08

- feat(frontend): rewrite frontend in React + TypeScript (#128)

## [1.11.1] - 2026-03-07

- chore: drop Node.js 18 support (EOL April 2025) (#126)
- refactor(version): combine dev version into single semver-style string
- fix(resize): activity-aware PTY sizing, better replay, mobile persistence (#124)
- fix(version): derive version from git tag when running from source (#125)

## [1.11.0] - 2026-03-07

- feat: add update notification system
- fix(ui): redirect to session hub when no sessions exist (#122)

## [1.10.3] - 2026-03-06

- perf(ui): pin Nerd Fonts CDN to v3.4.0 for immutable caching

## [1.10.2] - 2026-03-06

- feat(cli): add attach alias, improve empty-session messages, add startup hints (#119)
- fix: add test-results directory to .gitignore
- delete: remove obsolete .last-run.json file
- Delete issues directory
- skill update

## [1.10.1] - 2026-03-06

- fix(security): harden error handling, add WS rate limiting, validate CLI args (#117)
- feat: SEO, discoverability, and content improvements (#115)

## [1.10.0] - 2026-03-06

- feat: add file upload to session working directory (#113)
- chore: add .gitleaks.toml to allowlist doc placeholders

## [1.9.0] - 2026-03-05

- docs: restructure README, split getting-started, add troubleshooting and usage guide, fix 15 inaccuracies (#112)
- docs: add resume and list commands to README
- feat(resume): add termbeam resume and sessions commands (#109)
- chore(security): add CODEOWNERS and enable branch protection (#107)
- chore(security): add CODEOWNERS and enable branch protection

## [1.8.1] - 2026-03-05

- fix(security): pin mkdocs-material version in pages workflow (#106)
- fix(security): harden session creation input validation (#104)
- fix(security): update demo-video deps to fix GHSA-5c6j-r48x-rmvq (#105)
- fix: use commit SHA instead of tag object SHA for codeql-action v3
- fix: prevent path injection and open redirect vulnerabilities (#93)
- fix: use correct commit SHA for ossf/scorecard-action v2.4.3
- fix: add rate limiting to file-serving routes (#94)
- fix: add defense-in-depth shell validation in SessionManager (#91)
- fix: prevent clear-text logging of passwords (#92)
- fix: make HTML tag filtering regexp case-insensitive (#95)
- fix: harden CI/CD workflow permissions and pin dependencies (#96)
- chore(ci): bump gitleaks/gitleaks-action from dcedce43c6f43de0b836d1fe38946645c9c638dc to ff98106e4c7b2bc287b24eaf42907196329070c7 (#83)
- chore(ci): bump actions/setup-node from 4.4.0 to 6.3.0 (#82)
- chore(deps): bump eslint from 9.39.3 to 10.0.2 (#81)
- chore(ci): bump ossf/scorecard-action from ea651e62978af7915d09fe2e282747c798bf2dab to f49aabe0b5af0936a0987cfb85d86b75731b0186 (#80)
- chore(deps): bump lint-staged from 16.3.1 to 16.3.2 (#77)
- fix: unpin all actions in scorecard workflow (webapp verification requires tags)
- fix: use tag ref for scorecard action (SHA pinning not supported)
- feat: add SecOps hardening — security scanning, Dependabot, action pinning (#76)
- feat: add static code analysis with ESLint and CodeQL (#75)

## [1.8.0] - 2026-03-04

- feat(cli): add interactive setup wizard (#72)

## [1.7.0] - 2026-03-04

- chore: bump version to 1.6.0
- feat(sessions): show git repo info in session cards (#70)
- docs: enhance description of touch-optimized UI and features in README
- docs: restructure README features and fix documentation gaps
- docs: reorder screenshots — terminal in center
- docs: update screenshots to consistent dark theme
- docs: update screenshots for README and landing page

## [1.5.0] - 2026-03-04

- feat(ui): add command notifications, terminal search, and command palette (#68)

## [1.4.0] - 2026-03-04

- feat(ui): show unread indicator in side panel session cards
- fix(ui): reuse AudioContext for mobile notification sound
- feat(ui): add tab title activity indicator for unread output (#66)
- feat(ui): add pinch-to-zoom font size adjustment (#67)
- feat: Replace dark/light toggle with 12-theme picker (#60)
- Create issue: Feature Request: Support Multiple Themes
- fix(test): replace setTimeout with setImmediate in actionLogs error handler test (#58)
- docs: add landing page URL to README and package.json homepage
- fix: add GitHub deployment environment to landing workflow
- feat: add standalone landing page with Cloudflare Pages deployment
- docs: center README header and badges
- docs: add npm downloads and node version badges
- chore: add smoke test step to publish skill, fix CI double-trigger

## [1.3.0] - 2026-03-03

- feat(service): add interactive PM2 service wizard (#57)
- fix(test): mock os.platform in ps-based shell detection tests
- test: boost coverage from 80% to 94.81%
- test: improve coverage and exclude test/ from report
- docs: update README, API, and configuration docs; add new CLI flags and improve security notes
- docs: fix security doc inaccuracies found during review
- Revert "perf: replace qrcode with lean-qr to reduce install size"
- perf: replace qrcode with lean-qr to reduce install size

## [1.2.10] - 2026-03-02

- fix(test): use real PNG magic bytes in upload serve test
- feat(upload): validate image content by magic bytes (#55)

## [1.2.9] - 2026-03-02

- fix(auth): remove share-token identifiers from production logs (#56)
- fix(paste): send filesystem path for image paste instead of URL
- fix(upload): return opaque IDs instead of absolute file paths
- fix(auth): make share tokens one-time use (#52)
- fix(auth): consistent auth responses for API vs UI routes (#51)

## [1.2.8] - 2026-03-02

- fix(server): improve startup banner colors and remove clipboard notice
- chore(deps): bump lint-staged from 16.2.7 to 16.3.1 (#50)
- chore(ci): bump actions/upload-artifact from 4 to 7 (#49)
- feat(cli): change default bind from 0.0.0.0 to 127.0.0.1 (#48)
- feat(auth): rate-limit failed Bearer auth attempts (#46)
- feat(auth): set cookie Secure flag dynamically based on HTTPS (#47)

## [1.2.7] - 2026-03-02

- docs: note --public requires password in README and docs
- feat(auth): block --public --no-password unsafe configuration (#45)

## [1.2.6] - 2026-03-02

- feat(tunnel): add smoke test workflow and auto-install devtunnel (#33)

## [1.2.5] - 2026-03-02

- feat(tunnel): make tunnel access private by default with --public opt-in
- docs: update mobile UI section to use a table for screenshots
- Implement code structure updates and remove redundant sections
- docs: add mobile screenshots to README
- docs(skill): emphasize waiting for all CI jobs including E2E before release

## [1.2.4] - 2026-03-02

- feat(terminal): add scroll-to-bottom button, write coalescer, and E2E test infra (#31)

## [1.2.3] - 2026-03-01

- fix(ui): prevent session cards from shrinking in side panel

## [1.2.2] - 2026-03-01

- fix(ui): make side panel sessions list scrollable

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
