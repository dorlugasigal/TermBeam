const http = require('http');
const express = require('express');
const log = require('./logger');

const PROXY_TIMEOUT = 10_000;

// Rewrite absolute paths in HTML/CSS so they route through the proxy
function rewriteAbsolutePaths(body, prefix, isHtml) {
  if (isHtml) {
    // Rewrite HTML attributes: href="/...", src="/...", action="/...", etc.
    body = body.replace(
      /((?:href|src|action|srcset|poster|data|formaction)\s*=\s*["'])\/(?!\/|preview\/)/gi,
      `$1${prefix}/`,
    );
    // Rewrite meta content URLs: content="/..."
    body = body.replace(/(content\s*=\s*["'])\/(?!\/|preview\/)/gi, `$1${prefix}/`);
  }
  // Rewrite CSS url() references: url("/...") or url('/...') or url(/...)
  body = body.replace(/(url\(\s*["']?)\/(?!\/|preview\/)/gi, `$1${prefix}/`);
  return body;
}

function createPreviewProxy() {
  const router = express.Router();

  function proxyRequest(req, res) {
    const port = Number(req.params.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return res
        .status(400)
        .json({ error: 'Invalid port: must be an integer between 1 and 65535' });
    }

    // Strip /preview/:port prefix, keep the rest (or default to /)
    // Express 5 *path returns an array of segments — join them back
    const segments = req.params.path;
    const forwardPath = segments ? `/${[].concat(segments).join('/')}` : '/';
    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

    const fwdHeaders = { ...req.headers, host: `127.0.0.1:${port}` };
    // Request uncompressed so we can rewrite HTML content
    delete fwdHeaders['accept-encoding'];

    const options = {
      hostname: '127.0.0.1',
      port,
      path: forwardPath + search,
      method: req.method,
      headers: fwdHeaders,
    };

    log.debug(`Preview proxy: ${req.method} ${forwardPath}${search} → 127.0.0.1:${port}`);

    const prefix = `/preview/${port}`;

    const proxyReq = http.request(options, (proxyRes) => {
      const headers = { ...proxyRes.headers };

      // Rewrite Location headers so redirects stay inside the proxy
      if (headers.location) {
        const loc = headers.location;
        if (loc.startsWith('/') && !loc.startsWith(prefix)) {
          headers.location = prefix + loc;
        }
      }

      const contentType = (headers['content-type'] || '').toLowerCase();
      const isHtml = contentType.includes('text/html');
      const isCss = contentType.includes('text/css');

      if (isHtml || isCss) {
        // Buffer response to rewrite absolute paths
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let body = Buffer.concat(chunks).toString();
          body = rewriteAbsolutePaths(body, prefix, isHtml);
          delete headers['content-length'];
          headers['transfer-encoding'] = 'chunked';
          res.writeHead(proxyRes.statusCode, headers);
          res.end(body);
        });
      } else {
        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res);
      }
    });

    proxyReq.setTimeout(PROXY_TIMEOUT, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: 'Gateway timeout: upstream server did not respond in time' });
      }
    });

    proxyReq.on('error', (err) => {
      log.warn(`Preview proxy error (port ${port}): ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Bad gateway: upstream server is not responding' });
      }
    });

    req.pipe(proxyReq);
  }

  router.all('/:port', proxyRequest);
  router.all('/:port/*path', proxyRequest);

  return router;
}

module.exports = { createPreviewProxy };
