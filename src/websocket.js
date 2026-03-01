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
          session.clients.add(ws);
          if (session.scrollbackBuf.length > 0) {
            ws.send(JSON.stringify({ type: 'output', data: session.scrollbackBuf }));
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
            recalcPtySize(attached);
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
