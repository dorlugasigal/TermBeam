const log = require('./logger');

const ACTIVE_THRESHOLD = 60000; // 60 seconds

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
  session.pty.resize(minCols, minRows);
}

function setupWebSocket(wss, { auth, sessions }) {
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
      if (ws.readyState === 1) ws.ping();
    }, 30000);
    if (typeof pingInterval.unref === 'function') pingInterval.unref();

    let authenticated = !auth.password;
    let attached = null;

    // Check cookie from upgrade request
    if (auth.password) {
      const cookies = auth.parseCookies(req.headers.cookie || '');
      if (cookies.pty_token && auth.validateToken(cookies.pty_token)) {
        authenticated = true;
      }
    }

    ws.on('message', (raw) => {
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
              ws.send(JSON.stringify({ type: 'output', data: session.scrollbackBuf }));
            }
          }
          ws.send(JSON.stringify({ type: 'attached', sessionId: msg.sessionId }));
          log.info(`Client attached to session ${msg.sessionId}`);
          return;
        }

        if (!attached) return;

        if (msg.type === 'input') {
          ws._lastActivity = Date.now();
          attached.pty.write(msg.data);
        } else if (msg.type === 'resize') {
          const cols = Math.floor(msg.cols);
          const rows = Math.floor(msg.rows);
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
                  ws.send(JSON.stringify({ type: 'output', data: attached.scrollbackBuf }));
                }
              }
            } else {
              recalcPtySize(attached);
            }
          }
        }
      } catch (err) {
        log.warn(`WS: dropped unparseable message: ${err.message}`);
      }
    });

    ws.on('close', () => {
      clearInterval(pingInterval);
      if (attached) {
        attached.clients.delete(ws);
        recalcPtySize(attached);
        log.info('Client detached');
      }
    });
  });
}

module.exports = { setupWebSocket, ACTIVE_THRESHOLD };
