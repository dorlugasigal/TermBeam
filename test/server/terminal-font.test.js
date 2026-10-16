const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTerminalFont } = require('../../src/server/terminal-font');
const { createTermBeamServer } = require('../../src/server');

describe('loadTerminalFont', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-font-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function writeFont(name = '한글 regular.woff2', marker = 0) {
    const data = Buffer.alloc(48, marker);
    data.write('wOF2');
    const file = path.join(dir, name);
    fs.writeFileSync(file, data);
    return { file, data };
  }

  it('does not override the bundled font when no file is configured', () => {
    assert.equal(loadTerminalFont(undefined), null);
    assert.equal(loadTerminalFont(null), null);
  });

  it('loads exact bytes and exposes a content-based URL without the local path', () => {
    const { file, data } = writeFont();
    const font = loadTerminalFont(file);
    assert.deepEqual(font.data, data);
    assert.match(font.url, /^\/api\/terminal-font\/[a-f0-9]{64}\.woff2$/);
    assert.equal(loadTerminalFont(file).url, font.url);
    fs.unlinkSync(file);
    assert.deepEqual(font.data, data, 'serves the startup snapshot even if the file is removed');
  });

  it('changes the URL when the font contents change, and accepts uppercase extensions', () => {
    const a = writeFont('a.woff2', 0);
    const b = writeFont('b.WOFF2', 1);
    assert.notEqual(loadTerminalFont(a.file).url, loadTerminalFont(b.file).url);
  });

  it('rejects non-WOFF2 paths and missing files', () => {
    assert.throws(() => loadTerminalFont('font.ttf'), /local \.woff2/);
    assert.throws(() => loadTerminalFont(42), /local \.woff2/);
    assert.throws(() => loadTerminalFont(path.join(dir, 'missing.woff2')), /ENOENT/);
    const directory = path.join(dir, 'folder.woff2');
    fs.mkdirSync(directory);
    assert.throws(() => loadTerminalFont(directory));
  });

  it('rejects truncated headers and incorrect magic bytes', () => {
    for (const data of [Buffer.from('wOF2'), Buffer.alloc(48), Buffer.alloc(48, 255)]) {
      const file = path.join(dir, 'bad.woff2');
      fs.writeFileSync(file, data);
      assert.throws(() => loadTerminalFont(file), /invalid WOFF2 header/);
    }
  });

  it('rejects a bad configured font before creating the server or auth state', () => {
    const configDir = path.join(dir, 'config');
    assert.throws(
      () =>
        createTermBeamServer({
          config: { font: path.join(dir, 'missing.woff2'), configDir },
        }),
      /ENOENT/,
    );
    assert.equal(fs.existsSync(configDir), false);
  });
});
