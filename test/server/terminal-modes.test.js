'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { TerminalModeTracker } = require('../../src/server/terminal-modes');

// What GitHub Copilot CLI emits when it starts: alt screen, bracketed paste,
// focus events, any-motion mouse tracking + SGR encoding, hidden cursor.
const COPILOT_STARTUP = '\x1b[?1049h\x1b[?2004h\x1b[?1004h\x1b[?1003h\x1b[?1006h\x1b[?25l';
const COPILOT_SESSION =
  'Welcome to GitHub Copilot CLI\r\n' +
  COPILOT_STARTUP +
  '\x1b[2J\x1b[H\x1b[38;5;141m> \x1b[0mHow can I help?\x1b]11;?\x07\x1b[?2026h\x1b[?2026l';

const DEFAULT_RESTORE = '\x1b[?1;1004;2004;1000;1006l\x1b[?7;25h';

function snapshot(t) {
  return {
    flags: Object.fromEntries(t.flags),
    mouseProtocol: t.mouseProtocol,
    mouseEncoding: t.mouseEncoding,
    altScreenMode: t.altScreenMode,
    inAltScreen: t.inAltScreen,
    restore: t.restoreSequence(),
    nonDefault: t.hasNonDefaultModes(),
  };
}

function track(...chunks) {
  const t = new TerminalModeTracker();
  for (const c of chunks) t.feed(c);
  return t;
}

/** Deterministic PRNG so chunk splits are reproducible. */
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomChunks(str, rand, maxLen = 8) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    const n = 1 + Math.floor(rand() * maxLen);
    out.push(str.slice(i, i + n));
    i += n;
  }
  return out;
}

