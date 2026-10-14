/**
 * Origin / CSRF validation shared by the HTTP API and the WebSocket server.
 *
 * Behind Microsoft Dev Tunnels the relay rewrites `Host` to `localhost:<port>`
 * (the public host arrives in `X-Forwarded-Host`) and rewrites `Origin` to
 * `http://localhost:<port>` — but ONLY when the page is the tunnel's own
 * origin. Foreign origins, including other `*.devtunnels.ms` pages, pass
 * through untouched. Because `devtunnels.ms` is not on the Public Suffix List,
 * every tunnel is "same-site" with every other tunnel, so SameSite=Strict
 * cookies alone do not stop another tunnel's page from opening an
 * authenticated WebSocket. We therefore require the browser origin to match
 * an authority this server is actually being reached at, and refuse
 * `Sec-Fetch-Site: same-site|cross-site` for API calls and WebSockets.
 */

function isLoopbackAddress(addr) {
  if (!addr || typeof addr !== 'string') return false;
  return addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');
}

function firstHeader(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return '';
  return value.split(',')[0].trim();
}

/**
 * Authorities (host[:port], lowercase) the request says it was sent to: the
 * Host header, plus X-Forwarded-Host when a loopback proxy (the DevTunnel
 * host process) forwards it. No scheme is known for these.
 */
function allowedAuthorities(req) {
  const set = new Set();
  const host = firstHeader(req.headers && req.headers.host).toLowerCase();
  if (host) set.add(host);
  const remote = req.socket && req.socket.remoteAddress;
  if (isLoopbackAddress(remote)) {
    const fwd = firstHeader(req.headers && req.headers['x-forwarded-host']).toLowerCase();
    if (fwd) set.add(fwd);
  }
  return set;
}

/**
 * Full origins (scheme://host[:port]) of the configured public URLs (tunnel
 * URL, --public-url). Compared as whole origins so `https://x` never also
 * trusts `http://x`.
 */
function allowedOrigins(publicUrl) {
  const set = new Set();
  for (const url of [].concat(publicUrl || [])) {
    if (!url) continue;
    try {
      set.add(new URL(url).origin.toLowerCase());
    } catch {
      /* ignore malformed */
    }
  }
  return set;
}

function hostnameOf(authority) {
  if (authority.startsWith('[')) return authority.slice(0, authority.indexOf(']') + 1);
  const idx = authority.lastIndexOf(':');
  return idx === -1 ? authority : authority.slice(0, idx);
}

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443' };

/**
 * Same hostname and the same effective port. A Host header without a port
 * (or with the scheme's default one) means the default port; a different
 * port is a different origin even though cookies are shared across ports.
 */
function matchesAuthority(allowed, url) {
  const hostname = hostnameOf(allowed);
  if (hostname !== url.hostname.toLowerCase()) return false;
  const defaultPort = DEFAULT_PORTS[url.protocol];
  const allowedPort = allowed.slice(hostname.length + 1) || defaultPort;
  return allowedPort === (url.port || defaultPort);
}

/**
 * @returns {{ ok: boolean, reason?: 'invalid' | 'mismatch' | 'cross-site' }}
 */
function checkOrigin(req, { publicUrl } = {}) {
  const site = firstHeader(req.headers && req.headers['sec-fetch-site']).toLowerCase();
  if (site === 'cross-site' || site === 'same-site') return { ok: false, reason: 'cross-site' };

  const origin = req.headers && req.headers.origin;
  // Browsers always send Origin on WebSocket handshakes and cross-origin
  // requests; non-browser clients (termbeam resume, curl) carry no ambient
  // cookies, so a missing Origin is not a CSRF vector.
  if (origin === undefined || origin === '') return { ok: true };
  let url;
  try {
    url = new URL(origin);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'invalid' };

  if (allowedOrigins(publicUrl).has(url.origin.toLowerCase())) return { ok: true };
  for (const a of allowedAuthorities(req)) {
    if (matchesAuthority(a, url)) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}

const BLOCK_LOG_INTERVAL_MS = 60_000;

/**
 * Express middleware: blocks cross-site API calls (all methods) and
 * state-changing requests from foreign origins. `getPublicUrl` may return a
 * URL or a list of URLs (tunnel URL, --public-url) that are also trusted.
 */
function createCsrfGuard(getPublicUrl = () => null, { log } = {}) {
  const lastLogged = new Map();
  return function csrfGuard(req, res, next) {
    const isApi = req.path.startsWith('/api/');
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (!isApi && !unsafe) return next();
    const site = firstHeader(req.headers['sec-fetch-site']).toLowerCase();
    if (!unsafe && site !== 'cross-site' && site !== 'same-site') return next();
    const result = checkOrigin(req, { publicUrl: getPublicUrl() });
    if (result.ok) return next();
    if (log) {
      // A legitimate reverse proxy that rewrites Host looks exactly like this;
      // say how to fix it — once a minute per origin, not per request.
      const origin = String(req.headers.origin || '');
      const now = Date.now();
      if (now - (lastLogged.get(origin) || 0) > BLOCK_LOG_INTERVAL_MS) {
        lastLogged.set(origin, now);
        if (lastLogged.size > 100) lastLogged.delete(lastLogged.keys().next().value);
        log.warn(
          `Blocked ${req.method} ${req.path} from origin ${origin || '(none)'} (Host: ${req.headers.host || '-'}, reason: ${result.reason}). ` +
            'If this is your own reverse proxy, forward the Host header (nginx: proxy_set_header Host $host;), ' +
            'send X-Forwarded-Host, or start TermBeam with --public-url <its https address>.',
        );
      }
    }
    res.status(403).json({ error: 'Cross-site request blocked', reason: result.reason });
  };
}

module.exports = {
  checkOrigin,
  createCsrfGuard,
  isLoopbackAddress,
  allowedAuthorities,
  allowedOrigins,
};
