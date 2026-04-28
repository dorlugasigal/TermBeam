const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  sanitize,
  getDefaults,
  readPreferences,
  writePreferences,
  PREFS_FILENAME,
} = require('../../src/server/preferences');

describe('preferences sanitize()', () => {
  it('returns defaults for empty input', () => {
    const d = getDefaults();
    assert.strictEqual(d.themeId, 'dracula');
    assert.strictEqual(d.fontSize, 14);
    assert.strictEqual(d.notifications, false);
    assert.strictEqual(d.haptics, true);
    assert.strictEqual(d.touchBarCollapsed, false);
    assert.strictEqual(d.touchBarKeys, null);
    assert.deepStrictEqual(d.startupWorkspace, { enabled: false, sessions: [] });
  });

  it('clamps fontSize within 2..32', () => {
    assert.strictEqual(sanitize({ fontSize: 0 }).fontSize, 2);
    assert.strictEqual(sanitize({ fontSize: 999 }).fontSize, 32);
    assert.strictEqual(sanitize({ fontSize: 15.7 }).fontSize, 16);
    assert.strictEqual(sanitize({ fontSize: 'twelve' }).fontSize, 14);
    assert.strictEqual(sanitize({ fontSize: NaN }).fontSize, 14);
  });

  it('coerces booleans and rejects bad types', () => {
    const s = sanitize({ notifications: 'yes', haptics: 0, touchBarCollapsed: null });
    assert.strictEqual(s.notifications, false);
    assert.strictEqual(s.haptics, true);
    assert.strictEqual(s.touchBarCollapsed, false);
  });

  it('drops unknown keys silently (forward compat)', () => {
    const s = sanitize({ futureFeature: 'x', themeId: 'nord' });
    assert.strictEqual(s.themeId, 'nord');
    assert.strictEqual('futureFeature' in s, false);
  });

  it('caps long strings', () => {
    const long = 'a'.repeat(10_000);
    const s = sanitize({ defaultInitialCommand: long });
    assert.ok(s.defaultInitialCommand.length <= 1024);
  });

  it('sanitizes touchBarKeys list, capping length and validating shape', () => {
    const keys = [];
    for (let i = 0; i < 100; i++) keys.push({ id: `k${i}`, label: 'L', send: '\u001b' });
    keys.push({ id: '', label: 'X', send: 'x' }); // missing id - skipped
    keys.push({ label: 'no-id', send: 'y' }); // missing id - skipped
    keys.push({ id: 'modtest', label: 'C', send: '', modifier: 'ctrl' });
    keys.push({ id: 'badmod', label: 'B', send: '', modifier: 'super' });
    const s = sanitize({ touchBarKeys: keys });
    assert.ok(Array.isArray(s.touchBarKeys));
    assert.ok(s.touchBarKeys.length <= 32);
    const mod = s.touchBarKeys.find((k) => k.id === 'modtest');
    if (mod) assert.strictEqual(mod.modifier, 'ctrl');
  });

  it('caps touchBarKeys send length', () => {
    const huge = '\u001b'.repeat(500);
    const s = sanitize({ touchBarKeys: [{ id: 'a', label: 'A', send: huge }] });
    assert.ok(s.touchBarKeys[0].send.length <= 64);
  });

  it('passes through null touchBarKeys (use defaults)', () => {
    assert.strictEqual(sanitize({ touchBarKeys: null }).touchBarKeys, null);
    // Non-array, non-null values become null too
    assert.strictEqual(sanitize({ touchBarKeys: 'oops' }).touchBarKeys, null);
  });

  it('sanitizes startupWorkspace', () => {
    const s = sanitize({
      startupWorkspace: {
        enabled: true,
        sessions: [
          { id: 's1', name: 'API', kind: 'shell', cwd: '~/api', initialCommand: 'npm run dev' },
          { id: 's2', name: 'Agent', kind: 'agent', agentId: 'copilot' },
          { id: '', name: 'no-id' }, // dropped
          { name: 'no-id-either' }, // dropped
          { id: 's3', name: 'unknown-kind', kind: 'wat' }, // kind coerced to shell
        ],
      },
    });
    assert.strictEqual(s.startupWorkspace.enabled, true);
    assert.strictEqual(s.startupWorkspace.sessions.length, 3);
    assert.strictEqual(s.startupWorkspace.sessions[0].kind, 'shell');
    assert.strictEqual(s.startupWorkspace.sessions[1].kind, 'agent');
    assert.strictEqual(s.startupWorkspace.sessions[1].agentId, 'copilot');
    assert.strictEqual(s.startupWorkspace.sessions[2].kind, 'shell');
  });

  it('caps startupWorkspace.sessions length', () => {
    const sessions = [];
    for (let i = 0; i < 100; i++) sessions.push({ id: `id${i}`, name: `s${i}` });
    const s = sanitize({ startupWorkspace: { enabled: true, sessions } });
    assert.ok(s.startupWorkspace.sessions.length <= 16);
  });
});

describe('preferences read/write', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults + version 0 when file is missing', () => {
    const { prefs, version } = readPreferences(tmpDir);
    assert.strictEqual(version, 0);
    assert.strictEqual(prefs.themeId, 'dracula');
  });

  it('writes prefs.json with mode 0o600 and increments version', () => {
    const r1 = writePreferences(tmpDir, { themeId: 'nord', fontSize: 18 });
    assert.strictEqual(r1.version, 1);
    assert.strictEqual(r1.prefs.themeId, 'nord');
    assert.strictEqual(r1.prefs.fontSize, 18);

    const file = path.join(tmpDir, PREFS_FILENAME);
    const stat = fs.statSync(file);
    // mode bits: rw for owner only
    assert.strictEqual(stat.mode & 0o777, 0o600);

    const r2 = writePreferences(tmpDir, { themeId: 'solarized' });
    assert.strictEqual(r2.version, 2);
    assert.strictEqual(r2.prefs.themeId, 'solarized');
  });

  it('round-trips through read after write', () => {
    writePreferences(tmpDir, {
      themeId: 'monokai',
      fontSize: 22,
      haptics: false,
      touchBarKeys: [{ id: 'esc', label: 'ESC', send: '\u001b' }],
    });
    const { prefs, version } = readPreferences(tmpDir);
    assert.strictEqual(version, 1);
    assert.strictEqual(prefs.themeId, 'monokai');
    assert.strictEqual(prefs.fontSize, 22);
    assert.strictEqual(prefs.haptics, false);
    assert.strictEqual(prefs.touchBarKeys.length, 1);
  });

  it('returns defaults when prefs.json is corrupt', () => {
    fs.writeFileSync(path.join(tmpDir, PREFS_FILENAME), '{not valid json');
    const { prefs, version } = readPreferences(tmpDir);
    assert.strictEqual(version, 0);
    assert.strictEqual(prefs.themeId, 'dracula');
  });
});