/** Parse "ESC[?a;b;cl ESC[?d;eh" → { resets: [...], sets: [...] } */
function parseRestore(seq) {
  const m = /^\x1b\[\?([\d;]+)l(?:\x1b\[\?([\d;]+)h)?$/.exec(seq);
  assert.ok(m, `unexpected restore sequence ${JSON.stringify(seq)}`);
  return {
    resets: m[1].split(';').map(Number),
    sets: m[2] ? m[2].split(';').map(Number) : [],
  };
}

describe('TerminalModeTracker', () => {
  describe('power-on defaults', () => {
    it('starts with the xterm defaults', () => {
      const t = new TerminalModeTracker();
      assert.deepEqual(snapshot(t), {
        flags: { 1: false, 7: true, 25: true, 1004: false, 2004: false },
        mouseProtocol: 0,
        mouseEncoding: 0,
        altScreenMode: null,
        inAltScreen: false,
        restore: DEFAULT_RESTORE,
        nonDefault: false,
      });
    });

    it('ignores empty and non-string input', () => {
      const t = track('', null, undefined, 42, Buffer.from('\x1b[?1003h'));
      assert.deepEqual(snapshot(t), snapshot(new TerminalModeTracker()));
    });
  });

  describe('Copilot CLI startup', () => {
    const expected = {
      flags: { 1: false, 7: true, 25: false, 1004: true, 2004: true },
      mouseProtocol: 1003,
      mouseEncoding: 1006,
      altScreenMode: '1049',
      inAltScreen: true,
      restore: '\x1b[?1;25;1000l\x1b[?7;1004;2004;1003;1006h',
      nonDefault: true,
    };

    it('tracks every mode from a single chunk', () => {
      assert.deepEqual(snapshot(track(COPILOT_SESSION)), expected);
    });

    it('reaches the same state when fed byte by byte', () => {
      assert.deepEqual(snapshot(track(...COPILOT_SESSION.split(''))), expected);
    });

    it('reaches the same state for random chunk splits', () => {
      for (let seed = 1; seed <= 300; seed++) {
        const chunks = randomChunks(COPILOT_SESSION, mulberry32(seed), 1 + (seed % 12));
        assert.deepEqual(snapshot(track(...chunks)), expected, `seed ${seed}`);
      }
    });

    it('keeps tracking across a long stream of unrelated output', () => {
      const noise = 'line of output \x1b[1;32mgreen\x1b[0m\r\n'.repeat(5000);
      const t = track(COPILOT_STARTUP, noise, noise);
      assert.deepEqual(snapshot(t), expected);
      assert.equal(t._tail, '');
    });
  });

  describe('sequence parsing', () => {
    it('applies combined parameters (CSI ? Pm;Pm h)', () => {
      const t = track('\x1b[?1049;1006h');
      assert.equal(t.altScreenMode, '1049');
      assert.equal(t.mouseEncoding, 1006);
      t.feed('\x1b[?1003;1006;25l');
      assert.equal(t.mouseProtocol, 0);
      assert.equal(t.mouseEncoding, 0);
      assert.equal(t.flags.get(25), false);
    });

    it('skips empty parameters and ignores untracked modes', () => {
      const t = track('\x1b[?;1006h', '\x1b[?12h\x1b[?2026h\x1b[?5h\x1b[?9999h');
      assert.equal(t.mouseEncoding, 1006);
      assert.deepEqual(Object.fromEntries(t.flags), {
        1: false,
        7: true,
        25: true,
        1004: false,
        2004: false,
      });
    });

    it('does not confuse non-private CSI sequences with DEC modes', () => {
      const t = track('\x1b[1003h\x1b[25l\x1b[?1h');
      assert.equal(t.mouseProtocol, 0);
      assert.equal(t.flags.get(25), true);
      assert.equal(t.flags.get(1), true);
    });

    it('carries an escape sequence split right after ESC', () => {
      const t = track('output\x1b', '[?1003h');
      assert.equal(t.mouseProtocol, 1003);
    });
  });

  describe('mouse tracking semantics (mirror xterm.js)', () => {
    it('mouse protocols are mutually exclusive — the last one set wins', () => {
      const t = track('\x1b[?1000h');
      assert.equal(t.mouseProtocol, 1000);
      t.feed('\x1b[?1003h');
      assert.equal(t.mouseProtocol, 1003);
      t.feed('\x1b[?1002h');
      assert.equal(t.mouseProtocol, 1002);
      t.feed('\x1b[?9h');
      assert.equal(t.mouseProtocol, 9);
    });

    it('resetting any protocol disables mouse tracking', () => {
      for (const reset of [9, 1000, 1002, 1003]) {
        const t = track('\x1b[?1000h\x1b[?1003h', `\x1b[?${reset}l`);
        assert.equal(t.mouseProtocol, 0, `?${reset}l`);
      }
    });

    it('an encoding reset only clears the matching encoding', () => {
      const t = track('\x1b[?1006h', '\x1b[?1015l\x1b[?1005l\x1b[?1016l');
      assert.equal(t.mouseEncoding, 1006);
      t.feed('\x1b[?1006l');
      assert.equal(t.mouseEncoding, 0);
      t.feed('\x1b[?1005h\x1b[?1016h');
      assert.equal(t.mouseEncoding, 1016, 'last encoding set wins');
    });
  });

  describe('flags and alt screen', () => {
    it('tracks DECCKM, DECAWM, DECTCEM, focus and bracketed paste', () => {
      const t = track('\x1b[?1h\x1b[?7l\x1b[?25l\x1b[?1004h\x1b[?2004h');
      assert.deepEqual(Object.fromEntries(t.flags), {
        1: true,
        7: false,
        25: false,
        1004: true,
        2004: true,
      });
      t.feed('\x1b[?1l\x1b[?7h\x1b[?25h\x1b[?1004l\x1b[?2004l');
      assert.deepEqual(snapshot(t), snapshot(new TerminalModeTracker()));
    });

    it('tracks each alternate screen variant and leaves it on any reset', () => {
      for (const mode of ['47', '1047', '1049']) {
        const t = track(`\x1b[?${mode}h`);
        assert.equal(t.altScreenMode, mode);
        assert.equal(t.inAltScreen, true);
        t.feed('\x1b[?1049l');
        assert.equal(t.altScreenMode, null);
        assert.equal(t.inAltScreen, false);
      }
    });
  });

  describe('restoreSequence', () => {
    it('emits the default-state sequence for a fresh tracker', () => {
      assert.equal(new TerminalModeTracker().restoreSequence(), DEFAULT_RESTORE);
    });

    it('emits resets before sets so "mouse off" never clobbers the active protocol', () => {
      const t = track('\x1b[?1000h\x1b[?1006h');
      const seq = t.restoreSequence();
      const { resets, sets } = parseRestore(seq);
      assert.ok(resets.includes(1000), 'always resets whatever mouse mode the replay left on');
      assert.ok(sets.includes(1000), 'then re-enables the tracked protocol');
      assert.ok(seq.indexOf('l') < seq.indexOf('h'));
      assert.equal(resets.includes(1006), false, 'active encoding is not reset');
    });

    it('re-creates the exact input state on a terminal that replays it', () => {
      const scenarios = [
        COPILOT_SESSION,
        '\x1b[?1000h\x1b[?1015h\x1b[?1h',
        '\x1b[?9h\x1b[?7l',
        '\x1b[?1002h\x1b[?1006h\x1b[?1006l',
        '\x1b[?1003h\x1b[?1003l\x1b[?25l',
        '',
      ];
      for (const scenario of scenarios) {
        const original = track(scenario);
        // A client left with stale modes by the replay, then fed the restore.
        // (Only states xterm.js can really be in: it ignores 1005/1015, and
        // its ?1006l resets whichever encoding is active.)
        const stale = '\x1b[?1003h\x1b[?1006h\x1b[?1h\x1b[?2004h\x1b[?25l\x1b[?7l\x1b[?1004h';
        const client = track(stale, original.restoreSequence());
        const pick = (t) => ({
          flags: Object.fromEntries(t.flags),
          mouseProtocol: t.mouseProtocol,
          mouseEncoding: t.mouseEncoding,
        });
        assert.deepEqual(pick(client), pick(original), JSON.stringify(scenario));
      }
    });

    it('does not include alternate-screen switches (the replay adds those)', () => {
      const seq = track('\x1b[?1049h\x1b[?1003h').restoreSequence();
      assert.equal(/\b(47|1047|1049)\b/.test(seq), false);
    });
  });

  describe('hasNonDefaultModes', () => {
    it('reflects mouse modes and flags that differ from power-on defaults', () => {
      const t = new TerminalModeTracker();
      assert.equal(t.hasNonDefaultModes(), false);
      t.feed('\x1b[?1003h');
      assert.equal(t.hasNonDefaultModes(), true);
      t.feed('\x1b[?1003l');
      assert.equal(t.hasNonDefaultModes(), false);
      t.feed('\x1b[?1006h');
      assert.equal(t.hasNonDefaultModes(), true);
      t.feed('\x1b[?1006l\x1b[?25l');
      assert.equal(t.hasNonDefaultModes(), true);
      t.feed('\x1b[?25h');
      assert.equal(t.hasNonDefaultModes(), false);
    });

    it('does not count the alternate screen on its own', () => {
      assert.equal(track('\x1b[?1049h').hasNonDefaultModes(), false);
    });
  });

  describe('partial-sequence tail', () => {
    it('keeps an incomplete sequence (≤ 72 chars) and completes it with the next chunk', () => {
      const partial = `\x1b[?${'1;'.repeat(30)}`; // 63 chars
      const t = track(partial);
      assert.equal(t._tail, partial);
      t.feed('1003h');
      assert.equal(t._tail, '');
      assert.equal(t.flags.get(1), true);
      assert.equal(t.mouseProtocol, 1003);
    });

    it('discards an incomplete sequence longer than 72 chars', () => {
      const t = track(`\x1b[?${'1;'.repeat(40)}`); // 83 chars
      assert.equal(t._tail, '');
      t.feed('1003h');
      assert.equal(t.mouseProtocol, 0);
      assert.equal(t.flags.get(1), false);
    });

    it('drops the tail once the sequence turns out not to be a DEC mode switch', () => {
      const t = track('\x1b[?10');
      assert.equal(t._tail, '\x1b[?10');
      t.feed('xyz');
      assert.equal(t._tail, '');
      t.feed('\x1b[0m');
      assert.equal(t._tail, '');
    });

    it('never grows the tail beyond 72 chars, whatever the input', () => {
      const rand = mulberry32(42);
      const alphabet = ['\x1b', '[', '?', '1', '0', '6', ';', 'h', 'l', 'm', 'x', '\r\n'];
      const t = new TerminalModeTracker();
      for (let i = 0; i < 2000; i++) {
        let chunk = '';
        const len = 1 + Math.floor(rand() * 40);
        for (let j = 0; j < len; j++) chunk += alphabet[Math.floor(rand() * alphabet.length)];
        t.feed(chunk);
        assert.ok(t._tail.length <= 72, `tail grew to ${t._tail.length}`);
        assert.ok(t._tail === '' || t._tail.startsWith('\x1b'));
      }
    });
  });
});
