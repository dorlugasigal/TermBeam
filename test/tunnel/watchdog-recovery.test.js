'use strict';

/**
 * Tunnel watchdog recovery paths, driven through the swappable process
 * helpers (`_internal.setRunner` / `_internal.setSpawner`) — no real
 * devtunnel CLI is ever executed.
 *
 * Isolation: every test resets the shared module state in afterEach. The
 * tunnelId is cleared BEFORE cleanupTunnel() so it never runs
 * `devtunnel delete`, and `persisted` stays false so recovery never writes
 * ~/.termbeam/tunnel.json.
 */
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const dns = require('dns');
const childProcess = require('child_process');

// Safety net: src/tunnel captures execFileSync at load time (`devtunnel
// delete`, `taskkill`, …). Hand it a recorder that refuses to run anything.
const blockedExecs = [];
const realExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = (cmd, args = []) => {
  blockedExecs.push([cmd, ...args].join(' '));
  throw new Error(`execFileSync blocked in tests: ${cmd}`);
};
const tunnel = require('../../src/tunnel');
childProcess.execFileSync = realExecFileSync;
const { cleanupTunnel, tunnelEvents, _internal } = tunnel;
const {
  state,
  classifyError,
  parseHostConnections,
  checkTunnelHealth,
  hostTunnel,
  recoverGoneTunnel,
  onSystemResume,
  constants,
  setRunner,
  setSpawner,
} = _internal;

const OLD_ID = 'happy-ocean-5rshhtb.uks1';
const OLD_URL = 'https://happy-ocean-5rshhtb-3456.uks1.devtunnels.ms';
const NEW_ID = 'brave-river-9x2kq7p.uks1';
const NEW_URL = 'https://brave-river-9x2kq7p-3456.uks1.devtunnels.ms';
const GONE_MSG = 'Tunnel not found in uks1: happy-ocean-5rshhtb';
const EXPIRED_MSG =
  '{"type":"https://tools.ietf.org/html/rfc9110#section-15.5.5","title":"Tunnel Expiration","status":404,"detail":"Cannot get tunnel, tunnel is expired"}';
const CLI_BANNER = 'Welcome to dev tunnels!\nCLI version: 1.0.2030+fc9273aa0f\n\n';

const realLookup = dns.lookup;

const EVENT_NAMES = [
  'connected',
  'disconnected',
  'reconnecting',
  'failed',
  'auth-expired',
  'auth-restored',
  'network-lost',
  'network-restored',
  'relay-lost',
  'relay-restored',
  'recreated',
  'url-changed',
  'resumed',
];

// --- Fakes --------------------------------------------------------------------

const ok = (stdout = '') => ({ ok: true, code: 0, stdout, stderr: '', error: '' });
const fail = (stderr, stdout = '') => ({
  ok: false,
  code: 1,
  stdout,
  stderr,
  error: `Command failed: devtunnel\n${stderr}`,
});
const showJson = (hostConnections, id = OLD_ID) =>
  ok(`${CLI_BANNER}${JSON.stringify({ tunnel: { tunnelId: id, hostConnections } }, null, 2)}\n`);
const LOGGED_IN = ok('Logged in as dev@example.com using Microsoft.\nToken lifetime: 5:00:00\n');

/** Default CLI behaviour; `overrides(args)` may return a result to short-circuit. */
function installRunner(overrides = () => undefined) {
  const calls = [];
  setRunner((args, opts) => {
    calls.push(args);
    const custom = overrides(args, opts);
    if (custom !== undefined) return Promise.resolve(custom);
    const [cmd, sub] = args;
    if (cmd === 'user' && sub === 'show') return Promise.resolve(LOGGED_IN);
    if (cmd === 'show') return Promise.resolve(showJson(1, args[1]));
    if (cmd === 'create') {
      return Promise.resolve(
        ok(`${CLI_BANNER}${JSON.stringify({ tunnel: { tunnelId: NEW_ID } })}`),
      );
    }
    return Promise.resolve(ok());
  });
  return calls;
}

function createFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  // Never a real pid: on Windows killHostProc() would `taskkill` it.
  proc.pid = undefined;
  proc.killed = false;
  proc.kill = (signal) => {
    proc.killed = true;
    proc.killSignal = signal;
    return true;
  };
  return proc;
}

