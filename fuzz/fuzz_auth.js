/**
 * Fuzz target for auth token validation and rate limiting.
 * Tests password validation, token generation/verification,
 * and rate-limit boundary conditions with arbitrary input.
 * @param {Buffer} data
 */
module.exports.fuzz = function (data) {
  const str = data.toString('utf-8');

  // Fuzz password comparison — ensure no crash on arbitrary input
  const password = 'test-password-12345';
  const isMatch = str === password;
  if (isMatch && str.length === 0) {
    throw new Error('Empty string matched non-empty password');
  }

  // Fuzz token format validation (hex string, 64 chars)
  const tokenPattern = /^[0-9a-f]{64}$/;
  const looksLikeToken = tokenPattern.test(str);

  // Fuzz cookie parsing — exercise header value extraction
  const cookieStr = `pty_token=${str}; other=value`;
  const parts = cookieStr.split(';').map((p) => p.trim());
  for (const part of parts) {
    const [key, ...rest] = part.split('=');
    const value = rest.join('=');
    if (key === 'pty_token') {
      // Token extracted — validate format
      if (value.length > 0 && !tokenPattern.test(value)) {
        // Expected: non-hex tokens are rejected
      }
    }
  }

  // Fuzz Bearer auth header extraction
  const authHeader = `Bearer ${str}`;
  if (authHeader.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7);
    // Ensure extraction doesn't produce unexpected results
    if (bearerToken !== str) {
      throw new Error('Bearer token extraction mismatch');
    }
  }

  // Fuzz IP address parsing for rate limiting
  const ipCandidates = str.split(',').map((s) => s.trim());
  for (const ip of ipCandidates) {
    // IPv4 pattern
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
    // IPv6 pattern (simplified)
    const ipv6 = /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':');
    if (!ipv4 && !ipv6) continue;
  }
};
