---
title: Ai Agents
---

# AI Agent Launch

TermBeam can detect AI coding agents installed on your machine and launch them with a single tap — perfect for starting a Copilot, Claude, or Aider session from your phone.

## Supported Agents

| Agent                   | Command      | Website                                                              |
| ----------------------- | ------------ | -------------------------------------------------------------------- |
| **GitHub Copilot**      | `copilot`    | [docs.github.com/copilot](https://docs.github.com/en/copilot)        |
| **GitHub Copilot (gh)** | `gh copilot` | [github.com/github/gh-copilot](https://github.com/github/gh-copilot) |
| **Claude Code**         | `claude`     | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code) |
| **Aider**               | `aider`      | [aider.chat](https://aider.chat)                                     |
| **Codex CLI**           | `codex`      | [github.com/openai/codex](https://github.com/openai/codex)           |

TermBeam auto-detects which agents are available in your PATH on first request, with results cached for 60 seconds.

## Usage

### From the UI

1. Open the **New Session** modal (tap **"+ New Session"**)
2. Choose your working directory
3. Tap an AI agent to launch — a new terminal session opens with the agent running

To resume a previous agent session, open the **Command Palette** (`Ctrl+K` or tap the ⌘ button) and select **"Resume agent session"**.

### How It Works

When you launch an agent, TermBeam creates a regular terminal session and runs the agent command inside it. This means:

- **Full agent features** — You get the complete CLI experience (agent mode, tool calling, file editing, codebase awareness) — not a watered-down SDK version
- **All TermBeam features apply** — TouchBar, themes, push notifications, split view, wake lock
- **Session management** — The agent session appears in your session list like any other terminal

### API

```
GET /api/agents
```

Returns detected AI agents:

```json
{
  "agents": [
    {
      "id": "copilot",
      "name": "GitHub Copilot",
      "cmd": "copilot",
      "args": [],
      "icon": "copilot",
      "version": "1.2.3"
    },
    {
      "id": "claude",
      "name": "Claude Code",
      "cmd": "claude",
      "args": [],
      "icon": "claude",
      "version": "2.0.0"
    }
  ]
}
```

Results are cached for 60 seconds. The endpoint requires authentication.

## Installing AI Agents

If no agents are detected, install one:

```bash
# Claude Code
npm install -g @anthropic-ai/claude-code

# GitHub Copilot (via gh CLI)
gh extension install github/gh-copilot

# Aider
pip install aider-chat

# Codex CLI
npm install -g @openai/codex
```

After installing, restart TermBeam or wait 60 seconds for the cache to refresh.

## Mobile Tips

- **TouchBar keys** work great with AI agents — Tab to accept suggestions, Esc to cancel, arrows to navigate
- **Push notifications** will alert you when a long-running agent task finishes
- **Wake Lock** keeps your screen on during agent work
- **Split View** lets you run an AI agent alongside a regular terminal
- **Copy Overlay** makes it easy to copy agent output on mobile
