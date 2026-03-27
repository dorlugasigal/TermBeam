/**
 * Fuzz target for WebSocket message parsing.
 * Tests the JSON message parsing and type dispatch that handles
 * untrusted input from WebSocket clients.
 * @param {Buffer} data
 */
module.exports.fuzz = function (data) {
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

  // Validate known message types (same dispatch as websocket.js)
  const validTypes = ['attach', 'input', 'resize', 'detach', 'ping'];
  if (!validTypes.includes(type)) return;

  // Exercise resize payload validation
  if (type === 'resize') {
    const { cols, rows } = parsed;
    if (typeof cols !== 'number' || typeof rows !== 'number') return;
    if (cols < 1 || cols > 500 || rows < 1 || rows > 500) return;
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
  }

  // Exercise input payload validation
  if (type === 'input') {
    const { data: inputData } = parsed;
    if (typeof inputData !== 'string') return;
    if (inputData.length > 1024 * 1024) return; // 1MB limit
  }

  // Exercise attach payload validation
  if (type === 'attach') {
    const { sessionId, token } = parsed;
    if (sessionId !== undefined && typeof sessionId !== 'string') return;
    if (token !== undefined && typeof token !== 'string') return;
  }
};
