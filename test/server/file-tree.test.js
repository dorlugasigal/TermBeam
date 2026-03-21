const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { createTermBeamServer } = require('../../src/server');

async function safeCleanup(dir) {
  if (!dir) return;
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: Buffer.concat(chunks).toString(),
        }),
      );
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const baseConfig = {
  port: 0,
  host: '127.0.0.1',
  password: 'test-pass',
  useTunnel: false,
  persistedTunnel: false,
  shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  shellArgs: [],
  defaultShell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
  version: '0.1.0-test',
  logLevel: 'error',
};

describe('GET /api/sessions/:id/file-tree', () => {
  let inst, tmpDir, port, defaultId, cookieHeader;

  after(async () => {
    inst?.shutdown();
    await safeCleanup(tmpDir);
  });

  async function setup() {
    if (inst) return;

    // Build a known fixture tree:
    //   alpha/          (directory)
    //     nested.txt
    //     deep/         (directory)
    //       inner.txt
    //   beta.txt        (file, 11 bytes)
    //   gamma.txt       (file, 5 bytes)
    //   .hidden         (hidden file — should be filtered)
    //   .secret/        (hidden dir — should be filtered)
    //     private.txt
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-ftree-'));

    const alphaDir = path.join(tmpDir, 'alpha');
    const deepDir = path.join(alphaDir, 'deep');
    const secretDir = path.join(tmpDir, '.secret');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.mkdirSync(secretDir, { recursive: true });

    fs.writeFileSync(path.join(alphaDir, 'nested.txt'), 'nested');
    fs.writeFileSync(path.join(deepDir, 'inner.txt'), 'inner');
    fs.writeFileSync(path.join(tmpDir, 'beta.txt'), 'hello world'); // 11 bytes
    fs.writeFileSync(path.join(tmpDir, 'gamma.txt'), 'abcde'); // 5 bytes
    fs.writeFileSync(path.join(tmpDir, '.hidden'), 'hidden');
    fs.writeFileSync(path.join(secretDir, 'private.txt'), 'secret');

    const tb = createTermBeamServer({
      config: { ...baseConfig, cwd: tmpDir },
    });
    const result = await tb.start();
    inst = tb;
    port = tb.server.address().port;
    defaultId = result.defaultId;

    // Login to get auth cookie
    const loginBody = JSON.stringify({ password: 'test-pass' });
    const loginRes = await httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/auth',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(loginBody),
        },
      },
      loginBody,
    );
    assert.equal(loginRes.statusCode, 200, 'Login should succeed');
    const setCookie = loginRes.headers['set-cookie'] || [];
    cookieHeader = setCookie.map((c) => c.split(';')[0]).join('; ');
  }

  function get(urlPath) {
    return httpRequest({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'GET',
      headers: { Cookie: cookieHeader },
    });
  }

  function getNoAuth(urlPath) {
    return httpRequest({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method: 'GET',
    });
  }

  it('returns tree structure with root and tree array', async () => {
    await setup();
    const res = await get(`/api/sessions/${defaultId}/file-tree`);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.data);
    assert.ok(body.root, 'response should have root');
    assert.ok(Array.isArray(body.tree), 'response should have tree array');
    assert.ok(body.tree.length > 0, 'tree should not be empty');

    // Every entry should have name, type, path
    for (const entry of body.tree) {
      assert.ok(entry.name, 'entry should have name');
      assert.ok(['file', 'directory'].includes(entry.type), 'type should be file or directory');
      assert.ok(typeof entry.path === 'string', 'entry should have path string');
    }
  });

  it('filters hidden files and directories', async () => {
    await setup();
    const res = await get(`/api/sessions/${defaultId}/file-tree`);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.data);

    function collectNames(entries) {
      const names = [];
      for (const e of entries) {
        names.push(e.name);
        if (e.children) names.push(...collectNames(e.children));
      }
      return names;
    }

    const allNames = collectNames(body.tree);
    for (const name of allNames) {
      assert.ok(!name.startsWith('.'), `hidden entry "${name}" should be filtered out`);
    }
    // Specifically verify our fixtures are excluded
    assert.ok(!allNames.includes('.hidden'), '.hidden file should be filtered');
    assert.ok(!allNames.includes('.secret'), '.secret dir should be filtered');
  });

  it('respects depth parameter', async () => {
    await setup();
    const res = await get(`/api/sessions/${defaultId}/file-tree?depth=1`);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.data);

    // At depth=1, directories should have empty children arrays
    const alphaEntry = body.tree.find((e) => e.name === 'alpha');
    assert.ok(alphaEntry, 'alpha directory should be present');
    assert.deepStrictEqual(alphaEntry.children, [], 'depth=1 should not recurse into children');
  });

  it('returns 404 for invalid session', async () => {
    await setup();
    const res = await get('/api/sessions/nonexistent-session-id/file-tree');
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.data);
    assert.ok(body.error, 'response should have error field');
  });

  it('requires authentication', async () => {
    await setup();
    const res = await getNoAuth(`/api/sessions/${defaultId}/file-tree`);
    assert.equal(res.statusCode, 401);
  });

  it('directories have children array', async () => {
    await setup();
    const res = await get(`/api/sessions/${defaultId}/file-tree`);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.data);

    const dirs = body.tree.filter((e) => e.type === 'directory');
    assert.ok(dirs.length > 0, 'should have at least one directory');
    for (const dir of dirs) {
      assert.ok(Array.isArray(dir.children), `directory "${dir.name}" should have children array`);
    }
  });

  it('files have numeric size field', async () => {
    await setup();
    const res = await get(`/api/sessions/${defaultId}/file-tree`);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.data);

    const files = body.tree.filter((e) => e.type === 'file');
    assert.ok(files.length > 0, 'should have at least one file');
    for (const file of files) {
      assert.equal(typeof file.size, 'number', `file "${file.name}" should have numeric size`);
    }

    // Verify known fixture sizes
    const beta = files.find((f) => f.name === 'beta.txt');
    assert.ok(beta, 'beta.txt should be present');
    assert.equal(beta.size, 11, 'beta.txt should be 11 bytes');
  });

  it('entries are sorted: directories first, then alphabetically', async () => {
    await setup();
    const res = await get(`/api/sessions/${defaultId}/file-tree`);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.data);

    // Root level should be: alpha (dir), beta.txt (file), gamma.txt (file)
    const names = body.tree.map((e) => e.name);
    const types = body.tree.map((e) => e.type);

    // All directories should come before all files
    const lastDirIdx = types.lastIndexOf('directory');
    const firstFileIdx = types.indexOf('file');
    if (lastDirIdx !== -1 && firstFileIdx !== -1) {
      assert.ok(lastDirIdx < firstFileIdx, 'directories should come before files');
    }

    // Within each group, entries should be alphabetically sorted
    const dirNames = body.tree.filter((e) => e.type === 'directory').map((e) => e.name);
    const fileNames = body.tree.filter((e) => e.type === 'file').map((e) => e.name);
    assert.deepStrictEqual(
      dirNames,
      [...dirNames].sort(),
      'directories should be alphabetically sorted',
    );
    assert.deepStrictEqual(
      fileNames,
      [...fileNames].sort(),
      'files should be alphabetically sorted',
    );
  });
});
