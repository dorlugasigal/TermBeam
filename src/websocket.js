const log = require('./logger');

function recalcPtySize(session) {
  let minCols = Infinity;
  let minRows = Infinity;
  for (const client of session.clients) {
    if (client._dims) {
      minCols = Math.min(minCols, client._dims.cols);
      minRows = Math.min(minRows, client._dims.rows);
    }
  }
  if (minCols === Infinity || minRows === Infinity) return;
  if (minCols === session._lastCols && minRows === session._lastRows) return;
  session._lastCols = minCols;
  session._lastRows = minRows;
  session.pty.resize(minCols, minRows);
}

function setupWebSocket(wss, { auth, sessions }) {
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
          if (msg.password === auth.password || auth.validateToken(msg.token)) {
            authenticated = true;
            ws.send(JSON.stringify({ type: 'auth_ok' }));
            log.info('WS: auth success');
          } else {
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
          attached.pty.write(msg.data);
        } else if (msg.type === 'resize') {
          const cols = Math.floor(msg.cols);
          const rows = Math.floor(msg.rows);
          if (cols > 0 && cols <= 500 && rows > 0 && rows <= 200) {
            ws._dims = { cols, rows };
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
      if (attached) {
        attached.clients.delete(ws);
        recalcPtySize(attached);
        log.info('Client detached');
      }
    });
  });
}

module.exports = { setupWebSocket };
