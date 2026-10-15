const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  updateSourceCheckout,
  installedMatchesLockfile,
  installedTreeIsValid,
} = require('../../src/utils/source-update');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

/** A checkout whose lockfiles pin `lock` and whose node_modules hold `installed`. */
function makeCheckout(dir, { root = {}, frontend = {} } = {}) {
  const project = (base, { lock = {}, installed = {} }) => {
    writeJson(path.join(base, 'package-lock.json'), {
      lockfileVersion: 3,
      packages: { '': { name: 'x' }, ...lock },
    });
    for (const [name, version] of Object.entries(installed)) {
      writeJson(path.join(base, 'node_modules', name, 'package.json'), { name, version });
    }
  };
  writeJson(path.join(dir, 'package.json'), { name: 'termbeam', version: '1.1.0' });
  project(dir, root);
  project(path.join(dir, 'src', 'frontend'), frontend);
}

const LOCK = {
  'node_modules/express': { version: '5.3.0' },
  'node_modules/prettier': { version: '3.9.10', dev: true },
  'node_modules/fsevents': { version: '2.3.3', optional: true },
};

/**
 * Mock execFile. `npm` maps an npm subcommand (install, ls, run) to a reply:
 * a stdout string, or an error object with stdout/stderr.
 */
function mockCommands(t, { npm = {}, git = {} } = {}) {
  const calls = [];
  let head = 0;
  t.mock.method(cp, 'execFile', (file, args, opts, cb) => {
    calls.push({ file, args: [...args], cwd: opts.cwd });
    const reply = file === 'git' ? git[args[0]] : file === 'npm' ? npm[args[0]] : undefined;
    if (reply && typeof reply === 'object') {
      return cb(Object.assign(new Error('Command failed'), reply), reply.stdout, reply.stderr);
    }
    if (file === 'git' && args[0] === 'rev-parse') {
      head++;
      return cb(null, `${head === 1 ? 'a' : 'b'}`.repeat(40) + '\n', '');
    }
    cb(null, reply ?? '', '');
  });
  return calls;
}

