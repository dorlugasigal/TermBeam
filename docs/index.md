---
title: TermBeam — Beam Your Terminal to Any Device
description: >-
  Access your terminal from your phone, tablet, or any browser. No SSH, no
  config — one command and a QR code.
hide:
  - navigation
  - toc
---

<section class="tb-hero" markdown>

<p class="tb-eyebrow">
<span class="tb-eyebrow-dot"></span> Open source · MIT licensed
</p>

<h1 class="tb-hero-title">
Beam your terminal<br>to <span class="tb-grad">any device</span>.
</h1>

<p class="tb-hero-sub">
One command turns your terminal into a secure, mobile-optimized web app.<br class="tb-only-desktop">
No SSH, no port forwarding — just scan the QR code.
</p>

<div class="tb-hero-actions" markdown>

[Get started :material-arrow-right:](getting-started.md){ .md-button .md-button--primary .tb-btn-primary }

<button class="tb-install-btn" id="tb-copy" type="button" aria-label="Copy install command">
  <span class="tb-install-prompt">$</span><span class="tb-install-cmd">npx termbeam</span>
  <span class="tb-install-icon" aria-hidden="true">⧉</span>
</button>

</div>

<div class="tb-hero-shot" markdown>

![TermBeam desktop terminal](assets/showcase/hero-desktop.png){ .tb-desktop-shot loading=eager }

![TermBeam on mobile](assets/mobile-terminal.jpeg){ .tb-mobile-shot loading=eager }

</div>

</section>

<section class="tb-section" markdown>

## Why TermBeam { .tb-section-title }

<p class="tb-section-lead" markdown>
A terminal that goes wherever you do. Multi-session, touch-first, secure by default.
</p>

<div class="tb-feature-grid" markdown>

<div class="tb-feature" markdown>

### :material-cellphone: Mobile-first

No SSH client needed. Touch-optimized key bar with arrows, Tab, Enter, Ctrl, Esc. Swipe scrolling, pinch zoom, image paste, and iPhone PWA safe areas.

</div>

<div class="tb-feature" markdown>

### :material-tab-plus: Multi-session

Tabbed sessions, split view (horizontal on desktop, vertical on mobile), session colors, activity indicators, hover/long-press previews, and a folder browser.

</div>

<div class="tb-feature" markdown>

### :material-magnify: Productivity

Terminal search with regex (<kbd>Ctrl+F</kbd>), command palette (<kbd>Ctrl+K</kbd>), file upload &amp; download, markdown viewer, completion notifications, 30 themes.

</div>

<div class="tb-feature" markdown>

### :material-shield-lock: Secure by default

Password auth with auto-generation and rate limiting. httpOnly cookies. QR code auto-login with single-use share tokens. Validated shells. Optional secure tunnel.

</div>

<div class="tb-feature" markdown>

### :material-robot: AI agent ready

Auto-detects Copilot CLI, Claude, Aider, and Codex. Launch them from the agent picker — your phone becomes a remote control for AI coding sessions.

</div>

<div class="tb-feature" markdown>

### :material-flash: One command

`npx termbeam` and you're online. Optional secure tunnel for cellular access. Or run on LAN, or fully local. Interactive setup wizard with `termbeam -i`.

</div>

</div>

</section>

<section class="tb-section tb-section--alt" markdown>

## How it works { .tb-section-title }

<div class="tb-how-grid" markdown>

<div class="tb-how-step" markdown>

#### 1 · Spawn

A lightweight server starts a PTY with your shell — `zsh`, `bash`, `pwsh`, or `cmd`.

</div>

<div class="tb-how-step" markdown>

#### 2 · Bridge

The browser connects via WebSocket. Input and output stream in real time over xterm.js.

</div>

<div class="tb-how-step" markdown>

#### 3 · Beam

A QR code (or link) opens the terminal on your phone. Use a tunnel for cellular, or stay on LAN.

</div>

</div>

```mermaid
flowchart LR
  A["Phone<br>(Browser)"] <-->|WebSocket| B["TermBeam<br>(Server)"]
  B <-->|PTY| C["Shell<br>(zsh/bash)"]
```

</section>

<section class="tb-section tb-cta" markdown>

## Ready in 30 seconds { .tb-section-title }

<p class="tb-section-lead">
Free. Open source. No account, no signup, no telemetry.
</p>

<div class="tb-cta-actions" markdown>

[Read the docs :material-book-open-variant:](getting-started.md){ .md-button .md-button--primary }
[Star on GitHub :material-github:](https://github.com/dorlugasigal/TermBeam){ .md-button }

</div>

</section>