/** `onSpawn(proc, args)` can script the fake `devtunnel host` process. */
function installSpawner(onSpawn) {
  const spawned = [];
  setSpawner((args) => {
    const proc = createFakeProc();
    proc.args = args;
    spawned.push(proc);
    if (onSpawn) onSpawn(proc, args);
    return proc;
  });
  return spawned;
}

const printsUrl = (url) => (proc) =>
  setImmediate(() =>
    proc.stdout.emit('data', Buffer.from(`Hosting port: 3456\nConnect via browser: ${url}\n`)),
  );

function stubDns(reachable) {
  const lookups = [];
  dns.lookup = (host, cb) => {
    lookups.push(host);
    setImmediate(() =>
      reachable ? cb(null, '20.0.0.1', 4) : cb(new Error(`getaddrinfo ENOTFOUND ${host}`)),
    );
  };
  return lookups;
}

function seed(overrides = {}) {
  const proc = createFakeProc();
  Object.assign(state, {
    tunnelId: OLD_ID,
    port: 3456,
    persisted: false,
    anonymous: false,
    stopped: false,
    url: OLD_URL,
    hostProc: proc,
    hostOutput: '',
    consecutiveFailures: 0,
    restartAttempts: 0,
    restarting: false,
    waitingForAuth: false,
    waitingForNetwork: false,
    recovering: false,
    checking: false,
    lastRecreateAt: 0,
    lastRecoveryExtendAt: 0,
    // Keep the "while healthy" side jobs quiet unless a test opts in
    lastExtendAt: Date.now(),
    loginInfoAt: Date.now(),
    ...overrides,
  });
  return proc;
}

function recordEvents() {
  const events = [];
  for (const name of EVENT_NAMES) tunnelEvents.on(name, (payload) => events.push([name, payload]));
  return events;
}

const names = (events) => events.map(([n]) => n);

async function waitFor(predicate, label = 'condition') {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((r) => setImmediate(r));
  }
  assert.fail(`timed out waiting for ${label}`);
}

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

/** Stop all watchdog timers and restore pristine module state. */
function resetTunnelState() {
  state.tunnelId = null; // never let cleanupTunnel() run `devtunnel delete`
  cleanupTunnel();
  Object.assign(state, {
    port: null,
    persisted: false,
    anonymous: false,
    hostProc: null,
    hostOutput: '',
    lastRecreateAt: 0,
    lastRecoveryExtendAt: 0,
    lastExtendAt: 0,
    loginInfo: null,
    loginInfoAt: 0,
    waitingForAuth: false,
    waitingForNetwork: false,
    stopped: true,
  });
  tunnelEvents.removeAllListeners();
}

afterEach(() => {
  resetTunnelState();
  setRunner(null);
  setSpawner(null);
  dns.lookup = realLookup;
  assert.deepEqual(blockedExecs.splice(0), [], 'no synchronous devtunnel/taskkill calls');
});

// --- Tests --------------------------------------------------------------------

describe('classifyError', () => {
  it('classifies real devtunnel / network messages', () => {
    const cases = [
      [GONE_MSG, 'gone'],
      [EXPIRED_MSG, 'gone'],
      ['Tunnel has expired', 'gone'],
      ['Error: Tunnel not found', 'gone'],
      ['Login required', 'auth'],
      ['Not logged in.', 'auth'],
      ['Sign in required to host tunnels', 'auth'],
      ['Please login with `devtunnel user login`', 'auth'],
      ['getaddrinfo ENOTFOUND global.rel.tunnels.api.visualstudio.com', 'network'],
      ['nodename nor servname provided, or not known', 'network'],
      ['connect ECONNREFUSED 20.0.0.1:443', 'network'],
      ['read ECONNRESET', 'network'],
      ['connect ETIMEDOUT 20.0.0.1:443', 'network'],
      ['getaddrinfo EAI_AGAIN uks1.rel.tunnels.api.visualstudio.com', 'network'],
      ['No such host is known.', 'network'],
      ['Network is unreachable', 'network'],
      ['Temporary failure in name resolution', 'network'],
      ['Something unexpected happened', 'unknown'],
      ['', 'unknown'],
      [null, 'unknown'],
      [undefined, 'unknown'],
    ];
    for (const [message, expected] of cases) {
      assert.equal(classifyError(message), expected, String(message));
    }
  });

  it('prefers auth over gone over network when several patterns match', () => {
    assert.equal(classifyError('Login required: tunnel not found'), 'auth');
    assert.equal(classifyError('Tunnel not found (getaddrinfo ENOTFOUND)'), 'gone');
  });
});

