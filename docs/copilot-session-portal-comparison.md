# Copilot Session Portal vs TermBeam — Detailed Comparison

> **Prepared**: April 2026
> **Perspective**: TermBeam (mobile-first terminal-over-HTTP tool)
> **Goal**: Identify similarities, differences, and actionable takeaways from [copilot-session-portal](https://github.com/vinodata_microsoft/copilot-session-portal)

---

## Executive Summary

**Copilot Session Portal (CSP)** is a self-hosted web portal for remote access to GitHub Copilot CLI sessions. It reads the Copilot CLI's local SQLite database (`~/.copilot/session-store.db`) to provide a dashboard for browsing session history, launching persistent terminal sessions, and interacting with the Copilot SDK — all from any device.

**TermBeam** is a mobile-first CLI tool that exposes any local PTY over HTTP + WebSocket with an optimized browser UI, built-in tunneling, PWA support, and a rich feature set for on-the-go terminal access.

Both projects solve a similar core problem — **remote terminal access from mobile devices** — but approach it from very different angles. CSP is Copilot-specific with session intelligence; TermBeam is a general-purpose, production-hardened terminal tool.

### Verdict at a Glance

| Dimension                | Winner          | Why                                                                           |
| ------------------------ | --------------- | ----------------------------------------------------------------------------- |
| **Mobile UX**            | **TermBeam** ✅ | PWA, wake lock, visualViewport, swipe gestures, 24+ themes, orientation-aware |
| **Session Intelligence** | **CSP** ✅      | SQLite history, checkpoints, file tracking, git refs, FTS5 search             |
| **Security**             | **TermBeam** ✅ | Rate limiting (3-tier), auth tokens, CORS, WebSocket origin validation        |
| **Testing**              | **TermBeam** ✅ | 575+ tests vs ~150 lines; E2E with Playwright; 92% coverage threshold         |
| **AI Integration**       | **CSP** ✅      | Native Copilot SDK chat with streaming, model selection                       |
| **Production Readiness** | **TermBeam** ✅ | PM2 service, auto-updates, health endpoints, cross-platform CI                |
| **Developer Velocity**   | **CSP** ✅      | No build step, single vanilla JS file, zero-config auto-discovery             |

---

## 1. Architecture Comparison

### Tech Stack

| Component       | TermBeam                                         | Copilot Session Portal                       |
| --------------- | ------------------------------------------------ | -------------------------------------------- |
| **Runtime**     | Node.js 20+                                      | Node.js 20+                                  |
| **Language**    | JS (CommonJS backend), TS (React frontend)       | Vanilla JS (no transpilation)                |
| **Backend**     | Express                                          | Express 5.2                                  |
| **Frontend**    | React SPA (Vite + TypeScript)                    | Vanilla JS SPA (no framework)                |
| **State Mgmt**  | Zustand                                          | Global variables + DOM                       |
| **Styling**     | CSS Modules + CSS variables                      | Single CSS file + CSS variables              |
| **Terminal**    | xterm.js (npm bundled)                           | xterm.js 5.5 (CDN)                           |
| **PTY**         | node-pty                                         | node-pty 1.1                                 |
| **Database**    | None                                             | better-sqlite3 (read-only)                   |
| **Test Runner** | Node.js built-in (`node:test`)                   | Vitest 4.1 + Supertest                       |
| **E2E**         | Playwright                                       | None                                         |
| **Build**       | Vite (frontend)                                  | None (no build step)                         |
| **CI/CD**       | GitHub Actions (Ubuntu + Windows, Node 20/22/24) | GitHub Actions (manual trigger, Ubuntu only) |
| **Tunnel**      | Microsoft DevTunnels (integrated)                | Microsoft DevTunnels (scripted)              |
| **Package**     | npm (published)                                  | Local clone only                             |

### Backend Structure

**TermBeam** (~2,400 lines):

```
src/server/   → index.js (orchestrator), routes.js, auth.js, sessions.js, websocket.js, preview.js, push.js
src/cli/      → index.js, client.js, resume.js, service.js, interactive.js, prompts.js
src/utils/    → logger.js, shells.js, git.js, version.js, update-check.js, update-executor.js
src/tunnel/   → index.js, install.js
```

**CSP** (~864 lines):

```
src/          → server.js (14 lines), app.js (70 lines)
src/lib/      → config.js, db.js, pty-manager.js
src/routes/   → sessions.js, files.js, search.js, ptys.js, chat.js
src/ws/       → updates.js, terminal.js, chat.js
src/middleware/ → security.js
```

**Key Difference**: TermBeam has 3× more backend code because it handles auth, service management, tunneling, git APIs, file operations, push notifications, and in-app updates. CSP is lean because it delegates auth to DevTunnel and reads an existing database.

### Frontend Structure

**TermBeam** — ~60 React components:

```
src/frontend/src/
  components/  → CommandPalette, FolderBrowser, LoginPage, Modals, Overlays,
                 SearchBar, SessionsHub, SidePanel, TabBar, TerminalApp,
                 TerminalPane, TouchBar, common/ (TopBar, ThemePicker, UpdateBanner)
  hooks/       → useAuth, useWebSocket, useTerminal, useWakeLock, etc.
  stores/      → Zustand stores for sessions, terminal, UI state
  services/    → api.ts (fetchWithTimeout, auth validation)
  sw.ts        → Service Worker (Workbox, NetworkFirst + CacheFirst strategies)
```

**CSP** — Single-file SPA:

```
public/
  index.html   → Semantic HTML shell (8.1 KB)
  app.js       → All client logic (1,033 lines, 42.5 KB)
  styles.css   → All styling (971 lines, 28.4 KB)
```

**Key Difference**: TermBeam uses a modern React architecture with component isolation, typed props, hooks, and Zustand state management. CSP uses vanilla JS with global state and DOM manipulation — simpler but harder to maintain at scale.

---

## 2. Mobile-First Comparison (Critical)

Both projects claim mobile support, but their depth differs significantly.

### Mobile Feature Matrix

| Mobile Feature             | TermBeam                                               | CSP                                        | Notes                                     |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------ | ----------------------------------------- |
| **PWA / Installable**      | ✅ manifest + SW + precache                            | ❌ None                                    | TermBeam installs to home screen          |
| **Service Worker**         | ✅ Workbox (NetworkFirst nav, CacheFirst assets)       | ❌                                         | Offline shell, fast reload                |
| **Push Notifications**     | ✅ Web Push + VAPID                                    | ❌                                         | Session events push to phone              |
| **Wake Lock**              | ✅ Screen Wake Lock API                                | ❌                                         | Prevents screen sleep during terminal use |
| **visualViewport API**     | ✅ Accurate keyboard height                            | ❌                                         | Proper layout when virtual keyboard opens |
| **Touch Bar**              | ✅ Custom (Esc, Tab, Ctrl, arrows, swipe)              | ✅ Similar (Esc, Tab, Ctrl, arrows, pipes) | Both good                                 |
| **Swipe Gestures**         | ✅ 10px threshold (TouchBar), 40px (mic-lock)          | ❌ None                                    | TermBeam has gesture navigation           |
| **Orientation Handling**   | ✅ Recalculates on orientation change                  | ❌                                         | TermBeam resizes terminal properly        |
| **Safe Area (notch)**      | ⚠️ Not explicit                                        | ❌                                         | Neither handles `env(safe-area-inset-*)`  |
| **Pinch Zoom**             | ✅ Allowed                                             | ✅ Allowed                                 | Both support                              |
| **Min Touch Target**       | ✅ 44px (WCAG AAA)                                     | ✅ 40-44px                                 | Both good                                 |
| **Responsive Breakpoints** | ✅ Multiple (CSS modules)                              | ✅ 900px, 600px                            | Both responsive                           |
| **Themes**                 | ✅ 24+ themes (dark/light)                             | ✅ Dark/Light toggle                       | TermBeam far richer                       |
| **Modifier Encoding**      | ✅ Correct Ctrl+Shift+Arrow sequences                  | ✅ Basic Ctrl modifier                     | TermBeam more accurate                    |
| **Connection Resilience**  | ✅ connectionLost banner, re-auth on visibility change | ✅ Exponential backoff reconnect           | TermBeam more robust                      |

### Where CSP Does Something Better for Mobile

1. **Terminal Bell → Browser Notification + Audio**
   - CSP plays an 880Hz synthesized beep via Web Audio API when a terminal bell (`\x07`) fires, and triggers a browser notification
   - TermBeam has push notifications but not terminal-bell-triggered audio

2. **Larger Terminal Pane on Mobile**
   - CSP gives 60vh to the terminal on mobile (vs 45vh on desktop)
   - Simple but effective — more terminal real estate on small screens

3. **Session List Compaction**
   - CSP hides session IDs and reduces metadata gap on phones
   - Clean progressive disclosure pattern

### Where TermBeam Is Significantly Better for Mobile

1. **PWA is the biggest gap in CSP** — TermBeam can be installed on the home screen, works offline (shell), and preaches assets. CSP is just a website.

2. **Wake Lock** — Without this, the phone screen turns off during long terminal sessions. Critical for mobile use.

3. **visualViewport API** — TermBeam correctly handles virtual keyboard appearance/disappearance, resizing the terminal pane. CSP relies on browser defaults.

4. **Push Notifications** — TermBeam can notify you when a long-running command finishes, even if the phone is locked.

---

## 3. Session Management Comparison

| Feature             | TermBeam                                   | CSP                                                      |
| ------------------- | ------------------------------------------ | -------------------------------------------------------- |
| **Session Source**  | node-pty processes (runtime)               | SQLite database (history)                                |
| **Named Sessions**  | ✅ `termbeam resume [name]`                | ❌ Sessions identified by UUID                           |
| **Session History** | ❌ No persistent history                   | ✅ Full conversation history (turns, files, checkpoints) |
| **Multi-Session**   | ✅ Tabs + Split View                       | ✅ Multi-tab terminals                                   |
| **Session Search**  | ❌                                         | ✅ FTS5 full-text search across all sessions             |
| **Session Stats**   | ❌                                         | ✅ Dashboard aggregates (total sessions, turns, files)   |
| **Checkpoints**     | ❌                                         | ✅ Structured progress markers with markdown             |
| **Git Refs**        | ✅ Session-level git status/diff/blame/log | ✅ Commits/PRs/issues linked to sessions                 |
| **File Tracking**   | ✅ File browser + upload/download          | ✅ Files touched by session (create/edit)                |
| **PTY Persistence** | ✅ Survives browser disconnect             | ✅ Survives browser disconnect                           |
| **Auto-Cleanup**    | ✅ onExit callback                         | ✅ 2s delayed cleanup after exit                         |

### 🎯 Actionable: What TermBeam Could Adopt

**Session History/Intelligence is CSP's killer feature.** TermBeam could benefit from:

1. **Optional session recording** — Persist terminal output to a local SQLite or JSON log. Users could browse past sessions, search output, and resume context.

2. **Session metadata enrichment** — CSP tracks which files were created/edited, git refs produced, and checkpoint milestones. TermBeam already has git APIs — extending this to session-level tracking would add significant value.

3. **Dashboard stats** — A lightweight stats endpoint (`/api/stats`) showing session count, uptime, and activity would enhance the SessionsHub.

---

## 4. Authentication & Security Comparison

| Security Feature        | TermBeam                                                | CSP                                         |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------- |
| **Auth Mechanism**      | Password + token cookies                                | None (relies on tunnel AAD)                 |
| **Rate Limiting**       | ✅ 3-tier (auth: 5/min, WS, API)                        | ❌ None                                     |
| **CORS**                | ✅ WebSocket origin validation                          | ❌ Relies on SOP                            |
| **Security Headers**    | ✅ X-Frame-Options, CSP, no-store, nosniff, no-referrer | ✅ X-Frame-Options, nosniff, XSS-Protection |
| **Shell Validation**    | ✅ Only detected shells accepted                        | ⚠️ Accepts arbitrary commands               |
| **Path Validation**     | ✅ File operations validated                            | ✅ Path allowlist (`isAllowedPath()`)       |
| **Request Size Limit**  | ✅ Via Express defaults                                 | ✅ 100KB JSON limit                         |
| **CSRF Protection**     | ⚠️ SOP-based                                            | ❌ None                                     |
| **Audit Logging**       | ⚠️ Structured logger                                    | ❌ None                                     |
| **WebSocket Ping/Pong** | ✅ 15s heartbeat                                        | ❌ No heartbeat                             |

**Verdict**: TermBeam is significantly more secure. CSP's "no auth" design is fine for localhost+tunnel but would be dangerous if the server were exposed directly.

### 🎯 Actionable: CSP's Path Allowlist Pattern

CSP's `isAllowedPath()` middleware is a clean pattern worth noting:

```javascript
// CSP validates every file read against session CWDs
function isAllowedPath(requestedPath) {
  return allowedDirs.some((dir) => requestedPath.startsWith(dir));
}
```

TermBeam already validates shell paths but could apply similar allowlist logic more consistently across file APIs.

---

## 5. Real-Time Communication Comparison

| Feature              | TermBeam                                               | CSP                                                            |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| **Protocol**         | Single WS endpoint (`/ws`) with JSON message types     | Three separate WS servers (data, terminal, chat)               |
| **Message Types**    | `attach`, `input`, `resize`, `output`, `exit`, `error` | `terminal:input/output/resize/exit`, `session:turns`, `chat:*` |
| **Multi-Client PTY** | ✅ Broadcast to all connected clients                  | ✅ Broadcast model                                             |
| **Heartbeat**        | ✅ 15s ping, terminate on missed pong                  | ❌ None                                                        |
| **Reconnection**     | ✅ Scrollback replay on reconnect                      | ✅ Scrollback replay on reconnect                              |
| **Live Updates**     | ✅ Real-time terminal output                           | ✅ 3s polling for session turns + real-time terminal           |

### 🎯 Actionable: CSP's Multi-Channel WebSocket Architecture

CSP uses **three separate WebSocket upgrade paths** (`/ws`, `/ws/terminal`, `/ws/chat`), each with its own handler. This is a clean separation of concerns vs. TermBeam's single multiplexed endpoint.

**Consideration**: TermBeam's single-endpoint approach is simpler and has less overhead, but CSP's pattern would be useful if TermBeam ever adds non-terminal real-time features (like a chat overlay or live file watching).

---

## 6. Unique CSP Features Worth Studying

### 6.1 Copilot SDK Chat Integration

CSP integrates `@github/copilot-sdk` to provide a **streaming chat overlay** within the portal:

- Users can chat with Copilot models (Claude, GPT, etc.) directly
- Responses stream via WebSocket delta messages
- Chat sessions are persistent and manageable via REST API
- Tool access auto-approval (`--allow-all`)

**Relevance to TermBeam**: Not directly applicable (TermBeam is terminal-agnostic), but the streaming chat UI pattern could inspire a "command assistant" feature.

### 6.2 Session Checkpoints & File Tracking

CSP reads Copilot's checkpoint data:

- `checkpoint_number`, `title`, `overview`, `work_done`, `technical_details`, `important_files`, `next_steps`
- Files are tracked with `tool_name` (create/edit) and `turn_index`

**Relevance to TermBeam**: TermBeam could implement a lightweight checkpointing system — save terminal snapshots at user-defined points, annotated with notes.

### 6.3 Full-Text Search (FTS5)

CSP uses SQLite FTS5 for searching across all session content:

```sql
SELECT content, session_id FROM search_index WHERE search_index MATCH 'query'
```

**Relevance to TermBeam**: If TermBeam adds session recording, FTS5 search over recorded output would be a powerful discovery feature.

### 6.4 Active Session Detection

CSP detects which sessions have active state directories (`~/.copilot/session-state/`) and highlights them in the dashboard.

**Relevance to TermBeam**: TermBeam already tracks active sessions in memory. This pattern could enhance `termbeam list` with richer status information.

### 6.5 Terminal Bell → Audio + Notification

CSP synthesizes an 880Hz beep via Web Audio API on terminal bell and triggers a browser notification. Clever mobile UX.

**Relevance to TermBeam**: TermBeam has push notifications but could add terminal-bell-triggered audio as a nice touch, especially for mobile users waiting for command completion.

---

## 7. Where CSP Does Something Better Than TermBeam

| Area                       | What CSP Does Better                                                                 | Impact                                   | Difficulty to Adopt                                 |
| -------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------- |
| **Session Intelligence**   | Queries Copilot's SQLite for rich session history, turns, checkpoints, file tracking | High — users can browse/search past work | Medium (needs recording layer)                      |
| **Zero-Config**            | Auto-discovers Copilot CLI, session DB, paths — no config file needed                | Medium — frictionless onboarding         | Low (TermBeam already has good defaults)            |
| **Terminal Bell Audio**    | Web Audio API beep on `\x07` + browser notification                                  | Low — nice mobile touch                  | Low                                                 |
| **Live Turn Streaming**    | Polls DB for new conversation turns, broadcasts with LIVE badge                      | Medium — monitor active sessions         | Medium                                              |
| **Semantic HTML**          | Uses `<header>`, `<main>`, `<aside>`, `<button>` throughout                          | Low — better a11y baseline               | Low (TermBeam uses React which naturally does this) |
| **No Build Step**          | Vanilla JS served directly — edit and refresh                                        | Low — faster dev iteration               | N/A (TermBeam's Vite is fast enough)                |
| **Single-File Simplicity** | 1,033 lines of app.js covers everything                                              | Low — easier to understand               | N/A (doesn't scale)                                 |

---

## 8. Where TermBeam Is Clearly Superior

| Area                     | TermBeam Advantage                                              | Why It Matters                          |
| ------------------------ | --------------------------------------------------------------- | --------------------------------------- |
| **PWA**                  | Full PWA with manifest, service worker, precache, push          | Installable, offline shell, native-like |
| **Testing**              | 575+ tests, Playwright E2E, 92% coverage                        | Reliable, maintainable, CI-gated        |
| **Security**             | 3-tier rate limiting, auth tokens, origin validation, heartbeat | Safe to expose on LAN/internet          |
| **Themes**               | 24+ terminal themes (Dracula, Nord, Catppuccin, etc.)           | Personalization, accessibility          |
| **CLI Tools**            | `resume`, `list`, `service install/status/logs`                 | Power user workflow                     |
| **Split View**           | Vertical/horizontal terminal split                              | Multi-task on large screens             |
| **Command Palette**      | Fuzzy search actions                                            | Keyboard-driven power UX                |
| **In-App Updates**       | Detect + auto-update from npm                                   | Stay current without manual work        |
| **Git Integration**      | Session-scoped diff, blame, log, status                         | Developer context                       |
| **File Operations**      | Upload, download, folder browser, markdown preview              | Full file management                    |
| **Cross-Platform CI**    | Ubuntu + Windows, Node 20/22/24                                 | Tested across environments              |
| **Documentation**        | MkDocs site with 10+ pages, auto-deployed                       | Professional docs                       |
| **Preview Proxy**        | Forward to local services with path rewriting                   | Access local apps via tunnel            |
| **Wake Lock**            | Screen stays on during terminal sessions                        | Critical for mobile                     |
| **Orientation Handling** | Recalculates layout on rotation                                 | Polished mobile experience              |

---

## 9. Recommendations — What to Take From CSP

### Priority 1: High Impact, Low Effort

1. **Terminal Bell Audio Feedback**
   - Add Web Audio API beep on terminal bell character (`\x07`)
   - Small change in the terminal component, big UX win on mobile
   - CSP does: `new AudioContext().createOscillator()` at 880Hz for 150ms

2. **Larger Terminal on Mobile Breakpoint**
   - CSP gives 60vh on mobile vs 45vh on desktop
   - TermBeam could adopt similar progressive height allocation
   - Quick CSS change

3. **Safe Area Support**
   - Neither project handles notch/Dynamic Island
   - Add `env(safe-area-inset-*)` padding — TermBeam should do this first as mobile-first leader

### Priority 2: Medium Impact, Medium Effort

4. **Session Recording (Optional)**
   - Add opt-in terminal output recording to SQLite or JSONL
   - Enable search over past session output
   - Would unlock CSP-like session intelligence without Copilot dependency
   - Could integrate with existing git tracking for rich session context

5. **Dashboard Stats Endpoint**
   - Add `GET /api/stats` returning session count, uptime, active connections
   - Useful for the SessionsHub component and monitoring
   - Lightweight addition

6. **Session Activity Indicators**
   - CSP's "LIVE" badge on active sessions is a good UX pattern
   - TermBeam's SessionsHub could show real-time activity indicators

### Priority 3: Consider for Future

7. **Multi-Client PTY Read-Only Mode**
   - CSP allows multiple browsers to view the same PTY output (broadcast)
   - TermBeam already broadcasts but could formalize a "viewer" vs "controller" mode
   - Useful for pair programming or demos

8. **Streaming Chat Overlay** (if AI features are ever desired)
   - CSP's chat WebSocket pattern is a clean reference implementation
   - Could power a "command helper" or "AI terminal assistant" feature

---

## 10. Anti-Patterns to Avoid from CSP

| CSP Pattern                   | Why to Avoid                          | TermBeam's Better Approach               |
| ----------------------------- | ------------------------------------- | ---------------------------------------- |
| **No application auth**       | Dangerous if server exposed           | Password + token cookies + rate limiting |
| **Global JS state**           | Unmaintainable at scale               | Zustand stores with React                |
| **Single 1,033-line app.js**  | No component isolation                | 60+ React components                     |
| **CDN-loaded libraries**      | Fragile (CDN outages), no offline     | npm-bundled via Vite                     |
| **No heartbeat on WebSocket** | Zombie connections accumulate         | 15s ping/pong + timeout                  |
| **Polling for live data**     | 3s polling adds latency + server load | Real-time WebSocket push                 |
| **No CI automation**          | Manual trigger only                   | Auto-run on push, multi-OS               |
| **No rate limiting**          | DoS vulnerability                     | 3-tier rate limiting                     |
| **No PWA**                    | Can't install on phone                | Full PWA with service worker             |
| **setTimeout cleanup**        | Missed on crash                       | onExit callback + cleanup                |

---

## 11. Summary Matrix

| Category                 | TermBeam   | CSP        | Winner   |
| ------------------------ | ---------- | ---------- | -------- |
| **Mobile-First UX**      | ⭐⭐⭐⭐⭐ | ⭐⭐⭐     | TermBeam |
| **PWA / Installability** | ⭐⭐⭐⭐⭐ | ⭐         | TermBeam |
| **Session Intelligence** | ⭐⭐       | ⭐⭐⭐⭐⭐ | CSP      |
| **AI Integration**       | ⭐         | ⭐⭐⭐⭐⭐ | CSP      |
| **Security**             | ⭐⭐⭐⭐⭐ | ⭐⭐       | TermBeam |
| **Testing**              | ⭐⭐⭐⭐⭐ | ⭐⭐       | TermBeam |
| **Terminal Features**    | ⭐⭐⭐⭐⭐ | ⭐⭐⭐     | TermBeam |
| **Theming**              | ⭐⭐⭐⭐⭐ | ⭐⭐⭐     | TermBeam |
| **CLI Tooling**          | ⭐⭐⭐⭐⭐ | ⭐         | TermBeam |
| **Documentation**        | ⭐⭐⭐⭐⭐ | ⭐⭐⭐     | TermBeam |
| **Simplicity / DX**      | ⭐⭐⭐     | ⭐⭐⭐⭐⭐ | CSP      |
| **Zero-Config Setup**    | ⭐⭐⭐     | ⭐⭐⭐⭐⭐ | CSP      |
| **Full-Text Search**     | ⭐         | ⭐⭐⭐⭐⭐ | CSP      |
| **Production Readiness** | ⭐⭐⭐⭐⭐ | ⭐⭐       | TermBeam |

---

## 12. Conclusion

**TermBeam is the more mature, feature-rich, and production-ready tool.** It excels at what matters most for a mobile-first terminal tool: PWA support, wake lock, visualViewport handling, push notifications, themes, security, and testing.

**CSP's strength is session intelligence** — the ability to browse, search, and enrich terminal session history. This is a feature category TermBeam doesn't address yet, and it's the most valuable concept to borrow.

### Top 3 Takeaways

1. **Add optional session recording** — This unlocks CSP's best feature (session browsing/search) in TermBeam's architecture
2. **Add terminal bell audio** — Quick win for mobile UX
3. **Add safe area CSS support** — Neither does it, TermBeam should lead as mobile-first

TermBeam should **not** adopt CSP's architectural choices (vanilla JS, no auth, no PWA, no testing) — these are areas where TermBeam is already significantly ahead.
