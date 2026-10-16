const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Load once at startup; only these bytes, never a client-provided path, are served. */
function loadTerminalFont(fontPath) {
  if (!fontPath) return null;
  if (typeof fontPath !== 'string' || path.extname(fontPath).toLowerCase() !== '.woff2') {
    throw new Error('Terminal font must be a local .woff2 file');
  }

  const fd = fs.openSync(path.resolve(fontPath), 'r');
  let data;
  try {
    if (!fs.fstatSync(fd).isFile()) {
      throw new Error('Terminal font must be a regular file');
    }
    data = fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (data.length < 48 || !data.subarray(0, 4).equals(Buffer.from('wOF2'))) {
    throw new Error('Terminal font has an invalid WOFF2 header');
  }

  const revision = crypto.createHash('sha256').update(data).digest('hex');
  return { data, url: `/api/terminal-font/${revision}.woff2` };
}

module.exports = { loadTerminalFont };