describe('parseHostConnections', () => {
  it('reads hostConnections from --json output surrounded by CLI noise', () => {
    assert.equal(parseHostConnections(showJson(2).stdout), 2);
    assert.equal(parseHostConnections(`${showJson(0).stdout}\nTip: run devtunnel host\n`), 0);
  });

  it('falls back to the human-readable format', () => {
    const text = `Tunnel ID             : ${OLD_ID}\nDescription           :\nHost connections      : 3\nClient connections    : 0\n`;
    assert.equal(parseHostConnections(text), 3);
    assert.equal(parseHostConnections('host connections: 1'), 1);
  });

  it('falls back to text when the JSON is broken or lacks the field', () => {
    assert.equal(parseHostConnections('{ broken json }\nHost connections: 4'), 4);
    assert.equal(parseHostConnections('{"tunnel":{"hostConnections":"2"}}'), null);
    assert.equal(parseHostConnections('{"other":1}'), null);
  });

  it('returns null for garbage', () => {
    for (const garbage of ['', 'nothing to see', '}{', null, undefined, 42]) {
      assert.equal(parseHostConnections(garbage), null, String(garbage));
    }
  });
});

describe('hostTunnel', () => {
  it('resolves { url } once `devtunnel host` prints the public URL', async () => {
    seed({ hostProc: null });
    const spawned = installSpawner();
    const pending = hostTunnel();
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawned[0].args, ['host', OLD_ID]);
    assert.equal(state.hostProc, spawned[0]);

    spawned[0].stdout.emit(
      'data',
      Buffer.from('Hosting port: 3456\nConnect via browser: https://happy-oc'),
    );
    spawned[0].stdout.emit(
      'data',
      Buffer.from(
        `ean-5rshhtb-3456.uks1.devtunnels.ms/\nInspect network activity: ${OLD_URL.replace('-3456', '-3456-inspect')}\n`,
      ),
    );
    assert.deepEqual(await pending, { url: OLD_URL });
    assert.equal(state.hostProc, spawned[0], 'host process kept running');
    assert.match(state.hostOutput, /Hosting port/);
  });

  it('takes only the first URL when the CLI prints a comma-separated list', async () => {
    seed({ hostProc: null });
    const spawned = installSpawner();
    const pending = hostTunnel();
    spawned[0].stdout.emit(
      'data',
      Buffer.from(
        'Connect via browser: https://abc12-3456.uks1.devtunnels.ms, https://abc12.uks1.devtunnels.ms:3456\n',
      ),
    );
    assert.deepEqual(await pending, { url: 'https://abc12-3456.uks1.devtunnels.ms' });
  });

  it('waits for the end of the URL when a chunk splits it before the port', async () => {
    seed({ hostProc: null });
    const spawned = installSpawner();
    const pending = hostTunnel();
    let settled = false;
    pending.then(() => (settled = true));
    spawned[0].stdout.emit(
      'data',
      Buffer.from('Connect via browser: https://abc12.uks1.devtunnels.ms'),
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(settled, false, 'must not resolve with a truncated URL');
    spawned[0].stdout.emit('data', Buffer.from(':3456\n'));
    assert.deepEqual(await pending, { url: 'https://abc12.uks1.devtunnels.ms:3456' });
  });

  it('resolves { kind: "gone" } when the host exits with "Tunnel not found"', async () => {
    seed({ hostProc: null });
    const spawned = installSpawner();
    const pending = hostTunnel();
    spawned[0].stderr.emit('data', Buffer.from(`${GONE_MSG}\n`));
    spawned[0].emit('exit', 1, null);
    const result = await pending;
    assert.equal(result.kind, 'gone');
    assert.match(result.output, /Tunnel not found in uks1/);
    assert.equal(state.hostProc, null);
  });

  it('classifies other early exits (auth / expired / unknown)', async () => {
    for (const [output, kind] of [
      ['Login required\n', 'auth'],
      [`${EXPIRED_MSG}\n`, 'gone'],
      ['boom\n', 'unknown'],
    ]) {
      seed({ hostProc: null });
      const spawned = installSpawner();
      const pending = hostTunnel();
      spawned[0].stdout.emit('data', output);
      spawned[0].emit('exit', 1, null);
      assert.equal((await pending).kind, kind, output);
    }
  });

  it('resolves (never rejects) on a spawn error', async () => {
    seed({ hostProc: null });
    const spawned = installSpawner();
    const pending = hostTunnel();
    spawned[0].emit('error', new Error('spawn devtunnel ENOENT'));
    assert.deepEqual(await pending, { kind: 'unknown', output: 'spawn devtunnel ENOENT' });
    assert.equal(state.hostProc, null);
  });

  it('kills the host and reports a timeout when no URL appears in time', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    seed({ hostProc: null });
    const spawned = installSpawner();
    const pending = hostTunnel();
    spawned[0].stdout.emit('data', 'Connecting to host tunnel relay...\n');
    t.mock.timers.tick(20_000);
    const result = await pending;
    assert.equal(result.kind, 'timeout');
    assert.equal(spawned[0].killSignal, 'SIGKILL');
    assert.equal(state.hostProc, null);

    seed({ hostProc: null });
    const pending2 = hostTunnel();
    spawned[1].stderr.emit(
      'data',
      'getaddrinfo ENOTFOUND uks1-data.rel.tunnels.api.visualstudio.com\n',
    );
    t.mock.timers.tick(20_000);
    assert.equal((await pending2).kind, 'network');
  });

  it('emits relay-lost / relay-restored for relay status lines after connecting', async () => {
    seed({ hostProc: null });
    const events = recordEvents();
    const spawned = installSpawner();
    const pending = hostTunnel();
    spawned[0].stdout.emit('data', `Connect via browser: ${OLD_URL}\n`);
    await pending;

    spawned[0].stdout.emit('data', 'Connection to host tunnel relay lost. Reconnecting...\n');
    spawned[0].stderr.emit('data', 'Host relay connection closed unexpectedly\n');
    spawned[0].stdout.emit('data', 'Connection to host tunnel relay restored.\n');
    spawned[0].stdout.emit('data', 'Forwarding from 127.0.0.1:3456\n');
    assert.deepEqual(names(events), ['relay-lost', 'relay-lost', 'relay-restored']);

    // Output from a superseded host process is ignored
    state.hostProc = createFakeProc();
    spawned[0].stdout.emit('data', 'Connection to host tunnel relay lost.\n');
    assert.equal(events.length, 3);
  });

  it('a connected host that exits triggers a scheduled restart', async () => {
    seed({ hostProc: null });
    const events = recordEvents();
    const spawned = installSpawner();
    const pending = hostTunnel();
    spawned[0].stdout.emit('data', `Connect via browser: ${OLD_URL}\n`);
    await pending;

    spawned[0].emit('exit', 0, 'SIGTERM');
    assert.equal(state.hostProc, null);
    assert.deepEqual(events, [
      ['disconnected', undefined],
      ['reconnecting', { attempt: 1, delay: 1000 }],
    ]);
    assert.equal(state.restarting, true);
    assert.ok(state.restartTimer, 'restart is queued');
  });

  it('a connected host that exits because the tunnel is gone starts recovery', async () => {
    seed({ hostProc: null });
    const events = recordEvents();
    const calls = installRunner();
    const spawned = installSpawner();
    const pending = hostTunnel();
    spawned[0].stdout.emit('data', `Connect via browser: ${OLD_URL}\n`);
    await pending;

    spawned[0].stderr.emit('data', `${GONE_MSG}\n`);
    spawned[0].emit('exit', 1, null);
    await waitFor(() => events.some(([n]) => n === 'reconnecting'), 'restart after extend');
    assert.deepEqual(calls[0], ['update', OLD_ID, '--expiration', '1d']);
    assert.equal(state.recovering, false);
  });

  it('ignores exits from stale processes and after shutdown', async () => {
    seed({ hostProc: null });
    const events = recordEvents();
    const spawned = installSpawner();
    const pending = hostTunnel();
    spawned[0].stdout.emit('data', `Connect via browser: ${OLD_URL}\n`);
    await pending;

    const replacement = createFakeProc();
    state.hostProc = replacement;
    spawned[0].emit('exit', 1, null);
    assert.equal(state.hostProc, replacement);

    state.hostProc = spawned[0];
    state.stopped = true;
    spawned[0].emit('exit', 1, null);
    assert.deepEqual(events, []);
  });
});

