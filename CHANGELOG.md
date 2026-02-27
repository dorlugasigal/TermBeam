# Changelog

## [0.0.8] - 2026-02-27

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
