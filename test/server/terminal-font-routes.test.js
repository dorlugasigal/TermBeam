const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { createAuth } = require('../../src/server/auth');
const { setupRoutes } = require('../../src/server/routes');
const { loadTerminalFont } = require('../../src/server/terminal-font');

describe('custom terminal font routes', () => {
  let dir, auth, server, base, terminalFont, cookie;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-font-routes-'));
    const data = Buffer.alloc(48);
    data.write('wOF2');
    const file = path.join(dir, 'private-local-name.woff2');
    fs.writeFileSync(file, data);
    terminalFont = loadTerminalFont(file);
    auth = createAuth('test-password', { configDir: dir });
    const { token } = auth.createSession({ method: 'password', remember: true });
    cookie = `${auth.cookieName}=${token}`;
    const app = express();
    app.use(cookieParser());
    setupRoutes(app, {
      auth,
      sessions: {},
      config: { disableRateLimit: true },
      state: {},
      terminalFont,
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    auth?.cleanup();
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exposes the font URL without disclosing its filesystem path', async () => {
    const res = await fetch(`${base}/api/config`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      passwordRequired: true,
      terminalFontUrl: terminalFont.url,
    });
    assert.equal(terminalFont.url.includes('private-local-name'), false);
  });

  it('requires authentication for font data', async () => {
    const res = await fetch(`${base}${terminalFont.url}`);
    assert.equal(res.status, 401);
  });

  it('serves only the configured font bytes with a WOFF2 type and private caching', async () => {
    const res = await fetch(`${base}${terminalFont.url}?file=/another/file.woff2`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^font\/woff2/);
    assert.equal(res.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), terminalFont.data);
  });

  it('rejects unknown revisions', async () => {
    const res = await fetch(`${base}/api/terminal-font/unknown.woff2`, {
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 404);
  });
});
