# RFC: AI Integration Strategy for TermBeam

> **Status**: Draft — Proposal for Discussion
> **Created**: April 2026
> **Context**: Inspired by Copilot Session Portal's approach; revised after evaluating SDK vs CLI trade-offs

---

## The Core Insight

**The terminal IS the AI interface.** Copilot CLI, Claude Code, Aider, and other AI coding agents already have rich TUIs with tool calling, file editing, codebase awareness, and agent mode. Building an SDK-based chat UI would give users a **worse** experience than just running these tools in a terminal.

TermBeam's value-add isn't to reinvent the AI chat — it's to make running AI agents in a terminal **effortless from your phone**.

---

## Two-Part Strategy

### Part 1: One-Tap AI Agent Launch (Primary)

**Problem**: Starting Copilot CLI, Claude Code, or any AI agent on your phone means:

1. Open TermBeam
2. Create a new session
3. Type `copilot` or `claude` or `aider` manually
4. Wait for it to load

**Solution**: A **quick-launch menu** in the UI that starts a pre-configured AI agent in one tap.

#### UX Design (Mobile-First)

**Entry points**:

- **SessionsHub** — "New AI Session" card alongside "New Terminal"
- **CommandPalette** — "Launch Copilot", "Launch Claude Code", etc.
- **TouchBar** — Optional AI button (🤖) that opens the quick-launch menu

**Quick-Launch Menu** (bottom sheet on mobile):

```
┌────────────────────────┐
│  Launch AI Agent       │
│                        │
│  ┌──────────────────┐  │
│  │ 🐙 GitHub Copilot│  │  ← Detected: copilot in PATH
│  │    copilot        │  │
│  └──────────────────┘  │
│  ┌──────────────────┐  │
│  │ 🟣 Claude Code   │  │  ← Detected: claude in PATH
│  │    claude         │  │
│  └──────────────────┘  │
│  ┌──────────────────┐  │
│  │ 🟢 Aider         │  │  ← Detected: aider in PATH
│  │    aider          │  │
│  └──────────────────┘  │
│  ┌──────────────────┐  │
│  │ ⚙️  Custom...     │  │  ← User-defined command
│  └──────────────────┘  │
│                        │
│  [Cancel]              │
└────────────────────────┘
```

**Auto-detection**: On server start (and cached), scan PATH for known AI CLI tools:

```javascript
const KNOWN_AGENTS = [
  { name: 'GitHub Copilot', cmd: 'copilot', icon: '🐙', detect: 'copilot --version' },
  { name: 'GitHub Copilot (gh)', cmd: 'gh copilot', icon: '🐙', detect: 'gh copilot --version' },
  { name: 'Claude Code', cmd: 'claude', icon: '🟣', detect: 'claude --version' },
  { name: 'Aider', cmd: 'aider', icon: '🟢', detect: 'aider --version' },
  { name: 'Cursor Agent', cmd: 'cursor', icon: '🔵', detect: 'cursor --version' },
  { name: 'Codex CLI', cmd: 'codex', icon: '⚪', detect: 'codex --version' },
];
```

**Implementation**: This is a thin feature on top of existing session creation:

```javascript
// New endpoint: GET /api/agents
// Returns list of detected AI agents + user-configured ones
app.get('/api/agents', auth, (req, res) => {
  res.json(agentManager.getAvailable());
});

// Creating an AI session is just createSession with a specific command
// POST /api/sessions with { command: "copilot", name: "Copilot Session" }
// Already supported by SessionManager!
```

**Mobile optimization**: When launching an AI agent, the session is automatically named (e.g., "Copilot — Apr 4"), and TermBeam's existing mobile features shine:

- **TouchBar** keys work perfectly for Copilot's TUI (Tab to accept, Esc to cancel, arrows to navigate)
- **Themes** make the AI output beautiful on any screen
- **PWA push notifications** alert you when a long-running agent task finishes
- **Wake Lock** keeps the screen on during agent work
- **Split View** lets you run an AI agent alongside a regular terminal

#### Copilot Resume Support (CSP's Best Feature)

If the user has Copilot sessions in `~/.copilot/session-store.db`, offer a **"Resume Session"** option:

```
┌────────────────────────┐
│  Resume Copilot Session│
│                        │
│  🔵 "Fix auth bug"     │  ← 2 hours ago
│     main branch        │
│                        │
│  🟢 "Add dark mode"    │  ← Yesterday
│     feature/themes     │
│                        │
│  ⚪ "Refactor API"     │  ← 3 days ago
│     main branch        │
│                        │
│  [Start Fresh Instead] │
└────────────────────────┘
```

This launches `copilot --resume=<id>` in a PTY — giving full session continuity.

**Note**: This requires `better-sqlite3` as an optional dependency to read the Copilot session store. It should be opt-in and gracefully degrade if the DB doesn't exist.

---

### Part 2: Quick Terminal Assistant (Complementary)

**Problem**: Sometimes you don't need a full agent session — you just want:

- "What does this error mean?"
- "Give me the command to find files > 100MB"
- "Explain this git output"