describe('source-update', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'termbeam-source-update-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('installedMatchesLockfile', () => {
    it('ignores dev and optional packages unless dev is asked for', () => {
      makeCheckout(dir, {
        root: { lock: LOCK, installed: { express: '5.3.0', prettier: '3.9.9' } },
      });
      assert.strictEqual(installedMatchesLockfile(dir, { includeDev: false }), true);
      assert.strictEqual(installedMatchesLockfile(dir, { includeDev: true }), false);
    });

    it('reports drifted or missing packages', () => {
      makeCheckout(dir, { root: { lock: LOCK, installed: { express: '5.2.1' } } });
      assert.strictEqual(installedMatchesLockfile(dir, { includeDev: false }), false);
      fs.rmSync(path.join(dir, 'node_modules'), { recursive: true });
      assert.strictEqual(installedMatchesLockfile(dir, { includeDev: false }), false);
    });

    it('treats an unreadable lockfile as out of date', () => {
      assert.strictEqual(installedMatchesLockfile(dir, { includeDev: false }), false);
      fs.writeFileSync(path.join(dir, 'package-lock.json'), '{"lockfileVersion":1}');
      assert.strictEqual(installedMatchesLockfile(dir, { includeDev: false }), false);
    });
  });

  describe('installedTreeIsValid', () => {
    it('only fails on missing or invalid packages', async (t) => {
      const problems = (list) => JSON.stringify({ problems: list });
      mockCommands(t, { npm: { ls: problems(['extraneous: left-pad@1.0.0 /x']) } });
      assert.strictEqual(await installedTreeIsValid(dir, { includeDev: false }), true);
    });

    it('reads the report npm ls prints when it exits with problems', async (t) => {
      const stdout = JSON.stringify({
        problems: ['invalid: express@4.0.0 /x/node_modules/express'],
      });
      const calls = mockCommands(t, { npm: { ls: { code: 1, stdout, stderr: '' } } });
      assert.strictEqual(await installedTreeIsValid(dir, { includeDev: false }), false);
      assert.deepStrictEqual(calls[0].args, ['ls', '--all', '--json', '--omit=dev']);
    });

    it('fails closed when npm ls output is unusable', async (t) => {
      mockCommands(t, { npm: { ls: { code: 'ENOENT', path: 'npm' } } });
      assert.strictEqual(await installedTreeIsValid(dir, { includeDev: true }), false);
    });
  });

  describe('updateSourceCheckout', () => {
    it('only pulls and rebuilds when dependencies already match', async (t) => {
      makeCheckout(dir, {
        root: { lock: LOCK, installed: { express: '5.3.0', prettier: '3.9.9' } },
        frontend: {
          lock: { 'node_modules/vite': { version: '7.1.0', dev: true } },
          installed: { vite: '7.1.0' },
        },
      });
      const calls = mockCommands(t);
      const phases = [];
      const result = await updateSourceCheckout({ cwd: dir, onPhase: (p) => phases.push(p) });

      const frontend = path.join(dir, 'src', 'frontend');
      assert.deepStrictEqual(
        calls.map((c) => [c.file, c.args.join(' '), c.cwd]),
        [
          ['git', 'rev-parse HEAD', dir],
          ['git', 'pull --ff-only', dir],
          ['git', 'rev-parse HEAD', dir],
          ['npm', 'run build', frontend],
        ],
      );
      assert.deepStrictEqual(phases, ['Pulling the latest code...', 'Building the web app...']);
      assert.deepStrictEqual(result, { from: 'a'.repeat(40), to: 'b'.repeat(40), warnings: [] });
    });

    it('installs where the lockfile moved, without rewriting it', async (t) => {
      makeCheckout(dir, {
        root: { lock: LOCK, installed: { express: '5.2.1' } },
        frontend: {
          lock: { 'node_modules/vite': { version: '7.1.0', dev: true } },
          installed: { vite: '7.0.0' },
        },
      });
      const calls = mockCommands(t);
      const phases = [];
      await updateSourceCheckout({ cwd: dir, onPhase: (p) => phases.push(p) });

      const installs = calls.filter((c) => c.args[0] === 'install');
      assert.deepStrictEqual(
        installs.map((c) => [c.args.join(' '), c.cwd]),
        [
          ['install --no-save --no-audit --no-fund', dir],
          ['install --no-save --no-audit --no-fund', path.join(dir, 'src', 'frontend')],
        ],
      );
      assert.deepStrictEqual(phases, [
        'Pulling the latest code...',
        'Installing dependencies...',
        'Installing web app dependencies...',
        'Building the web app...',
      ]);
    });

    it('keeps going on the installed packages when the registry lags', async (t) => {
      makeCheckout(dir, { root: { lock: LOCK, installed: { express: '5.2.1' } } });
      const stderr =
        'npm error code E404\nnpm error 404 Not Found - GET https://mirror.example.com/npm/prettier/-/prettier-3.9.10.tgz';
      const calls = mockCommands(t, {
        npm: { install: { code: 1, stderr, stdout: '' }, ls: JSON.stringify({ problems: [] }) },
      });
      const result = await updateSourceCheckout({ cwd: dir });

      assert.deepStrictEqual(result.warnings, [
        "npm install: prettier-3.9.10.tgz isn't available from mirror.example.com (E404). Registry mirrors can lag behind npmjs.org; try again later.",
      ]);
      assert.ok(
        calls.some((c) => c.args.join(' ') === 'run build'),
        'still builds the web app',
      );
    });

    it('stops when the installed packages no longer satisfy the new version', async (t) => {
      makeCheckout(dir, { root: { lock: LOCK, installed: { express: '5.2.1' } } });
      const stdout = JSON.stringify({
        problems: ['invalid: express@5.2.1 /x/node_modules/express'],
      });
      const calls = mockCommands(t, {
        npm: {
          install: {
            code: 1,
            stderr:
              'npm error code ETARGET\nnpm error notarget No matching version found for express@5.3.0.',
            stdout: '',
          },
          ls: { code: 1, stdout, stderr: '' },
        },
      });
      await assert.rejects(updateSourceCheckout({ cwd: dir }), {
        message: "npm install: express@5.3.0 isn't available (ETARGET).",
      });
      assert.ok(!calls.some((c) => c.args.join(' ') === 'run build'), 'does not build');
    });

    it('explains a pull that cannot fast-forward', async (t) => {
      makeCheckout(dir);
      mockCommands(t, {
        git: {
          pull: { code: 128, stderr: 'fatal: Not possible to fast-forward, aborting.', stdout: '' },
        },
      });
      await assert.rejects(updateSourceCheckout({ cwd: dir }), {
        message:
          'git pull: Not possible to fast-forward, aborting. Local commits block a fast-forward; update this checkout by hand.',
      });
    });

    it('reports the first compiler error when the web app does not build', async (t) => {
      makeCheckout(dir);
      mockCommands(t, {
        npm: {
          run: {
            code: 2,
            stdout: 'src/App.tsx(1,1): error TS1005: ";" expected.',
            stderr: 'npm error code 2',
          },
        },
      });
      await assert.rejects(updateSourceCheckout({ cwd: dir }), {
        message: 'web app build: src/App.tsx(1,1): error TS1005: ";" expected.',
      });
    });
  });
});
