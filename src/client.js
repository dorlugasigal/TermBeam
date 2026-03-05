const WebSocket = require('ws');

const DETACH_KEY = '\x02'; // Ctrl+B

/**
 * Create a terminal client that pipes stdin/stdout over WebSocket.
 * Resolves when detached or session exits. Rejects on connection error.
 *
 * @param {object} opts
 * @param {string} opts.url        WebSocket URL (ws://host:port/ws)
 * @param {string} [opts.password] Server password (null for no-auth mode)
 * @param {string} opts.sessionId  Session ID to connect to
 * @param {string} [opts.sessionName] Session name (for display)
 * @param {string} [opts.detachKey] Key to detach (default: Ctrl+B)
 * @returns {Promise<{reason: string}>}
 */
function createTerminalClient({
  url,
  password,
  sessionId,
  sessionName = 'session',
  detachKey = DETACH_KEY,
}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let cleaned = false;
    let bannerTimer = null;
    const detachLabel = 'Ctrl+B';

    function showBanner() {
      if (!cleaned) {
        process.stdout.write(
          `\r\n\x1b[33m  attached: ${sessionName} ─── ${detachLabel} to detach\x1b[0m\r\n\r\n`,
        );
      }
      bannerTimer = null;
    }

    function debounceBanner() {
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(showBanner, 500);
    }

    function cleanup(reason) {
      if (cleaned) return;
      cleaned = true;

      if (bannerTimer) clearTimeout(bannerTimer);

      // Restore terminal title
      process.stdout.write('\x1b]0;\x07');

      if (process.stdin.isTTY && process.stdin.isRaw) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeAllListeners('data');
      process.stdin.pause();
      process.removeAllListeners('SIGWINCH');

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }

      resolve({ reason });
    }

    ws.on('open', () => {
      if (password) {
        ws.send(JSON.stringify({ type: 'auth', password }));
      } else {
        ws.send(JSON.stringify({ type: 'attach', sessionId }));
      }
    });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      if (msg.type === 'auth_ok') {
        ws.send(JSON.stringify({ type: 'attach', sessionId }));
        return;
      }

      if (msg.type === 'attached') {
        // Set terminal title to show we're attached
        process.stdout.write(`\x1b]0;[termbeam] ${sessionName} — ${detachLabel} to detach\x07`);

        enterRawMode(ws, detachKey, cleanup);
        sendResize(ws);
        debounceBanner();
        return;
      }

      if (msg.type === 'output') {
        debounceBanner();
        process.stdout.write(msg.data);
        return;
      }

      if (msg.type === 'exit') {
        cleanup(`session exited with code ${msg.code}`);
        return;
      }

      if (msg.type === 'error') {
        cleanup(`error: ${msg.message}`);
        return;
      }
    });

    ws.on('error', (err) => {
      if (!cleaned) {
        reject(err);
      }
    });

    ws.on('close', () => {
      cleanup('connection closed');
    });
  });
}

function enterRawMode(ws, detachKey, cleanup) {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  process.stdin.on('data', (data) => {
    const str = data.toString();
    if (str === detachKey) {
      cleanup('detached');
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: str }));
    }
  });

  process.on('SIGWINCH', () => sendResize(ws));
}

function sendResize(ws) {
  if (ws.readyState === WebSocket.OPEN && process.stdout.columns && process.stdout.rows) {
    ws.send(
      JSON.stringify({
        type: 'resize',
        cols: process.stdout.columns,
        rows: process.stdout.rows,
      }),
    );
  }
}

module.exports = { createTerminalClient };