Starting a full Copilot session for a one-off question is overkill.

**Solution**: A **lightweight command helper** — not a full chat, but a quick Q&A overlay.

#### How It Differs from Part 1

| Aspect       | Part 1 (Agent Launch)          | Part 2 (Quick Assistant) |
| ------------ | ------------------------------ | ------------------------ |
| **Scope**    | Full agent session             | Single question/answer   |
| **Duration** | Minutes to hours               | Seconds                  |
| **Context**  | Agent reads codebase           | Last N terminal lines    |
| **Tool use** | Agent can edit files           | Read-only suggestions    |
| **UI**       | Full terminal (xterm.js)       | Overlay/modal            |
| **Provider** | Whatever CLI tool user prefers | OpenAI-compatible API    |

#### UX Design

**Activation**: Long-press on an error in the terminal → "Ask AI" context action. Or swipe up on TouchBar → quick input.

```
┌────────────────────────┐
│ ✨ Quick Help           │
│                        │
│ Terminal context:      │
│ ┌────────────────────┐ │
│ │ $ npm run build    │ │  ← Last 10 lines auto-captured
│ │ Error: Cannot find │ │
│ │ module 'express'   │ │
│ └────────────────────┘ │
│                        │
│ 🤖 The module isn't    │
│ installed. Run:        │
│ ┌────────────────────┐ │
│ │ npm install express│ │
│ │            [▶ Run] │ │  ← Injects into terminal
│ └────────────────────┘ │
│                        │
│ [Ask follow-up...]     │
│ [Close]                │
└────────────────────────┘
```

**Key design choices**:

- **NOT a persistent chat** — it's a quick popup, like Spotlight
- **Auto-captures context** — grabs last N lines from xterm scrollback
- **"Run" button** injects command into terminal (without executing — user presses Enter)
- **One provider** — OpenAI-compatible API, configured in `~/.termbeam/ai.json`
- **Completely optional** — zero degradation if not configured

#### Implementation

This is Phase 2 work. It requires:

- A simple streaming proxy in `src/server/chat.js`
- API key storage in `~/.termbeam/ai.json`
- A React overlay component
- 2-3 new WebSocket message types

---

## What We're NOT Building

1. ~~Full multi-provider AI chat UI~~ — The terminal IS the chat UI
2. ~~Copilot SDK integration~~ — SDK chat is strictly worse than Copilot CLI
3. ~~Custom agent framework~~ — Use existing CLI agents (Copilot, Claude, Aider)
4. ~~MCP client~~ — Interesting but too complex for the value-add

---

## Implementation Phases

### Phase 1: Agent Detection & Quick-Launch (Low effort, high impact)

- [ ] `src/server/agents.js` — Detect AI CLIs in PATH, cache results
- [ ] `GET /api/agents` — Return available agents
- [ ] Agent launch menu component (bottom sheet)
- [ ] CommandPalette integration ("Launch Copilot", "Launch Claude", etc.)
- [ ] Auto-naming of AI sessions
- [ ] Docs page (`docs/ai-agents.md`)
- [ ] Tests

### Phase 2: Copilot Resume Integration (Medium effort, high impact for Copilot users)

- [ ] Optional `better-sqlite3` dependency for reading `~/.copilot/session-store.db`
- [ ] `GET /api/agents/copilot/sessions` — List resumable sessions
- [ ] Resume session picker UI
- [ ] Graceful degradation if DB doesn't exist
- [ ] Tests

### Phase 3: Quick Terminal Assistant (Medium effort, complementary)

- [ ] `src/server/chat.js` — Streaming proxy to OpenAI-compatible API
- [ ] `~/.termbeam/ai.json` config
- [ ] Quick Help overlay component
- [ ] Context capture from xterm scrollback
- [ ] "Run" command injection
- [ ] Rate limiting (10 req/min)
- [ ] Tests

---

## Security Considerations

### Agent Launch (Phase 1)

- Only pre-detected CLI tools can be launched (no arbitrary commands from the agent menu)
- Same shell validation as regular sessions
- Auth required (existing token system)

### Copilot Resume (Phase 2)

- Read-only access to `session-store.db`
- No modification of Copilot's data
- Session IDs are not secret (same as Copilot's own model)

### Quick Assistant (Phase 3)

- API keys stored on server only (`~/.termbeam/ai.json`, mode 0600)
- Never sent to browser
- Terminal context is opt-in and visible to user
- Message length capped (10,000 chars)
- Rate limited

---

## Why This Approach Wins

1. **Zero new dependencies for Phase 1** — Just PATH scanning and a new API endpoint
2. **Leverages existing strengths** — TermBeam's mobile terminal UX is already great for AI agents
3. **Provider-agnostic without trying** — User picks their favorite CLI tool
4. **Full feature parity** — Running the actual CLI gives you everything (agent mode, tools, context)
5. **Incremental delivery** — Each phase is independently valuable
6. **Mobile-first by default** — TouchBar, themes, PWA, wake lock all apply to AI sessions automatically
