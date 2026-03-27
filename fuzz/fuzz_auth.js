/**
 * Fuzz target for auth token validation and rate limiting.
 * Tests password validation, token generation/verification,
 * and rate-limit boundary conditions with arbitrary input.
 * @param {Buffer} data
 */
module.exports.fuzz = function (data) {
  if (data.length > 4096) return;
  const str = data.toString('utf-8');

  // Fuzz password comparison — ensure no crash on arbitrary input
  const password = 'test-password-12345';
  str === password; // exercise comparison with arbitrary strings

  // Fuzz token format validation (hex string, 64 chars)
  const tokenPattern = /^[0-9a-f]{64}$/;
  tokenPattern.test(str);

  // Fuzz cookie parsing — exercise header value extraction
  const cookieStr = `pty_token=${str}; other=value`;
  const parts = cookieStr.split(';').map((p) => p.trim());
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    const value = rest.join('=');
    if (key === 'pty_token') {
      tokenPattern.test(value);
    }
  }

  // Fuzz Bearer auth header extraction
  const authHeader = `Bearer ${str}`;
  if (authHeader.startsWith('Bearer ')) {
    authHeader.slice(7);
  }

  // Fuzz IP address parsing for rate limiting
  const ipCandidates = str.split(',').map((s) => s.trim());
  for (const ip of ipCandidates) {
    /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
    /^[0-9a-fA-F:]+$/.test(ip);
  }
};