describe('checkTunnelHealth', () => {
  it('resets the failure count when the host is connected, and runs the healthy side jobs', async () => {
    seed({ consecutiveFailures: 1, lastExtendAt: 0, loginInfoAt: 0 });
    const calls = installRunner((args) =>
      args.join(' ') === 'user show -v'
        ? ok('Logged in as dev@example.com using Microsoft.\nToken lifetime: 0:30:00\n')
        : undefined,
    );
    await checkTunnelHealth();
    assert.equal(state.consecutiveFailures, 0);
    assert.deepEqual(calls[0], ['show', OLD_ID, '--json']);
    await flush();
    assert.ok(
      calls.some((a) => a.join(' ') === `update ${OLD_ID} --expiration 1d`),
      'expiry extended',
    );
    assert.deepEqual(state.loginInfo, { provider: 'microsoft', tokenLifetimeSeconds: 1800 });
    assert.equal(state.expiryWarned, true, 'token expiry warning raised');
  });

  it('counts 0 host connections and restarts after the grace period', async () => {
    const hostProc = seed();
    const events = recordEvents();
    installRunner((args) => (args[0] === 'show' ? showJson(0) : undefined));
    await checkTunnelHealth();
    assert.equal(state.consecutiveFailures, 1);
    assert.deepEqual(events, []);

    await checkTunnelHealth();
    assert.equal(state.consecutiveFailures, constants.HEALTH_CHECK_GRACE);
    assert.deepEqual(events, [
      ['disconnected', undefined],
      ['reconnecting', { attempt: 1, delay: 1000 }],
    ]);
    assert.equal(hostProc.killSignal, 'SIGKILL');
    assert.equal(state.hostProc, null);
    assert.equal(state.restarting, true);
    assert.ok(state.restartTimer);
  });

  it('backs off exponentially and gives up into network-wait after MAX_RESTART_ATTEMPTS', async () => {
    seed({ consecutiveFailures: 1, restartAttempts: 3 });
    let events = recordEvents();
    installRunner((args) => (args[0] === 'show' ? showJson(0) : undefined));
    await checkTunnelHealth();
    assert.deepEqual(events.at(-1), ['reconnecting', { attempt: 4, delay: 10_000 }]);

    resetTunnelState();
    stubDns(false);
    seed({ consecutiveFailures: 1, restartAttempts: constants.MAX_RESTART_ATTEMPTS });
    events = recordEvents();
    await checkTunnelHealth();
    assert.deepEqual(names(events), ['disconnected', 'failed', 'network-lost']);
    assert.deepEqual(events[1][1], { attempts: constants.MAX_RESTART_ATTEMPTS });
    assert.equal(state.waitingForNetwork, true);
    assert.equal(state.restartTimer, null);
    await flush();
  });

  it('counts unparseable output as a failure', async () => {
    seed();
    installRunner((args) => (args[0] === 'show' ? ok('¯\\_(ツ)_/¯') : undefined));
    await checkTunnelHealth();
    assert.equal(state.consecutiveFailures, 1);
  });

  it('recovers a gone tunnel ("Tunnel not found" / "Tunnel Expiration")', async () => {
    for (const message of [GONE_MSG, EXPIRED_MSG]) {
      seed();
      const events = recordEvents();
      const calls = installRunner((args) => (args[0] === 'show' ? fail(message) : undefined));
      await checkTunnelHealth();
      assert.deepEqual(calls[1], ['update', OLD_ID, '--expiration', '1d'], message);
      assert.deepEqual(names(events), ['disconnected', 'reconnecting']);
      assert.equal(
        calls.some((a) => a[0] === 'create'),
        false,
      );
      resetTunnelState();
    }
  });

  it('pauses for re-authentication on an auth error', async () => {
    const hostProc = seed();
    const events = recordEvents();
    installRunner((args) => (args[0] === 'show' ? fail('Login required') : undefined));
    await checkTunnelHealth();
    assert.deepEqual(names(events), ['disconnected', 'auth-expired']);
    assert.equal(state.waitingForAuth, true);
    assert.ok(state.authTimer);
    assert.equal(hostProc.killSignal, 'SIGKILL');
  });

  it('pauses for connectivity on a network error', async () => {
    seed();
    const events = recordEvents();
    const lookups = stubDns(false);
    installRunner((args) =>
      args[0] === 'show'
        ? fail('getaddrinfo ENOTFOUND global.rel.tunnels.api.visualstudio.com')
        : undefined,
    );
    await checkTunnelHealth();
    assert.deepEqual(names(events), ['disconnected', 'network-lost']);
    assert.equal(state.waitingForNetwork, true);
    assert.ok(state.networkTimer);
    await waitFor(() => lookups.length === 1, 'immediate network probe');
    await flush();
    assert.equal(state.waitingForNetwork, true, 'still offline');
  });

  it('treats an unexplained failure as an expired login when the CLI is logged out', async () => {
    seed();
    const events = recordEvents();
    installRunner((args) => {
      if (args[0] === 'show') return fail('Unexpected error 500');
      if (args.join(' ') === 'user show') return ok('Not logged in.\n');
      return undefined;
    });
    await checkTunnelHealth();
    assert.deepEqual(names(events), ['disconnected', 'auth-expired']);
  });

  it('counts an unexplained failure while still logged in', async () => {
    seed();
    installRunner((args) => (args[0] === 'show' ? fail('Unexpected error 500') : undefined));
    await checkTunnelHealth();
    assert.equal(state.consecutiveFailures, 1);
  });

  it('does nothing while stopped, recovering, waiting, restarting or already checking', async () => {
    const skips = [
      { stopped: true },
      { tunnelId: null },
      { hostProc: null },
      { restarting: true },
      { waitingForAuth: true },
      { waitingForNetwork: true },
      { recovering: true },
      { checking: true },
    ];
    for (const overrides of skips) {
      seed(overrides);
      const calls = installRunner();
      await checkTunnelHealth();
      assert.deepEqual(calls, [], JSON.stringify(overrides));
    }
  });

  it('drops a result that arrives after a restart has begun', async () => {
    seed();
    let resolveShow;
    installRunner((args) =>
      args[0] === 'show' ? new Promise((r) => (resolveShow = r)) : undefined,
    );
    const pending = checkTunnelHealth();
    state.restarting = true;
    resolveShow(showJson(0));
    await pending;
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(state.checking, false);
  });
});

