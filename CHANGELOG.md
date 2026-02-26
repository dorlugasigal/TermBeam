# Changelog

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
