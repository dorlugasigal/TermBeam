const log = require('../utils/logger');

const ACTIVE_THRESHOLD = 60000; // 60 seconds

// OSC color query/response sequences (OSC 4/10/11/12) cause garbled output
// on replay: color queries trigger xterm.js to generate responses that echo
// through the PTY as visible text, accumulating on each refresh.
const OSC_COLOR_RE = /\x1b\](?:4;\d+|10|11|12);[^\x07\x1b]*(?:\x07|\x1b\\)/g;

// Alternate screen buffer sequences (DECSET/DECRST 1049, 1047, 47) cause
// screen wipes on replay: entering alt screen hides the normal buffer content
// and re-entering on replay makes the terminal appear blank/wiped.
// Matched enter+exit pairs are stripped along with their content (the alt
// screen output is no longer relevant after the program exits).
// Unmatched enters/exits are stripped as bare sequences.
const ALT_SCREEN_PAIR_RE = /\x1b\[\?(1049|1047|47)h[\s\S]*?\x1b\[\?\1l/g;
const ALT_SCREEN_BARE_RE = /\x1b\[\?(?:1049|1047|47)[hl]/g;

// Clear-scrollback (ESC[3J) is destructive on replay — it would wipe
// the xterm.js scrollback that the user might want to scroll through.
const CLEAR_SCROLLBACK_RE = /\x1b\[3J/g;

function sanitizeForReplay(buf) {
  buf = buf.replace(OSC_COLOR_RE, '');
  buf = buf.replace(ALT_SCREEN_PAIR_RE, '');
  buf = buf.replace(ALT_SCREEN_BARE_RE, '');
  buf = buf.replace(CLEAR_SCROLLBACK_RE, '');
  return buf;
}

function recalcPtySize(session) {
  const now = Date.now();
  let activeCols = Infinity;
  let activeRows = Infinity;
  let allCols = Infinity;
  let allRows = Infinity;
  let hasActive = false;

  for (const client of session.clients) {
    if (!client._dims) continue;
    allCols = Math.min(allCols, client._dims.cols);
    allRows = Math.min(allRows, client._dims.rows);
    if (client._lastActivity && now - client._lastActivity < ACTIVE_THRESHOLD) {
      activeCols = Math.min(activeCols, client._dims.cols);
      activeRows = Math.min(activeRows, client._dims.rows);
      hasActive = true;
    }
  }

  const minCols = hasActive ? activeCols : allCols;
  const minRows = hasActive ? activeRows : allRows;

  if (minCols === Infinity || minRows === Infinity) return;
  if (minCols === session._lastCols && minRows === session._lastRows) return;
  session._lastCols = minCols;
  session._lastRows = minRows;
  log.debug(`PTY resized to ${minCols}×${minRows}`);
  session.pty.resize(minCols, minRows);
}

function setupWebSocket(wss, { auth, sessions, copilotService }) {
  const wsAuthAttempts = new Map(); // ip -> [timestamps]
  const WS_AUTH_WINDOW = 60 * 1000; // 1 minute
  const WS_MAX_AUTH_ATTEMPTS = 5;

  wss.on('connection', (ws, req) => {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const originHost = new URL(origin).hostname;
        const reqHost = (req.headers.host || '').split(':')[0];
        if (originHost !== reqHost && originHost !== 'localhost' && reqHost !== 'localhost') {
          log.warn(`WS: rejected cross-origin connection from ${origin}`);
          ws.close(1008, 'Origin not allowed');
          return;
        }
      } catch {
        log.warn(`WS: rejected invalid origin: ${origin}`);
        ws.close(1008, 'Invalid origin');
        return;
      }
    }

    const pingInterval = setInterval(() => {
      if (ws.readyState === 1) {
        if (ws._pongPending) {
          // Previous ping never got a pong — connection is dead
          ws.terminate();
          return;
        }
        ws._pongPending = true;
        ws.ping();
      }
    }, 15000);
    if (typeof pingInterval.unref === 'function') pingInterval.unref();

    ws.on('pong', () => {
      ws._pongPending = false;
    });

    let authenticated = !auth.password;
    let attached = null;

    // Check cookie from upgrade request
    if (auth.password) {
      const cookies = auth.parseCookies(req.headers.cookie || '');
      if (cookies.pty_token && auth.validateToken(cookies.pty_token)) {
        authenticated = true;
      }
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === 'auth') {
          const ip = req.socket.remoteAddress;
          const now = Date.now();
          const attempts = (wsAuthAttempts.get(ip) || []).filter((t) => now - t < WS_AUTH_WINDOW);

          if (attempts.length >= WS_MAX_AUTH_ATTEMPTS) {
            log.warn(`WS: rate limit exceeded for ${ip}`);
            ws.send(
              JSON.stringify({ type: 'error', message: 'Too many attempts. Try again later.' }),
            );
            ws.close();
            return;
          }

          if (msg.password === auth.password || auth.validateToken(msg.token)) {
            authenticated = true;
            ws.send(JSON.stringify({ type: 'auth_ok' }));
            log.info('WS: auth success');
          } else {
            attempts.push(now);
            wsAuthAttempts.set(ip, attempts);
            log.warn('WS: auth failed');
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            ws.close();
          }
          return;
        }

        if (!authenticated) {
          ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
          ws.close();
          return;
        }

        if (msg.type === 'attach') {
          const session = sessions.get(msg.sessionId);
          if (!session) {
            ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
            log.warn(`WS: attach failed — session ${msg.sessionId} not found`);
            return;
          }
          ws._lastActivity = Date.now();
          attached = session;
          // First client: defer adding to session.clients until after the
          // first resize so we can decide whether the PTY needs resizing.
          if (!session.hasHadClient) {
            session.hasHadClient = true;
            ws._pendingResize = true;
          } else {
            session.clients.add(ws);
            if (session.scrollbackBuf.length > 0) {
              ws.send(
                JSON.stringify({ type: 'output', data: sanitizeForReplay(session.scrollbackBuf) }),
              );
            }
            // After replaying scrollback (which has alt-screen sequences
            // stripped by sanitizeForReplay), re-enter alt-screen so xterm.js
            // uses the correct buffer before SIGWINCH triggers the app to repaint.
            if (session.inAltScreen) {
              const mode = session.altScreenMode || '1049';
              ws.send(JSON.stringify({ type: 'output', data: `\x1b[?${mode}h` }));
              ws._needsRedraw = true;
            }
          }
          ws.send(JSON.stringify({ type: 'attached', sessionId: msg.sessionId }));
          // Deliver any command-complete notifications that fired while disconnected
          if (session.pendingNotifications.length > 0) {
            for (const n of session.pendingNotifications) {
              ws.send(JSON.stringify({ type: 'notification', ...n }));
            }
            session.pendingNotifications = [];
          }
          log.info(`Client attached to session ${msg.sessionId}`);
          return;
        }

        // Copilot SDK messages
        if (copilotService && msg.type === 'copilot.attach') {
          let sid = msg.sessionId;
          if (!copilotService.sessions.has(sid)) {
            // Session not found in local map — create a fresh one
            try {
              sid = await copilotService.createSession({ model: msg.model });
            } catch (err) {
              ws.send(JSON.stringify({ type: 'copilot.error', data: { message: err.message } }));
              return;
            }
          }
          copilotService.setListener(
            sid,
            (event) => {
              if (ws.readyState === 1) ws.send(JSON.stringify(event));
            },
            ws,
          );
          ws._copilotSessionId = sid;
          const entry = copilotService.sessions.get(sid);
          ws.send(
            JSON.stringify({
              type: 'copilot.created',
              data: { sessionId: sid, model: entry?.model },
            }),
          );
          // Send existing message history for immediate replay on refresh/reconnect
          const messages = copilotService.getMessages(sid);
          if (messages.length > 0) {
            ws.send(JSON.stringify({ type: 'copilot.message_history', data: { messages } }));
          }
          return;
        }

        if (copilotService && msg.type === 'copilot.create') {
          // If this WebSocket already owns a live session, reuse it
          if (ws._copilotSessionId && copilotService.sessions.has(ws._copilotSessionId)) {
            const sid = ws._copilotSessionId;
            copilotService.setListener(
              sid,
              (event) => {
                if (ws.readyState === 1) ws.send(JSON.stringify(event));
              },
              ws,
            );
            ws.send(JSON.stringify({ type: 'copilot.created', data: { sessionId: sid } }));
            return;
          }
          try {
            const sdkSessionId = await copilotService.createSession({
              model: msg.model,
            });
            copilotService.setListener(
              sdkSessionId,
              (event) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify(event));
                }
              },
              ws,
            );
            ws.send(
              JSON.stringify({
                type: 'copilot.created',
                data: { sessionId: sdkSessionId },
              }),
            );
            ws._copilotSessionId = sdkSessionId;
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: 'copilot.error',
                data: { message: err.message },
              }),
            );
          }
          return;
        }

        if (copilotService && msg.type === 'copilot.resume') {
          const sdkSessionId = msg.sdkSessionId;
          if (!sdkSessionId) {
            ws.send(
              JSON.stringify({ type: 'copilot.error', data: { message: 'Missing sdkSessionId' } }),
            );
            return;
          }
          try {
            const sessionId = await copilotService.resumeSession(sdkSessionId, {
              model: msg.model,
            });
            copilotService.setListener(
              sessionId,
              (event) => {
                if (ws.readyState === 1) ws.send(JSON.stringify(event));
              },
              ws,
            );
            ws._copilotSessionId = sessionId;
            ws.send(JSON.stringify({ type: 'copilot.created', data: { sessionId } }));
            // Send existing messages for replay
            const entry = copilotService.sessions.get(sessionId);
            if (entry?.existingMessages?.length) {
              ws.send(
                JSON.stringify({
                  type: 'copilot.message_history',
                  data: { messages: entry.existingMessages },
                }),
              );
            }
          } catch (err) {
            ws.send(JSON.stringify({ type: 'copilot.error', data: { message: err.message } }));
          }
          return;
        }

        if (copilotService && msg.type === 'copilot.send') {
          const sid = ws._copilotSessionId;
          if (!sid) return;
          try {
            await copilotService.sendMessage(sid, msg.prompt);
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: 'copilot.error',
                data: { message: err.message },
              }),
            );
          }
          return;
        }

        if (copilotService && msg.type === 'copilot.input_response') {
          const sid = ws._copilotSessionId;
          if (!sid) return;
          copilotService.respondToInput(sid, msg.answer);
          return;
        }

        if (copilotService && msg.type === 'copilot.get_messages') {
          const sid = ws._copilotSessionId;
          if (!sid) return;
          const messages = copilotService.getMessages(sid);
          ws.send(JSON.stringify({ type: 'copilot.message_history', data: { messages } }));
          return;
        }

        if (copilotService && msg.type === 'copilot.cancel') {
          const sid = ws._copilotSessionId;
          if (sid) await copilotService.abortSession(sid);
          return;
        }

        if (copilotService && msg.type === 'copilot.set_model') {
          const sid = ws._copilotSessionId;
          if (!sid) return;
          try {
            await copilotService.setModel(sid, msg.model);
            ws.send(JSON.stringify({ type: 'copilot.model_changed', data: { model: msg.model } }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'copilot.error', data: { message: err.message } }));
          }
          return;
        }

        if (!attached) return;

        if (msg.type === 'input') {
          ws._lastActivity = Date.now();
          attached.pty.write(msg.data);
        } else if (msg.type === 'resize') {
          const cols = Math.floor(msg.cols);
          const rows = Math.floor(msg.rows);
          log.debug(`Client resize request: ${cols}×${rows}`);
          if (cols > 0 && cols <= 500 && rows > 0 && rows <= 200) {
            ws._dims = { cols, rows };
            ws._lastActivity = Date.now();
            if (ws._pendingResize) {
              ws._pendingResize = false;
              // Only discard scrollback and send SIGWINCH if the PTY was
              // spawned at a different size (e.g. default 120×30).
              // If the PTY already matches (new session sent dims in POST),
              // just add the client and replay scrollback — no SIGWINCH,
              // no duplicate prompt from slow themes like oh-my-posh.
              const sizeChanged = cols !== attached._lastCols || rows !== attached._lastRows;
              if (sizeChanged) {
                attached.scrollbackBuf = '';
                attached.clients.add(ws);
                recalcPtySize(attached);
              } else {
                attached.clients.add(ws);
                if (attached.scrollbackBuf.length > 0) {
                  ws.send(
                    JSON.stringify({
                      type: 'output',
                      data: sanitizeForReplay(attached.scrollbackBuf),
                    }),
                  );
                }
                // After replaying scrollback (which has alt-screen sequences
                // stripped), re-enter alt-screen so xterm.js uses the correct
                // buffer before SIGWINCH triggers the TUI to repaint.
                if (attached.inAltScreen) {
                  const mode = attached.altScreenMode || '1049';
                  ws.send(JSON.stringify({ type: 'output', data: `\x1b[?${mode}h` }));
                  // Force SIGWINCH so the TUI repaints into the alt buffer
                  recalcPtySize(attached);
                  const targetCols = attached._lastCols || cols;
                  const targetRows = attached._lastRows || rows;
                  try {
                    const small = Math.min(500, targetCols === 1 ? 2 : targetCols - 1);
                    attached.pty.resize(small, targetRows);
                    attached._lastCols = small;
                  } catch {
                    // ignore — PTY may have exited
                  }
                  if (attached._resizeBounceTimer) {
                    clearTimeout(attached._resizeBounceTimer);
                  }
                  attached._resizeBounceTimer = setTimeout(() => {
                    attached._resizeBounceTimer = null;
                    try {
                      attached.pty.resize(targetCols, targetRows);
                      attached._lastCols = targetCols;
                    } catch {
                      // ignore — PTY may have exited
                    }
                  }, 50);
                }
              }
            } else {
              if (ws._needsRedraw) {
                ws._needsRedraw = false;
                // Force SIGWINCH so TUI apps (vim, copilot, htop) redraw
                // after client reconnect. The ioctl only fires SIGWINCH when
                // the size actually changes, and standard signals coalesce —
                // so we must delay the restore to ensure the app queries
                // the intermediate size before we resize back.
                recalcPtySize(attached);
                const targetCols = attached._lastCols || cols;
                const targetRows = attached._lastRows || rows;
                try {
                  const small = Math.min(500, targetCols === 1 ? 2 : targetCols - 1);
                  attached.pty.resize(small, targetRows);
                  attached._lastCols = small;
                } catch {
                  // ignore — PTY may have exited
                }
                // Cancel any prior bounce timer to avoid stale restores
                if (attached._resizeBounceTimer) {
                  clearTimeout(attached._resizeBounceTimer);
                }
                attached._resizeBounceTimer = setTimeout(() => {
                  attached._resizeBounceTimer = null;
                  try {
                    attached.pty.resize(targetCols, targetRows);
                    attached._lastCols = targetCols;
                  } catch {
                    // ignore — PTY may have exited
                  }
                }, 50);
              } else {
                // Cancel any pending bounce timer from a prior redraw
                if (attached._resizeBounceTimer) {
                  clearTimeout(attached._resizeBounceTimer);
                  attached._resizeBounceTimer = null;
                }
                recalcPtySize(attached);
              }
            }
          }
        }
      } catch (err) {
        log.warn(`WS: dropped unparseable message: ${err.message}`);
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      if (copilotService && ws._copilotSessionId) {
        // Only clear the listener if this ws owns it — avoids clobbering another client's listener
        const entry = copilotService.sessions.get(ws._copilotSessionId);
        if (entry && entry._listenerOwner === ws) {
          copilotService.setListener(ws._copilotSessionId, null);
        }
      }
      if (attached) {
        if (attached._resizeBounceTimer) {
          clearTimeout(attached._resizeBounceTimer);
          attached._resizeBounceTimer = null;
          // Restore PTY to correct size since the bounce was interrupted
          recalcPtySize(attached);
        }
        attached.clients.delete(ws);
        recalcPtySize(attached);
        log.info('Client detached');
      }
    });
  });
}

module.exports = { setupWebSocket, ACTIVE_THRESHOLD, sanitizeForReplay };