describe('recoverGoneTunnel', () => {
  it('extends the tunnel in place and schedules a restart when `update --expiration` succeeds', async () => {
    const hostProc = seed();
    const events = recordEvents();
    const calls = installRunner();
    const before = Date.now();
    await recoverGoneTunnel('test');
    assert.deepEqual(calls, [['update', OLD_ID, '--expiration', '1d']]);
    assert.equal(
      calls.some((a) => a[0] === 'create'),
      false,
      'no new tunnel',
    );
    assert.equal(state.tunnelId, OLD_ID, 'URL is preserved');
    assert.ok(state.lastRecoveryExtendAt >= before);
    assert.equal(state.recovering, false);
    assert.equal(state.restarting, true);
    assert.ok(state.restartTimer);
    assert.equal(hostProc.killSignal, 'SIGKILL');
    assert.deepEqual(events, [
      ['disconnected', undefined],
      ['reconnecting', { attempt: 1, delay: 1000 }],
    ]);
  });

  it('re-creates the tunnel when it cannot be extended, hosts it and announces the new URL', async () => {
    seed();
    const events = recordEvents();
    const calls = installRunner((args) => (args[0] === 'update' ? fail(GONE_MSG) : undefined));
    const spawned = installSpawner(printsUrl(NEW_URL));
    await recoverGoneTunnel('test');

    assert.deepEqual(calls, [
      ['update', OLD_ID, '--expiration', '1d'],
      ['create', '--expiration', '1d', '--json'],
      ['port', 'create', NEW_ID, '-p', '3456', '--protocol', 'http'],
      ['access', 'reset', NEW_ID],
    ]);
    assert.deepEqual(spawned[0].args, ['host', NEW_ID]);
    assert.equal(state.tunnelId, NEW_ID);
    assert.equal(state.url, NEW_URL);
    assert.equal(state.recovering, false);
    assert.equal(state.restarting, false);
    assert.ok(state.lastRecreateAt > 0);
    assert.ok(state.healthTimer, 'health checks resume');
    assert.deepEqual(events, [
      ['disconnected', undefined],
      ['recreated', { tunnelId: NEW_ID, previousId: OLD_ID }],
      ['connected', { url: NEW_URL }],
      ['url-changed', { url: NEW_URL, previousUrl: OLD_URL }],
    ]);
  });

  it('re-creates anonymous tunnels with anonymous access', async () => {
    seed({ anonymous: true, persisted: false });
    const calls = installRunner((args) => (args[0] === 'update' ? fail(GONE_MSG) : undefined));
    installSpawner(printsUrl(NEW_URL));
    await recoverGoneTunnel('test');
    assert.deepEqual(calls.at(-1), ['access', 'create', NEW_ID, '-p', '3456', '--anonymous']);
  });

  it('skips the extend attempt right after a failed extend+restart cycle', async () => {
    seed({ lastRecoveryExtendAt: Date.now() });
    const calls = installRunner();
    installSpawner(printsUrl(NEW_URL));
    await recoverGoneTunnel('restart');
    assert.deepEqual(calls[0], ['create', '--expiration', '1d', '--json']);
    assert.equal(state.tunnelId, NEW_ID);
  });

  it('backs off instead of re-creating again moments after a re-create', async () => {
    seed({ lastRecreateAt: Date.now() });
    const events = recordEvents();
    const calls = installRunner((args) => (args[0] === 'update' ? fail(GONE_MSG) : undefined));
    await recoverGoneTunnel('test');
    assert.equal(
      calls.some((a) => a[0] === 'create'),
      false,
    );
    assert.equal(state.tunnelId, OLD_ID);
    assert.deepEqual(names(events), ['disconnected', 'reconnecting']);
  });

  it('waits for the network when re-creating fails with a network error', async () => {
    seed();
    const events = recordEvents();
    stubDns(false);
    installRunner((args) => {
      if (args[0] === 'update') return fail(GONE_MSG);
      if (args[0] === 'create')
        return fail('getaddrinfo ENOTFOUND global.rel.tunnels.api.visualstudio.com');
      return undefined;
    });
    await recoverGoneTunnel('test');
    assert.deepEqual(names(events), ['disconnected', 'network-lost']);
    assert.equal(state.waitingForNetwork, true);
    assert.equal(state.recovering, false);
    assert.equal(state.restartTimer, null);
    await flush();
  });

  it('retries later when re-creating fails while the network is fine', async () => {
    seed();
    const events = recordEvents();
    const lookups = stubDns(true);
    installRunner((args) => {
      if (args[0] === 'update') return fail(GONE_MSG);
      if (args[0] === 'create') return fail('Rate limit exceeded');
      return undefined;
    });
    await recoverGoneTunnel('test');
    assert.equal(lookups.length, 1);
    assert.deepEqual(names(events), ['disconnected', 'reconnecting']);
    assert.equal(state.tunnelId, OLD_ID);
  });

  it('schedules a restart when the re-created tunnel does not come up', async () => {
    seed();
    const events = recordEvents();
    installRunner((args) => (args[0] === 'update' ? fail(GONE_MSG) : undefined));
    installSpawner((proc) =>
      setImmediate(() => {
        proc.stderr.emit('data', 'Something went wrong\n');
        proc.emit('exit', 1, null);
      }),
    );
    await recoverGoneTunnel('test');
    assert.equal(state.tunnelId, NEW_ID);
    assert.deepEqual(names(events), ['disconnected', 'recreated', 'reconnecting']);
  });

  it('is a no-op while already recovering or after shutdown', async () => {
    for (const overrides of [{ recovering: true }, { stopped: true }]) {
      seed(overrides);
      const events = recordEvents();
      const calls = installRunner();
      await recoverGoneTunnel('test');
      assert.deepEqual(calls, []);
      assert.deepEqual(events, []);
      tunnelEvents.removeAllListeners();
    }
  });

  it('a queued restart re-hosts the extended tunnel and reports it connected', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    seed();
    const events = recordEvents();
    installRunner();
    const spawned = installSpawner(printsUrl(OLD_URL));
    await recoverGoneTunnel('test');
    assert.ok(state.restartTimer);

    t.mock.timers.tick(1000);
    await waitFor(() => events.some(([n]) => n === 'connected'), 'reconnect');
    assert.deepEqual(spawned[0].args, ['host', OLD_ID]);
    assert.equal(state.restarting, false);
    assert.equal(state.restartAttempts, 0);
    assert.equal(names(events).includes('url-changed'), false, 'same URL after extending');
  });
});

