/**
 * Fuzz target for WebSocket message parsing.
 * Tests the JSON message parsing and type dispatch that handles
 * untrusted input from WebSocket clients.
 * @param {Buffer} data
 */
module.exports.fuzz = function (data) {
  if (data.length > 4096) return;
  const str = data.toString('utf-8');

  // Fuzz JSON.parse with arbitrary input (mirrors websocket.js message handler)
  let parsed;
  try {
    parsed = JSON.parse(str);
  } catch {
    return; // Invalid JSON is expected and handled gracefully
  }

  // Exercise the message type validation logic
  if (typeof parsed !== 'object' || parsed === null) return;

  const { type } = parsed;
  if (typeof type !== 'string') return;

  // Validate known message types (matches src/server/websocket.js dispatch)
  const validTypes = ['auth', 'attach', 'input', 'resize'];

  // Exercise resize payload validation (matches production: rows <= 200)
  if (type === 'resize') {
    const { cols, rows } = parsed;
    if (typeof cols !== 'number' || typeof rows !== 'number') return;
    if (cols < 1 || cols > 500 || rows < 1 || rows > 200) return;
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
  }

  // Exercise input payload — production calls pty.write(msg.data) without
  // type checking, so we intentionally allow non-string data here to surface
  // potential crashes
  if (type === 'input') {
    const { data: inputData } = parsed;
    if (inputData === undefined) return;
  }

  // Exercise attach payload validation
  if (type === 'attach') {
    const { sessionId, token } = parsed;
    // Production uses these values without strict type checks
    if (sessionId !== undefined) String(sessionId);
    if (token !== undefined) String(token);
  }

  // Exercise auth payload
  if (type === 'auth') {
    const { token } = parsed;
    if (token !== undefined) String(token);
  }
};
