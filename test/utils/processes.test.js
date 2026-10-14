'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { toPid, getProcessCwd, getChildPids } = require('../../src/utils/processes');

/** Fake execFile that records calls and answers with `reply(file, args)`. */
function fakeExecFile(reply) {
  const calls = [];
  const execFile = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    let out;
    try {
      out = reply(file, args);
    } catch (err) {
      setImmediate(() => cb(err, ''));
      return;
    }
    setImmediate(() => cb(null, out));
  };
  return { execFile, calls };
}

const neverCalled = () => {
  throw new Error('should not be called');
};

describe('processes', () => {
  describe('toPid', () => {
    it('accepts positive integers and digit-only strings', () => {
      assert.strictEqual(toPid(1), 1);
      assert.strictEqual(toPid(4242), 4242);
      assert.strictEqual(toPid('4242'), 4242);
    });

    it('rejects anything that is not a positive integer', () => {
      for (const bad of [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        2 ** 60,
        '',
        ' 12',
        '12 ',
        '1;rm -rf /',
        '0x10',
        null,
        undefined,
        {},
        [],
      ]) {
        assert.strictEqual(toPid(bad), null, String(bad));
      }
    });
  });

  describe('getProcessCwd', () => {
    it('returns null for an invalid pid without running anything', async () => {
      const opts = { platform: 'darwin', readlink: neverCalled, execFile: neverCalled };
      assert.strictEqual(await getProcessCwd('$(id)', opts), null);
      assert.strictEqual(await getProcessCwd(-5, { ...opts, platform: 'linux' }), null);
    });

    it('reads /proc/<pid>/cwd on Linux', async () => {
      const seen = [];
      const readlink = async (p) => {
        seen.push(p);
        return '/home/me/project';
      };
      const cwd = await getProcessCwd(321, { platform: 'linux', readlink, execFile: neverCalled });
      assert.strictEqual(cwd, '/home/me/project');
      assert.deepStrictEqual(seen, ['/proc/321/cwd']);
    });

    it('returns null when /proc cannot be read (process gone)', async () => {
      const readlink = async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      };
      assert.strictEqual(await getProcessCwd(321, { platform: 'linux', readlink }), null);
    });

    it('asks lsof on macOS with an argument list (no shell) and parses the name field', async () => {
      const { execFile, calls } = fakeExecFile(() => 'p321\nfcwd\nn/Users/me/My Project\n');
      const cwd = await getProcessCwd(321, { platform: 'darwin', execFile });
      assert.strictEqual(cwd, '/Users/me/My Project');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].file, 'lsof');
      assert.deepStrictEqual(calls[0].args, ['-a', '-p', '321', '-d', 'cwd', '-Fn']);
      assert.ok(calls[0].opts.timeout > 0, 'runs with a timeout');
    });

    it('returns null when lsof fails or prints no name field', async () => {
      const failing = fakeExecFile(() => {
        throw new Error('no such process');
      });
      assert.strictEqual(
        await getProcessCwd(321, { platform: 'darwin', execFile: failing.execFile }),
        null,
      );
      const empty = fakeExecFile(() => 'p321\n');
      assert.strictEqual(
        await getProcessCwd(321, { platform: 'darwin', execFile: empty.execFile }),
        null,
      );
    });

    it('returns null on Windows', async () => {
      const opts = { platform: 'win32', readlink: neverCalled, execFile: neverCalled };
      assert.strictEqual(await getProcessCwd(321, opts), null);
    });
  });

  describe('getChildPids', () => {
    const PS_OUTPUT = '    1     0\n   11    10\n   12    10\n   13    11\n  110     1\n';

    it('returns null for an invalid pid or on Windows', async () => {
      const opts = { platform: 'linux', readFile: neverCalled, execFile: neverCalled };
      assert.strictEqual(await getChildPids('10 && reboot', opts), null);
      assert.strictEqual(await getChildPids(10, { ...opts, platform: 'win32' }), null);
    });

    it('reads /proc/<pid>/task/<pid>/children on Linux', async () => {
      const seen = [];
      const readFile = async (p) => {
        seen.push(p);
        return '11 12 ';
      };
      const pids = await getChildPids(10, { platform: 'linux', readFile, execFile: neverCalled });
      assert.deepStrictEqual(pids, ['11', '12']);
      assert.deepStrictEqual(seen, ['/proc/10/task/10/children']);
      assert.deepStrictEqual(
        await getChildPids(10, {
          platform: 'linux',
          readFile: async () => '',
          execFile: neverCalled,
        }),
        [],
      );
    });

    it('falls back to ps when the /proc children file is unavailable', async () => {
      const readFile = async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      };
      const { execFile, calls } = fakeExecFile(() => PS_OUTPUT);
      assert.deepStrictEqual(await getChildPids(10, { platform: 'linux', readFile, execFile }), [
        '11',
        '12',
      ]);
      assert.strictEqual(calls[0].file, 'ps');
      assert.deepStrictEqual(calls[0].args, ['-A', '-o', 'pid=,ppid=']);
    });

    it('uses ps directly on macOS and only keeps direct children', async () => {
      const { execFile } = fakeExecFile(() => PS_OUTPUT);
      const opts = { platform: 'darwin', readFile: neverCalled, execFile };
      assert.deepStrictEqual(await getChildPids(10, opts), ['11', '12']);
      assert.deepStrictEqual(await getChildPids('11', opts), ['13']);
      assert.deepStrictEqual(
        await getChildPids(1, opts),
        ['110'],
        'matches whole ppids, not prefixes',
      );
      assert.deepStrictEqual(await getChildPids(999, opts), []);
    });

    it('returns null when ps is unavailable', async () => {
      const { execFile } = fakeExecFile(() => {
        throw Object.assign(new Error('spawn ps ENOENT'), { code: 'ENOENT' });
      });
      assert.strictEqual(await getChildPids(10, { platform: 'darwin', execFile }), null);
    });
  });

  describe(
    'on this machine',
    { skip: process.platform === 'win32' && 'Windows has no cwd/child lookup' },
    () => {
      it("reads this process's working directory", async () => {
        const cwd = await getProcessCwd(process.pid);
        assert.strictEqual(fs.realpathSync(cwd), fs.realpathSync(process.cwd()));
      });

      it("lists this process's children (an array, possibly empty)", async () => {
        const pids = await getChildPids(process.pid);
        assert.ok(Array.isArray(pids));
        assert.ok(pids.every((pid) => /^\d+$/.test(pid)));
      });
    },
  );
});