describe('onSystemResume', () => {
  it('sets failures to grace-1 and immediately runs a health check', async () => {
    seed();
    const events = recordEvents();
    let resolveShow;
    const calls = installRunner((args) =>
      args[0] === 'show' ? new Promise((r) => (resolveShow = r)) : undefined,
    );
    onSystemResume(5 * 60_000);
    assert.deepEqual(events, [['resumed', { sleptMs: 300_000 }]]);
    assert.equal(state.consecutiveFailures, constants.HEALTH_CHECK_GRACE - 1);
    assert.deepEqual(calls, [['show', OLD_ID, '--json']]);

    // One more failure after waking is enough to restart
    resolveShow(showJson(0));
    await waitFor(() => !state.checking, 'health check');
    assert.deepEqual(names(events), ['resumed', 'disconnected', 'reconnecting']);
  });

  it('clears the failure count when the tunnel survived the sleep', async () => {
    seed();
    installRunner();
    onSystemResume(60_000);
    await waitFor(() => !state.checking, 'health check');
    assert.equal(state.consecutiveFailures, 0);
    assert.equal(state.restartTimer, null);
  });

  it('only probes the network while waiting for connectivity', async () => {
    seed({ waitingForNetwork: true });
    const lookups = stubDns(false);
    const calls = installRunner();
    onSystemResume(60_000);
    await waitFor(() => lookups.length === 1, 'network probe');
    await flush();
    assert.deepEqual(calls, []);
  });

  it('does not interfere while waiting for auth or already restarting', () => {
    for (const overrides of [{ waitingForAuth: true }, { restarting: true }]) {
      seed(overrides);
      const calls = installRunner();
      onSystemResume(60_000);
      assert.deepEqual(calls, []);
      assert.equal(state.consecutiveFailures, 0);
    }
  });

  it('is ignored after shutdown', () => {
    seed({ stopped: true });
    const events = recordEvents();
    const calls = installRunner();
    onSystemResume(60_000);
    assert.deepEqual(events, []);
    assert.deepEqual(calls, []);
  });
});

describe('cleanupTunnel', () => {
  it('stops every timer, kills the host and keeps persisted tunnels', async () => {
    const hostProc = seed({ persisted: true });
    installRunner((args) => (args[0] === 'show' ? fail('Login required') : undefined));
    await checkTunnelHealth(); // → auth wait (authTimer)
    state.restartTimer = setTimeout(() => assert.fail('restart should be cancelled'), 1000);
    state.hostProc = hostProc;

    cleanupTunnel();
    assert.equal(state.stopped, true);
    assert.equal(state.tunnelId, null);
    assert.equal(state.hostProc, null);
    assert.equal(hostProc.killSignal, 'SIGKILL');
    assert.equal(state.authTimer, null);
    assert.equal(state.waitingForAuth, false);
    assert.equal(state.restartTimer, null);
    assert.equal(state.healthTimer, null);
    assert.equal(state.url, null);
  });
});
