const { describe, it } = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const { describeFailure, runCommand } = require('../../src/utils/update-commands');

const failure = (fields) => Object.assign(new Error('Command failed'), fields);

describe('update-commands', () => {
  describe('describeFailure', () => {
    it('names the missing tarball and the mirror for an npm 404', () => {
      const stderr = [
        'npm error code E404',
        'npm error 404 Not Found - GET https://packagefeedproxy.microsoft.io/npm/prettier/-/prettier-3.9.10.tgz - Cannot find the file prettier-3.9.10.tgz in package',
        'npm error 404',
        "npm error 404  The requested resource 'prettier@https://packagefeedproxy.microsoft.io/npm/prettier/-/prettier-3.9.10.tgz' could not be found",
        'npm error A complete log of this run can be found in: /tmp/x.log',
      ].join('\n');
      assert.strictEqual(
        describeFailure('npm install', failure({ code: 1, stderr })),
        "npm install failed: prettier-3.9.10.tgz isn't available from packagefeedproxy.microsoft.io (E404). Registry mirrors can lag behind npmjs.org; try again later.",
      );
    });

    it('leaves out the mirror hint when the registry is npmjs.org', () => {
      const stderr =
        'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/nope/-/nope-1.0.0.tgz';
      assert.strictEqual(
        describeFailure('npm install', failure({ code: 1, stderr })),
        "npm install failed: nope-1.0.0.tgz isn't available from registry.npmjs.org (E404).",
      );
    });

    it('names a package the registry does not know', () => {
      const stderr = [
        'npm error code E404',
        'npm error 404 Not Found - GET https://registry.npmjs.org/no-such-pkg - Not found',
        "npm error 404  'no-such-pkg@*' is not in this registry.",
      ].join('\n');
      assert.strictEqual(
        describeFailure('npm install', failure({ code: 1, stderr })),
        "npm install failed: no-such-pkg@* isn't available from registry.npmjs.org (E404).",
      );
    });

    it('names the spec npm could not match', () => {
      const stderr =
        'npm error code ETARGET\nnpm error notarget No matching version found for express@9.9.9.';
      assert.strictEqual(
        describeFailure('npm install', failure({ code: 1, stderr })),
        "npm install failed: express@9.9.9 isn't available (ETARGET).",
      );
    });

    it('explains auth and network failures', () => {
      const auth = 'npm error code E401\nnpm error Unable to authenticate, your token is invalid.';
      assert.strictEqual(
        describeFailure('npm install', failure({ code: 1, stderr: auth })),
        'npm install failed: the npm registry refused the request (E401). Check your npm login for it.',
      );
      const network = [
        'npm error code ENOTFOUND',
        'npm error syscall getaddrinfo',
        'npm error network request to https://npm.example.com/express failed',
      ].join('\n');
      assert.strictEqual(
        describeFailure('npm install', failure({ code: 1, stderr: network })),
        "npm install failed: couldn't reach npm.example.com (ENOTFOUND).",
      );
    });

    it('turns git refusals into a next step', () => {
      const diverged = failure({
        code: 128,
        stderr:
          "hint: Diverging branches can't be fast-forwarded.\nfatal: Not possible to fast-forward, aborting.",
      });
      assert.strictEqual(
        describeFailure('git pull', diverged, { kind: 'git' }),
        'git pull failed: Not possible to fast-forward, aborting. Local commits block a fast-forward; update this checkout by hand.',
      );
      const dirty = failure({
        code: 1,
        stderr:
          'error: Your local changes to the following files would be overwritten by merge:\n\tpackage-lock.json\nAborting',
      });
      assert.strictEqual(
        describeFailure('git pull', dirty, { kind: 'git' }),
        'git pull failed: Your local changes to the following files would be overwritten by merge. Commit or stash local changes, then retry.',
      );
      const untracked = failure({
        code: 1,
        stderr:
          'There is no tracking information for the current branch.\nPlease specify which branch.',
      });
      assert.strictEqual(
        describeFailure('git pull', untracked, { kind: 'git' }),
        'git pull failed: There is no tracking information for the current branch. Check out a branch that tracks a remote (such as main), then retry.',
      );
    });

    it('reports the first compiler error of a failed build', () => {
      const err = failure({
        code: 2,
        stdout:
          "src/App.tsx(12,3): error TS2322: Type 'string' is not assignable to type 'number'.",
        stderr: 'npm error Lifecycle script `build` failed with error:\nnpm error code 2',
      });
      assert.strictEqual(
        describeFailure('Web app build', err, { kind: 'build' }),
        "Web app build failed: src/App.tsx(12,3): error TS2322: Type 'string' is not assignable to type 'number'.",
      );
    });

    it('covers missing commands, timeouts, unknown output and long messages', () => {
      assert.strictEqual(
        describeFailure('Web app build', failure({ code: 'ENOENT', path: 'npm' })),
        "Web app build failed: npm isn't installed or isn't on PATH.",
      );
      assert.strictEqual(
        describeFailure('npm install', failure({ killed: true, signal: 'SIGTERM' }), {
          timeoutMs: 600_000,
        }),
        'npm install failed: timed out after 10 min.',
      );
      assert.strictEqual(
        describeFailure('Installing the update', new Error('NETWORK ERROR')),
        'Installing the update failed: NETWORK ERROR.',
      );
      const long = describeFailure('npm install', new Error('x'.repeat(500)));
      assert.strictEqual(long.length, 300);
      assert.ok(long.endsWith('…'));
    });
  });

  describe('runCommand', () => {
    it('runs the command directly and passes its output through', async (t) => {
      const calls = [];
      t.mock.method(cp, 'execFile', (file, args, opts, cb) => {
        calls.push({ file, args, shell: opts.shell, cwd: opts.cwd });
        cb(null, 'out', 'err');
      });
      const result = await runCommand('npm', ['ls', '--json'], { cwd: '/repo' });
      assert.deepStrictEqual(result, { stdout: 'out', stderr: 'err' });
      if (process.platform !== 'win32') {
        assert.deepStrictEqual(calls, [
          { file: 'npm', args: ['ls', '--json'], shell: false, cwd: '/repo' },
        ]);
      }
    });

    it('attaches stdout and stderr to failures', async (t) => {
      t.mock.method(cp, 'execFile', (file, args, opts, cb) =>
        cb(Object.assign(new Error('boom'), { code: 1 }), 'partial', 'npm error code E404'),
      );
      await assert.rejects(runCommand('npm', ['install']), (err) => {
        assert.strictEqual(err.stdout, 'partial');
        assert.strictEqual(err.stderr, 'npm error code E404');
        return true;
      });
    });

    it('starts package-manager shims through the shell on Windows', async (t) => {
      const platform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });
      delete require.cache[require.resolve('../../src/utils/update-commands')];
      try {
        const { runCommand: runOnWindows } = require('../../src/utils/update-commands');
        const calls = [];
        t.mock.method(cp, 'execFile', (file, args, opts, cb) => {
          calls.push({ file, args, shell: opts.shell });
          cb(null, '', '');
        });
        await runOnWindows('npm', ['install', '--no-save']);
        await runOnWindows('git', ['pull', '--ff-only']);
        await runOnWindows('C:\\Program Files\\nodejs\\node.exe', ['-v']);
        assert.deepStrictEqual(calls, [
          { file: 'npm install --no-save', args: [], shell: true },
          { file: 'git', args: ['pull', '--ff-only'], shell: false },
          { file: 'C:\\Program Files\\nodejs\\node.exe', args: ['-v'], shell: false },
        ]);
      } finally {
        Object.defineProperty(process, 'platform', platform);
        delete require.cache[require.resolve('../../src/utils/update-commands')];
      }
    });
  });
});
